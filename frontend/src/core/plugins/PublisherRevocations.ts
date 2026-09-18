/** User-controlled local denylist for reviewed publisher keys. This is not a
 * remote revocation feed; Buckle releases can later add a signed feed. */
export class PublisherRevocations {
  private readonly revoked = new Set<string>()
  private readonly storage?: Pick<Storage, 'getItem' | 'setItem'>
  private readonly requireStorage: boolean
  private storageFailed = false
  private readonly storageKey = 'buckle-revoked-plugin-publishers-v1'

  constructor(storage?: Pick<Storage, 'getItem' | 'setItem'>, requireStorage = false) {
    this.storage = storage
    this.requireStorage = requireStorage
    try {
      if (requireStorage && !storage) throw new Error('Publisher blocklist storage is unavailable')
      const saved = storage?.getItem(this.storageKey)
      const values: unknown = saved ? JSON.parse(saved) : []
      if (!Array.isArray(values)) throw new Error('Publisher blocklist is malformed')
      for (const value of values) {
        if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
          throw new Error('Publisher blocklist contains an invalid key')
        }
        this.revoked.add(value)
      }
    } catch { this.storageFailed = requireStorage }
  }

  isRevoked(keySha256: string): boolean { return this.storageFailed || this.revoked.has(keySha256) }
  list(): readonly string[] { return [...this.revoked].sort() }

  private save(next: Set<string>): void {
    if (this.requireStorage && (this.storageFailed || !this.storage)) {
      throw new Error('Publisher blocklist storage is unavailable; signed plugins remain blocked')
    }
    this.storage?.setItem(this.storageKey, JSON.stringify([...next].sort()))
    this.revoked.clear()
    for (const key of next) this.revoked.add(key)
  }

  revoke(keySha256: string): void {
    if (!/^[a-f0-9]{64}$/.test(keySha256)) throw new Error('Invalid publisher key fingerprint')
    this.save(new Set([...this.revoked, keySha256]))
  }

  release(keySha256: string): void {
    const next = new Set(this.revoked)
    next.delete(keySha256)
    this.save(next)
  }
}

const browserStorage = (): Storage | undefined => {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage } catch { return undefined }
}

export const browserPublisherRevocations = new PublisherRevocations(browserStorage(), true)
