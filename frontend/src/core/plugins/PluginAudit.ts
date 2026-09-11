/**
 * Plugin audit trail and emergency kill switch (Goal 6). The audit log is a
 * bounded ring every privileged action flows through (install/enable/commit/
 * crash/kill); the kill switch is a single host-wide flag that disables every
 * live plugin session and blocks any new enable — one user action must be able
 * to stop all plugin activity immediately.
 */

export type PluginAuditAction =
  | 'install' | 'uninstall'
  | 'enable' | 'enableBlocked' | 'disable'
  | 'crash' | 'quarantine' | 'release'
  | 'killSwitchEngaged' | 'killSwitchReleased'
  | 'revoked'

export type PluginAuditEntry = Readonly<{
  at: number
  pluginId: string
  action: PluginAuditAction
  detail?: string
}>

export type PluginAuditOptions = Readonly<{ capacity?: number; now?: () => number }>

export class PluginAuditLog {
  private entries: PluginAuditEntry[] = []
  private readonly capacity: number
  private readonly now: () => number
  private readonly listeners = new Set<() => void>()
  private snapshot: readonly PluginAuditEntry[] = []

  constructor(options: PluginAuditOptions = {}) {
    this.capacity = options.capacity ?? 500
    this.now = options.now ?? (() => Date.now())
  }

  record(pluginId: string, action: PluginAuditAction, detail?: string) {
    this.entries.push({ at: this.now(), pluginId, action, ...(detail !== undefined ? { detail } : {}) })
    if (this.entries.length > this.capacity) this.entries = this.entries.slice(-this.capacity)
    this.snapshot = [...this.entries]
    for (const listener of this.listeners) listener()
  }

  /**
   * React `useSyncExternalStore`-compatible view (stable snapshot). Declared
   * as a bound arrow property so the reference can be passed around detached
   * from the instance (e.g. `useSyncExternalStore(store.subscribe, store.list)`)
   * without losing `this`.
   */
  list = (): readonly PluginAuditEntry[] => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  clear() {
    this.entries = []
    this.snapshot = []
    for (const listener of this.listeners) listener()
  }
}

export type KillSwitchState = Readonly<{ engaged: boolean; reason?: string; at?: number }>

export class PluginKillSwitch {
  private state: KillSwitchState = { engaged: false }
  private readonly listeners = new Set<() => void>()

  engage(reason: string) {
    this.state = { engaged: true, reason, at: Date.now() }
    for (const listener of this.listeners) listener()
  }

  release() {
    this.state = { engaged: false }
    for (const listener of this.listeners) listener()
  }

  get snapshot(): KillSwitchState {
    return this.state
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

/** App-wide singletons: the manager writes, UI reads. */
export const pluginAudit = new PluginAuditLog()
export const pluginKillSwitch = new PluginKillSwitch()
