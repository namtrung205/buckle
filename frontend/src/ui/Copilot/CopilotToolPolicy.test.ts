import assert from 'node:assert/strict'
import test from 'node:test'
import { safeProviderToolArguments } from './CopilotToolPolicy.ts'

test('provider structural edits are forced to preview until the user applies them', () => {
  for (const tool of ['move_nodes', 'update_members', 'change_section', 'change_material', 'transform_entities', 'update_entity_properties']) {
    assert.deepEqual(safeProviderToolArguments(tool, { preview: false, value: 1 }), { preview: true, value: 1 })
  }
  assert.deepEqual(safeProviderToolArguments('set_selection', { entities: [] }), { entities: [] })
  assert.deepEqual(safeProviderToolArguments('delete_entities', { entities: [] }), { entities: [] })
})
