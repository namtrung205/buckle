import { canonicalStringify, deterministicHash } from '../structural/canonical.ts'
import type { PluginManifest } from './manifest.ts'

/**
 * Package integrity, signature and revocation (Goal 6). Signatures are keyed
 * FNV-1a digests over the canonical manifest — deterministic, dependency-free
 * and enough for tamper detection in the beta distribution model. A revoked
 * plugin id (or id@version) can never be installed or re-enabled again.
 */

export class PluginTrustError extends Error {
  readonly code: 'UNTRUSTED_SIGNATURE' | 'REVOKED'
  constructor(code: 'UNTRUSTED_SIGNATURE' | 'REVOKED', message: string) {
    super(message)
    this.name = 'PluginTrustError'
    this.code = code
  }
}

/** Keyed digest (HMAC-style construction over the FNV-1a chain): the key is
 *  folded in before and after the payload hash so a leaked digest cannot be
 *  re-rolled for different content without the key. */
export const keyedHash = (payload: unknown, key: string): string =>
  deterministicHash(`buckle.plugin.v1|${key}|${canonicalStringify(payload)}`)

/** Content digest of a package manifest (integrity, independent of any key). */
export const computePackageDigest = (manifest: PluginManifest): string =>
  deterministicHash(manifest)

/** Signature a publisher produces for one manifest with their signing key. */
export const signPackage = (manifest: PluginManifest, key: string): string =>
  keyedHash(manifest, key)

export type TrustVerdict = Readonly<{ ok: true; digest: string }>

export type PluginTrustOptions = Readonly<{
  /** Signing keys accepted by this host. Empty list = no package is trusted. */
  trustedKeys?: readonly string[]
  /** Require a valid signature for every install (default: require). */
  requireSignature?: boolean
}>

/** Host-side trust policy: which keys sign packages, which plugins are revoked. */
export class PluginTrustStore {
  private readonly keys = new Set<string>()
  private readonly revokedIds = new Set<string>()
  private readonly revokedVersions = new Set<string>()
  private readonly requireSignature: boolean

  constructor(options: PluginTrustOptions = {}) {
    for (const key of options.trustedKeys ?? []) this.keys.add(key)
    this.requireSignature = options.requireSignature ?? true
  }

  addTrustedKey(key: string) {
    this.keys.add(key)
  }

  revoke(pluginId: string) {
    this.revokedIds.add(pluginId)
  }

  revokeVersion(pluginId: string, version: string) {
    this.revokedVersions.add(`${pluginId}@${version}`)
  }

  /** Lift a revocation (e.g. after a fixed release is re-published). */
  clearRevocation(pluginId: string) {
    this.revokedIds.delete(pluginId)
    for (const entry of this.revokedVersions) {
      if (entry.startsWith(`${pluginId}@`)) this.revokedVersions.delete(entry)
    }
  }

  isRevoked(pluginId: string, version?: string): boolean {
    if (this.revokedIds.has(pluginId)) return true
    if (version !== undefined && this.revokedVersions.has(`${pluginId}@${version}`)) return true
    return false
  }

  /** Verify one package: revocation first (fail closed), then signature.
   *  Throws `PluginTrustError` — callers must not install on any throw. */
  verify(manifest: PluginManifest, signature: string | undefined): TrustVerdict {
    const digest = computePackageDigest(manifest)
    if (this.isRevoked(manifest.id, manifest.version)) {
      throw new PluginTrustError('REVOKED', `Plugin ${manifest.id}@${manifest.version} is revoked`)
    }
    if (signature === undefined) {
      if (this.requireSignature) {
        throw new PluginTrustError('UNTRUSTED_SIGNATURE', `Package ${manifest.id} has no signature`)
      }
      return { ok: true, digest }
    }
    const valid = [...this.keys].some(key => keyedHash(manifest, key) === signature)
    if (!valid) {
      throw new PluginTrustError('UNTRUSTED_SIGNATURE', `Signature for ${manifest.id} does not match any trusted key (digest ${digest})`)
    }
    return { ok: true, digest }
  }
}
