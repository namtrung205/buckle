import assert from 'node:assert/strict'
import test from 'node:test'
import { estimateSolidTriangles, materializationChunks, shouldEvictSolidResources } from './solidResourcePolicy.ts'

test('large solid caches evict while inspection-size models remain warm', () => {
  assert.equal(shouldEvictSolidResources(2_000), false)
  assert.equal(shouldEvictSolidResources(2_001), true)
})

test('solid estimate and chunk plan are deterministic', () => {
  assert.equal(estimateSolidTriangles(10_000, 3_731), 1_915_136)
  assert.equal(materializationChunks(13_731), 69)
})
