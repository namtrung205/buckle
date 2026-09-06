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
