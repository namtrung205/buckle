import { validateManifest, negotiateApiVersion } from './manifest.ts'
import type { PluginManifest } from './manifest.ts'
import { CrashLoopTracker } from './sandbox.ts'
import { PluginTrustError, PluginTrustStore } from './PluginTrust.ts'
import { pluginAudit, pluginKillSwitch } from './PluginAudit.ts'
import { pluginStorage } from './PluginStorage.ts'
import type { ContributionOwner } from './types.ts'
import type { PluginCommandBroker } from './PluginHostApi.ts'
/** Plugin lifecycle manager (Goal 4): install/enable/disable/uninstall with
 *  manifest validation, crash-loop quarantine and a safe-mode boot that a
 *  faulty plugin can never block (Goal 4 exit gate). Goal 6 hardening: package
 *  signature/revocation verification on install, an audit trail on every
 *  privileged action and an emergency kill switch that stops all plugins. */

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
  /** Trust policy for package verification (Goal 6). Omitted = no signature
   *  enforcement (in-host samples); a store with no trusted keys rejects all. */
  trust?: PluginTrustStore
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
  private readonly trust?: PluginTrustStore

  constructor(options: PluginManagerOptions) {
    this.sessionFactory = options.sessionFactory
    this.trust = options.trust
    this.crashes = options.crashTracker ?? new CrashLoopTracker(options.now !== undefined ? { now: options.now } : {})
  }

  /** Validate + verify + register a manifest. A re-install replaces the previous
   *  definition after tearing down any live session. Revoked or untrusted
   *  packages are rejected before any state is stored (fail closed). */
  install(value: unknown, signature?: string): PluginManifest {
    const manifest = validateManifest(value)
    if (this.trust) {
      try {
        this.trust.verify(manifest, signature)
      } catch (error) {
        const code = error instanceof PluginTrustError ? error.code : 'UNTRUSTED_SIGNATURE'
        pluginAudit.record(manifest.id, 'revoked', code)
        throw error
      }
    }
    const existing = this.installed.get(manifest.id)
    if (existing?.session) this.disable(manifest.id)
    this.installed.set(manifest.id, { manifest, state: 'installed', session: null })
    pluginAudit.record(manifest.id, 'install', manifest.version)
    return manifest
  }

  /** Activate a plugin. Quarantined plugins stay off until explicitly released;
   *  an engaged kill switch blocks every activation. */
  async enable(id: string): Promise<boolean> {
    const entry = this.installed.get(id)
    if (!entry) return false
    if (pluginKillSwitch.snapshot.engaged) {
      pluginAudit.record(id, 'enableBlocked', pluginKillSwitch.snapshot.reason)
      return false
    }
    if (this.crashes.isQuarantined(id)) {
      entry.state = 'quarantined'
      return false
    }
    if (entry.session) return true
    try {
      negotiateApiVersion(entry.manifest)
      entry.session = await this.sessionFactory(entry.manifest)
      entry.state = 'enabled'
      pluginAudit.record(id, 'enable', entry.manifest.version)
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
    pluginAudit.record(id, 'disable')
    return true
  }

  uninstall(id: string): boolean {
    const entry = this.installed.get(id)
    if (!entry) return false
    if (entry.session) this.disable(id)
    this.installed.delete(id)
    this.crashes.release(id)
    // Goal 5: uninstalling a plugin drops its persisted storage namespaces too.
    pluginStorage.clearPlugin(id)
    pluginAudit.record(id, 'uninstall', entry.manifest.version)
    return true
  }

  /** Report a sandbox crash (violation budget, worker error, ...). Returns the
   *  new state — 'quarantined' once the crash loop trips. */
  reportCrash(id: string): PluginState {
    const entry = this.installed.get(id)
    if (!entry) return 'installed'
    pluginAudit.record(id, 'crash')
    if (this.crashes.reportCrash(id)) {
      entry.session = null
      entry.state = 'quarantined'
      pluginAudit.record(id, 'quarantine', 'crash loop threshold reached')
    }
    return entry.state
  }

  /** User-driven release from quarantine (safe-mode UI). */
  release(id: string) {
    this.crashes.release(id)
    const entry = this.installed.get(id)
    if (entry && entry.state === 'quarantined') entry.state = 'disabled'
    pluginAudit.record(id, 'release')
  }

  /** Emergency stop (Goal 6): engage the kill switch, tear down every live
   *  session and block further enables until released. */
  engageKillSwitch(reason: string) {
    pluginKillSwitch.engage(reason)
    pluginAudit.record('*', 'killSwitchEngaged', reason)
    for (const [id] of this.installed) {
      const entry = this.installed.get(id)!
      if (entry.session) {
        entry.session = null
        entry.state = 'disabled'
      }
    }
  }

  releaseKillSwitch() {
    pluginKillSwitch.release()
    pluginAudit.record('*', 'killSwitchReleased')
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
   *  faulty plugin is recorded and skipped — the host always starts. An engaged
   *  kill switch skips all activations (audit only, never throws). */
  async bootAll(): Promise<BootSummary> {
    const started: string[] = []
    const failed: string[] = []
    const quarantined: string[] = []
    for (const [id, entry] of this.installed) {
      if (pluginKillSwitch.snapshot.engaged) {
        pluginAudit.record(id, 'enableBlocked', pluginKillSwitch.snapshot.reason)
        failed.push(id)
        continue
      }
      if (this.crashes.isQuarantined(id)) {
        entry.state = 'quarantined'
        quarantined.push(id)
        continue
      }
      try {
        negotiateApiVersion(entry.manifest)
        entry.session = await this.sessionFactory(entry.manifest)
        entry.state = 'enabled'
        pluginAudit.record(id, 'enable', entry.manifest.version)
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
