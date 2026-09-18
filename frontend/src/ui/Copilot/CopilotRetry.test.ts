import assert from 'node:assert/strict'
import test from 'node:test'
import { CommandGateway, StructuralDocument } from '../../core/structural/index.ts'
import { AiToolExecutor } from '../../core/ai/index.ts'
import { canRetryCopilotTurn, copilotToolCallId } from './CopilotRetry.ts'

test('only one failed-turn retry is offered', () => {
  assert.equal(canRetryCopilotTurn({ status: 'failed', retryCount: 0 }, false), true)
  assert.equal(canRetryCopilotTurn({ status: 'failed', retryCount: 1 }, false), false)
  assert.equal(canRetryCopilotTurn({ status: 'completed', retryCount: 0 }, false), false)
  assert.equal(canRetryCopilotTurn({ status: 'cancelled', retryCount: 0 }, false), false)
  assert.equal(canRetryCopilotTurn({ status: 'failed', retryCount: 0 }, true), false)
})

test('mutation retry reuses a stable tool-call id and cannot duplicate an applied entity', () => {
  const document = new StructuralDocument()
  const executor = new AiToolExecutor(document, new CommandGateway(document), {
    getWorkspaceState: () => ({ selection: [], hidden: [] }),
    applyWorkspaceState: () => undefined,
  })
  const logicalTurnId = 'logical-turn-1'
  const originalId = copilotToolCallId(logicalTurnId, 0, 0)
  const retryId = copilotToolCallId(logicalTurnId, 0, 0)
  const call = { id: originalId, name: 'create_nodes', arguments: { nodes: [{ id: 1, position: [0, 0, 0] }] } } as const

  const original = executor.execute(call, 'Modeling')
  const revisionAfterOriginal = document.revision
  const retried = executor.execute({ ...call, id: retryId }, 'Modeling')

  assert.equal(original.ok, true)
  assert.equal(retried.ok, true)
  assert.equal(retryId, originalId)
  assert.equal(document.nodes.size, 1)
  assert.equal(document.revision, revisionAfterOriginal)
  assert.equal(retried.undoToken, original.undoToken)
})

test('mutation retry fails closed if the provider changes a tool call in the same slot', () => {
  const document = new StructuralDocument()
  const executor = new AiToolExecutor(document, new CommandGateway(document), {
    getWorkspaceState: () => ({ selection: [], hidden: [] }),
    applyWorkspaceState: () => undefined,
  })
  const id = copilotToolCallId('logical-turn-2', 0, 0)

  executor.execute({ id, name: 'create_nodes', arguments: { nodes: [{ id: 1, position: [0, 0, 0] }] } }, 'Modeling')
  const conflict = executor.execute({ id, name: 'create_nodes', arguments: { nodes: [{ id: 2, position: [1, 0, 0] }] } }, 'Modeling')

  assert.equal(conflict.ok, false)
  assert.equal(conflict.error?.code, 'IDEMPOTENCY_CONFLICT')
  assert.equal(document.nodes.has(1), true)
  assert.equal(document.nodes.has(2), false)
})
