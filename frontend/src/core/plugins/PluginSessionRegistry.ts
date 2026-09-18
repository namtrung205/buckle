import type { PluginCommandBroker } from './PluginHostApi.ts'

/**
 * Host-side registry of live plugin broker sessions (Goal 4). Plugin sessions
 * register on creation; the panel host resolves the session that owns a
 * namespaced panel id (owner ids contain dots, so the owner prefix is matched
 * segment-by-segment from the right).
 */
export class PluginSessionRegistry {
  private readonly sessions = new Map<string, PluginCommandBroker>()

  set(pluginId: string, session: PluginCommandBroker | null) {
    if (session) this.sessions.set(pluginId, session)
    else this.sessions.delete(pluginId)
  }

  get(pluginId: string): PluginCommandBroker | undefined {
    return this.sessions.get(pluginId)
  }

  delete(pluginId: string) {
    this.sessions.delete(pluginId)
  }

  /** `com.buckle.samples.windload.panel` → session of
   *  `com.buckle.samples.windload` (drops trailing segments until a hit). */
  resolveByPrefix(namespacedId: string): PluginCommandBroker | undefined {
    const segments = namespacedId.split('.')
    for (let end = segments.length - 1; end >= 1; end--) {
      const candidate = segments.slice(0, end).join('.')
      const session = this.sessions.get(candidate)
      if (session) return session
    }
    return undefined
  }
}

/** App-wide singleton (mirrors `Model.instance`): samples and panel hosts share it. */
export const pluginSessions = new PluginSessionRegistry()
