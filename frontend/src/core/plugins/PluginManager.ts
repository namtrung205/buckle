import { validateManifest, negotiateApiVersion } from './manifest.ts'
import type { PluginManifest } from './manifest.ts'
import { CrashLoopTracker } from './sandbox.ts'
import type { ContributionOwner } from './types.ts'
import type { PluginCommandBroker } from './PluginHostApi.ts'

/** Plugin lifecycle manager (Goal 4): install/enable/disable/uninstall with
 *  manifest validation, crash-loop quarantine and a safe-mode boot that a
 *  faulty plugin can never block (Goal 4 exit gate). */

export type PluginState = 'installed' | 'enabled' | 'disabled' | 'quarantined'

export type InstalledPlugin = Readonly<{
  manifest: PluginManifest
  state: PluginState
  apiVersion: number
}>

/** Host-provided session factory: binds the validated manifest to a live
 *  broker session (Model services + contribution registry on the app side). */
export type PluginSessionFactory = (manifest: PluginManifest) => PluginCommandBroker | Promise<PluginCommandBroker>

export type PluginManagerOptions = Readonly<{
  sessionFactory: PluginSessionFactory
  crashTracker?: CrashLoopTracker
  now?: () => number
}>

export type BootSummary = Readonly<{
  started: readonly string[]
  failed: readonly string[]
  quarantined: readonly string[]
}>

const asOwner = (manifest: PluginManifest): ContributionOwner =>
  ({ kind: 'plugin', id: manifest.id, version: manifest.version })

export class PluginManager {
  private readonly installed = new Map<string, { manifest: PluginManifest; state: PluginState; session: PluginCommandBroker | null }>()
  private readonly crashes: CrashLoopTracker
  private readonly sessionFactory: PluginSessionFactory

  constructor(options: PluginManagerOptions) {
    this.sessionFactory = options.sessionFactory
    this.crashes = options.crashTracker ?? new CrashLoopTracker(options.now !== undefined ? { now: options.now } : {})
  }

  /** Validate + register a manifest. A re-install replaces the previous
   *  definition after tearing down any live session. */
  install(value: unknown): PluginManifest {
    const manifest = validateManifest(value)
    const existing = this.installed.get(manifest.id)
    if (existing?.session) this.disable(manifest.id)
    this.installed.set(manifest.id, { manifest, state: 'installed', session: null })
    return manifest
  }

  /** Activate a plugin. Quarantined plugins stay off until explicitly released. */
  async enable(id: string): Promise<boolean> {
    const entry = this.installed.get(id)
    if (!entry) return false
    if (this.crashes.isQuarantined(id)) {
      entry.state = 'quarantined'
      return false
    }
    if (entry.session) return true
    try {
      negotiateApiVersion(entry.manifest)
      entry.session = await this.sessionFactory(entry.manifest)
      entry.state = 'enabled'
      return true
    } catch {
      this.recordFailure(id)
      return false
    }
  }

  /** Tear down the session but keep the definition (user can re-enable). */
  disable(id: string): boolean {
    const entry = this.installed.get(id)
    if (!entry) return false
    entry.session = null
    entry.state = 'disabled'
    return true
  }

  uninstall(id: string): boolean {
    const entry = this.installed.get(id)
    if (!entry) return false
    if (entry.session) this.disable(id)
    this.installed.delete(id)
    this.crashes.release(id)
    return true
  }

  /** Report a sandbox crash (violation budget, worker error, ...). Returns the
   *  new state — 'quarantined' once the crash loop trips. */
  reportCrash(id: string): PluginState {
    const entry = this.installed.get(id)
    if (!entry) return 'installed'
    if (this.crashes.reportCrash(id)) {
      entry.session = null
      entry.state = 'quarantined'
    }
    return entry.state
  }

  /** User-driven release from quarantine (safe-mode UI). */
  release(id: string) {
    this.crashes.release(id)
    const entry = this.installed.get(id)
    if (entry && entry.state === 'quarantined') entry.state = 'disabled'
  }

  list(): readonly InstalledPlugin[] {
    return [...this.installed.values()].map(entry => ({
      manifest: entry.manifest,
      state: entry.state,
      apiVersion: entry.manifest.apiVersion,
    }))
  }

  getSession(id: string): PluginCommandBroker | null {
    return this.installed.get(id)?.session ?? null
  }

  /** Safe mode is on while any plugin sits in quarantine. */
  get safeMode(): boolean {
    return [...this.installed.values()].some(entry => entry.state === 'quarantined')
  }

  /** Safe-mode boot: enable every installed plugin one by one. A throwing or
   *  faulty plugin is recorded and skipped — the host always starts. */
  async bootAll(): Promise<BootSummary> {
    const started: string[] = []
    const failed: string[] = []
    const quarantined: string[] = []
    for (const [id, entry] of this.installed) {
      if (this.crashes.isQuarantined(id)) {
        entry.state = 'quarantined'
        quarantined.push(id)
        continue
      }
      try {
        negotiateApiVersion(entry.manifest)
        entry.session = await this.sessionFactory(entry.manifest)
        entry.state = 'enabled'
        started.push(id)
      } catch {
        entry.session = null
        const state = this.recordFailure(id)
        if (state === 'quarantined') quarantined.push(id)
        else failed.push(id)
      }
    }
    return { started, failed, quarantined }
  }

  private recordFailure(id: string): PluginState {
    const state = this.reportCrash(id)
    return state === 'installed' ? 'disabled' : state
  }
}

export type { PluginManifest }
export { asOwner }
