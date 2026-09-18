import assert from 'node:assert/strict'
import test from 'node:test'
import {
  analysisTransportToDocumentSeed,
  StructuralDocument,
  type StructuralChangeSet,
  type StructuralDocumentSeed,
} from './index.ts'

const seed = (): StructuralDocumentSeed => ({
  nodes: [
    { id: 20, name: 'J', position: [5, 0, 0] },
    { id: 10, name: 'I', position: [0, 0, 0] },
  ],
  materials: [{ id: 1, name: 'Steel', E: 210e9, nu: 0.3, rho: 7850 }],
  sections: [{ id: 2, name: 'IPE300', type: 'I', materialId: 1, depth: 300, width: 150, tw: 7.1, tf: 10.7 }],
  members: [{ id: 30, label: 'B1', nodeI: 10, nodeJ: 20, sectionId: 2, referenceAxis: [0, 0, 1] }],
  loads: [{ id: 40, type: 'linear', targetIds: [30], value: [0, 0, -5] }],
  boundaryConditions: [{
    id: 50, type: 'fixed', targetNodeIds: [10],
    dx: 1, dy: 1, dz: 1, rx: 1, ry: 1, rz: 1,
  }],
})

test('canonical snapshot and hash are deterministic regardless of input order', () => {
  const first = new StructuralDocument(seed())
  const reversed = seed()
  reversed.nodes = [...(reversed.nodes ?? [])].reverse()
  reversed.loads = reversed.loads?.map(load => ({ ...load, targetIds: [...load.targetIds].reverse() }))
  const second = new StructuralDocument(reversed)

  assert.deepEqual(first.getSnapshot().nodes.map(node => node.id), [10, 20])
  assert.equal(first.getSnapshotHash(), second.getSnapshotHash())
  assert.equal(first.createAnalysisSnapshot().hash, second.createAnalysisSnapshot().hash)
})

test('revision changes once per reconcile and emits an exact entity change set', () => {
  const document = new StructuralDocument(seed())
  const changes: number[] = []
  document.subscribe(change => {
    changes.push(change.revision)
    assert.deepEqual(change.changes.nodes.updated, [20])
    assert.deepEqual(change.changes.members.updated, [])
  })
  const next = seed()
  next.nodes = next.nodes?.map(node => node.id === 20 ? { ...node, position: [6, 1, 0] } : node)

  document.reconcile(next)

  assert.equal(document.revision, 1)
  assert.equal(document.dirty, true)
  assert.deepEqual(changes, [1])
  assert.equal(document.reconcile(next), null)
  assert.equal(document.revision, 1)
})

test('invalid updates are atomic and dangling references are rejected', () => {
  const document = new StructuralDocument(seed())
  const before = document.getSnapshotHash()

  assert.throws(() => document.updateMember(30, { nodeJ: 999 }), /Unknown node id 999/)
  assert.equal(document.getSnapshotHash(), before)
  assert.equal(document.revision, 0)
  assert.throws(() => document.deleteNode(10), /still referenced/)
})

test('cascade delete removes dependent topology and produces one revision', () => {
  const document = new StructuralDocument(seed())
  let lastChange: StructuralChangeSet | undefined
  document.subscribe(change => { lastChange = change })

  document.deleteNode(10, { cascade: true })

  assert.equal(document.revision, 1)
  assert.equal(document.nodes.has(10), false)
  assert.equal(document.members.size, 0)
  assert.equal(document.loads.size, 0)
  assert.equal(document.boundaryConditions.size, 0)
  assert.deepEqual(lastChange?.changes.members.deleted, [30])
})

test('analysis snapshot is immutable, normalized and carries source revision', () => {
  const document = new StructuralDocument(seed())
  document.updateNode(20, { position: [7, 0, 0] })
  const snapshot = document.createAnalysisSnapshot()

  assert.equal(snapshot.revision, 1)
  assert.equal(snapshot.model.metadata.modelRevision, 1)
  assert.equal(snapshot.model.members[0].nodej.x, 7)
  assert.equal(snapshot.model.members[0].section, 2)
  assert.equal(Object.isFrozen(snapshot), true)
  assert.equal(Object.isFrozen(snapshot.model.nodes), true)
})

test('analysis transport round-trip preserves topology, axes, units and semantic hash', () => {
  const first = new StructuralDocument(seed())
  const exported = first.createAnalysisSnapshot()
  const second = new StructuralDocument(analysisTransportToDocumentSeed(exported.model))
  const roundTrip = second.createAnalysisSnapshot()

  assert.equal(roundTrip.hash, exported.hash)
  assert.deepEqual(roundTrip.model.members[0].vecxz, [0, 0, 1])
  assert.equal(roundTrip.model.sections[0].depth, 300)
  assert.equal(roundTrip.model.loads[0].value.z, -5)
  assert.deepEqual(roundTrip.model.boundary_conditions[0].targets, [10])
})

test('versioned document snapshot restores revision and clean state', () => {
  const original = new StructuralDocument(seed())
  original.updateNode(20, { position: [8, 0, 0] })
  const restored = StructuralDocument.fromSnapshot(original.getSnapshot())

  assert.equal(restored.revision, 1)
  assert.equal(restored.dirty, false)
  assert.equal(restored.getSnapshotHash(), original.getSnapshotHash())
  const unsupported = { ...original.getSnapshot(), documentVersion: 99 }
  assert.throws(
    () => StructuralDocument.fromSnapshot(unsupported as never),
    /Unsupported documentVersion/,
  )
})

test('typed organizational references survive persistence and follow cascade deletes', () => {
  const document = new StructuralDocument({
    ...seed(),
    nodes: [
      ...(seed().nodes ?? []),
      { id: 30, position: [5, 5, 0] },
      { id: 40, position: [0, 5, 0] },
    ],
    shells: [{ id: 60, nodeIds: [10, 20, 30, 40], thickness: 0.2, materialId: 1 }],
    grids: [{ id: 70, name: 'Grid A', kind: 'cartesian', data: { spacing: 5 } }],
    levels: [{ id: 80, name: 'Roof', elevation: 6 }],
    groups: [{
      id: 90,
      name: 'Bay 1',
      entityRefs: [
        { collection: 'members', id: 30 },
        { collection: 'nodes', id: 30 },
        { collection: 'shells', id: 60 },
      ],
    }],
    parametricObjects: [{
      id: 100,
      kind: 'portal-frame',
      version: 1,
      parameters: { bays: 1 },
      ownedEntityRefs: [
        { collection: 'nodes', id: 10 },
        { collection: 'members', id: 30 },
        { collection: 'shells', id: 60 },
      ],
      generatorVersion: '1.0.0',
    }],
  })

  const restored = StructuralDocument.fromSnapshot(document.getSnapshot())
  assert.equal(restored.getSnapshotHash(), document.getSnapshotHash())
  assert.deepEqual(restored.groups.get(90)?.entityRefs, [
    { collection: 'members', id: 30 },
    { collection: 'nodes', id: 30 },
    { collection: 'shells', id: 60 },
  ])

  restored.deleteNode(10, { cascade: true })
  assert.deepEqual(restored.groups.get(90)?.entityRefs, [{ collection: 'nodes', id: 30 }])
  assert.deepEqual(restored.parametricObjects.get(100)?.ownedEntityRefs, [])

  restored.updateGrid(70, { name: 'Grid A1' })
  restored.updateLevel(80, { elevation: 6.5 })
  restored.updateGroup(90, { name: 'Remaining nodes' })
  restored.updateParametricObject(100, { parameters: { bays: 2 } })
  assert.equal(restored.grids.get(70)?.name, 'Grid A1')
  assert.equal(restored.levels.get(80)?.elevation, 6.5)
  assert.equal(restored.groups.get(90)?.name, 'Remaining nodes')
  assert.deepEqual(restored.parametricObjects.get(100)?.parameters, { bays: 2 })
})

test('typed organizational references reject unknown targets atomically', () => {
  const document = new StructuralDocument(seed())
  const before = document.getSnapshotHash()

  assert.throws(() => document.addGroup({
    id: 90,
    name: 'Broken group',
    entityRefs: [{ collection: 'nodes', id: 999 }],
  }), /Unknown nodes reference id 999/)
  assert.equal(document.getSnapshotHash(), before)
  assert.equal(document.revision, 0)
})

test('100k members live in the pure core without Object3D/browser globals', () => {
  const memberCount = 100_000
  const large = new StructuralDocument({
    nodes: Array.from({ length: memberCount + 1 }, (_, index) => ({ id: index + 1, position: [index, 0, 0] })),
    materials: [{ id: 200_001, name: 'Steel', E: 210e9, nu: 0.3 }],
    sections: [{ id: 200_002, name: 'I', type: 'I', materialId: 200_001, depth: 300, width: 150, tw: 8, tf: 12 }],
    members: Array.from({ length: memberCount }, (_, index) => ({
      id: 300_000 + index,
      nodeI: index + 1,
      nodeJ: index + 2,
      sectionId: 200_002,
    })),
  })

  assert.equal(large.members.size, memberCount)
  assert.equal(large.memberIdsBySectionId.get(200_002)?.size, memberCount)
  assert.equal('Object3D' in (globalThis as Record<string, unknown>), false)
})
