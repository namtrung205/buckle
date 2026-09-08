import assert from 'node:assert/strict'
import test from 'node:test'
import { CommandGateway, StructuralDocument, type CommandWorkspaceState } from '../structural/index.ts'
import { AiToolExecutor, AiToolRegistry, StructuralQueryService, runToolHarness, type AiMode, type AiToolCall, type AiToolProvider } from './index.ts'

const baseDocument = () => new StructuralDocument({
  materials: [
    { id: 1, name: 'Steel', category: 'steel', E: 210e9, nu: 0.3 },
    { id: 2, name: 'Concrete', category: 'concrete', E: 30e9, nu: 0.2 },
  ],
  sections: [
    { id: 1, name: 'I200', type: 'I', materialId: 1 },
    { id: 2, name: 'R300', type: 'Rectangular', materialId: 2 },
  ],
  nodes: [
    { id: 1, name: 'A', position: [0, 0, 0] },
    { id: 2, name: 'B', position: [3, 4, 0] },
    { id: 3, name: 'C', position: [0, 0, 4] },
  ],
  members: [
    { id: 1, label: 'Beam one', nodeI: 1, nodeJ: 2, sectionId: 1 },
    { id: 2, label: 'Column one', nodeI: 1, nodeJ: 3, sectionId: 1 },
  ],
  parametricObjects: [{
    id: 1, kind: 'FrameArray', version: 1, parameters: {}, generatorVersion: 'test@1',
    ownedEntityRefs: [{ collection: 'members', id: 2 }],
    roleBindings: { 'frame-line:0:left:column': { collection: 'members', id: 2 } },
  }],
})

const harness = (document = baseDocument(), budget = {}) => {
  let workspace: CommandWorkspaceState = { selection: [], hidden: [] }
  const executor = new AiToolExecutor(document, new CommandGateway(document), {
    getWorkspaceState: () => structuredClone(workspace),
    applyWorkspaceState: next => { workspace = structuredClone(next) },
    parametricGenerators: {
      MiniFrame: {
        version: 1, generatorVersion: 'mini@1',
        generator: parameters => ({ nodes: [{ role: 'origin:base-node', record: { position: [Number(parameters.x), 0, 0] } }] }),
      },
    },
  }, budget)
  return { document, executor, get workspace() { return workspace } }
}

const invoke = (executor: AiToolExecutor, id: string, name: string, args: Record<string, unknown>, mode: AiMode = 'Modeling') =>
  executor.execute({ id, name, arguments: args } as AiToolCall, mode)

test('registry exposes provider-neutral schemas for every P0 tool', () => {
  const registry = new AiToolRegistry()
  const names = new Set(registry.list().map(tool => tool.name))
  for (const name of [
    'get_model_summary', 'get_selection', 'get_entities', 'query_entities', 'get_connected_entities',
    'get_nearby_nodes', 'get_sections', 'get_materials', 'validate_model', 'create_nodes',
    'create_members', 'move_nodes', 'update_members', 'change_section', 'delete_entities',
    'set_selection', 'hide_entities', 'show_entities', 'execute_transaction', 'preview_transaction',
    'undo_last_ai_change',
  ]) assert.equal(names.has(name), true, `missing ${name}`)
  assert.equal(registry.toOpenAiTools().length, registry.list().length)
  assert.equal(registry.toAnthropicTools().length, registry.list().length)
  assert.equal(JSON.stringify(registry.list()).includes('three'), false)
})

test('query service computes length, material relation, semantic role and connectivity', () => {
  const document = baseDocument()
  const queries = new StructuralQueryService(document, () => ({ selection: [{ collection: 'members', id: 1 }], hidden: [] }))
  const shortSteel = queries.queryEntities('members', { length: { lte: 5 }, materialIds: [1], semanticRoles: ['beam', 'column'] })
  assert.equal(shortSteel.total, 2)
  assert.equal((shortSteel.entities[0] as { computed: { length: number } }).computed.length, 5)
  assert.equal(queries.semanticRole({ collection: 'members', id: 2 }), 'column')
  assert.deepEqual(queries.getNearbyNodes([0, 0, 0], 4).map(node => node.id), [1, 3])
  const connected = queries.getConnectedEntities([{ collection: 'members', id: 1 }])
  assert.ok(connected.some(ref => ref.collection === 'materials' && ref.id === 1))
  assert.equal(queries.getSelection().selection.length, 1)
})

test('Inspect rejects mutation even when a provider emits a valid mutation call', () => {
  const { executor, document } = harness()
  const before = document.getSnapshotHash()
  const response = invoke(executor, 'inspect-escape', 'create_nodes', { nodes: [{ id: 10, position: [1, 2, 3] }] }, 'Inspect')
  assert.equal(response.ok, false)
  assert.equal(response.error?.code, 'MODE_DENIED')
  assert.equal(document.getSnapshotHash(), before)
})

test('Inspect denies every registered mutation schema before handler execution', () => {
  const state = harness()
  const args: Record<string, Record<string, unknown>> = {
    create_nodes: { nodes: [{ position: [0, 0, 0] }] },
    create_members: { members: [{ nodeI: 1, nodeJ: 2, sectionId: 1 }] },
    move_nodes: { nodes: [{ id: 1, position: [0, 0, 0] }] },
    update_members: { members: [{ id: 1, patch: { label: 'x' } }] },
    change_section: { memberIds: [1], sectionId: 1 },
    delete_entities: { entities: [{ collection: 'members', id: 1 }] },
    set_selection: { entities: [] }, hide_entities: { entities: [] }, show_entities: { entities: [] },
    execute_transaction: { operations: [{ type: 'SetSelection', payload: { entities: [] } }] },
    preview_transaction: { operations: [{ type: 'SetSelection', payload: { entities: [] } }] },
    undo_last_ai_change: { undoToken: 'not-used' },
    generate_parametric: { kind: 'MiniFrame', parameters: { x: 1 } },
  }
  const mutations = state.executor.registry.list().filter(tool => tool.kind === 'mutation')
  for (const tool of mutations) {
    const response = invoke(state.executor, `inspect-${tool.name}`, tool.name, args[tool.name], 'Inspect')
    assert.equal(response.error?.code, 'MODE_DENIED', tool.name)
  }
  assert.equal(state.document.revision, 0)
})

test('Edit mutations are selection-scoped while selection tools remain available', () => {
  const state = harness()
  assert.equal(invoke(state.executor, 'select', 'set_selection', { entities: [{ collection: 'nodes', id: 1 }] }, 'Edit').ok, true)
  assert.equal(invoke(state.executor, 'move-selected', 'move_nodes', { nodes: [{ id: 1, position: [1, 0, 0] }] }, 'Edit').ok, true)
  const denied = invoke(state.executor, 'move-unselected', 'move_nodes', { nodes: [{ id: 2, position: [2, 0, 0] }] }, 'Edit')
  assert.equal(denied.ok, false)
  assert.match(denied.error!.message, /unselected/)
  assert.deepEqual(state.document.nodes.get(2)!.position, [3, 4, 0])
})

test('mock-provider harness creates, selects and changes section without a vendor SDK', () => {
  const state = harness()
  const calls = [
    ['create-nodes', 'create_nodes', { nodes: [{ id: 10, position: [0, 0, 0] }, { id: 11, position: [2, 0, 0] }] }],
    ['create-member', 'create_members', { members: [{ id: 10, nodeI: 10, nodeJ: 11, sectionId: 1 }] }],
    ['select-member', 'set_selection', { entities: [{ collection: 'members', id: 10 }] }],
    ['change-section', 'change_section', { memberIds: [10], sectionId: 2 }],
  ] as const
  for (const [id, name, args] of calls) assert.equal(invoke(state.executor, id, name, args).ok, true)
  assert.equal(state.document.members.get(10)?.sectionId, 2)
  assert.deepEqual(state.workspace.selection, [{ collection: 'members', id: 10 }])
})

test('provider-neutral async harness executes a mock provider plan', async () => {
  const state = harness()
  const provider: AiToolProvider = {
    plan: async ({ tools }) => {
      assert.ok(tools.some(tool => tool.name === 'create_nodes'))
      return [{ id: 'mock-node', name: 'create_nodes', arguments: { nodes: [{ id: 40, position: [1, 2, 3] }] } }]
    },
  }
  const responses = await runToolHarness(provider, state.executor, { prompt: 'create one node', mode: 'Modeling' })
  assert.equal(responses[0].ok, true)
  assert.equal(state.document.nodes.has(40), true)
})

test('destructive action previews, requires a bound token, applies and can be undone', () => {
  const state = harness()
  const args = { entities: [{ collection: 'members', id: 1 }] }
  const preview = invoke(state.executor, 'delete-preview', 'delete_entities', args)
  assert.equal(preview.ok, true)
  assert.equal(preview.preview?.requiresApproval, true)
  assert.equal(state.document.members.has(1), true)
  const applied = invoke(state.executor, 'delete-apply', 'delete_entities', { ...args, approvalToken: preview.preview!.approvalToken })
  assert.equal(applied.ok, true)
  assert.equal(state.document.members.has(1), false)
  assert.ok(applied.undoToken)
  const undone = invoke(state.executor, 'undo-delete', 'undo_last_ai_change', { undoToken: applied.undoToken })
  assert.equal(undone.ok, true)
  assert.equal(state.document.members.has(1), true)
})

test('mutation calls are idempotent and invalid batches roll back atomically', () => {
  const state = harness()
  const args = { nodes: [{ id: 20, position: [0, 0, 0] }] }
  const first = invoke(state.executor, 'once', 'create_nodes', args)
  const replay = invoke(state.executor, 'once', 'create_nodes', args)
  assert.deepEqual(replay, first)
  assert.equal(state.document.nodes.has(20), true)
  assert.equal(invoke(state.executor, 'once', 'create_nodes', { nodes: [{ id: 21, position: [0, 0, 0] }] }).error?.code, 'IDEMPOTENCY_CONFLICT')
  const before = state.document.getSnapshotHash()
  const invalid = invoke(state.executor, 'bad-member', 'create_members', { members: [{ id: 30, nodeI: 1, nodeJ: 999, sectionId: 1 }] })
  assert.equal(invalid.ok, false)
  assert.equal(state.document.getSnapshotHash(), before)
  assert.equal(state.document.members.has(30), false)
})

test('Generate accepts only injected high-level generators and supports regeneration', () => {
  const state = harness(new StructuralDocument())
  const created = invoke(state.executor, 'generate', 'generate_parametric', { kind: 'MiniFrame', parameters: { x: 2 } }, 'Generate')
  assert.equal(created.ok, true)
  const objectId = (created.data as { objectId: number }).objectId
  const nodeId = [...state.document.nodes.keys()][0]
  const regenerated = invoke(state.executor, 'regenerate', 'generate_parametric', { kind: 'MiniFrame', objectId, parameters: { x: 5 } }, 'Generate')
  assert.equal(regenerated.ok, true)
  assert.equal(state.document.nodes.get(nodeId)?.position[0], 5)
  assert.equal(invoke(state.executor, 'generate-low-level', 'create_nodes', { nodes: [{ position: [0, 0, 0] }] }, 'Generate').error?.code, 'MODE_DENIED')
})

test('Agent enforces step/command budget and schema errors request clarification', () => {
  const state = harness(baseDocument(), { maxSteps: 2, maxCommands: 1, maxTimeMs: 60_000 })
  assert.equal(invoke(state.executor, 'agent-query', 'get_model_summary', {}, 'Agent').ok, true)
  assert.equal(invoke(state.executor, 'agent-command', 'set_selection', { entities: [] }, 'Agent').ok, true)
  assert.match(invoke(state.executor, 'over-budget', 'get_model_summary', {}, 'Agent').error!.message, /budget/)
  const missing = invoke(state.executor, 'missing-section', 'change_section', { memberIds: [1] })
  assert.equal(missing.ok, false)
  assert.ok(missing.error?.clarification)
})

test('raw unknown command cannot bypass gateway validation', () => {
  const state = harness()
  const result = invoke(state.executor, 'unknown-operation', 'execute_transaction', { operations: [{ type: 'DirectModelMutation', payload: {} }] })
  assert.equal(result.ok, false)
  assert.match(result.error!.message, /Unsupported command operation/)
})
