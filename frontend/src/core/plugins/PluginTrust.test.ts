import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PluginTrustError, PluginTrustStore, computePackageDigest, signPackage, keyedHash } from './PluginTrust.ts'
import { validateManifest } from './manifest.ts'

const baseManifest = {
  id: 'com.example.trustee',
  name: 'Trustee',
  version: '1.0.0',
  apiVersion: 1,
  permissions: ['model.read'],
  contributions: { commands: [{ id: 'com.example.trustee.run', title: 'Run' }] },
}

const key = 'signing-key-1'

test('keyedHash binds the key and the canonical payload', () => {
  const a = keyedHash(baseManifest, key)
  assert.equal(a, keyedHash({ ...baseManifest }, key))
  assert.notEqual(a, keyedHash(baseManifest, 'other-key'))
  assert.notEqual(a, keyedHash({ ...baseManifest, name: 'Tampered' }, key))
})

test('signPackage + verify accepts a signature from a trusted key', () => {
  const manifest = validateManifest(baseManifest)
  const store = new PluginTrustStore({ trustedKeys: [key] })
  const verdict = store.verify(manifest, signPackage(manifest, key))
  assert.equal(verdict.ok, true)
  assert.equal(verdict.digest, computePackageDigest(manifest))
})

test('tampered payloads fail signature verification', () => {
  const manifest = validateManifest(baseManifest)
  const store = new PluginTrustStore({ trustedKeys: [key] })
  const signature = signPackage(manifest, key)
  assert.throws(
    () => store.verify(validateManifest({ ...baseManifest, name: 'Evil' }), signature),
    (error: unknown) => error instanceof PluginTrustError && error.code === 'UNTRUSTED_SIGNATURE',
  )
})

test('unknown keys and missing signatures fail closed', () => {
  const manifest = validateManifest(baseManifest)
  const store = new PluginTrustStore({ trustedKeys: [key] })
  assert.throws(
    () => store.verify(manifest, signPackage(manifest, 'attacker-key')),
    (error: unknown) => error instanceof PluginTrustError && error.code === 'UNTRUSTED_SIGNATURE',
  )
  assert.throws(
    () => store.verify(manifest, undefined),
    (error: unknown) => error instanceof PluginTrustError && error.code === 'UNTRUSTED_SIGNATURE',
  )
  // Unsigned packages are accepted only when the policy explicitly allows it.
  const permissive = new PluginTrustStore({ trustedKeys: [key], requireSignature: false })
  assert.deepEqual(permissive.verify(manifest, undefined), { ok: true, digest: computePackageDigest(manifest) })
})

test('revocation blocks id and exact version, and can be lifted', () => {
  const manifest = validateManifest(baseManifest)
  const store = new PluginTrustStore({ trustedKeys: [key] })
  store.revoke('com.example.other')
  assert.throws(
    () => store.verify(validateManifest({ ...baseManifest, id: 'com.example.other', contributions: { commands: [{ id: 'com.example.other.run', title: 'Run' }] } }), signPackage(manifest, key)),
    (error: unknown) => error instanceof PluginTrustError && error.code === 'REVOKED',
  )
  store.revokeVersion('com.example.trustee', '1.0.0')
  assert.throws(
    () => store.verify(manifest, signPackage(manifest, key)),
    (error: unknown) => error instanceof PluginTrustError && error.code === 'REVOKED',
  )
  // A different version of the same id stays installable.
  const v101 = validateManifest({ ...baseManifest, version: '1.0.1' })
  assert.doesNotThrow(() => store.verify(v101, signPackage(v101, key)))
  store.clearRevocation('com.example.trustee')
  assert.doesNotThrow(() => store.verify(manifest, signPackage(manifest, key)))
  assert.equal(store.isRevoked('com.example.other'), true)
  store.clearRevocation('com.example.other')
  assert.equal(store.isRevoked('com.example.other'), false)
})

test('a store with no trusted keys rejects every signed package', () => {
  const manifest = validateManifest(baseManifest)
  const store = new PluginTrustStore()
  assert.throws(() => store.verify(manifest, signPackage(manifest, key)), PluginTrustError)
})
