import assert from 'node:assert/strict'
import test from 'node:test'
import { generateStructuralBenchmarkFixture } from '../Benchmark/structuralFixture.ts'
import {
  ENTITY_SELECTED,
  ENTITY_VISIBLE,
  MEMBER_MIRROR_Y,
  MEMBER_MIRROR_Z,
  StructuralSceneDB,
  type StructuralSceneSource,
} from './StructuralSceneDB.ts'
import { fixtureToStructuralSource, legacyModelToStructuralSource } from './structuralSceneAdapters.ts'

const simpleSource = (): StructuralSceneSource => ({
  nodes: [
    { id: 10, position: [0, 0, 0] },
    { id: 20, position: [2, 0, 0] },
    { id: 30, position: [2, 3, 0] },
  ],
  profiles: [{ id: 100, family: 'h', parameters: [0.3, 0.15, 0.007, 0.011] }],
  members: [
    { id: 1000, startNodeId: 10, endNodeId: 20, profileId: 100 },
    { id: 2000, startNodeId: 20, endNodeId: 30, profileId: 100, gammaRadians: Math.PI / 2 },
  ],
})

test('stable member IDs round-trip through dense indices', () => {
  const db = new StructuralSceneDB(simpleSource())
  assert.equal(db.memberIndexById.get(1000), 0)
  assert.equal(db.memberIndexById.get(2000), 1)
  assert.equal(db.entityIdForMemberIndex(0), 1000)
  assert.equal(db.entityIdForMemberIndex(1), 2000)
  assert.equal(db.entityIdForMemberIndex(2), undefined)
})

test('node delta only rewrites connected member endpoints and flags are bit-packed', () => {
  const db = new StructuralSceneDB(simpleSource())
  db.clearDirtyRanges()
  db.updateNode(20, [5, 6, 7])
  assert.deepEqual(db.dirtyNodes, { min: 1, maxExclusive: 2 })
  assert.deepEqual(db.dirtyMembers, { min: 0, maxExclusive: 2 })
  assert.deepEqual(Array.from(db.memberEndpoints.slice(3, 6)), [5, 6, 7])
  assert.deepEqual(Array.from(db.memberEndpoints.slice(6, 9)), [5, 6, 7])
  db.setMemberFlag(1000, ENTITY_SELECTED, true)
  assert.equal(db.memberFlags[0] & ENTITY_VISIBLE, ENTITY_VISIBLE)
  assert.equal(db.memberFlags[0] & ENTITY_SELECTED, ENTITY_SELECTED)
})

test('member delete compacts dense arrays and preserves ID mapping', () => {
  const db = new StructuralSceneDB(simpleSource())
  db.removeMember(1000)
  assert.equal(db.memberCount, 1)
  assert.equal(db.memberIndexById.has(1000), false)
  assert.equal(db.memberIndexById.get(2000), 0)
  assert.equal(db.entityIdForMemberIndex(0), 2000)
  assert.throws(() => db.removeNode(20), /still referenced/)
  db.removeMember(2000)
  db.removeNode(20)
  assert.equal(db.nodeIndexById.has(20), false)
})

test('profile deltas preserve dense member references after compaction', () => {
  const source = simpleSource()
  source.profiles = [
    { id: 50, family: 'box', parameters: [0.2, 0.2] },
    ...source.profiles,
  ]
  const db = new StructuralSceneDB(source)
  db.updateProfile(100, { parameters: [0.4, 0.2, 0.01, 0.02] })
  assert.ok(Math.abs(db.profileParameters[8] - 0.4) < 1e-6)
  db.removeProfile(50)
  assert.equal(db.profileIndexById.get(100), 0)
  assert.deepEqual(Array.from(db.memberProfileIndices.slice(0, 2)), [0, 0])
  assert.throws(() => db.removeProfile(100), /still referenced/)
})

test('failed member update is atomic and legacy adapter preserves gamma/reference axis', () => {
  const db = new StructuralSceneDB(simpleSource())
  assert.throws(() => db.updateMember(1000, { startNodeId: 999 }), /Unknown start node/)
  assert.equal(db.memberStartNodeIndices[0], db.nodeIndexById.get(10))

  const source = legacyModelToStructuralSource({
    nodes: [{ id: 1, x: 0, y: 1, z: 2 }, { id: 2, x: 3, y: 4, z: 5 }],
    sections: [{
      id: 7, name: 'H300', type: 'I', depth: 300, width: 300, tw: 10, tf: 15, r: 18,
      material: { id: 3, name: 'Steel', E: 210e9, nu: 0.3 },
    }],
    members: [{
      id: 9,
      nodes: [{ id: 1, x: 0, y: 1, z: 2 }, { id: 2, x: 3, y: 4, z: 5 }],
      section: {
        id: 7, name: 'H300', type: 'I', depth: 300, width: 300, tw: 10, tf: 15, r: 18,
        material: { id: 3, name: 'Steel', E: 210e9, nu: 0.3 },
      },
      gamma: 90,
      vecxz: { x: 0, y: 0, z: 1 },
    }],
  })
  const legacyDB = new StructuralSceneDB(source)
  assert.ok(Math.abs(legacyDB.memberGammaRadians[0] - Math.PI / 2) < 1e-6)
  assert.deepEqual(Array.from(legacyDB.memberReferenceAxes.slice(0, 3)), [0, 0, 1])
})

test('fixture adapter is deterministic, Y-up and uses SI profile dimensions', () => {
  const fixture = generateStructuralBenchmarkFixture({ beamCount: 10_000, seed: 123 })
  const source = fixtureToStructuralSource(fixture)
  const first = new StructuralSceneDB(source)
  const second = new StructuralSceneDB(fixtureToStructuralSource(fixture))
  assert.equal(first.nodeCount, fixture.nodes.length)
  assert.equal(first.memberCount, 10_000)
  assert.equal(first.profileCount, 7)
  assert.deepEqual(first.memberIds.slice(0, first.memberCount), second.memberIds.slice(0, second.memberCount))
  assert.deepEqual(first.memberEndpoints.slice(0, 60), second.memberEndpoints.slice(0, 60))
  const h300 = first.profileIndexById.get(1)!
  assert.ok(Math.abs(first.profileParameters[h300 * 8] - 0.3) < 1e-6)
  const verticalNode = fixture.nodes.find(node => node.z > 0)!
  const renderIndex = first.nodeIndexById.get(verticalNode.id)!
  assert.equal(first.nodePositions[renderIndex * 3 + 1], verticalNode.z)
})

test('100k fixture creates compact buffers and transferable snapshot without Object3D', () => {
  const fixture = generateStructuralBenchmarkFixture({ beamCount: 100_000 })
  const db = new StructuralSceneDB(fixtureToStructuralSource(fixture))
  assert.equal(db.memberCount, 100_000)
  assert.ok(db.byteLength < 20 * 1024 * 1024)
  const { snapshot, transferables } = db.toTransferableSnapshot()
  assert.equal(snapshot.version, 2)
  assert.equal(snapshot.counts.members, 100_000)
  assert.equal(transferables.length, 19)
  assert.ok(transferables.every(buffer => buffer instanceof ArrayBuffer))
})

test('custom contour atlas and asymmetric mirror flags survive transferable snapshot', () => {
  const source = simpleSource()
  source.profiles = [{
    id: 100,
    family: 'custom',
    contour: [[-.1, -.2], [.1, -.2], [0, .2]],
    contourClosed: true,
  }]
  source.members = [
    { ...source.members[0], mirrorY: true },
    { ...source.members[1], mirrorZ: true },
  ]
  const db = new StructuralSceneDB(source)
  assert.equal(db.memberOrientationFlags[0], MEMBER_MIRROR_Y)
  assert.equal(db.memberOrientationFlags[1], MEMBER_MIRROR_Z)
  db.updateMember(1000, { mirrorZ: true })
  assert.equal(db.memberOrientationFlags[0], MEMBER_MIRROR_Y | MEMBER_MIRROR_Z)
  const { snapshot } = db.toTransferableSnapshot()
  assert.deepEqual(Array.from(snapshot.profileContourOffsets), [0, 6])
  assert.deepEqual(Array.from(snapshot.profileContourCoordinates), Array.from(new Float32Array([-.1, -.2, .1, -.2, 0, .2])))
  assert.deepEqual(Array.from(snapshot.profileContourClosed), [1])
  assert.deepEqual(Array.from(snapshot.memberOrientationFlags), [3, 2])
})
