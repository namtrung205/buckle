import assert from 'node:assert/strict'
import test from 'node:test'
import { WorkerRuntime } from './WorkerRuntime.ts'
import type { WorkerRuntimeOptions } from './WorkerRuntime.ts'

/** Minimal worker double: records posts/terminates, keeps listeners injectable. */
class FakeWorker {
  readonly posted: unknown[] = []
  terminateCalls = 0
  private listeners: ((event: { data: unknown }) => void)[] = []
  postMessage(message: unknown): void {
    this.posted.push(message)
  }
  terminate(): void {
    this.terminateCalls += 1
  }
  addEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
    this.listeners.push(listener)
  }
  removeEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
    this.listeners = this.listeners.filter(registered => registered !== listener)
  }
  emit(data: unknown): void {
    for (const listener of [...this.listeners]) listener({ data })
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

const harness = (options: Partial<WorkerRuntimeOptions> = {}) => {
  const worker = new FakeWorker()
  const crashes: string[] = []
  const violations: [string, string][] = []
  const runtime = new WorkerRuntime({
    spawn: () => worker,
    handlers: { 'model.query': () => ({ nodes: [] }) },
    onCrash: reason => {
      crashes.push(reason)
      options.onCrash?.(reason)
    },
    onViolation: (code, message) => {
      violations.push([code, message])
      options.onViolation?.(code, message)
    },
    ...(options.budget !== undefined ? { budget: options.budget } : {}),
    ...(options.maxViolations !== undefined ? { maxViolations: options.maxViolations } : {}),
    ...(options.callTimeoutMs !== undefined ? { callTimeoutMs: options.callTimeoutMs } : {}),
  })
  return { worker, runtime, crashes, violations, emit: (data: unknown) => worker.emit(data) }
}

test('a valid call is answered with a structured result envelope', async () => {
  const { worker, emit } = harness()
  emit({ v: 1, id: 'q1', method: 'model.query' })
  await flush()
  assert.equal(worker.posted.length, 1)
  assert.deepEqual(worker.posted[0], { v: 1, id: 'q1', ok: true, value: { nodes: [] } })
})

test('unknown and malformed traffic fails closed without reaching a handler', async () => {
  let handlerCalls = 0
  const worker = new FakeWorker()
  const runtime = new WorkerRuntime({
    spawn: () => worker,
    handlers: { 'model.query': () => { handlerCalls += 1; return { nodes: [] } } },
  })
  void runtime
  worker.emit({ v: 1, id: 'x1', method: 'fs.read' }) // unknown method → answerable
  worker.emit({ v: 2, id: 'x2', method: 'model.query' }) // wrong version → answerable
  worker.emit('nope') // not an envelope → unroutable, dropped
  await flush()
  assert.equal(handlerCalls, 0) // the handler never saw anything
  assert.equal(worker.posted.length, 2) // only the answerable ones got error envelopes
  assert.equal((worker.posted[0] as { id: string }).id, 'x1')
  assert.equal((worker.posted[0] as { ok: boolean }).ok, false)
  assert.equal((worker.posted[0] as { error: { code: string } }).error.code, 'UNKNOWN_METHOD')
  assert.equal((worker.posted[1] as { error: { code: string } }).error.code, 'MALFORMED_ENVELOPE')
})

test('protocol violations count toward maxViolations and terminate the worker', async () => {
  const { worker, runtime, crashes, violations, emit } = harness({ maxViolations: 2 })
  emit('bad-1')
  emit('bad-2')
  assert.equal(runtime.isTerminated, true)
  assert.equal(worker.terminateCalls, 1)
  assert.equal(violations.length, 2)
  await flush()
  assert.equal(worker.posted.length, 0)
  assert.equal(crashes.length, 1)
  assert.match(crashes[0]!, /violation budget exhausted/)
  // the listener is detached — later traffic is dropped and cannot re-crash
  emit({ v: 1, id: 'q2', method: 'model.query' })
  await flush()
  assert.equal(worker.posted.length, 0)
  assert.equal(crashes.length, 1)
})

test('a throwing handler becomes a structured error envelope, not a crash', async () => {
  const worker = new FakeWorker()
  const runtime = new WorkerRuntime({
    spawn: () => worker,
    handlers: { 'model.query': () => { throw new Error('boom') } },
  })
  worker.emit({ v: 1, id: 'q1', method: 'model.query' })
  await flush()
  assert.equal(runtime.isTerminated, false)
  assert.deepEqual(worker.posted[0], {
    v: 1, id: 'q1', ok: false, error: { code: 'REJECTED', message: 'boom' },
  })
})

test('terminate() is idempotent and stops answering messages', () => {
  const { worker, runtime, crashes, emit } = harness()
  runtime.terminate('manual')
  runtime.terminate('manual-again')
  assert.equal(worker.terminateCalls, 1)
  assert.equal(crashes.length, 1)
  emit({ v: 1, id: 'q3', method: 'model.query' })
  assert.equal(worker.posted.length, 0)
})
