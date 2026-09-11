import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PluginStorage, PluginStorageQuotaError, pluginStorage } from './PluginStorage.ts'
import { brokerRpcHandlers } from './PanelRpcBridge.ts'
import { RpcProtocolError } from './rpc.ts'
import { createPluginCommandBroker } from './PluginHostApi.ts'
import type { PluginCommandServices } from './PluginHostApi.ts'

const services = (): PluginCommandServices => ({
  getRevision: () => 1,
  querySnapshot: () => ({}),
  getWorkspaceState: () => ({ modelLocked: false, hasResults: false, selection: [], hidden: [] }),
  execute: () => ({ commandId: 'x', status: 'applied', revision: 1, appliedAt: 0 } as never),
})

const sessionFor = (id: string) =>
  createPluginCommandBroker(
    services(),
    { kind: 'plugin', id, version: '1.0.0' },
    ['model.read', 'storage.project', 'storage.local'],
  )

test('namespaced storage isolates plugins from each other', () => {
  const storage = new PluginStorage()
  storage.set('a.b', 'project', 'key', 1)
  storage.set('c.d', 'project', 'key', 2)
  assert.equal(storage.get('a.b', 'project', 'key'), 1)
  assert.equal(storage.get('c.d', 'project', 'key'), 2)
  assert.deepEqual(storage.keys('a.b', 'project'), ['key'])
})

test('scopes are independent: project persists, local is session-only', () => {
  const storage = new PluginStorage()
  storage.set('a.b', 'project', 'k', 'persisted')
  storage.set('a.b', 'local', 'k', 'session')
  assert.equal(storage.get('a.b', 'project', 'k'), 'persisted')
  assert.equal(storage.get('a.b', 'local', 'k'), 'session')
  storage.delete('a.b', 'local', 'k')
  assert.equal(storage.get('a.b', 'project', 'k'), 'persisted')
})

test('quotas fail closed before a value is stored', () => {
  const storage = new PluginStorage({ maxEntriesPerPlugin: 2, maxValueBytes: 16 })
  storage.set('p', 'project', 'a', 1)
  storage.set('p', 'project', 'b', 2)
  assert.throws(() => storage.set('p', 'project', 'c', 3), PluginStorageQuotaError)
  // Oversized value is rejected without consuming the entry budget.
  assert.throws(() => storage.set('p', 'project', 'big', 'x'.repeat(17)), PluginStorageQuotaError)
  // Unserializable value fails closed too.
  const circular: Record<string, unknown> = {}
  circular.self = circular
  assert.throws(() => storage.set('p', 'project', 'bad', circular), PluginStorageQuotaError)
  assert.throws(() => storage.set('p', 'project', '', 1), PluginStorageQuotaError)
  assert.deepEqual(storage.keys('p', 'project'), ['a', 'b'])
})

test('project scope round-trips through the project file snapshot', () => {
  const source = new PluginStorage()
  source.set('a.b', 'project', 'config', { span: 12, bays: 4 })
  source.set('a.b', 'local', 'scratch', 'not persisted')
  source.set('c.d', 'project', 'other', [1, 2, 3])
  const file = source.serializeProject() as Record<string, Record<string, unknown>>
  assert.deepEqual(file['a.b'], { config: { span: 12, bays: 4 } })
  assert.equal((file['a.b'] as Record<string, unknown>).scratch, undefined)

  const target = new PluginStorage()
  target.restoreProject(file)
  assert.deepEqual(target.get('a.b', 'project', 'config'), { span: 12, bays: 4 })
  assert.equal(target.get('a.b', 'local', 'scratch'), undefined)
})

test('restore drops malformed namespaces and over-quota entries without failing', () => {
  const storage = new PluginStorage({ maxEntriesPerPlugin: 1, maxValueBytes: 8 })
  storage.restoreProject({
    good: { keep: 1, 'too-much': 2 },
    broken: 'not an object',
    'huge.value': { big: 'x'.repeat(64) },
  })
  assert.equal(storage.get('good', 'project', 'keep'), 1)
  assert.equal(storage.get('good', 'project', 'too-much'), undefined)
  assert.equal(storage.get('broken', 'project', 'x'), undefined)
  // Non-object input clears persisted state (fail closed, not fatal).
  storage.set('z', 'project', 'k', 1)
  storage.restoreProject(null)
  assert.deepEqual(storage.keys('z', 'project'), [])
})

test('clearPlugin drops both scopes (uninstall cleanup)', () => {
  const storage = new PluginStorage()
  storage.set('p', 'project', 'a', 1)
  storage.set('p', 'local', 'b', 2)
  storage.clearPlugin('p')
  assert.deepEqual(storage.keys('p', 'project'), [])
  assert.deepEqual(storage.keys('p', 'local'), [])
})

test('app-wide singleton survives a save/open round-trip', () => {
  pluginStorage.set('com.roundtrip', 'project', 'state', { v: 42 })
  const file = pluginStorage.serializeProject()
  pluginStorage.clearPlugin('com.roundtrip')
  pluginStorage.restoreProject(file)
  assert.deepEqual(pluginStorage.get('com.roundtrip', 'project', 'state'), { v: 42 })
})

test('storage RPC handlers are namespaced by the session owner id', () => {
  const storage = new PluginStorage()
  const handlers = brokerRpcHandlers(sessionFor('com.acme.plugin'), storage)
  handlers['storage.set']!({ method: 'storage.set', params: { key: 'plan', value: { w: 4 } } } as never)
  assert.deepEqual(handlers['storage.get']!({ method: 'storage.get', params: { key: 'plan' } } as never), { w: 4 })
  // Another plugin's namespace is unreachable through its own session.
  const other = brokerRpcHandlers(sessionFor('com.other.plugin'), storage)
  assert.equal(other['storage.get']!({ method: 'storage.get', params: { key: 'plan' } } as never), undefined)
  assert.deepEqual(handlers['storage.keys']!({ method: 'storage.keys', params: {} } as never), ['plan'])
  assert.equal(handlers['storage.delete']!({ method: 'storage.delete', params: { key: 'plan' } } as never), true)
  assert.deepEqual(handlers['storage.keys']!({ method: 'storage.keys', params: {} } as never), [])
})

test('storage RPC fails closed without a backing or with bad params', () => {
  const handlers = brokerRpcHandlers(sessionFor('com.acme.plugin'))
  assert.throws(
    () => handlers['storage.get']!({ method: 'storage.get', params: { key: 'k' } } as never),
    (error: unknown) => error instanceof RpcProtocolError && error.code === 'UNAVAILABLE',
  )
  const backed = brokerRpcHandlers(sessionFor('com.acme.plugin'), new PluginStorage({ maxValueBytes: 16 }))
  assert.throws(
    () => backed['storage.get']!({ method: 'storage.get', params: { scope: 'cookie' } } as never),
    (error: unknown) => error instanceof RpcProtocolError && error.code === 'INVALID_PARAMS',
  )
  assert.throws(
    () => backed['storage.set']!({ method: 'storage.set', params: { key: 'k' } } as never),
    (error: unknown) => error instanceof RpcProtocolError && error.code === 'INVALID_PARAMS',
  )
  assert.throws(
    () => backed['storage.set']!({ method: 'storage.set', params: { key: 'k', value: 'x'.repeat(17) } } as never),
    (error: unknown) => error instanceof RpcProtocolError && error.code === 'STORAGE_QUOTA_EXCEEDED',
  )
})

