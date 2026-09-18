import { isSelfContainedHtml, normalizeEntry, PluginLoadError } from '../../../packages/plugin-sdk/src/bundle.ts'
import type { BundledPlugin } from '../../../packages/plugin-sdk/src/bundle.ts'
import type { PluginManifest } from './manifest.ts'
import type { PluginCommandBroker } from './PluginHostApi.ts'
import { brokerRpcHandlers } from './PanelRpcBridge.ts'
import type { PluginStorage } from './PluginStorage.ts'
import { WorkerRuntime } from './WorkerRuntime.ts'
import type { WorkerLike } from './WorkerRuntime.ts'
import { RpcBudget, MAX_RPC_CALLS_PER_WINDOW, RPC_RATE_WINDOW_MS } from './rpc.ts'
import type { ContributionBundle, ContributionOwner } from './types.ts'
import type { PluginAuditAction } from './PluginAudit.ts'

export * from '../../../packages/plugin-sdk/src/bundle.ts'

export type PluginLaunchDeps = Readonly<{
  /** Bind a validated manifest to a live broker session. */
  createSession: (manifest: PluginManifest) => PluginCommandBroker | Promise<PluginCommandBroker>
  /** Storage backing for `storage.*` RPC calls (may be undefined → UNAVAILABLE). */
  storage?: PluginStorage
  /** Browser: creates the opaque-origin plugin Worker transport. */
  spawnWorker: (bytes: Uint8Array, filename: string) => WorkerLike
  /** Browser: `URL.createObjectURL(new Blob([html]))` for a self-contained panel. */
  createPanelUrl: (bytes: Uint8Array, filename: string) => string
  revokeUrl?: (url: string) => void
  register: (owner: ContributionOwner, bundle: ContributionBundle) => () => void
  setSession: (pluginId: string, session: PluginCommandBroker | null) => void
  openPanel?: (panelId: string) => void
  notify?: (message: string, kind: 'info' | 'success' | 'error') => void
  audit?: (pluginId: string, action: PluginAuditAction, detail?: string) => void
  onCrash?: (pluginId: string, reason: string) => void
}>

export type LoadedPluginHandle = Readonly<{
  pluginId: string
  version: string
  session: PluginCommandBroker
  isActive: () => boolean
  stop: () => void
}>

const contributionBundle = (
  target: BundledPlugin,
  deps: PluginLaunchDeps,
  panelUrls: string[],
  invokeCommand: (id: string) => Promise<void>,
): ContributionBundle | undefined => {
  const source = target.manifest.contributions
  if (!source) return undefined
  const panels = (source.panels ?? []).map((panel) => {
    const path = normalizeEntry(panel.entry)
    const bytes = target.files.get(path)
    if (!bytes) {
      throw new PluginLoadError('ENTRY_MISSING', `panel ${panel.id} entry "${panel.entry}" is missing from the bundle`)
    }
    const html = new TextDecoder().decode(bytes)
    if (!isSelfContainedHtml(html)) {
      throw new PluginLoadError('PANEL_NOT_SELF_CONTAINED', `panel "${panel.id}" must inline its scripts/styles for client-side loading`)
    }
    const url = deps.createPanelUrl(bytes, path)
    panelUrls.push(url)
    return { id: panel.id, title: panel.title, entry: url }
  })
  const commands = (source.commands ?? []).map((command) => ({
    id: command.id,
    title: command.title,
    execute: () => invokeCommand(command.id),
  }))
  const translation: Record<string, unknown> = {}
  if (commands.length > 0) translation.commands = commands
  if ((source.ribbonTabs?.length ?? 0) > 0) translation.ribbonTabs = source.ribbonTabs
  if ((source.ribbon?.length ?? 0) > 0) translation.ribbon = source.ribbon
  if ((source.contextMenus?.length ?? 0) > 0) translation.contextMenus = source.contextMenus
  if (panels.length > 0) translation.panels = panels
  return translation as ContributionBundle
}

/** Launch a validated bundle: create the session, start the worker sandbox and
 *  register contributions. Returns a handle whose `stop()` tears everything
 *  down (worker terminate, blob revocation, unregister, session clear). */
export const launchBundledPlugin = async (
  target: BundledPlugin,
  deps: PluginLaunchDeps,
): Promise<LoadedPluginHandle> => {
  const { manifest } = target
  const panelUrls: string[] = []
  const stopTasks: Array<() => void> = []
  let stopped = false
  let session: PluginCommandBroker | undefined
  let runtime: WorkerRuntime | undefined
  try {
    session = await deps.createSession(manifest)
    deps.setSession(manifest.id, session)
    const workerPath = manifest.entrypoints?.worker ? normalizeEntry(manifest.entrypoints.worker) : undefined
    if (workerPath && target.files.has(workerPath)) {
      const spawned = deps.spawnWorker(target.files.get(workerPath)!, workerPath)
      runtime = new WorkerRuntime({
        spawn: () => spawned,
        handlers: brokerRpcHandlers(session, deps.storage),
        budget: new RpcBudget({ maxCalls: MAX_RPC_CALLS_PER_WINDOW, windowMs: RPC_RATE_WINDOW_MS }),
        callTimeoutMs: 5_000,
        maxViolations: 10,
        onCrash: reason => {
          if (reason !== 'terminated') {
            deps.notify?.(`[${manifest.id}] worker ${reason}`, 'error')
            deps.onCrash?.(manifest.id, reason)
          }
        },
      })
      stopTasks.push(() => runtime?.terminate())
    }
    const declaredCommands = (manifest.contributions?.commands ?? []).map(command => command.id)
    if (declaredCommands.length > 0) {
      if (!runtime) throw new PluginLoadError('COMMAND_WORKER_REQUIRED', 'commands require a Worker entrypoint')
      const registered = await runtime.waitReady()
      if (registered.length !== declaredCommands.length ||
        declaredCommands.some(id => !registered.includes(id))) {
        throw new PluginLoadError('COMMAND_MISMATCH', 'Worker command handlers must match manifest commands')
      }
    }
    const contributions = contributionBundle(target, deps, panelUrls, id => {
      if (!runtime) return Promise.reject(new Error('Plugin Worker stopped'))
      return runtime.invokeCommand(id)
    })
    if (contributions) {
      stopTasks.push(deps.register({ kind: 'plugin', id: manifest.id, version: manifest.version }, contributions))
    }
  } catch (error) {
    for (const task of stopTasks.reverse()) task()
    for (const url of panelUrls) deps.revokeUrl?.(url)
    if (session) deps.setSession(manifest.id, null)
    throw error
  }

  deps.audit?.(manifest.id, 'install', manifest.version)
  deps.audit?.(manifest.id, 'enable', manifest.version)

  return {
    pluginId: manifest.id,
    version: manifest.version,
    session,
    isActive: () => !stopped && (runtime?.isTerminated !== true),
    stop: () => {
      if (stopped) return
      stopped = true
      for (const task of stopTasks) task()
      for (const url of panelUrls) deps.revokeUrl?.(url)
      deps.setSession(manifest.id, null)
      deps.audit?.(manifest.id, 'disable', 'unloaded')
    },
  }
}
