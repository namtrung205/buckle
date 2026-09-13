/**
 * Host-side bundle loader (developer preview — "load a plugin and run it").
 *
 * Turns an uploaded `.zip` package or a single compiled `.js`/`.mjs` worker
 * file into a live, session-only plugin: the manifest is validated fail-closed,
 * the broker session is created from the declared grants, worker code runs in
 * the sandboxed Worker runtime, and declared contributions (commands / ribbon /
 * panels) are registered against the app registry. Nothing persists across
 * reloads and no remote entrypoints are fetched — the local loader only ever
 * runs code the user explicitly hands it from the client.
 */

import { unzipSync, strFromU8 } from 'fflate'
import { validateManifest } from './manifest.ts'
import type { PluginManifest } from './manifest.ts'
import type { PluginCommandBroker, PluginSessionPermission } from './PluginHostApi.ts'
import { brokerRpcHandlers } from './PanelRpcBridge.ts'
import type { PluginStorage } from './PluginStorage.ts'
import { WorkerRuntime } from './WorkerRuntime.ts'
import type { WorkerLike } from './WorkerRuntime.ts'
import { RpcBudget, MAX_RPC_CALLS_PER_WINDOW, RPC_RATE_WINDOW_MS } from './rpc.ts'
import type { ContributionBundle, ContributionOwner } from './types.ts'

export const PLUGIN_BUNDLE_MAX_BYTES = 8 * 1024 * 1024
export const PLUGIN_BUNDLE_MAX_FILES = 200
export const PLUGIN_ENTRY_MAX_BYTES = 1 * 1024 * 1024

const MANIFEST_NAMES = ['buckle.plugin.json', 'plugin.json', 'manifest.json']
const ALLOWED_EXTENSIONS = new Set(['.json', '.js', '.mjs', '.html', '.css', '.svg', '.png', '.ico', '.txt'])
const absoluteEntryPattern = /^[a-z][a-z0-9+.-]*:/i

export class PluginLoadError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'PluginLoadError'
    this.code = code
  }
}

export type BundledPlugin = Readonly<{
  manifest: PluginManifest
  /** Normalized relative paths (no `..`, no leading slash) → raw file bytes. */
  files: ReadonlyMap<string, Uint8Array>
  source: string
}>

const slugify = (value: string): string => {
  const base = value.replace(/\.[^.]+$/, '').toLowerCase()
  const slug = base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'plugin'
  return slug.length > 40 ? slug.slice(0, 40) : slug
}

/** Wrap a single compiled worker file into a minimal worker-only manifest.
 *  Grants default to none (fail closed) — pass the permission list the worker
 *  may use. */
export const parseWorkerFile = (
  filename: string,
  data: Uint8Array,
  grants: readonly PluginSessionPermission[] = [],
): BundledPlugin => {
  const id = `com.plugins.${slugify(filename)}`
  const name = (filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') || 'Plugin').trim()
  if (data.byteLength > PLUGIN_ENTRY_MAX_BYTES) {
    throw new PluginLoadError('ENTRY_TOO_LARGE', `worker file exceeds ${PLUGIN_ENTRY_MAX_BYTES} bytes`)
  }
  const manifest = validateManifest({
    id,
    name,
    version: '0.0.1',
    apiVersion: 1,
    permissions: grants,
    entrypoints: { worker: 'index.js' },
  })
  return { manifest, files: new Map([['index.js', data]]), source: filename }
}

const normalizeEntry = (entry: string): string => entry.replace(/^\.\/+/, '')

const requireEntry = (files: ReadonlyMap<string, Uint8Array>, entry: string | undefined, label: string): void => {
  if (!entry) return
  if (absoluteEntryPattern.test(entry)) {
    throw new PluginLoadError('REMOTE_ENTRY_UNSUPPORTED', `${label} "${entry}" is remote — the local loader only accepts bundled files`)
  }
  if (!files.has(normalizeEntry(entry))) {
    throw new PluginLoadError('ENTRY_MISSING', `${label} "${entry}" is missing from the bundle`)
  }
}

/** Unzip + validate a plugin package. Every lookup outside the strict rule set
 *  (size, count, extension, path traversal) fails closed. */
export const parseZipBundle = (data: Uint8Array, sourceLabel = 'bundle.zip'): BundledPlugin => {
  if (data.byteLength > PLUGIN_BUNDLE_MAX_BYTES) {
    throw new PluginLoadError('BUNDLE_TOO_LARGE', `bundle exceeds ${PLUGIN_BUNDLE_MAX_BYTES} bytes`)
  }
  let rawEntries: Record<string, Uint8Array>
  try {
    rawEntries = unzipSync(new Uint8Array(data)) as Record<string, Uint8Array>
  } catch (error) {
    throw new PluginLoadError('INVALID_ARCHIVE', `${sourceLabel} is not a readable zip archive (${error instanceof Error ? error.message : String(error)})`)
  }

  const files = new Map<string, Uint8Array>()
  for (const [rawPath, bytes] of Object.entries(rawEntries)) {
    const path = rawPath.replace(/\\/g, '/').replace(/^\.\/+/, '')
    const segments = path.split('/').filter(Boolean)
    if (path.startsWith('/') || /^[a-z]:/i.test(path) || segments.includes('..')) {
      throw new PluginLoadError('ZIP_SLIP', `unsafe archive path "${rawPath}" is rejected`)
    }
    if (path.endsWith('/')) continue
    if (files.size >= PLUGIN_BUNDLE_MAX_FILES) {
      throw new PluginLoadError('TOO_MANY_FILES', `more than ${PLUGIN_BUNDLE_MAX_FILES} files in a bundle`)
    }
    const ext = path.includes('.') ? `.${path.split('.').pop()!.toLowerCase()}` : ''
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new PluginLoadError('FORBIDDEN_FILE', `file type "${ext || '(none)'}" is not allowed (${path})`)
    }
    if (bytes.byteLength > PLUGIN_ENTRY_MAX_BYTES) {
      throw new PluginLoadError('ENTRY_TOO_LARGE', `${path} exceeds ${PLUGIN_ENTRY_MAX_BYTES} bytes`)
    }
    files.set(path, bytes)
  }
  if (files.size === 0) throw new PluginLoadError('EMPTY_ARCHIVE', 'the archive contains no files')

  const manifestName = (path: string) => path.split('/').pop() ?? ''
  const manifestPath = [...files.keys()].find(path => MANIFEST_NAMES.includes(manifestName(path)))
  if (!manifestPath) {
    throw new PluginLoadError('MANIFEST_NOT_FOUND', `no plugin manifest (${MANIFEST_NAMES.join(' | ')}) in the archive`)
  }

  let manifest: PluginManifest
  try {
    manifest = validateManifest(JSON.parse(strFromU8(files.get(manifestPath)!)))
  } catch (error) {
    if (error instanceof PluginLoadError) throw error
    throw new PluginLoadError('INVALID_MANIFEST', `manifest is invalid: ${error instanceof Error ? error.message : String(error)}`)
  }

  // A build output may place the package under one folder (`dist/`): rebase to
  // that folder so every path in the manifest resolves against the stored files.
  const base = manifestPath.includes('/') ? manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1) : ''
  if (base) {
    const rebased = new Map<string, Uint8Array>()
    for (const [path, bytes] of files) {
      const key = path.startsWith(base) ? path.slice(base.length) : null
      if (key) rebased.set(key, bytes)
    }
    files.clear()
    for (const [key, bytes] of rebased) files.set(key, bytes)
    if (!files.has(manifestPath.slice(base.length))) {
      throw new PluginLoadError('INVALID_MANIFEST', `manifest ${manifestPath} has no supporting files`)
    }
  }

  requireEntry(files, manifest.entrypoints?.worker, 'worker entrypoint')
  requireEntry(files, manifest.entrypoints?.panel, 'panel entrypoint')
  for (const panel of manifest.contributions?.panels ?? []) requireEntry(files, panel.entry, `panel ${panel.id}`)

  return { manifest, files: new Map(files), source: sourceLabel }
}

/** Heuristic: a panel HTML that does not reference sibling package files
 *  (scripts/styles/assets) can be rendered directly from a single blob URL. */
export const isSelfContainedHtml = (html: string): boolean => {
  if (/<script[^>]*\bsrc=/i.test(html)) return false
  if (/<link[^>]*\bhref=/i.test(html)) return false
  if (/<img[^>]*\bsrc=|srcset=/i.test(html)) return false
  if (/@import\b/i.test(html)) return false
  if (/url\(\s*['"]?\s*\.{0,2}\//i.test(html)) return false
  return true
}

export type PluginLaunchDeps = Readonly<{
  /** Bind a validated manifest to a live broker session. */
  createSession: (manifest: PluginManifest) => PluginCommandBroker | Promise<PluginCommandBroker>
  /** Storage backing for `storage.*` RPC calls (may be undefined → UNAVAILABLE). */
  storage?: PluginStorage
  /** Browser: `new Worker(URL.createObjectURL(blob), { type: 'module' })`. */
  spawnWorker: (bytes: Uint8Array, filename: string) => WorkerLike
  /** Browser: `URL.createObjectURL(new Blob([html]))` for a self-contained panel. */
  createPanelUrl: (bytes: Uint8Array, filename: string) => string
  revokeUrl?: (url: string) => void
  register: (owner: ContributionOwner, bundle: ContributionBundle) => () => void
  setSession: (pluginId: string, session: PluginCommandBroker | null) => void
  openPanel?: (panelId: string) => void
  notify?: (message: string, kind: 'info' | 'success' | 'error') => void
  audit?: (pluginId: string, action: 'install' | 'enable' | 'disable', detail?: string) => void
}>

export type LoadedPluginHandle = Readonly<{
  pluginId: string
  version: string
  session: PluginCommandBroker
  stop: () => void
}>

const contributionBundle = (
  target: BundledPlugin,
  deps: PluginLaunchDeps,
  panelUrls: string[],
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
    execute: () => {
      if (panels.length > 0) deps.openPanel?.(panels[0].id)
      else deps.notify?.(`[${target.manifest.id}] ${command.title} — no binding (worker-only plugin)`, 'info')
    },
  }))
  const translation: Record<string, unknown> = {}
  if (commands.length > 0) translation.commands = commands
  if ((source.ribbonTabs?.length ?? 0) > 0) translation.ribbonTabs = source.ribbonTabs
  if ((source.ribbon?.length ?? 0) > 0) translation.ribbon = source.ribbon
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
  const contributions = contributionBundle(target, deps, panelUrls)
  const session = await deps.createSession(manifest)
  deps.setSession(manifest.id, session)

  const stopTasks: Array<() => void> = []
  let stopped = false

  const workerPath = manifest.entrypoints?.worker ? normalizeEntry(manifest.entrypoints.worker) : undefined
  if (workerPath && target.files.has(workerPath)) {
    const spawned = deps.spawnWorker(target.files.get(workerPath)!, workerPath)
    const runtime = new WorkerRuntime({
      spawn: () => spawned,
      handlers: brokerRpcHandlers(session, deps.storage),
      budget: new RpcBudget({ maxCalls: MAX_RPC_CALLS_PER_WINDOW, windowMs: RPC_RATE_WINDOW_MS }),
      callTimeoutMs: 5_000,
      maxViolations: 10,
      onCrash: reason => {
        if (reason !== 'terminated') deps.notify?.(`[${manifest.id}] worker ${reason}`, 'error')
      },
    })
    stopTasks.push(() => runtime.terminate())
  }

  if (contributions) {
    stopTasks.push(deps.register({ kind: 'plugin', id: manifest.id, version: manifest.version }, contributions))
  }

  deps.audit?.(manifest.id, 'install', manifest.version)
  deps.audit?.(manifest.id, 'enable', manifest.version)

  return {
    pluginId: manifest.id,
    version: manifest.version,
    session,
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
