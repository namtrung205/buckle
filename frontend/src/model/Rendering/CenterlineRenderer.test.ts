import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { generateStructuralBenchmarkFixture } from '../Benchmark/structuralFixture.ts'
import CenterlineRenderer from './CenterlineRenderer.ts'
import { ENTITY_SELECTED, ENTITY_VISIBLE, StructuralSceneDB } from './StructuralSceneDB.ts'
import { fixtureToStructuralSource } from './structuralSceneAdapters.ts'

const makeRenderer = (beamCount: number) => {
  const fixture = generateStructuralBenchmarkFixture({ beamCount })
  const db = new StructuralSceneDB(fixtureToStructuralSource(fixture))
  const scene = new THREE.Scene()
  const renderer = new CenterlineRenderer(scene, 0)
  renderer.upload(db)
  return { db, scene, renderer }
}

test('10k centerline uses one LineSegments and one Points object', () => {
  const { scene, renderer } = makeRenderer(10_000)
  let lineObjects = 0
  let pointObjects = 0
  scene.traverse(object => {
    if (object instanceof THREE.LineSegments) lineObjects++
    if (object instanceof THREE.Points) pointObjects++
  })
  assert.equal(lineObjects, 1)
  assert.equal(pointObjects, 1)
  assert.equal(renderer.lineGeometry.drawRange.count, 20_000)
})

test('100k object and draw-pass count stays constant', () => {
  const small = makeRenderer(1_000)
  const large = makeRenderer(100_000)
  assert.equal(small.renderer.group.children.length, 2)
  assert.equal(large.renderer.group.children.length, 2)
  assert.equal(large.renderer.lineGeometry.drawRange.count, 200_000)
})

test('endpoint delta and stable segment ID update without rebuilding objects', () => {
  const { db, renderer } = makeRenderer(10)
  const memberId = db.entityIdForMemberIndex(0)!
  const nodeIndex = db.memberStartNodeIndices[0]
  const nodeId = db.nodeIds[nodeIndex]
  const linesBefore = renderer.lines
  db.updateNode(nodeId, [7, 8, 9])
  renderer.syncDirty()
  const positions = renderer.lineGeometry.getAttribute('position') as THREE.BufferAttribute
  assert.deepEqual(Array.from(positions.array.slice(0, 3)), [7, 8, 9])
  assert.equal(renderer.entityIdForVertexIndex(0), memberId)
  assert.equal(renderer.entityIdForVertexIndex(1), memberId)
  assert.equal(renderer.lines, linesBefore)
})

test('selection and visibility update GPU flags without replacing the batch', () => {
  const { db, renderer } = makeRenderer(10)
  const entityId = db.entityIdForMemberIndex(2)!
  const linesBefore = renderer.lines
  renderer.setMemberState(entityId, { selected: true, visible: false })
  const flags = renderer.lineGeometry.getAttribute('entityFlags') as THREE.BufferAttribute
  const value = Number(flags.array[4])
  assert.equal(value & ENTITY_SELECTED, ENTITY_SELECTED)
  assert.equal(value & ENTITY_VISIBLE, 0)
  renderer.setVisible(false)
  renderer.setVisible(true)
  assert.equal(renderer.lines, linesBefore)
  assert.equal(Number(flags.array[4]) & ENTITY_SELECTED, ENTITY_SELECTED)
})

test('node selection and hover update the shared point flags without creating meshes', () => {
  const { db, renderer } = makeRenderer(10)
  const entityId = db.entityIdForNodeIndex(1)!
  const pointsBefore = renderer.nodes
  renderer.setNodeState(entityId, { selected: true, hovered: true })
  const flags = renderer.nodeGeometry.getAttribute('entityFlags') as THREE.BufferAttribute
  assert.equal(Number(flags.array[1]) & ENTITY_SELECTED, ENTITY_SELECTED)
  assert.equal(Number(flags.array[1]) & 4, 4)
  assert.equal(renderer.nodes, pointsBefore)
})

test('member gamma does not alter centerline endpoints', () => {
  const { db, renderer } = makeRenderer(10)
  const entityId = db.entityIdForMemberIndex(0)!
  const position = renderer.lineGeometry.getAttribute('position') as THREE.BufferAttribute
  const before = Array.from(position.array.slice(0, 6))
  db.updateMember(entityId, { gammaRadians: Math.PI / 2 })
  renderer.syncDirty()
  assert.deepEqual(Array.from(position.array.slice(0, 6)), before)
})

test('shrink trims both member ends in the uploaded buffer', () => {
  const { db } = makeRenderer(4)
  const shrunk = new CenterlineRenderer(new THREE.Scene(), 0)
  shrunk.setShrink(0.1)
  shrunk.upload(db)
  const positions = shrunk.lineGeometry.getAttribute('position') as THREE.BufferAttribute
  const endpoints = db.memberEndpoints
  const expected = new Float32Array([
    endpoints[0] + (endpoints[3] - endpoints[0]) * 0.1,
    endpoints[1] + (endpoints[4] - endpoints[1]) * 0.1,
    endpoints[2] + (endpoints[5] - endpoints[2]) * 0.1,
    endpoints[3] - (endpoints[3] - endpoints[0]) * 0.1,
    endpoints[4] - (endpoints[4] - endpoints[1]) * 0.1,
    endpoints[5] - (endpoints[5] - endpoints[2]) * 0.1,
  ])
  assert.deepEqual(Array.from(positions.array.slice(0, 6)), Array.from(expected))
})

test('setShrink toggles rewrite the uploaded buffer without re-upload', () => {
  const { db, renderer } = makeRenderer(4)
  const full = Array.from(db.memberEndpoints.slice(0, 6))
  renderer.setShrink(0.25)
  const positions = renderer.lineGeometry.getAttribute('position') as THREE.BufferAttribute
  assert.notDeepEqual(Array.from(positions.array.slice(0, 6)), full)
  renderer.setShrink(0)
  assert.deepEqual(Array.from(positions.array.slice(0, 6)), full)
})

test('shrink applies to dirty-range syncs as well', () => {
  const { db, renderer } = makeRenderer(10)
  renderer.setShrink(0.25)
  const nodeId = db.nodeIds[db.memberStartNodeIndices[0]]
  db.updateNode(nodeId, [7, 8, 9])
  renderer.syncDirty()
  const positions = renderer.lineGeometry.getAttribute('position') as THREE.BufferAttribute
  const endpoints = db.memberEndpoints
  const expected = new Float32Array([
    endpoints[0] + (endpoints[3] - endpoints[0]) * 0.25,
    endpoints[1] + (endpoints[4] - endpoints[1]) * 0.25,
    endpoints[2] + (endpoints[5] - endpoints[2]) * 0.25,
    endpoints[3] - (endpoints[3] - endpoints[0]) * 0.25,
    endpoints[4] - (endpoints[4] - endpoints[1]) * 0.25,
    endpoints[5] - (endpoints[5] - endpoints[2]) * 0.25,
  ])
  assert.deepEqual(Array.from(positions.array.slice(0, 6)), Array.from(expected))
})

