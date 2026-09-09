import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { closestProjectedMemberPoint, closestProjectedStructuralNode, memberSnapRatioLabel } from './structuralSnap.ts'

const camera = () => {
  const value = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 20)
  value.position.set(0, 0, 5)
  value.lookAt(0, 0, 0)
  value.updateProjectionMatrix()
  value.updateMatrixWorld(true)
  return value
}

test('data-driven drawing snap resolves the closest stable node id', () => {
  const result = closestProjectedStructuralNode(new THREE.Vector2(.51, 0), camera(), [
    { id: 101, position: new THREE.Vector3(-1, 0, 0) },
    { id: 909, position: new THREE.Vector3(1, 0, 0) },
  ], .1)
  assert.equal(result?.id, 909)
  assert.deepEqual(result?.position.toArray(), [1, 0, 0])
})

test('data-driven drawing snap rejects endpoints outside the screen threshold', () => {
  assert.equal(closestProjectedStructuralNode(new THREE.Vector2(0, .8), camera(), [
    { id: 101, position: new THREE.Vector3(-1, 0, 0) },
    { id: 909, position: new THREE.Vector3(1, 0, 0) },
  ], .1), null)
})

test('member drawing snap exposes only quarter, half and three-quarter stations', () => {
  const view = camera()
  const start = new THREE.Vector3(-1, 0, 0)
  const end = new THREE.Vector3(1, 0, 0)
  const result = closestProjectedMemberPoint(new THREE.Vector2(.24, .01), view, 77, start, end, .1)

  assert.equal(result?.id, 77)
  assert.equal(result?.ratio, .75)
  assert.deepEqual(result?.position.toArray(), [.5, 0, 0])
  assert.equal(memberSnapRatioLabel(result!.ratio), '3/4')
})

test('member drawing snap ignores arbitrary positions between special stations', () => {
  assert.equal(closestProjectedMemberPoint(
    new THREE.Vector2(.1, .4), camera(), 77,
    new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 0, 0), .1,
  ), null)
})
