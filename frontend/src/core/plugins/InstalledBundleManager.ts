import { launchBundledPlugin, parseZipBundle } from './PluginBundleLoader.ts'
import type { LoadedPluginHandle, PluginLaunchDeps } from './PluginBundleLoader.ts'
import type { InstalledBundleRecord, PluginInstallStore } from './PluginInstallStore.ts'
import { pluginKillSwitch } from './PluginAudit.ts'
import type { BundledPlugin } from './PluginBundleLoader.ts'
import { requireReviewedZip, sha256Hex } from './BundleIntegrity.ts'
import { verifyBundleSignature } from '../../../packages/plugin-sdk/src/signature.ts'
import { PublisherRevocations } from './PublisherRevocations.ts'
import type { VerifiedBundleSignature } from '../../../packages/plugin-sdk/src/signature.ts'

export type InstalledBundleView = Readonly<{
  id: string
  name: string
  version: string
  publisherKeySha256?: string
  revoked: boolean
  source: string
  enabled: boolean
  quarantined: boolean
  failure?: string
}>

type Entry = { record: InstalledBundleRecord; name: string; handle: LoadedPluginHandle | null; failure?: string }

const samePermissions = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every(permission => right.includes(permission))

/** The live ZIP lifecycle. The repository stores bytes and the exact reviewed
 * grants; boot always reparses those bytes before invoking any Worker code. */
export class InstalledBundleManager {
  private readonly entries = new Map<string, Entry>()
  private readonly store: PluginInstallStore
  private readonly deps: PluginLaunchDeps
  private readonly onChange: (entries: readonly InstalledBundleView[]) => void
  private readonly onFailure: (message: string) => void
  private readonly publishers: PublisherRevocations
  private readonly activationTokens = new Map<string, symbol>()
  private disposed = false

  constructor(options: {
    store: PluginInstallStore
    deps: PluginLaunchDeps
    onChange: (entries: readonly InstalledBundleView[]) => void
    onFailure: (message: string) => void
    publishers?: PublisherRevocations
  }) {
    this.store = options.store
    this.deps = options.deps
    this.onChange = options.onChange
    this.onFailure = options.onFailure
    this.publishers = options.publishers ?? new PublisherRevocations()
  }

  list(): readonly InstalledBundleView[] {
    return [...this.entries.values()].map(entry => ({
      id: entry.record.id,
      name: entry.name,
      version: entry.record.version,
      ...(entry.record.publisherKeySha256 ? { publisherKeySha256: entry.record.publisherKeySha256 } : {}),
      revoked: entry.record.publisherKeySha256 ? this.publishers.isRevoked(entry.record.publisherKeySha256) : false,
      source: entry.record.source,
      enabled: entry.handle !== null,
      quarantined: entry.record.quarantined === true,
      ...(entry.failure ? { failure: entry.failure } : {}),
    }))
  }

  private changed() { if (!this.disposed) this.onChange(this.list()) }

  private requireAllowedPublisher(publisher: VerifiedBundleSignature): void {
    if (publisher.status === 'signed' && this.publishers.isRevoked(publisher.keySha256)) {
      throw new Error(`Publisher key ${publisher.keySha256} is revoked locally`)
    }
  }

  private async launch(bundle: BundledPlugin): Promise<LoadedPluginHandle> {
    const id = bundle.manifest.id
    const token = Symbol(id)
    this.activationTokens.set(id, token)
    try {
      return await launchBundledPlugin(bundle, {
        ...this.deps,
        onCrash: (pluginId, reason) => {
          this.deps.onCrash?.(pluginId, reason)
          if (this.activationTokens.get(pluginId) === token) void this.handleCrash(pluginId, reason)
        },
      })
    } catch (error) {
      if (this.activationTokens.get(id) === token) this.activationTokens.delete(id)
      throw error
    }
  }

  private async handleCrash(id: string, reason: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry?.handle || this.disposed) return
    this.activationTokens.delete(id)
    entry.handle.stop()
    entry.handle = null
    const crashCount = (entry.record.crashCount ?? 0) + 1
    entry.record = { ...entry.record, enabled: false, crashCount, quarantined: crashCount >= 3 }
    entry.failure = `Worker ${reason}${entry.record.quarantined ? ' (quarantined after 3 crashes)' : ''}`
    this.changed()
    try { await this.store.put(entry.record) } catch (error) {
      this.onFailure(`${id}: could not persist crash state: ${String(error)}`)
    }
    this.deps.audit?.(id, 'crash', reason)
    if (entry.record.quarantined) this.deps.audit?.(id, 'quarantine', reason)
    this.onFailure(`${id}: ${entry.failure}`)
  }

  async restore(): Promise<void> {
    const records = await this.store.list()
    for (const record of records) {
      if (this.disposed) return
      try {
        await requireReviewedZip(record.zip, record.reviewedSha256)
        const bundle = parseZipBundle(record.zip, record.source)
        const publisher = await verifyBundleSignature(bundle)
        this.requireAllowedPublisher(publisher)
        if ((publisher.status === 'signed' ? publisher.keySha256 : undefined) !== record.publisherKeySha256) {
          throw new Error('Stored ZIP publisher does not match the reviewed key')
        }
        if (bundle.manifest.id !== record.id || bundle.manifest.version !== record.version ||
          !samePermissions(bundle.manifest.permissions ?? [], record.grantedPermissions)) {
          throw new Error('Stored ZIP does not match the reviewed manifest and permissions')
        }
        const entry: Entry = { record, name: bundle.manifest.name, handle: null }
        this.entries.set(record.id, entry)
        this.changed()
        if (record.enabled && pluginKillSwitch.snapshot.engaged) {
          entry.record = { ...record, enabled: false }
          await this.store.put(entry.record)
          continue
        }
        if (record.enabled && record.quarantined !== true && !pluginKillSwitch.snapshot.engaged) {
          try {
            entry.handle = await this.launch(bundle)
            if (this.disposed) { entry.handle.stop(); return }
            if (!entry.handle.isActive()) throw new Error('Worker stopped during restore')
            if (pluginKillSwitch.snapshot.engaged) {
              entry.handle.stop()
              entry.handle = null
              entry.record = { ...record, enabled: false }
              await this.store.put(entry.record)
              continue
            }
          } catch (error) {
            entry.failure = error instanceof Error ? error.message : String(error)
            entry.record = { ...record, enabled: false }
            await this.store.put(entry.record)
            this.onFailure(`${record.id}: ${entry.failure}`)
          }
          this.changed()
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.onFailure(`${record.id}: ${message}`)
        // Keep a broken install visible for removal, but never execute it.
        this.entries.set(record.id, { record: { ...record, enabled: false }, name: record.id,
          handle: null, failure: message })
        this.changed()
        try { await this.store.put({ ...record, enabled: false }) } catch { /* still removable next launch */ }
      }
    }
  }

  /** Called only after the app showed the manifest/permission review. */
  async install(zip: Uint8Array, source: string): Promise<void> {
    if (pluginKillSwitch.snapshot.engaged) throw new Error('Plugin kill switch is engaged')
    const bundle = parseZipBundle(zip, source)
    const publisher = await verifyBundleSignature(bundle)
    this.requireAllowedPublisher(publisher)
    const id = bundle.manifest.id
    const prior = this.entries.get(id)
    if (prior?.record.publisherKeySha256 &&
      (publisher.status !== 'signed' || publisher.keySha256 !== prior.record.publisherKeySha256)) {
      throw new Error('Plugin update must use the previously reviewed publisher key')
    }
    this.activationTokens.delete(id)
    prior?.handle?.stop()
    if (prior) prior.handle = null
    let handle: LoadedPluginHandle
    try {
      handle = await this.launch(bundle)
      if (this.disposed) { handle.stop(); throw new Error('Plugin manager stopped') }
      if (!handle.isActive()) { handle.stop(); throw new Error('Worker stopped during installation') }
      if (pluginKillSwitch.snapshot.engaged) { handle.stop(); throw new Error('Plugin kill switch is engaged') }
      const record: InstalledBundleRecord = {
        id, version: bundle.manifest.version, source, zip: new Uint8Array(zip), enabled: true,
        reviewedSha256: await sha256Hex(zip),
        ...(publisher.status === 'signed' ? { publisherKeySha256: publisher.keySha256 } : {}),
        grantedPermissions: [...(bundle.manifest.permissions ?? [])], crashCount: 0, quarantined: false,
      }
      try { await this.store.put(record) } catch (error) { handle.stop(); throw error }
      if (!handle.isActive()) {
        handle.stop()
        if (prior) await this.store.put(prior.record)
        else await this.store.delete(id)
        throw new Error('Worker stopped during installation')
      }
      this.entries.set(id, { record, name: bundle.manifest.name, handle })
      this.changed()
    } catch (error) {
      // Failed updates leave the previous ZIP installed and try to restore it.
      if (prior?.record.enabled) {
        try {
          await requireReviewedZip(prior.record.zip, prior.record.reviewedSha256)
          const previous = parseZipBundle(prior.record.zip, prior.record.source)
          const previousPublisher = await verifyBundleSignature(previous)
          this.requireAllowedPublisher(previousPublisher)
          if ((previousPublisher.status === 'signed' ? previousPublisher.keySha256 : undefined) !== prior.record.publisherKeySha256) {
            throw new Error('Previous ZIP publisher does not match the reviewed key')
          }
          prior.handle = await this.launch(previous)
        } catch (rollbackError) {
          prior.handle = null
          prior.failure = `Update rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
          this.onFailure(`${id}: ${prior.failure}`)
        }
      }
      this.changed()
      throw error
    }
  }

  async enable(id: string): Promise<void> {
    if (pluginKillSwitch.snapshot.engaged) throw new Error('Plugin kill switch is engaged')
    const entry = this.entries.get(id)
    if (!entry) throw new Error(`Plugin ${id} is not installed`)
    if (entry.record.quarantined) throw new Error(`Plugin ${id} is quarantined; release it first`)
    if (entry.handle) return
    await requireReviewedZip(entry.record.zip, entry.record.reviewedSha256)
    const bundle = parseZipBundle(entry.record.zip, entry.record.source)
    const publisher = await verifyBundleSignature(bundle)
    this.requireAllowedPublisher(publisher)
    if ((publisher.status === 'signed' ? publisher.keySha256 : undefined) !== entry.record.publisherKeySha256) {
      throw new Error('Stored ZIP publisher does not match the reviewed key')
    }
    if (bundle.manifest.id !== id || bundle.manifest.version !== entry.record.version ||
      !samePermissions(bundle.manifest.permissions ?? [], entry.record.grantedPermissions)) {
      throw new Error('Stored ZIP does not match reviewed permissions')
    }
    const handle = await this.launch(bundle)
    if (!handle.isActive()) { handle.stop(); throw new Error('Worker stopped during enable') }
    if (pluginKillSwitch.snapshot.engaged || this.disposed) {
      handle.stop()
      throw new Error(pluginKillSwitch.snapshot.engaged ? 'Plugin kill switch is engaged' : 'Plugin manager stopped')
    }
    try { await this.store.put({ ...entry.record, enabled: true }) } catch (error) { handle.stop(); throw error }
    if (!handle.isActive()) {
      handle.stop()
      await this.store.put({ ...entry.record, enabled: false })
      throw new Error('Worker stopped during enable')
    }
    entry.handle = handle
    entry.record = { ...entry.record, enabled: true }
    delete entry.failure
    this.changed()
  }

  async disable(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) return
    await this.store.put({ ...entry.record, enabled: false })
    this.activationTokens.delete(id)
    entry.handle?.stop()
    entry.handle = null
    entry.record = { ...entry.record, enabled: false }
    this.changed()
  }

  async blockPublisher(id: string): Promise<void> {
    const key = this.entries.get(id)?.record.publisherKeySha256
    if (!key) throw new Error('Plugin has no signed publisher key')
    this.publishers.revoke(key)
    const failures: string[] = []
    for (const entry of this.entries.values()) {
      if (entry.record.publisherKeySha256 !== key) continue
      this.activationTokens.delete(entry.record.id)
      entry.handle?.stop()
      entry.handle = null
      entry.record = { ...entry.record, enabled: false }
      try { await this.store.put(entry.record) } catch { failures.push(entry.record.id) }
      this.deps.audit?.(entry.record.id, 'revoked', key)
    }
    this.changed()
    if (failures.length) throw new Error(`Publisher blocked, but disabled state could not be saved for ${failures.join(', ')}`)
  }

  releasePublisher(id: string): void {
    const key = this.entries.get(id)?.record.publisherKeySha256
    if (!key) throw new Error('Plugin has no signed publisher key')
    this.publishers.release(key)
    this.changed()
  }

  async release(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) return
    const record = { ...entry.record, enabled: false, quarantined: false, crashCount: 0 }
    await this.store.put(record)
    entry.record = record
    delete entry.failure
    this.deps.audit?.(id, 'release', 'user released quarantine')
    this.changed()
  }

  async uninstall(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) return
    await this.store.delete(id)
    this.activationTokens.delete(id)
    entry.handle?.stop()
    this.entries.delete(id)
    this.deps.storage?.clearPlugin(id)
    this.deps.audit?.(id, 'uninstall', entry.record.version)
    this.changed()
  }

  async disableAll(): Promise<void> {
    const failures: string[] = []
    for (const [id, entry] of this.entries) {
      this.activationTokens.delete(id)
      entry.handle?.stop()
      entry.handle = null
      entry.record = { ...entry.record, enabled: false }
      try { await this.store.put(entry.record) } catch { failures.push(id) }
    }
    this.changed()
    if (failures.length) throw new Error(`Could not persist disabled state for ${failures.join(', ')}`)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.activationTokens.clear()
    for (const entry of this.entries.values()) entry.handle?.stop()
    this.entries.clear()
  }
}
