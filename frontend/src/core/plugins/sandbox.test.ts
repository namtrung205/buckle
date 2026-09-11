import assert from 'node:assert/strict'
import test from 'node:test'
import { CrashLoopTracker, SandboxDispatcher, isTrustedPanelSource } from './sandbox.ts'
import { RpcBudget } from './rpc.ts'
import type { RpcResult } from './rpc.ts'

const call = (id: string, method: string, params?: unknown) =>
  params === undefined ? { v: 1, id, method } : { v: 1, id, method, params }

/** Narrow `handle`'s union for sync-handler assertions (async paths use await). */
const sync = (result: RpcResult | Promise<RpcResult> | null): RpcResult | null => {
  assert.ok(!(result instanceof Promise), 'expected a synchronous result')
  return result
}

test('valid calls dispatch to the handler and return a result envelope', () => {
  const dispatcher = new SandboxDispatcher({
    handlers: { 'model.query': () => ({ nodes: [], members: [] }) },
  })
  const result = sync(dispatcher.handle(call('1', 'model.query')))
  assert.deepEqual(result, { v: 1, id: '1', ok: true, value: { nodes: [], members: [] } })
})

test('calls without a handler answer UNAVAILABLE', () => {
  const dispatcher = new SandboxDispatcher({ handlers: {} })
  const result = sync(dispatcher.handle(call('2', 'ui.notify', { message: 'hi' })))
  assert.equal(result?.ok, false)
  assert.equal(result?.ok === false ? result.error.code : '', 'UNAVAILABLE')
})

test('malformed messages fail closed', () => {
  let violations = 0
  const dispatcher = new SandboxDispatcher({ handlers: {}, onViolation: () => { violations += 1 } })
  // With an id the host can still answer the rejection.
  const withId = sync(dispatcher.handle({ v: 1, id: '3', method: 'nope' }))
  assert.equal(withId?.ok, false)
  // Without an id there is nowhere to route a reply — drop silently.
  assert.equal(sync(dispatcher.handle({ method: 'nope' })), null)
  assert.equal(violations, 2)
})

test('oversized or over-rate traffic never reaches a handler', () => {
  let calls = 0
  const now = 0
  const dispatcher = new SandboxDispatcher({
    handlers: { 'model.query': () => { calls += 1; return {} } },
    budget: new RpcBudget({ maxCalls: 1, windowMs: 1000, now: () => now }),
  })
  assert.equal(sync(dispatcher.handle(call('4', 'model.query')))?.ok, true)
  const second = sync(dispatcher.handle(call('5', 'model.query')))
  assert.equal(second?.ok, false)
  assert.equal(second?.ok === false ? second.error.code : '', 'RATE_EXCEEDED')
  assert.equal(calls, 1)
})

test('async handlers settle into a promise envelope', async () => {
  const dispatcher = new SandboxDispatcher({ handlers: { 'model.execute': () => Promise.resolve({ revision: 7 }) } })
  const result = dispatcher.handle(call('6', 'model.execute', { command: { type: 'Transaction', payload: { operations: [] } } }))
  assert.ok(result instanceof Promise)
  assert.deepEqual(await result, { v: 1, id: '6', ok: true, value: { revision: 7 } })
})

test('a hung handler answers TIMEOUT through the injected timer', async () => {
  const dispatcher = new SandboxDispatcher({
    handlers: { 'model.query': () => new Promise(() => {}) },
    callTimeoutMs: 25,
    scheduleTimeout: (_ms, fn) => { queueMicrotask(fn); return () => {} },
  })
  const result = await dispatcher.handle(call('7', 'model.query'))
  assert.equal(result?.ok, false)
  assert.equal(result?.ok === false ? result.error.code : '', 'TIMEOUT')
})

test('handler rejections become structured errors', async () => {
  const dispatcher = new SandboxDispatcher({
    handlers: { 'model.execute': () => { throw new Error('boom') } },
  })
  const result = await dispatcher.handle(call('8', 'model.execute', { command: { type: 'Transaction', payload: { operations: [] } } }))
  assert.deepEqual(result, { v: 1, id: '8', ok: false, error: { code: 'REJECTED', message: 'boom' } })
})

test('the crash loop quarantines after the threshold', () => {
  const now = 0
  const tracker = new CrashLoopTracker({ maxCrashes: 3, windowMs: 30_000, now: () => now })
  assert.equal(tracker.reportCrash('a'), false)
  assert.equal(tracker.reportCrash('a'), false)
  assert.equal(tracker.reportCrash('a'), true)
  assert.equal(tracker.isQuarantined('a'), true)
  tracker.release('a')
  assert.equal(tracker.isQuarantined('a'), false)
})

test('crashes outside the window do not accumulate', () => {
  let now = 0
  const tracker = new CrashLoopTracker({ maxCrashes: 3, windowMs: 30_000, now: () => now })
  tracker.reportCrash('b')
  tracker.reportCrash('b')
  now = 60_000
  assert.equal(tracker.reportCrash('b'), false)
})

test('panel trust is authenticated by source window identity', () => {
  const panelWindow = { postMessage() {} }
  assert.equal(isTrustedPanelSource(panelWindow, panelWindow), true)
  assert.equal(isTrustedPanelSource({}, panelWindow), false)
  assert.equal(isTrustedPanelSource(null, panelWindow), false)
})
