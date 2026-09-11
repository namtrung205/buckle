import assert from 'node:assert/strict'
import test from 'node:test'
import { PanelRpcBridge, brokerRpcHandlers } from './PanelRpcBridge.ts'
import type { PanelMessageLike, PanelWindowLike } from './PanelRpcBridge.ts'
import type { PluginCommandBroker } from './PluginHostApi.ts'
import { PluginStorage } from './PluginStorage.ts'

/** Minimal broker double: the bridge only touches query/execute/notify. */
const fakeSession = {
  query: () => ({ nodes: [{ id: 1 }], members: [] }),
  execute: () => ({ ok: true, result: { revision: 3, previousRevision: 2 } }),
  notify: () => {},
  openPanel: () => {},
} as unknown as PluginCommandBroker

const harness = (session: PluginCommandBroker = fakeSession, storage?: PluginStorage) => {
  const listeners: ((event: PanelMessageLike) => void)[] = []
  const posted: unknown[] = []
  const panel: PanelWindowLike = {
    postMessage: (message: unknown) => { posted.push(message) },
  }
  const bridge = new PanelRpcBridge({
    panel,
    handlers: brokerRpcHandlers(session, storage),
    subscribe: listener => {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
  })
  /** Default source is the panel itself — the trusted sender. */
  const emit = (data: unknown, source: unknown = panel) => {
    for (const listener of [...listeners]) listener({ source, data })
  }
  return { bridge, posted, emit, panel }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

test('a trusted panel call is answered with a result envelope', async () => {
  const { emit, posted } = harness()
  emit({ v: 1, id: 'q1', method: 'model.query' })
  await flush()
  assert.equal(posted.length, 1)
  assert.deepEqual(posted[0], { v: 1, id: 'q1', ok: true, value: { nodes: [{ id: 1 }], members: [] } })
})

test('model.execute passes through to the broker outcome', async () => {
  const { emit, posted } = harness()
  emit({ v: 1, id: 'e1', method: 'model.execute', params: { command: { type: 'Transaction', payload: { operations: [] } } } })
  await flush()
  assert.deepEqual(posted[0], {
    v: 1, id: 'e1', ok: true,
    value: { ok: true, result: { revision: 3, previousRevision: 2 } },
  })
})

test('messages from any other window are ignored (fail closed)', async () => {
  const { emit, posted } = harness()
  emit({ v: 1, id: 'x1', method: 'model.query' }, { postMessage: () => {} })
  emit({ v: 1, id: 'x2', method: 'model.query' }, null)
  await flush()
  assert.equal(posted.length, 0)
})

test('close() detaches the listener — later messages are dropped', async () => {
  const { bridge, emit, posted } = harness()
  assert.equal(bridge.isClosed, false)
  bridge.close()
  bridge.close() // idempotent
  assert.equal(bridge.isClosed, true)
  emit({ v: 1, id: 'c1', method: 'model.query' })
  await flush()
  assert.equal(posted.length, 0)
})

test('storage.* fails closed without the matching permission grant', async () => {
  const session = {
    ...fakeSession,
    ownerId: 'com.example.panel',
    grants: [] as string[],
  } as unknown as PluginCommandBroker
  const { emit, posted } = harness(session, new PluginStorage())
  emit({ v: 1, id: 's1', method: 'storage.set', params: { scope: 'project', key: 'k', value: 1 } })
  await flush()
  assert.deepEqual(posted[0], {
    v: 1, id: 's1', ok: false,
    error: { code: 'PERMISSION_DENIED', message: 'storage project access requires the storage.project permission' },
  })
  // The storage backend must stay untouched — no leak of the rejected write.
  const session2 = {
    ...fakeSession,
    ownerId: 'com.example.panel',
    grants: ['storage.local'],
  } as unknown as PluginCommandBroker
  const { emit: emit2, posted: posted2 } = harness(session2, new PluginStorage())
  emit2({ v: 1, id: 's2', method: 'storage.get', params: { scope: 'project', key: 'k' } })
  await flush()
  assert.deepEqual(posted2[0], {
    v: 1, id: 's2', ok: false,
    error: { code: 'PERMISSION_DENIED', message: 'storage project access requires the storage.project permission' },
  })
})

test('storage.* works with the grant and is namespaced by the owner id', async () => {
  const session = {
    ...fakeSession,
    ownerId: 'com.example.panel',
    grants: ['storage.project'],
  } as unknown as PluginCommandBroker
  const { emit, posted } = harness(session, new PluginStorage())
  emit({ v: 1, id: 's1', method: 'storage.set', params: { scope: 'project', key: 'k', value: 41 } })
  emit({ v: 1, id: 's2', method: 'storage.get', params: { scope: 'project', key: 'k' } })
  emit({ v: 1, id: 's3', method: 'storage.keys', params: { scope: 'project' } })
  await flush()
  assert.deepEqual(posted.map(message => (message as { id: string; value?: unknown }).value), [undefined, 41, ['k']])
})
