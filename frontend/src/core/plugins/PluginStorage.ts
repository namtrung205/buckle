import type { ProjectExtensions } from './storageContracts.ts'

/**
 * Namespaced extension storage host (Goal 5). Each plugin gets an isolated
 * key/value namespace; the host never interprets the values (opaque state).
 * The `project` scope is serialized into the project file on save and restored
 * on open, so plugin state survives a round-trip; the `local` scope lives for
 * the host session only. Both scopes are enforced with per-plugin quotas —
 * fail closed (`STORAGE_QUOTA_EXCEEDED`) before a value is stored.
 */
export type PluginStorageScope = 'project' | 'local'

export type PluginStorageOptions = Readonly<{
  maxEntriesPerPlugin?: number
  maxValueBytes?: number
}>

export class PluginStorageQuotaError extends Error {
  readonly code = 'STORAGE_QUOTA_EXCEEDED'
  constructor(message: string) {
    super(message)
    this.name = 'PluginStorageQuotaError'
  }
}

export const PROJECT_EXTENSION_SCOPES = ['project', 'local'] as const
export const isPluginStorageScope = (value: unknown): value is PluginStorageScope =>
  value === 'project' || value === 'local'

const byteLength = (value: unknown): number => {
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export class PluginStorage {
  private readonly scopes: Record<PluginStorageScope, Map<string, Map<string, unknown>>> = {
    project: new Map(),
    local: new Map(),
  }
  private readonly maxEntries: number
  private readonly maxValueBytes: number

  constructor(options: PluginStorageOptions = {}) {
    this.maxEntries = options.maxEntriesPerPlugin ?? 200
    this.maxValueBytes = options.maxValueBytes ?? 16 * 1024
  }

  private table(pluginId: string, scope: PluginStorageScope): Map<string, unknown> {
    let namespace = this.scopes[scope].get(pluginId)
    if (!namespace) {
      namespace = new Map()
      this.scopes[scope].set(pluginId, namespace)
    }
    return namespace
  }

  get(pluginId: string, scope: PluginStorageScope, key: string): unknown {
    return this.table(pluginId, scope).get(key)
  }

  set(pluginId: string, scope: PluginStorageScope, key: string, value: unknown) {
    if (typeof key !== 'string' || key.length === 0 || key.length > 256) {
      throw new PluginStorageQuotaError('storage keys must be 1..256 characters')
    }
    const bytes = byteLength(value)
    if (bytes > this.maxValueBytes) {
      throw new PluginStorageQuotaError(`storage value of ${bytes} bytes exceeds ${this.maxValueBytes}`)
    }
    const namespace = this.table(pluginId, scope)
    if (!namespace.has(key) && namespace.size >= this.maxEntries) {
      throw new PluginStorageQuotaError(`more than ${this.maxEntries} storage entries per plugin`)
    }
    if (bytes === Number.POSITIVE_INFINITY) {
      throw new PluginStorageQuotaError('storage values must be JSON-serializable')
    }
    namespace.set(key, value)
  }

  delete(pluginId: string, scope: PluginStorageScope, key: string): boolean {
    return this.table(pluginId, scope).delete(key)
  }

  keys(pluginId: string, scope: PluginStorageScope): readonly string[] {
    return [...this.table(pluginId, scope).keys()]
  }

  /** Uninstall cleanup: drop both scopes of one plugin. */
  clearPlugin(pluginId: string) {
    this.scopes.project.delete(pluginId)
    this.scopes.local.delete(pluginId)
  }

  /** Snapshot the persisted scope for the project file (opaque to the host). */
  serializeProject(): ProjectExtensions {
    const extensions: Record<string, Record<string, unknown>> = {}
    for (const [pluginId, namespace] of this.scopes.project) {
      if (namespace.size === 0) continue
      extensions[pluginId] = Object.fromEntries(namespace)
    }
    return extensions
  }

  /** Restore the persisted scope from a project file. Untrusted input: only
   *  well-formed records are taken, everything else is dropped (fail closed). */
  restoreProject(extensions: unknown) {
    this.scopes.project.clear()
    if (typeof extensions !== 'object' || extensions === null) return
    for (const [pluginId, namespace] of Object.entries(extensions as Record<string, unknown>)) {
      if (typeof namespace !== 'object' || namespace === null) continue
      for (const [key, value] of Object.entries(namespace as Record<string, unknown>)) {
        try {
          this.set(pluginId, 'project', key, value)
        } catch {
          // Over-quota or unserializable entries are skipped, never fatal.
        }
      }
    }
  }
}

/** App-wide singleton (mirrors `pluginSessions`): the panel bridges write here,
 *  the project save/open boundary (helpers.ts) reads/restores it. */
export const pluginStorage = new PluginStorage()
