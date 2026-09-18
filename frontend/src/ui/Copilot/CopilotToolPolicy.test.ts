import { approvedToolArguments } from './CopilotToolPolicy.ts'
import { AiToolRegistry, AiToolExecutor } from '../../core/ai/index.ts'
import { StructuralDocument, CommandGateway } from '../../core/structural/index.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { safeProviderToolArguments } from './CopilotToolPolicy.ts'

test('provider structural edits are forced to preview until the user applies them', () => {
  for (const tool of [
    'create_material', 'create_section',
    'move_nodes', 'update_members', 'change_section', 'change_material', 'transform_entities', 'update_entity_properties',
    'create_grid', 'create_portal_frame', 'create_frame_array', 'create_truss', 'create_warehouse', 'create_tower',
    'update_parametric_object', 'generate_parametric',
  ]) {
    assert.deepEqual(safeProviderToolArguments(tool, { preview: false, value: 1 }), { preview: true, value: 1 })
  }
  assert.deepEqual(safeProviderToolArguments('set_selection', { entities: [] }), { entities: [] })
  assert.deepEqual(safeProviderToolArguments('delete_entities', { entities: [] }), { entities: [] })
})

test('small-model query_entities arguments are reshaped into the schema shape', () => {
  // Flattened singular keys move into filter and become the documented plural keys.
  assert.deepEqual(
    safeProviderToolArguments('query_entities', { semanticRole: 'column', materialId: [2], limit: '10' }),
    { collection: 'members', limit: 10, filter: { semanticRoles: ['column'], materialIds: [2] } },
  )
  // Collection words used as roles are rerouted to the collection parameter.
  assert.deepEqual(
    safeProviderToolArguments('query_entities', { semanticRole: 'member' }),
    { collection: 'members' },
  )
  // Singular ids/numbers/aliases are normalized; the collection singular form is mapped.
  assert.deepEqual(
    safeProviderToolArguments('query_entities', { collection: 'member', materialIds: 1, length: 6, level: 2, name: 'B1' }),
    { collection: 'members', filter: { materialIds: [1], length: { gte: 6, lte: 6 }, levelIds: [2], nameContains: 'B1' } },
  )
  // Placeholder junk such as "[range]" is dropped instead of failing the whole call.
  assert.deepEqual(
    safeProviderToolArguments('query_entities', { collection: 'members', length: '[range]', semanticRoles: ['beam'] }),
    { collection: 'members', filter: { semanticRoles: ['beam'] } },
  )
  // The documented shape passes through unchanged.
  const documented = { collection: 'members', filter: { levelIds: [2], semanticRoles: ['column'] } }
  assert.deepEqual(safeProviderToolArguments('query_entities', documented), documented)
})

test('get_nearby_nodes accepts position/center aliases for the point vector', () => {
  assert.deepEqual(safeProviderToolArguments('get_nearby_nodes', { position: [0, 0, 0], radius: 4 }), { point: [0, 0, 0], radius: 4 })
  assert.deepEqual(safeProviderToolArguments('get_nearby_nodes', { point: [1, 2, 3] }), { point: [1, 2, 3] })
  // Mutations are never reshaped beyond the preview guard.
  assert.deepEqual(safeProviderToolArguments('move_nodes', { nodes: [] }), { nodes: [], preview: true })
})


test('delete Apply accepts schema-shaped arguments and commits after a preview', () => {
  const doc = new StructuralDocument({ nodes: [{ id: 1, position: [0, 0, 0] }] })
  const executor = new AiToolExecutor(doc, new CommandGateway(doc), { getWorkspaceState: () => ({ selection: [], hidden: [] }), applyWorkspaceState: () => {} })
  const args = { entities: [{ collection: 'nodes', id: 1 }] }
  const preview = executor.execute({ id: 'preview', name: 'delete_entities', arguments: args }, 'Agent')
  const properties = new AiToolRegistry().get('delete_entities')!.inputSchema.properties as Record<string, unknown>
  const applied = executor.execute({ id: 'apply', name: 'delete_entities', arguments: approvedToolArguments(args, properties, preview.preview!.approvalToken) }, 'Agent')
  assert.equal(applied.ok, true, applied.error?.message); assert.equal(doc.nodes.size, 0)
})

test('Agent edits execute directly unless explicitly previewed', () => {
  assert.equal(safeProviderToolArguments('move_nodes', { nodes: [] }, 'Agent').preview, false)
  assert.equal(safeProviderToolArguments('move_nodes', { nodes: [], preview: true }, 'Agent').preview, true)
  assert.equal(safeProviderToolArguments('move_nodes', { nodes: [] }, 'Edit').preview, true)
})
