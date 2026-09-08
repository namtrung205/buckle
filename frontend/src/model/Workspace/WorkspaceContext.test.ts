import assert from 'node:assert/strict'
import test from 'node:test'
import { StructuralDocument } from '../../core/structural/index.ts'
import { WorkspaceContext } from './WorkspaceContext.ts'

test('workspace selection and drafts never affect the structural snapshot hash', () => {
  const document = new StructuralDocument({ nodes: [{ id: 1, position: [0, 0, 0] }] })
  const before = document.getSnapshotHash()
  const workspace = new WorkspaceContext()

  workspace.selectedNodeIds.add(1)
  workspace.hovered = { kind: 'node', id: 1 }
  workspace.activeTool = 'move'
  workspace.draft = { x: 12 }

  assert.equal(document.getSnapshotHash(), before)
  assert.equal(document.revision, 0)
  assert.deepEqual([...workspace.selectedNodeIds], [1])

  workspace.reset()
  assert.equal(workspace.selectedNodeIds.size, 0)
  assert.equal(workspace.hovered, null)
  assert.equal(workspace.activeTool, null)
})
