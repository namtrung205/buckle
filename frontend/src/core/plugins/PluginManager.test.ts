import assert from 'node:assert/strict'
import test from 'node:test'
import { PluginManager } from './PluginManager.ts'
import type { PluginCommandBroker } from './PluginHostApi.ts'

const manifest = {
  id: 'com.example.thing',
  name: 'Thing',
  version: '1.0.0',
  apiVersion: 1,
  permissions: ['model.read'],
}

const factory = (result: 'ok' | 'throw') => (m: unknown): PluginCommandBroker => {
  if (result === 'throw') throw new Error('sandbox exploded')
  assert.equal((m as { id: string }).id, 'com.example.thing')
  return {} as PluginCommandBroker
}

/** Session factory that throws only for one plugin id (bootAll fault isolation). */
const factoryThrowingFor = (faultyId: string) => (m: unknown): PluginCommandBroker => {
  if ((m as { id: string }).id === faultyId) throw new Error('sandbox exploded')
  return {} as PluginCommandBroker
}

test('install validates and registers the manifest', () => {
  const manager = new PluginManager({ sessionFactory: factory('ok') })
  manager.install(manifest)
  assert.equal(manager.list()[0].state, 'installed')
  assert.equal(manager.list()[0].apiVersion, 1)
  assert.throws(() => manager.install({ ...manifest, id: 'nope' }))
})

test('enable/disable/uninstall lifecycle', async () => {
  const manager = new PluginManager({ sessionFactory: factory('ok') })
  manager.install(manifest)
  assert.equal(await manager.enable('com.example.thing'), true)
  assert.equal(manager.list()[0].state, 'enabled')
  assert.ok(manager.getSession('com.example.thing'))
  manager.disable('com.example.thing')
  assert.equal(manager.list()[0].state, 'disabled')
  assert.equal(manager.getSession('com.example.thing'), null)
  assert.equal(manager.uninstall('com.example.thing'), true)
  assert.equal(manager.list().length, 0)
})

test('enabling an unknown plugin returns false', async () => {
  const manager = new PluginManager({ sessionFactory: factory('ok') })
  assert.equal(await manager.enable('com.example.missing'), false)
})

test('bootAll starts healthy plugins and skips faulty ones (host still boots)', async () => {
  const manager = new PluginManager({ sessionFactory: factoryThrowingFor('com.example.fine') })
  manager.install(manifest)
  manager.install({ ...manifest, id: 'com.example.fine', name: 'Fine' })
  const summary = await manager.bootAll()
  assert.deepEqual(summary.started, ['com.example.thing'])
  assert.deepEqual(summary.failed, ['com.example.fine'])
  assert.equal(manager.safeMode, false)
  assert.equal(manager.getSession('com.example.thing') !== null, true)
})

test('a crash loop quarantines the plugin and flips safe mode', async () => {
  const manager = new PluginManager({ sessionFactory: factory('ok') })
  manager.install(manifest)
  assert.equal(manager.reportCrash('com.example.thing'), 'installed')
  manager.reportCrash('com.example.thing')
  assert.equal(manager.reportCrash('com.example.thing'), 'quarantined')
  assert.equal(manager.safeMode, true)
  assert.equal(await manager.enable('com.example.thing'), false)
  manager.release('com.example.thing')
  assert.equal(manager.safeMode, false)
})

test('bootAll reports quarantined plugins instead of enabling them', async () => {
  const manager = new PluginManager({ sessionFactory: factory('ok') })
  manager.install(manifest)
  manager.reportCrash('com.example.thing')
  manager.reportCrash('com.example.thing')
  manager.reportCrash('com.example.thing')
  const summary = await manager.bootAll()
  assert.deepEqual(summary.started, [])
  assert.deepEqual(summary.quarantined, ['com.example.thing'])
})

test('re-install tears down the live session first', async () => {
  const manager = new PluginManager({ sessionFactory: factory('ok') })
  manager.install(manifest)
  await manager.enable('com.example.thing')
  manager.install({ ...manifest, version: '1.1.0' })
  assert.equal(manager.list()[0].state, 'installed')
  assert.equal(manager.getSession('com.example.thing'), null)
})
