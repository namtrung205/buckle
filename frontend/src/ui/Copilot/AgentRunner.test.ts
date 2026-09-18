import assert from 'node:assert/strict'
import test from 'node:test'
import { agentContextResults, newAgentCheckpoint, readAgentResult, runAgent } from './AgentRunner.ts'

test('agent completes beyond old loop limits even when identical queries repeat', async () => {
  const run = newAgentCheckpoint('work until complete')
  let calls = 0
  const message = await runAgent(run, {
    signal: new AbortController().signal,
    plan: async () => calls >= 120 ? { message: 'Verified', toolCalls: [], finishReason: 'stop' }
      : { message: '', toolCalls: Array.from({ length: 3 }, () => ({ id: 'provider-reuses-id', name: 'query', arguments: {} })), finishReason: 'tool_calls' },
    execute: async call => { calls++; return { toolCallId: call.id, tool: call.name, ok: true, revision: 0, data: { calls } } },
  })
  assert.equal(message, 'Verified'); assert.equal(calls, 120); assert.equal(run.round, 41)
  assert.equal(new Set(run.results.map(r => r.toolCallId)).size, 120)
})

test('stop stores already committed evidence; resume executes remaining saved calls without replay', async () => {
  const run = newAgentCheckpoint('two changes')
  const controller = new AbortController()
  const committed: string[] = []
  await assert.rejects(runAgent(run, {
    signal: controller.signal,
    plan: async () => ({ message: '', toolCalls: [{ id: 'a', name: 'first', arguments: {} }, { id: 'b', name: 'second', arguments: {} }], finishReason: 'tool_calls' }),
    execute: async call => { committed.push(call.name); controller.abort(); return { toolCallId: call.id, tool: call.name, ok: true, revision: 1, undoToken: 'undo' } },
  }), { name: 'AbortError' })
  assert.deepEqual(committed, ['first']); assert.equal(run.queued.length, 1)
  await runAgent(run, {
    signal: new AbortController().signal,
    plan: async () => ({ message: 'complete', toolCalls: [], finishReason: 'stop' }),
    execute: async call => { committed.push(call.name); return { toolCallId: call.id, tool: call.name, ok: true, revision: 2 } },
  })
  assert.deepEqual(committed, ['first', 'second']); assert.equal(run.results.length, 2)
})

test('waiting for an approval result does not complete the task; next plan receives the applied result', async () => {
  const run = newAgentCheckpoint('preview, apply, inspect')
  let approve!: () => void
  let planned = 0
  const promise = runAgent(run, {
    signal: new AbortController().signal,
    plan: async current => {
      planned++
      if (planned === 1) return { message: '', toolCalls: [{ id: 'p', name: 'edit', arguments: {} }], finishReason: 'tool_calls' }
      assert.equal(current.results[0].content.undoToken, 'approved-change')
      return { message: 'verified', toolCalls: [], finishReason: 'stop' }
    },
    execute: call => new Promise(resolve => { approve = () => resolve({ toolCallId: call.id, tool: call.name, ok: true, revision: 1, undoToken: 'approved-change' }) }),
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(run.status, 'running'); assert.equal(planned, 1)
  approve(); assert.equal(await promise, 'verified'); assert.equal(planned, 2)
})

test('provider context compaction keeps every full original result retrievable', () => {
  const run = newAgentCheckpoint('long results')
  run.results = [{ toolCallId: 'large', tool: 'query', ok: true, content: { data: 'x'.repeat(90000) } }]
  const context = agentContextResults(run.results, 100)
  assert.equal(context[0].content.archived, true)
  let full = ''; let offset: number | null = 0
  while (offset !== null) { const page = readAgentResult(run, { resultId: 'large', offset, length: 10000 }); full += page.json; offset = page.nextOffset }
  assert.deepEqual(JSON.parse(full), run.results[0].content)
})
