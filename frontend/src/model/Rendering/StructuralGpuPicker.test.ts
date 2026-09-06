import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { StructuralSceneDB, type StructuralSceneSource } from './StructuralSceneDB.ts'
import { buildStructuralPickBuffers, decodeRenderIndex, StructuralWindowSelector } from './StructuralGpuPicker.ts'

const source = (): StructuralSceneSource => ({
  nodes: [
    { id: 1, position: [-.8, 0, 0] }, { id: 2, position: [-.2, 0, 0] },
    { id: 3, position: [.2, 0, 0] }, { id: 4, position: [.8, 0, 0] },
    { id: 5, position: [-2, 0, 0] }, { id: 6, position: [2, 0, 0] },
  ],
  profiles: [{ id: 10, family: 'h', parameters: [.3, .2, .01, .02] }],
  members: [
    { id: 101, startNodeId: 1, endNodeId: 2, profileId: 10 },
    { id: 305, startNodeId: 3, endNodeId: 4, profileId: 10 },
    { id: 9999, startNodeId: 5, endNodeId: 6, profileId: 10 },
  ],
})

test('pick buffers keep dense render indices separate from sparse entity IDs', () => {
  const db = new StructuralSceneDB(source())
  const buffers = buildStructuralPickBuffers(db)
  assert.deepEqual(Array.from(buffers.renderIndices), [0, 1, 2])
  assert.ok(Math.abs(buffers.starts[0] + .8) < 1e-6)
  assert.ok(Math.abs(buffers.starts[3] - .2) < 1e-6)
  assert.deepEqual(Array.from(buffers.starts.slice(6)), [-2, 0, 0])
  assert.equal(db.entityIdForMemberIndex(1), 305)
})

test('RGB pick IDs round-trip and zero remains the no-hit sentinel', () => {
  assert.equal(decodeRenderIndex([0, 0, 0, 255]), null)
  for (const renderIndex of [0, 1, 254, 255, 65534, 100_000]) {
    const encoded = renderIndex + 1
    const pixel = [encoded & 255, (encoded >> 8) & 255, (encoded >> 16) & 255, 255]
    assert.equal(decodeRenderIndex(pixel), renderIndex)
  }
})

test('window selects contained beams and reverse crossing selects intersections', () => {
  const db = new StructuralSceneDB(source())
  const selector = new StructuralWindowSelector()
  selector.upload(db, 1)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10)
  camera.position.set(0, 0, 5)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)

  assert.deepEqual(selector.select(camera, new THREE.Vector2(-.9, -.2), new THREE.Vector2(-.1, .2)), [101])
  assert.deepEqual(selector.select(camera, new THREE.Vector2(.1, .2), new THREE.Vector2(-.1, -.2)), [9999])
})

test('hidden members are excluded from rectangle selection', () => {
  const db = new StructuralSceneDB(source())
  db.setMemberFlag(101, 1, false)
  const selector = new StructuralWindowSelector()
  selector.upload(db)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10)
  camera.position.z = 5
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  const ids = selector.select(camera, new THREE.Vector2(-1, -1), new THREE.Vector2(1, 1))
  assert.deepEqual(ids, [305])
})

test('entity resolution remains stable after dense member compaction', () => {
  const db = new StructuralSceneDB(source())
  db.removeMember(101)
  const buffers = buildStructuralPickBuffers(db)
  assert.deepEqual(Array.from(buffers.renderIndices), [0, 1])
  assert.equal(db.entityIdForMemberIndex(0), 9999)
  assert.equal(db.entityIdForMemberIndex(1), 305)
})
