import assert from 'node:assert/strict'
import test from 'node:test'
import { PanelRpcBridge, brokerRpcHandlers } from './PanelRpcBridge.ts'
import type { PanelMessageLike, PanelWindowLike } from './PanelRpcBridge.ts'
import type { PluginCommandBroker } from './PluginHostApi.ts'

/** Minimal broker double: the bridge only touches query/execute/notify. */
const fakeSession = {
  query: () => ({ nodes: [{ id: 1 }], members: [] }),
  execute: () => ({ ok: true, result: { revision: 3, previousRevision: 2 } }),
  notify: () => {},
  openPanel: () => {},
} as unknown as PluginCommandBroker

const harness = () => {
  const listeners: ((event: PanelMessageLike) => void)[] = []
  const posted: unknown[] = []
  const panel: PanelWindowLike = {
    postMessage: (message: unknown) => { posted.push(message) },
  }
  const bridge = new PanelRpcBridge({
    panel,
    handlers: brokerRpcHandlers(fakeSession),
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
