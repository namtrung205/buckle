import assert from 'node:assert/strict'
import test from 'node:test'
import { generateStructuralBenchmarkFixture } from './structuralFixture.ts'

test('fixture is deterministic and exact-sized', () => {
  const a = generateStructuralBenchmarkFixture({ beamCount: 10_000, seed: 42 })
  const b = generateStructuralBenchmarkFixture({ beamCount: 10_000, seed: 42 })
  assert.equal(a.members.length, 10_000)
  assert.deepEqual(a, b)
  assert.equal(a.metadata.beamCount, 10_000)
})

test('fixture changes its section distribution when the seed changes', () => {
  const a = generateStructuralBenchmarkFixture({ beamCount: 1_000, seed: 1 })
  const b = generateStructuralBenchmarkFixture({ beamCount: 1_000, seed: 2 })
  assert.notDeepEqual(
    a.members.map(member => member.section),
    b.members.map(member => member.section),
  )
})

test('fixture references only emitted nodes', () => {
  const fixture = generateStructuralBenchmarkFixture({ beamCount: 1_000 })
  const nodeIds = new Set(fixture.nodes.map(node => node.id))
  for (const member of fixture.members) {
    assert(nodeIds.has(member.nodei.id))
    assert(nodeIds.has(member.nodej.id))
  }
})

