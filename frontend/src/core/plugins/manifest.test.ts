import assert from 'node:assert/strict'
import test from 'node:test'
import { ManifestError, negotiateApiVersion, validateManifest } from './manifest.ts'

const validManifest = {
  id: 'com.example.thing',
  name: 'Thing',
  version: '1.2.3',
  apiVersion: 1,
  permissions: ['model.read', 'viewport.draw'],
  entrypoints: { panel: 'panel.html' },
  contributions: {
    commands: [{ id: 'com.example.thing.run', title: 'Run' }],
    panels: [{ id: 'com.example.thing.panel', title: 'Thing', entry: 'panel.html' }],
  },
}

test('a valid manifest passes and normalizes', () => {
  const manifest = validateManifest(validManifest)
  assert.equal(manifest.id, 'com.example.thing')
  assert.deepEqual(manifest.permissions, ['model.read', 'viewport.draw'])
  assert.equal(manifest.apiVersion, 1)
})

test('unknown top-level keys are rejected (fail closed)', () => {
  assert.throws(() => validateManifest({ ...validManifest, storage: true }), (error: unknown) =>
    error instanceof ManifestError && error.code === 'INVALID_MANIFEST')
})

test('malformed ids, names and versions are rejected', () => {
  assert.throws(() => validateManifest({ ...validManifest, id: 'Bad Id' }))
  // A reverse-domain id requires at least one dot-separated label.
  assert.throws(() => validateManifest({ ...validManifest, id: 'nope' }))
  assert.throws(() => validateManifest({ ...validManifest, version: '1.2' }))
  assert.throws(() => validateManifest({ ...validManifest, name: '' }))
})

test('unsupported apiVersion negotiates to UNSUPPORTED_API_VERSION', () => {
  assert.throws(() => validateManifest({ ...validManifest, apiVersion: 2 }), (error: unknown) =>
    error instanceof ManifestError && error.code === 'UNSUPPORTED_API_VERSION')
})

test('unknown permissions are rejected', () => {
  assert.throws(() => validateManifest({ ...validManifest, permissions: ['model.read', 'host.tokens'] }))
})

test('entry points must be relative or https', () => {
  assert.throws(() => validateManifest({ ...validManifest, entrypoints: { panel: 'http://evil.test/x.html' } }))
  assert.throws(() => validateManifest({ ...validManifest, entrypoints: { worker: 'file:///etc/passwd' } }))
  assert.doesNotThrow(() => validateManifest({ ...validManifest, dev: { url: 'https://dev.test/manifest.json' } }))
  assert.throws(() => validateManifest({ ...validManifest, dev: { url: 'http://dev.test/manifest.json' } }))
})

test('contribution ids must live in the plugin namespace', () => {
  assert.throws(() => validateManifest({
    ...validManifest,
    contributions: { commands: [{ id: 'com.other.thing.run', title: 'Run' }] },
  }), (error: unknown) => error instanceof ManifestError && /namespaced/.test(error.message))
})

test('duplicate permissions collapse', () => {
  const manifest = validateManifest({ ...validManifest, permissions: ['model.read', 'model.read'] })
  assert.deepEqual(manifest.permissions, ['model.read'])
})

test('non-object manifests are rejected', () => {
  assert.throws(() => validateManifest(null))
  assert.throws(() => validateManifest([validManifest]))
})

test('api negotiation accepts supported versions only', () => {
  assert.equal(negotiateApiVersion({ apiVersion: 1 }), 1)
  assert.throws(() => negotiateApiVersion({ apiVersion: 99 }), (error: unknown) =>
    error instanceof ManifestError && error.code === 'UNSUPPORTED_API_VERSION')
})
