import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COMMAND_SCHEMA_VERSION,
  CommandGateway,
  StructuralDocument,
  prepareParametricRegeneration,
  type CommandEnvelope,
  type ParametricEntityGraph,
  type StructuralCommand,
} from './index.ts'

type FrameParameters = Record<string, unknown> & { length: number; bays: number; sectionId: number }

const frameGenerator = (parameters: Readonly<FrameParameters>): ParametricEntityGraph => ({
  nodes: Array.from({ length: parameters.bays + 1 }, (_, index) => ({
    role: `frame-line:${index}:base-node`,
    record: { name: `N${index}`, position: [parameters.length * index / parameters.bays, 0, 0] },
  })),
  members: Array.from({ length: parameters.bays }, (_, index) => ({
    role: `bay:${index}:member`,
    nodeIRole: `frame-line:${index}:base-node`,
    nodeJRole: `frame-line:${index + 1}:base-node`,
    sectionId: parameters.sectionId,
    record: { label: `M${index}` },
  })),
})

const baseDocument = () => new StructuralDocument({
  materials: [{ id: 1, name: 'Steel', E: 210e9, nu: 0.3 }],
  sections: [{ id: 1, name: 'I200', type: 'I', materialId: 1 }],
})

const execute = (gateway: CommandGateway, document: StructuralDocument, id: string, command: StructuralCommand, dryRun = false) =>
  gateway.execute({
    commandId: id,
    type: command.type,
    schemaVersion: COMMAND_SCHEMA_VERSION,
    modelRevision: document.revision,
    payload: command.payload,
    source: 'ui',
    ...(dryRun ? { dryRun: true } : {}),
  } as CommandEnvelope)

const planFrame = (document: StructuralDocument, parameters: FrameParameters, objectId?: number) =>
  prepareParametricRegeneration(document, {
    objectId, kind: 'FrameArray', version: 1, parameters,
    generatorVersion: 'frame-test@1', generator: frameGenerator,
    constraints: [{ type: 'positive', parameter: 'length' }],
    provenance: { source: 'test' },
  })

test('pure generation is deterministic and preview has no side effects', () => {
  const document = baseDocument()
  const gateway = new CommandGateway(document)
  const planA = planFrame(document, { length: 12, bays: 3, sectionId: 1 })
  const planB = planFrame(document, { length: 12, bays: 3, sectionId: 1 })
  assert.deepEqual(planA.object.roleBindings, planB.object.roleBindings)
  assert.equal(planA.total.created, 8)
  const before = document.getSnapshotHash()
  const preview = execute(gateway, document, 'preview-frame', planA.command, true)
  assert.equal(preview.changed, true)
  assert.equal(document.getSnapshotHash(), before)
  assert.equal(document.parametricObjects.size, 0)
})

test('regeneration preserves role IDs and changes only relevant records', () => {
  const document = baseDocument()
  const gateway = new CommandGateway(document)
  const initial = planFrame(document, { length: 10, bays: 3, sectionId: 1 })
  execute(gateway, document, 'create-frame', initial.command)
  const bindings = structuredClone(document.parametricObjects.get(initial.object.id)!.roleBindings!)
  const regenerated = planFrame(document, { length: 15, bays: 3, sectionId: 1 }, initial.object.id)
  assert.equal(regenerated.diff.nodes.created, 0)
  assert.equal(regenerated.diff.nodes.deleted, 0)
  assert.equal(regenerated.diff.members.created, 0)
  assert.equal(regenerated.diff.members.deleted, 0)
  assert.ok(regenerated.diff.nodes.updated > 0)
  execute(gateway, document, 'resize-frame', regenerated.command)
  assert.deepEqual(document.parametricObjects.get(initial.object.id)!.roleBindings, bindings)
})

test('odd bay count grows by semantic diff without clearing existing entities', () => {
  const document = baseDocument()
  const gateway = new CommandGateway(document)
  const initial = planFrame(document, { length: 8, bays: 2, sectionId: 1 })
  execute(gateway, document, 'two-bays', initial.command)
  const retainedNode = document.parametricObjects.get(initial.object.id)!.roleBindings!['frame-line:0:base-node']
  const grown = planFrame(document, { length: 20, bays: 5, sectionId: 1 }, initial.object.id)
  assert.equal(grown.diff.nodes.created, 3)
  assert.equal(grown.diff.members.created, 3)
  assert.equal(grown.diff.nodes.deleted, 0)
  execute(gateway, document, 'five-bays', grown.command)
  assert.equal(document.parametricObjects.get(initial.object.id)!.roleBindings!['frame-line:0:base-node'].id, retainedNode.id)
  assert.equal(document.members.size, 5)
})

test('invalid regeneration rolls back and undo restores parameters plus graph', () => {
  const document = baseDocument()
  const gateway = new CommandGateway(document)
  const initial = planFrame(document, { length: 10, bays: 2, sectionId: 1 })
  execute(gateway, document, 'valid-frame', initial.command)
  const validHash = document.getSnapshotHash()
  const validParameters = structuredClone(document.parametricObjects.get(initial.object.id)!.parameters)
  assert.throws(() => planFrame(document, { length: 10, bays: 2, sectionId: 999 }, initial.object.id), /unsupported section 999/)
  assert.equal(document.getSnapshotHash(), validHash)
  assert.deepEqual(document.parametricObjects.get(initial.object.id)!.parameters, validParameters)
  const resized = planFrame(document, { length: 16, bays: 2, sectionId: 1 }, initial.object.id)
  execute(gateway, document, 'valid-resize', resized.command)
  gateway.undo()
  assert.equal(document.getSnapshotHash(), validHash)
  assert.deepEqual(document.parametricObjects.get(initial.object.id)!.parameters, validParameters)
})

test('detach removes ownership and binding but preserves entity', () => {
  const document = baseDocument()
  const gateway = new CommandGateway(document)
  const initial = planFrame(document, { length: 10, bays: 1, sectionId: 1 })
  execute(gateway, document, 'create-detachable', initial.command)
  const ref = document.parametricObjects.get(initial.object.id)!.roleBindings!['bay:0:member']
  execute(gateway, document, 'detach-member', {
    type: 'DetachFromParametricObject', payload: { objectId: initial.object.id, entities: [ref] },
  })
  assert.equal(document.members.has(ref.id), true)
  assert.equal(document.parametricObjects.get(initial.object.id)!.ownedEntityRefs.some(item => item.collection === ref.collection && item.id === ref.id), false)
  assert.equal(document.parametricObjects.get(initial.object.id)!.roleBindings!['bay:0:member'], undefined)
})

test('nondeterministic and degenerate generators are rejected', () => {
  const document = baseDocument()
  assert.throws(() => prepareParametricRegeneration(document, {
    kind: 'Random', version: 1, parameters: {}, generatorVersion: 'bad@1',
    generator: () => ({ nodes: [{ role: 'node', record: { position: [Math.random(), 0, 0] } }] }),
  }), /not deterministic/)
  assert.throws(() => prepareParametricRegeneration(document, {
    kind: 'Degenerate', version: 1, parameters: {}, generatorVersion: 'bad@1',
    generator: () => ({
      nodes: [{ role: 'node', record: { position: [0, 0, 0] } }],
      members: [{ role: 'member', nodeIRole: 'node', nodeJRole: 'node', sectionId: 1 }],
    }),
  }), /degenerate/)
})

test('document rejects dangling role bindings and ownership shared by two objects', () => {
  const node = { id: 1, position: [0, 0, 0] as const }
  assert.throws(() => new StructuralDocument({
    nodes: [node],
    parametricObjects: [{
      id: 1, kind: 'Grid', version: 1, parameters: {}, generatorVersion: 'grid@1',
      ownedEntityRefs: [], roleBindings: { origin: { collection: 'nodes', id: 1 } },
    }],
  }), /role origin is not owned/)
  const owned = [{ collection: 'nodes' as const, id: 1 }]
  assert.throws(() => new StructuralDocument({
    nodes: [node],
    parametricObjects: [1, 2].map(id => ({
      id, kind: 'Grid', version: 1, parameters: {}, generatorVersion: 'grid@1',
      ownedEntityRefs: owned, roleBindings: { origin: owned[0] },
    })),
  }), /owned by parametric objects/)
})

test('detach of a non-owned entity is rejected atomically', () => {
  const document = baseDocument()
  const gateway = new CommandGateway(document)
  const initial = planFrame(document, { length: 10, bays: 1, sectionId: 1 })
  execute(gateway, document, 'create-owned', initial.command)
  const before = document.getSnapshotHash()
  assert.throws(() => execute(gateway, document, 'bad-detach', {
    type: 'DetachFromParametricObject',
    payload: { objectId: initial.object.id, entities: [{ collection: 'materials', id: 1 }] },
  }), /is not owned/)
  assert.equal(document.getSnapshotHash(), before)
})
