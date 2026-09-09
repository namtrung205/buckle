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
  levels: [{ id: 1, name: 'Roof', elevation: 4 }],
  grids: [{ id: 1, name: 'Grid A', kind: 'orthogonal', data: { entityRefs: [{ collection: 'members', id: 1 }] } }],
  groups: [{ id: 1, name: 'Edge frame', entityRefs: [{ collection: 'members', id: 2 }] }],
  loads: [{ id: 1, name: 'Dead load', type: 'linear', targetIds: [1], value: [0, 0, -1], magnitude: 1 }],
  boundaryConditions: [{ id: 1, name: 'Pinned', type: 'pinned', targetNodeIds: [1], dx: 1, dy: 1, dz: 1, rx: 0, ry: 0, rz: 0 }],
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
    'get_model_summary', 'get_selection', 'resolve_targets', 'remember_targets', 'get_entities', 'query_entities', 'get_connected_entities',
    'get_nearby_nodes', 'get_sections', 'get_materials', 'validate_model', 'create_nodes',
    'create_members', 'move_nodes', 'update_members', 'change_section', 'delete_entities',
    'change_material', 'transform_entities', 'update_entity_properties',
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

test('Goal 17 query DSL resolves type, group, level, grid, connectivity and workspace state', () => {
  const document = baseDocument()
  const queries = new StructuralQueryService(document, () => ({
    selection: [{ collection: 'members', id: 1 }],
    hidden: [{ collection: 'members', id: 2 }],
  }))

  assert.deepEqual(queries.queryEntities('members', { groupIds: [1] }).entities.map(entity => entity.id), [2])
  assert.deepEqual(queries.queryEntities('members', { gridIds: [1] }).entities.map(entity => entity.id), [1])
  assert.deepEqual(queries.queryEntities('members', { levelIds: [1], semanticRoles: ['column'] }).entities.map(entity => entity.id), [2])
  assert.deepEqual(queries.queryEntities('nodes', { connectedTo: [{ collection: 'members', id: 1 }] }).entities.map(entity => entity.id), [1, 2])
  assert.deepEqual(queries.queryEntities('members', { inSelection: true }).entities.map(entity => entity.id), [1])
  assert.deepEqual(queries.queryEntities('members', { hidden: true }).entities.map(entity => entity.id), [2])
  assert.deepEqual(queries.queryEntities('sections', { types: ['I'], names: ['I200'] }).entities.map(entity => entity.id), [1])
  assert.deepEqual(queries.queryEntities('sections', { materialIds: [1] }).entities.map(entity => entity.id), [1])
  assert.deepEqual(queries.queryEntities('members', { position: { x: { min: 1, max: 2 }, y: { min: 1, max: 3 } } }).entities.map(entity => entity.id), [1])
  assert.throws(() => queries.queryEntities('members', { groupIds: [999] }), /Unknown groups id 999/)
  assert.throws(() => queries.queryEntities('members', { sectionIds: [999] }), /Unknown sections id 999/)
  assert.throws(() => queries.queryEntities('members', { materialIds: [999] }), /Unknown materials id 999/)
})

test('Goal 17 P0 filter handles 100k members within the 100 ms P95 gate', context => {
  const memberCount = 100_000
  const document = new StructuralDocument({
    nodes: Array.from({ length: memberCount + 1 }, (_, index) => ({ id: index + 1, position: [index, 0, 0] })),
    materials: [{ id: 200_001, name: 'Steel', E: 210e9, nu: 0.3 }],
    sections: [{ id: 200_002, name: 'I', type: 'I', materialId: 200_001 }],
    members: Array.from({ length: memberCount }, (_, index) => ({ id: 300_000 + index, nodeI: index + 1, nodeJ: index + 2, sectionId: 200_002 })),
  })
  const queries = new StructuralQueryService(document, () => ({ selection: [], hidden: [] }))
  queries.queryEntities('members', { sectionIds: [200_002] }, 100)
  const durations = Array.from({ length: 8 }, () => {
    const started = performance.now()
    const result = queries.queryEntities('members', { sectionIds: [200_002] }, 100)
    assert.equal(result.total, memberCount)
    return performance.now() - started
  }).sort((a, b) => a - b)
  const p95 = durations[Math.ceil(durations.length * .95) - 1]
  context.diagnostic(`100k indexed section filter P95 ${p95.toFixed(1)} ms`)
  assert.ok(p95 <= 100, `100k member query P95 ${p95.toFixed(1)} ms exceeded 100 ms`)

  queries.queryEntities('members', { materialIds: [200_001] }, 100)
  const materialDurations = Array.from({ length: 8 }, () => {
    const started = performance.now()
    const result = queries.queryEntities('members', { materialIds: [200_001] }, 100)
    assert.equal(result.total, memberCount)
    return performance.now() - started
  }).sort((a, b) => a - b)
  const materialP95 = materialDurations[Math.ceil(materialDurations.length * .95) - 1]
  context.diagnostic(`100k indexed material filter P95 ${materialP95.toFixed(1)} ms`)
  assert.ok(materialP95 <= 100, `100k material query P95 ${materialP95.toFixed(1)} ms exceeded 100 ms`)
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
    change_material: { memberIds: [1], materialId: 2, preview: true },
    transform_entities: { entities: [{ collection: 'nodes', id: 1 }], operation: 'move', translation: [1, 0, 0], preview: true },
    update_entity_properties: { collection: 'members', ids: [1], patch: { release: 'i' }, preview: true },
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

test('Goal 17 target resolver uses workspace and latest command provenance instead of chat text', () => {
  const state = harness()
  invoke(state.executor, 'select-target', 'set_selection', { entities: [{ collection: 'members', id: 2 }] }, 'Edit')
  const selection = invoke(state.executor, 'resolve-selection', 'resolve_targets', { source: 'selection', collection: 'members', semanticRoles: ['column'] }, 'Inspect')
  assert.deepEqual((selection.data as { entities: unknown[] }).entities, [{ collection: 'members', id: 2 }])

  invoke(state.executor, 'create-targets', 'create_nodes', { nodes: [{ id: 10, position: [0, 0, 8] }, { id: 11, position: [2, 0, 8] }] })
  const created = invoke(state.executor, 'resolve-created', 'resolve_targets', { source: 'last_created', collection: 'nodes' }, 'Inspect')
  assert.deepEqual((created.data as { entities: unknown[] }).entities, [{ collection: 'nodes', id: 10 }, { collection: 'nodes', id: 11 }])

  invoke(state.executor, 'move-target', 'move_nodes', { nodes: [{ id: 10, position: [1, 0, 8] }] })
  const updated = invoke(state.executor, 'resolve-updated', 'resolve_targets', { source: 'last_updated' }, 'Inspect')
  assert.deepEqual((updated.data as { entities: unknown[] }).entities, [{ collection: 'nodes', id: 10 }])
  assert.match(invoke(state.executor, 'ambiguous-target', 'resolve_targets', { source: 'last_created', expect: 'exactly_one' }, 'Inspect').error!.message, /matched 2 entities/)
  assert.match(invoke(harness().executor, 'missing-target', 'resolve_targets', { source: 'last_created', expect: 'one_or_more' }, 'Inspect').error!.message, /matched no entities/)
  assert.equal(invoke(state.executor, 'remember-columns', 'remember_targets', {
    alias: 'new_columns', entities: [{ collection: 'nodes', id: 10 }, { collection: 'nodes', id: 11 }],
  }, 'Inspect').ok, true)
  const recalled = invoke(state.executor, 'recall-columns', 'resolve_targets', { source: 'alias', alias: 'new_columns' }, 'Inspect')
  assert.equal((recalled.data as { total: number }).total, 2)
})

test('Goal 17 named aliases cannot resurrect after delete and ID reuse', () => {
  const state = harness()
  assert.equal(invoke(state.executor, 'remember-node', 'remember_targets', {
    alias: 'original_node', entities: [{ collection: 'nodes', id: 2 }],
  }, 'Inspect').ok, true)
  const args = { entities: [{ collection: 'nodes', id: 2 }], cascade: true }
  const preview = invoke(state.executor, 'delete-node-preview', 'delete_entities', args)
  assert.equal(preview.ok, true)
  assert.equal(invoke(state.executor, 'delete-node-apply', 'delete_entities', {
    ...args, approvalToken: preview.preview!.approvalToken,
  }).ok, true)
  assert.equal(invoke(state.executor, 'reuse-node-id', 'create_nodes', { nodes: [{ id: 2, position: [9, 9, 9] }] }).ok, true)
  const resolved = invoke(state.executor, 'resolve-purged-alias', 'resolve_targets', {
    source: 'alias', alias: 'original_node', expect: 'one_or_more',
  }, 'Inspect')
  assert.equal(resolved.ok, false)
  assert.match(resolved.error!.message, /matched no entities/)
})

test('Goal 17 relative transforms preview, apply atomically, copy topology and undo', () => {
  const state = harness(new StructuralDocument({
    materials: [{ id: 1, name: 'Steel', category: 'steel', E: 210e9, nu: 0.3 }],
    sections: [{ id: 1, name: 'I200', type: 'I', materialId: 1 }],
    nodes: [{ id: 1, position: [0, 0, 0] }, { id: 2, position: [3, 4, 0] }],
    members: [{ id: 1, nodeI: 1, nodeJ: 2, sectionId: 1 }],
  }))
  const moveArgs = { entities: [{ collection: 'members', id: 1 }], operation: 'move', translation: [2, 0, 0], preview: true }
  const before = state.document.getSnapshotHash()
  const preview = invoke(state.executor, 'move-preview', 'transform_entities', moveArgs)
  assert.equal(preview.ok, true)
  assert.equal(preview.preview?.updated, 2)
  assert.equal(state.document.getSnapshotHash(), before)

  const moved = invoke(state.executor, 'move-apply', 'transform_entities', { ...moveArgs, preview: false })
  assert.equal(moved.ok, true)
  assert.equal(state.document.revision, 1)
  assert.deepEqual(state.document.nodes.get(1)?.position, [2, 0, 0])
  assert.deepEqual(state.document.nodes.get(2)?.position, [5, 4, 0])
  assert.equal(invoke(state.executor, 'move-undo', 'undo_last_ai_change', { undoToken: moved.undoToken }).ok, true)
  assert.deepEqual(state.document.nodes.get(1)?.position, [0, 0, 0])

  const copied = invoke(state.executor, 'copy-member', 'transform_entities', {
    entities: [{ collection: 'members', id: 1 }], operation: 'array', translation: [0, 0, 2], copies: 2, preview: false,
  })
  assert.equal(copied.ok, true)
  assert.equal(state.document.nodes.size, 6)
  assert.equal(state.document.members.size, 3)
  assert.equal(state.document.revision, 3)
})

test('Goal 17 member transforms reject silent movement of connected entities outside the target', () => {
  const state = harness()
  const rejected = invoke(state.executor, 'shared-endpoint', 'transform_entities', {
    entities: [{ collection: 'members', id: 1 }], operation: 'move', translation: [1, 0, 0], preview: false,
  })
  assert.equal(rejected.ok, false)
  assert.match(rejected.error!.message, /connected member\(s\) 2 through shared node 1/)
  assert.deepEqual(state.document.nodes.get(1)?.position, [0, 0, 0])

  const explicit = invoke(state.executor, 'explicit-shared-node', 'transform_entities', {
    entities: [{ collection: 'members', id: 1 }, { collection: 'nodes', id: 1 }], operation: 'move', translation: [1, 0, 0], preview: false,
  })
  assert.equal(explicit.ok, true)
  assert.deepEqual(state.document.nodes.get(1)?.position, [1, 0, 0])
})

test('Goal 17 edits 1000 entities as one revision, audit transaction and undo step', () => {
  const count = 1000
  const state = harness(new StructuralDocument({
    nodes: Array.from({ length: count }, (_, index) => ({ id: index + 1, position: [index, 0, 0] })),
  }))
  const result = invoke(state.executor, 'move-1000', 'transform_entities', {
    entities: Array.from({ length: count }, (_, index) => ({ collection: 'nodes', id: index + 1 })),
    operation: 'move', translation: [0, 2, 0], preview: false,
  })
  assert.equal(result.ok, true)
  assert.equal(state.document.revision, 1)
  assert.equal(state.executor.gateway.auditLog.length, 1)
  assert.equal(state.executor.gateway.auditLog[0].type, 'Transaction')
  assert.deepEqual(state.document.nodes.get(1000)?.position, [999, 2, 0])
  assert.equal(invoke(state.executor, 'undo-1000', 'undo_last_ai_change', { undoToken: result.undoToken }).ok, true)
  assert.deepEqual(state.document.nodes.get(1000)?.position, [999, 0, 0])
})

test('Goal 17 rotate and mirror use deterministic Z-up transforms', () => {
  const rotated = harness()
  assert.equal(invoke(rotated.executor, 'rotate', 'transform_entities', {
    entities: [{ collection: 'nodes', id: 2 }], operation: 'rotate', origin: [0, 0, 0], axis: 'z', angleDegrees: 90, preview: false,
  }).ok, true)
  const position = rotated.document.nodes.get(2)!.position
  assert.ok(Math.abs(position[0] + 4) < 1e-12)
  assert.ok(Math.abs(position[1] - 3) < 1e-12)

  const mirrored = harness()
  assert.equal(invoke(mirrored.executor, 'mirror', 'transform_entities', {
    entities: [{ collection: 'nodes', id: 2 }], operation: 'mirror', origin: [1, 0, 0], axis: 'x', preview: false,
  }).ok, true)
  assert.deepEqual(mirrored.document.nodes.get(2)?.position, [-1, 4, 0])
})

test('Goal 17 material edit preserves topology and parametric ownership in one transaction', () => {
  const state = harness()
  const args = { memberIds: [1, 2], materialId: 2, preview: true }
  const preview = invoke(state.executor, 'material-preview', 'change_material', args)
  assert.equal(preview.ok, true)
  assert.equal(preview.preview?.created, 1)
  assert.equal(preview.preview?.updated, 2)
  assert.equal(state.document.sections.size, 2)
  assert.equal(state.document.revision, 0)

  const applied = invoke(state.executor, 'material-apply', 'change_material', { ...args, preview: false })
  assert.equal(applied.ok, true)
  assert.equal(state.document.revision, 1)
  assert.equal(state.document.sections.size, 3)
  const targetSection = state.document.sections.get(state.document.members.get(1)!.sectionId)!
  assert.equal(targetSection.materialId, 2)
  assert.equal(state.document.members.get(1)?.nodeI, 1)
  assert.equal(state.document.members.get(2)?.nodeJ, 3)
  assert.deepEqual(state.document.parametricObjects.get(1)?.ownedEntityRefs, [{ collection: 'members', id: 2 }])
})

test('Goal 17 legacy edit tools support a non-mutating preview before Apply', () => {
  const state = harness()
  const preview = invoke(state.executor, 'section-preview', 'change_section', { memberIds: [1], sectionId: 2, preview: true })
  assert.equal(preview.ok, true)
  assert.equal(preview.preview?.updated, 1)
  assert.equal(state.document.members.get(1)?.sectionId, 1)
  assert.equal(state.document.revision, 0)
})

test('Goal 17 batch property edits cover release, load, support, group and metadata fields', () => {
  const state = harness()
  const releases = invoke(state.executor, 'release-batch', 'update_entity_properties', {
    collection: 'members', ids: [1, 2], patch: { release: 'ij', metadata: { reviewedBy: 'AI' } }, preview: false,
  })
  assert.equal(releases.ok, true)
  assert.equal(state.document.revision, 1)
  assert.equal(state.document.members.get(1)?.release, 'ij')
  assert.deepEqual(state.document.members.get(2)?.metadata, { reviewedBy: 'AI' })

  assert.equal(invoke(state.executor, 'node-metadata', 'update_entity_properties', {
    collection: 'nodes', ids: [1], patch: { metadata: { inspected: true } }, preview: false,
  }).ok, true)
  assert.deepEqual(state.document.nodes.get(1)?.metadata, { inspected: true })

  assert.equal(invoke(state.executor, 'load-edit', 'update_entity_properties', {
    collection: 'loads', ids: [1], patch: { magnitude: 2.5 }, preview: false,
  }).ok, true)
  assert.equal(state.document.loads.get(1)?.magnitude, 2.5)

  assert.equal(invoke(state.executor, 'support-edit', 'update_entity_properties', {
    collection: 'boundaryConditions', ids: [1], patch: { rx: 1 }, preview: false,
  }).ok, true)
  assert.equal(state.document.boundaryConditions.get(1)?.rx, 1)

  assert.equal(invoke(state.executor, 'group-edit', 'update_entity_properties', {
    collection: 'groups', ids: [1], patch: { name: 'Perimeter frame' }, preview: false,
  }).ok, true)
  assert.equal(state.document.groups.get(1)?.name, 'Perimeter frame')
  assert.match(invoke(state.executor, 'rewire-denied', 'update_entity_properties', {
    collection: 'members', ids: [1], patch: { nodeI: 3 }, preview: false,
  }).error!.message, /cannot be changed/)
})

test('Goal 17 no-op previews report zero exact changes and do not create a misleading undo', () => {
  const state = harness()
  const moved = invoke(state.executor, 'meaningful-move', 'move_nodes', { nodes: [{ id: 2, position: [4, 4, 0] }] })
  assert.equal(moved.ok, true)
  assert.ok(moved.undoToken)
  const preview = invoke(state.executor, 'noop-preview', 'update_entity_properties', {
    collection: 'members', ids: [1], patch: { sectionId: 1 }, preview: true,
  })
  assert.equal(preview.ok, true)
  assert.deepEqual(preview.preview, { created: 0, updated: 0, deleted: 0, affected: 0, risk: 'low', requiresApproval: false })
  const applied = invoke(state.executor, 'noop-apply', 'update_entity_properties', {
    collection: 'members', ids: [1], patch: { sectionId: 1 }, preview: false,
  })
  assert.equal(applied.ok, true)
  assert.equal(applied.undoToken, undefined)
  assert.equal(state.document.revision, 1)
  assert.equal(invoke(state.executor, 'undo-meaningful', 'undo_last_ai_change', { undoToken: moved.undoToken }).ok, true)
  assert.deepEqual(state.document.nodes.get(2)?.position, [3, 4, 0])
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
