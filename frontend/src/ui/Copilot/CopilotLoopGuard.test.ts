import assert from 'node:assert/strict'
import test from 'node:test'
import { copilotToolCallSignature, repeatedCopilotToolCycle, retainCopilotToolResults } from './CopilotLoopGuard.ts'

const call = (name: string, arguments_: Record<string, unknown> = {}) => ({ name, arguments: arguments_ })

test('detects an alternating repeated query cycle before another tool is executed', () => {
  const previous = [
    copilotToolCallSignature(call('get_sections')),
    copilotToolCallSignature(call('get_model_summary')),
    copilotToolCallSignature(call('get_sections')),
  ]

  const cycle = repeatedCopilotToolCycle(previous, [call('get_model_summary')])

  assert.deepEqual(cycle, [
    copilotToolCallSignature(call('get_sections')),
    copilotToolCallSignature(call('get_model_summary')),
  ])
})

test('does not treat changed tool arguments as the same cycle', () => {
  const previous = [copilotToolCallSignature(call('get_sections', { ids: [1] }))]

  assert.equal(repeatedCopilotToolCycle(previous, [call('get_sections', { ids: [2] })]), null)
})

test('tool signatures are stable across object key order', () => {
  assert.equal(
    copilotToolCallSignature(call('query_entities', { collection: 'members', filters: { max: 4, min: 2 } })),
    copilotToolCallSignature(call('query_entities', { filters: { min: 2, max: 4 }, collection: 'members' })),
  )
})

test('tool results remain available across rounds and retain the newest bounded window', () => {
  assert.deepEqual(retainCopilotToolResults(['sections'], ['summary']), ['sections', 'summary'])
  assert.deepEqual(retainCopilotToolResults(['old', 'sections'], ['summary'], 2), ['sections', 'summary'])
})
