import assert from 'node:assert/strict'
import test from 'node:test'
import type { PluginModelSnapshot } from '@buckle/plugin-sdk'
import { planRename, renameCommand } from './rename.ts'

const snapshot = {
  revision: 4,
  nodes: [{ id: 1, position: [0, 0, 0], name: 'A' }, { id: 2, position: [1, 0, 0] }],
  members: [{ id: 3, nodeI: 1, nodeJ: 2, sectionId: 1, label: 'Beam' }],
  shells: [{ id: 4, nodeIds: [1, 2, 3, 4], thickness: 0.2, materialId: 1 }],
} as unknown as PluginModelSnapshot

test('selected nodes are renamed with prefix and suffix', () => {
  const rows = planRename(snapshot, [{ collection: 'nodes', id: 2 }], {
    kind: 'nodes', scope: 'selected', prefix: 'N-', suffix: '-X',
  })
  assert.deepEqual(rows.map(row => [row.id, row.before, row.after]), [[2, 'Node 2', 'N-Node 2-X']])
  assert.deepEqual(renameCommand(rows), {
    type: 'Transaction', payload: { operations: [
      { type: 'MoveNodes', payload: { nodes: [{ id: 2, position: [1, 0, 0], name: 'N-Node 2-X' }] } },
    ] },
  })
})

test('all elements include members and shells and keep required shell fields', () => {
  const rows = planRename(snapshot, [], { kind: 'elements', scope: 'all', prefix: '', suffix: '_new' })
  assert.deepEqual(rows.map(row => row.after), ['Beam_new', 'Shell 4_new'])
  const command = renameCommand(rows) as { payload: { operations: { type: string; payload: Record<string, unknown> }[] } }
  assert.deepEqual(command.payload.operations.map(op => op.type), ['UpdateMembers', 'CreateOrUpdateShells'])
  assert.deepEqual(command.payload.operations[1]?.payload.shells, [
    { id: 4, nodeIds: [1, 2, 3, 4], thickness: 0.2, materialId: 1, name: 'Shell 4_new' },
  ])
})

test('empty affixes produce no mutations', () => {
  assert.deepEqual(planRename(snapshot, [], { kind: 'nodes', scope: 'all', prefix: '', suffix: '' }), [])
})
