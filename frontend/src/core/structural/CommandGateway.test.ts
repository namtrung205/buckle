import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COMMAND_SCHEMA_VERSION,
  CommandConflictError,
  CommandGateway,
  CommandPolicyError,
  CommandValidationError,
  StructuralDocument,
  type CommandEnvelope,
  type CommandGatewayContext,
  type CommandWorkspaceState,
  type StructuralCommand,
} from './index.ts'

const envelope = (document: StructuralDocument, commandId: string, command: StructuralCommand): CommandEnvelope => ({
  commandId,
  type: command.type,
  schemaVersion: COMMAND_SCHEMA_VERSION,
  modelRevision: document.revision,
  payload: command.payload,
  source: 'ui',
}) as CommandEnvelope

const pluginEnvelope = (document: StructuralDocument, commandId: string, command: StructuralCommand): CommandEnvelope => ({
  commandId,
  type: command.type,
  schemaVersion: COMMAND_SCHEMA_VERSION,
  modelRevision: document.revision,
  payload: command.payload,
  source: 'plugin',
  actor: { kind: 'plugin', pluginId: 'com.example.fixture', pluginVersion: '1.0.0' },
}) as CommandEnvelope

const baseDocument = () => new StructuralDocument({
  materials: [{ id: 1, name: 'Steel', E: 210e9, nu: 0.3 }],
  sections: [{ id: 1, name: 'I200', type: 'I', materialId: 1, depth: 200, width: 100 }],
})

const workspaceContext = () => {
  let state: CommandWorkspaceState = { selection: [], hidden: [] }
  const context: CommandGatewayContext = {
    getWorkspaceState: () => structuredClone(state),
    applyWorkspaceState: next => { state = structuredClone(next) },
  }
  return { context, get state() { return state } }
}

test('transaction resolves local node aliases and commits one revision', () => {
  const document = baseDocument()
  const gateway = new CommandGateway(document)
  let eventCount = 0
  document.subscribe(() => { eventCount++ })
  const result = gateway.execute(envelope(document, 'create-frame', {
    type: 'Transaction', payload: { operations: [
      { type: 'CreateNodes', payload: { nodes: [
        { alias: 'a', name: 'A', position: [0, 0, 0] },
        { alias: 'b', name: 'B', position: [5, 0, 0] },
      ] } },
      { type: 'CreateMembers', payload: { members: [{
        alias: 'beam', nodeI: { alias: 'a' }, nodeJ: { alias: 'b' }, sectionId: 1,
      }] } },
    ] },
  }))

  assert.equal(document.revision, 1)
  assert.equal(eventCount, 1)
  assert.equal(document.members.get(result.aliases.beam)?.nodeI, result.aliases.a)
  assert.equal(document.members.get(result.aliases.beam)?.nodeJ, result.aliases.b)
})

test('invalid transaction rolls back without event, history or audit entry', () => {
  const document = baseDocument()
  const gateway = new CommandGateway(document)
  const before = document.getSnapshotHash()
  let eventCount = 0
  document.subscribe(() => { eventCount++ })

  assert.throws(() => gateway.execute(envelope(document, 'invalid', {
    type: 'Transaction', payload: { operations: [
      { type: 'CreateNodes', payload: { nodes: [{ alias: 'a', position: [0, 0, 0] }] } },
      { type: 'CreateMembers', payload: { members: [{ nodeI: { alias: 'a' }, nodeJ: 999, sectionId: 1 }] } },
    ] },
  })), /Unknown node id 999/)

  assert.equal(document.getSnapshotHash(), before)
  assert.equal(document.revision, 0)
  assert.equal(eventCount, 0)
  assert.equal(gateway.auditLog.length, 0)
  assert.equal(gateway.canUndo, false)
})

test('command retry is idempotent and changed content cannot reuse an id', () => {
  const document = baseDocument()
  const gateway = new CommandGateway(document)
  const command = envelope(document, 'node-once', {
    type: 'CreateNodes', payload: { nodes: [{ id: 10, position: [0, 0, 0] }] },
  })
  const first = gateway.execute(command)
  const replay = gateway.execute(command)

  assert.equal(first.idempotentReplay, false)
  assert.equal(replay.idempotentReplay, true)
  assert.equal(document.nodes.size, 1)
  assert.equal(document.revision, 1)
  assert.throws(() => gateway.execute({
    ...command, payload: { nodes: [{ id: 11, position: [0, 0, 0] }] },
  } as CommandEnvelope), CommandValidationError)
})

test('stale revisions fail with deterministic change summary', () => {
  const document = baseDocument()
  const gateway = new CommandGateway(document)
  gateway.execute(envelope(document, 'first', {
    type: 'CreateNodes', payload: { nodes: [{ id: 1, position: [0, 0, 0] }] },
  }))

  let conflict: CommandConflictError | undefined
  try {
    gateway.execute({
      ...envelope(document, 'stale', { type: 'CreateNodes', payload: { nodes: [{ id: 2, position: [1, 0, 0] }] } }),
      modelRevision: 0,
    })
  } catch (error) { conflict = error as CommandConflictError }
  assert.equal(conflict?.actualRevision, 1)
  assert.equal(conflict?.changeSummary.length, 1)
  assert.equal(document.nodes.has(2), false)
})

test('apply undo redo preserves semantic hash and stable IDs', () => {
  const document = baseDocument()
  const gateway = new CommandGateway(document)
  const before = document.getSnapshotHash()
  gateway.execute(envelope(document, 'create-two', {
    type: 'CreateNodes', payload: { nodes: [
      { id: 20, position: [0, 0, 0] }, { id: 40, position: [2, 0, 0] },
    ] },
  }))
  const after = document.getSnapshotHash()

  gateway.undo()
  assert.equal(document.getSnapshotHash(), before)
  gateway.redo()
  assert.equal(document.getSnapshotHash(), after)
  assert.deepEqual([...document.nodes.keys()].sort((a, b) => a - b), [20, 40])
  assert.equal(document.revision, 3)
})

test('selection and visibility share transaction history without changing model hash', () => {
  const document = new StructuralDocument({ nodes: [{ id: 1, position: [0, 0, 0] }] })
  const gateway = new CommandGateway(document)
  const workspace = workspaceContext()
  const before = document.getSnapshotHash()
  gateway.execute(envelope(document, 'workspace', {
    type: 'Transaction', payload: { operations: [
      { type: 'SetSelection', payload: { entities: [{ collection: 'nodes', id: 1 }] } },
      { type: 'HideEntities', payload: { entities: [{ collection: 'nodes', id: 1 }] } },
    ] },
  }), workspace.context)

  assert.equal(document.getSnapshotHash(), before)
  assert.equal(workspace.state.selection[0].id, 1)
  assert.equal(workspace.state.hidden[0].id, 1)
  gateway.undo(workspace.context)
  assert.equal(workspace.state.selection.length, 0)
  assert.equal(workspace.state.hidden.length, 0)
  gateway.redo(workspace.context)
  assert.equal(workspace.state.hidden[0].id, 1)
})

test('workspace-only history stays correctly ordered with document edits', () => {
  const document = new StructuralDocument()
  const gateway = new CommandGateway(document)
  const workspace = workspaceContext()
  gateway.execute(envelope(document, 'create-node', {
    type: 'CreateNodes', payload: { nodes: [{ id: 1, position: [0, 0, 0] }] },
  }), workspace.context)
  gateway.execute(envelope(document, 'select-node', {
    type: 'SetSelection', payload: { entities: [{ collection: 'nodes', id: 1 }] },
  }), workspace.context)

  gateway.undo(workspace.context)
  assert.equal(document.nodes.has(1), true)
  assert.deepEqual(workspace.state.selection, [])
  gateway.undo(workspace.context)
  assert.equal(document.nodes.has(1), false)
  gateway.redo(workspace.context)
  assert.equal(document.nodes.has(1), true)
  gateway.redo(workspace.context)
  assert.equal((workspace.state as CommandWorkspaceState).selection[0].id, 1)
})

test('10k workspace selection avoids the full-document command path', () => {
  const nodes = Array.from({ length: 10_000 }, (_, index) => ({
    id: index + 1,
    position: [index, 0, 0] as const,
  }))
  const document = new StructuralDocument({ nodes })
  const gateway = new CommandGateway(document)
  const workspace = workspaceContext()
  const beforeHash = document.getSnapshotHash()
  const startedAt = performance.now()
  gateway.execute(envelope(document, 'select-10k', {
    type: 'SetSelection',
    payload: { entities: nodes.map(node => ({ collection: 'nodes', id: node.id })) },
  }), workspace.context)
  const elapsed = performance.now() - startedAt

  assert.equal(workspace.state.selection.length, 10_000)
  assert.equal(document.revision, 0)
  assert.equal(document.getSnapshotHash(), beforeHash)
  assert.ok(elapsed <= 500, `10k workspace selection took ${elapsed.toFixed(1)}ms`)
  gateway.undo(workspace.context)
  assert.deepEqual(workspace.state.selection, [])
})

test('dry run validates and resolves aliases but emits no side effects', () => {
  const document = baseDocument()
  const gateway = new CommandGateway(document)
  let committed = 0
  const command = {
    ...envelope(document, 'preview', {
      type: 'CreateNodes', payload: { nodes: [{ alias: 'preview-node', position: [1, 2, 3] }] },
    }), dryRun: true,
  }
  const result = gateway.execute(command, { onCommitted: () => { committed++ } })

  assert.equal(result.dryRun, true)
  assert.equal(result.changed, true)
  assert.deepEqual(result.changes?.changes.nodes.created, [1])
  assert.equal(result.aliases['preview-node'], 1)
  assert.equal(document.nodes.size, 0)
  assert.equal(gateway.auditLog.length, 0)
  assert.equal(committed, 0)
})

test('clear requires confirmation and policy approval, then is undoable', () => {
  const document = new StructuralDocument({ nodes: [{ id: 1, position: [0, 0, 0] }] })
  const gateway = new CommandGateway(document)
  const denied = envelope(document, 'clear-denied', { type: 'ClearModel', payload: { confirmed: true } })
  assert.throws(() => gateway.execute(denied), /policy approval/)
  assert.equal(document.nodes.size, 1)

  gateway.execute(envelope(document, 'clear', { type: 'ClearModel', payload: { confirmed: true } }), {
    allowDestructive: operation => operation === 'ClearModel',
  })
  assert.equal(document.nodes.size, 0)
  gateway.undo()
  assert.equal(document.nodes.has(1), true)
})

test('10k entity batch commits as one undo step within the command budget', () => {
  const document = new StructuralDocument()
  const gateway = new CommandGateway(document)
  const nodes = Array.from({ length: 10_000 }, (_, index) => ({
    id: index + 1,
    position: [index, 0, 0] as const,
  }))
  const startedAt = performance.now()
  gateway.execute(envelope(document, '10k-nodes', { type: 'CreateNodes', payload: { nodes } }))
  const elapsed = performance.now() - startedAt

  assert.equal(document.nodes.size, 10_000)
  assert.equal(document.revision, 1)
  assert.equal(gateway.canUndo, true)
  assert.ok(elapsed <= 1_000, `10k batch took ${elapsed.toFixed(1)}ms`)
  gateway.undo()
  assert.equal(document.nodes.size, 0)
  assert.equal(gateway.canUndo, false)
})

test('material, section, load, support and shell commands commit atomically', () => {
  const document = new StructuralDocument()
  const gateway = new CommandGateway(document)
  gateway.execute(envelope(document, 'complete-model', {
    type: 'Transaction', payload: { operations: [
      { type: 'CreateOrUpdateMaterials', payload: { materials: [{ alias: 'steel', name: 'S355', E: 210e9, nu: 0.3 }] } },
      { type: 'CreateOrUpdateSections', payload: { sections: [{
        alias: 'section', name: 'R200', type: 'Rectangular', materialId: { alias: 'steel' }, height: 200, width: 100,
      }] } },
      { type: 'CreateNodes', payload: { nodes: [
        { id: 1, position: [0, 0, 0] }, { id: 2, position: [1, 0, 0] },
        { id: 3, position: [1, 1, 0] }, { id: 4, position: [0, 1, 0] },
      ] } },
      { type: 'CreateMembers', payload: { members: [{ id: 1, nodeI: 1, nodeJ: 2, sectionId: { alias: 'section' } }] } },
      { type: 'CreateOrUpdateShells', payload: { shells: [{ id: 1, nodeIds: [1, 2, 3, 4], thickness: 0.1, materialId: 1 }] } },
      { type: 'CreateOrUpdateLoads', payload: { loads: [{ id: 1, type: 'linear', targetIds: [1], value: [0, 0, -5] }] } },
      { type: 'CreateOrUpdateBoundaryConditions', payload: { boundaryConditions: [{
        id: 1, type: 'fixed', targetNodeIds: [1], dx: 1, dy: 1, dz: 1, rx: 1, ry: 1, rz: 1,
      }] } },
    ] },
  }))

  assert.equal(document.revision, 1)
  assert.equal(document.materials.size, 1)
  assert.equal(document.sections.size, 1)
  assert.equal(document.shells.size, 1)
  assert.equal(document.loads.size, 1)
  assert.equal(document.boundaryConditions.size, 1)
  gateway.execute(envelope(document, 'delete-aux', {
    type: 'Transaction', payload: { operations: [
      { type: 'DeleteLoads', payload: { ids: [1] } },
      { type: 'DeleteBoundaryConditions', payload: { ids: [1] } },
      { type: 'DeleteShells', payload: { ids: [1] } },
    ] },
  }))
  assert.equal(document.loads.size + document.boundaryConditions.size + document.shells.size, 0)
})

test('invalid workspace references do not create history or audit', () => {
  const document = new StructuralDocument()
  const gateway = new CommandGateway(document)
  assert.throws(() => gateway.execute(envelope(document, 'bad-selection', {
    type: 'SetSelection', payload: { entities: [{ collection: 'nodes', id: 999 }] },
  })), /Unknown workspace nodes id 999/)
  assert.equal(gateway.auditLog.length, 0)
  assert.equal(gateway.canUndo, false)
})

test('runtime boundary rejects malformed payloads without side effects', () => {
  const document = new StructuralDocument()
  const gateway = new CommandGateway(document)
  const malformed = {
    ...envelope(document, 'malformed', { type: 'CreateNodes', payload: { nodes: [] } }),
    payload: { nodes: {}, injected: true },
  } as unknown as CommandEnvelope

  assert.throws(() => gateway.execute(malformed), /injected is not allowed|nodes must be an array/)
  assert.equal(document.revision, 0)
  assert.equal(document.nodes.size, 0)
  assert.equal(gateway.auditLog.length, 0)
  assert.equal(gateway.canUndo, false)
})

test('plugin commands require valid immutable actor provenance', () => {
  const document = new StructuralDocument()
  const gateway = new CommandGateway(document)
  const command = pluginEnvelope(document, 'plugin-node', {
    type: 'CreateNodes', payload: { nodes: [{ id: 1, position: [0, 0, 0] }] },
  })

  assert.throws(() => gateway.execute({ ...command, actor: undefined } as CommandEnvelope), /actor is required/)
  assert.throws(() => gateway.execute({ ...command, source: 'ui' } as CommandEnvelope), /requires source=plugin/)
  assert.throws(() => gateway.execute({
    ...command, actor: { kind: 'plugin', pluginId: 'COM Example', pluginVersion: 'latest' },
  } as CommandEnvelope), /pluginId is invalid|semantic version/)
  assert.equal(document.revision, 0)
  assert.equal(gateway.auditLog.length, 0)
})

test('plugin permissions are operation-scoped and audit the exact actor', () => {
  const document = new StructuralDocument({ nodes: [{ id: 1, position: [0, 0, 0] }] })
  const gateway = new CommandGateway(document)
  const load = pluginEnvelope(document, 'plugin-load', {
    type: 'CreateOrUpdateLoads',
    payload: { loads: [{ id: 1, type: 'nodal', targetIds: [1], value: [0, 0, -5] }] },
  })

  assert.throws(() => gateway.execute(load, {
    policy: { pluginPermissions: ['model.write.nodes'] },
  }), (error: unknown) => error instanceof CommandPolicyError && error.code === 'PLUGIN_PERMISSION_DENIED')
  assert.equal(document.loads.size, 0)
  assert.equal(gateway.auditLog.length, 0)

  gateway.execute(load, { policy: { pluginPermissions: ['model.write.loads'] } })
  assert.equal(document.loads.size, 1)
  assert.deepEqual(gateway.auditLog[0].actor, {
    kind: 'plugin', pluginId: 'com.example.fixture', pluginVersion: '1.0.0',
  })
})

test('locked policy allows workspace selection but rejects engineering mutation', () => {
  const document = new StructuralDocument({ nodes: [{ id: 1, position: [0, 0, 0] }] })
  const gateway = new CommandGateway(document)
  const workspace = workspaceContext()

  gateway.execute(envelope(document, 'locked-select', {
    type: 'SetSelection', payload: { entities: [{ collection: 'nodes', id: 1 }] },
  }), { ...workspace.context, policy: { modelLocked: true } })
  assert.equal(workspace.state.selection.length, 1)

  assert.throws(() => gateway.execute(envelope(document, 'locked-create', {
    type: 'CreateNodes', payload: { nodes: [{ id: 2, position: [1, 0, 0] }] },
  }), { policy: { modelLocked: true } }), (error: unknown) =>
    error instanceof CommandPolicyError && error.code === 'MODEL_LOCKED')
  assert.equal(document.nodes.has(2), false)
  assert.equal(gateway.auditLog.length, 1)
})

test('plugin destructive changes require permission and explicit host approval', () => {
  const document = new StructuralDocument({ nodes: [{ id: 1, position: [0, 0, 0] }] })
  const gateway = new CommandGateway(document)
  const deletion = pluginEnvelope(document, 'plugin-delete', {
    type: 'DeleteNodes', payload: { ids: [1], cascade: true },
  })

  assert.throws(() => gateway.execute(deletion, {
    policy: { pluginPermissions: ['model.delete.nodes'] },
  }), (error: unknown) => error instanceof CommandPolicyError && error.code === 'PLUGIN_APPROVAL_REQUIRED')
  assert.equal(document.nodes.has(1), true)

  gateway.execute(deletion, {
    policy: { pluginPermissions: ['model.delete.nodes'], allowPluginDestructive: true },
  })
  assert.equal(document.nodes.has(1), false)
})

test('command policy rejects entity and operation quota overflow before commit', () => {
  const document = new StructuralDocument()
  const gateway = new CommandGateway(document)
  const command = envelope(document, 'quota', {
    type: 'CreateNodes', payload: { nodes: [
      { id: 1, position: [0, 0, 0] },
      { id: 2, position: [1, 0, 0] },
    ] },
  })

  assert.throws(() => gateway.execute(command, {
    policy: { maxEntitiesPerOperation: 1 },
  }), (error: unknown) => error instanceof CommandPolicyError && error.code === 'ENTITY_LIMIT')
  assert.equal(document.nodes.size, 0)
  assert.equal(gateway.auditLog.length, 0)
})

const oversizedImportCommand = (): StructuralCommand => ({
  type: 'ImportModel',
  payload: {
    document: {
      nodes: Array.from({ length: 120_000 }, (_, index) => ({
        id: index + 1,
        name: `N${index}`,
        position: [index % 7, (index % 13) * 3, (index % 11) * 2],
      })),
    },
    replace: true,
    confirmed: true,
  },
}) as StructuralCommand

test('oversized ImportModel payload is rejected by the default policy', () => {
  const document = baseDocument()
  const gateway = new CommandGateway(document)
  assert.throws(
    () => gateway.execute(envelope(document, 'oversized', oversizedImportCommand())),
    (error: unknown) => error instanceof CommandPolicyError && error.code === 'PAYLOAD_LIMIT',
  )
  assert.equal(document.revision, 0)
})

test('trusted import may raise the payload budget via the policy context', () => {
  const document = baseDocument()
  const gateway = new CommandGateway(document)
  const { context } = workspaceContext()
  context.policy = { maxPayloadBytes: 64 * 1024 * 1024 }
  context.allowDestructive = () => true
  const result = gateway.execute(envelope(document, 'oversized-allowed', oversizedImportCommand()), context)
  assert.equal(result.changed, true)
  assert.equal(document.revision, 1)
  assert.equal(document.nodes.size, 120_000)
})

test('plugin envelopes stay capped even when other sources raise their budget', () => {
  const document = baseDocument()
  const gateway = new CommandGateway(document)
  const { context } = workspaceContext()
  context.policy = { maxPayloadBytes: 64 * 1024 * 1024 }
  context.allowDestructive = () => true
  assert.throws(
    () => gateway.execute(pluginEnvelope(document, 'oversized-plugin', oversizedImportCommand()), context),
    (error: unknown) => error instanceof CommandPolicyError && error.code === 'PLUGIN_OPERATION_DENIED',
  )
})
