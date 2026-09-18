import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { generateStructuralBenchmarkFixture } from '../Benchmark/structuralFixture.ts'
import DiagramRenderer, { computeDiagramPoint, diagramDirectionForComponent } from './DiagramRenderer.ts'
import ResultStore from './ResultStore.ts'
import { StructuralSceneDB, type StructuralSceneSource } from './StructuralSceneDB.ts'
import { fixtureToStructuralSource } from './structuralSceneAdapters.ts'

const closeTo = (actual: readonly number[], expected: readonly number[]) => {
  expected.forEach((value, index) => assert.ok(Math.abs(actual[index] - value) < 1e-7, `${actual} != ${expected}`))
}

const compactSource = (): StructuralSceneSource => ({
  nodes: [{ id: 1, position: [0, 0, 0] }, { id: 2, position: [10, 0, 0] }],
  profiles: [{ id: 1, family: 'h' }],
  members: [{ id: 10, startNodeId: 1, endNodeId: 2, profileId: 1, referenceAxis: [0, 0, 1] }],
})

test('N/V/T/M components share the framework and select the expected local direction', () => {
  for (const component of ['N', 'V2', 'T', 'M3', 'Vy', 'Mz']) assert.equal(diagramDirectionForComponent(component), 0)
  for (const component of ['V3', 'M2', 'Vz', 'My']) assert.equal(diagramDirectionForComponent(component), 1)
})

test('golden diagram points preserve sign, gamma and reversed I/J convention', () => {
  closeTo(computeDiagramPoint([0, 0, 0], [10, 0, 0], [0, 0, 1], 0, .25, 2, .5, 'N'), [2.5, 1, 0])
  closeTo(computeDiagramPoint([0, 0, 0], [10, 0, 0], [0, 0, 1], 0, .25, -2, .5, 'N'), [2.5, -1, 0])
  closeTo(computeDiagramPoint([0, 0, 0], [10, 0, 0], [0, 0, 1], Math.PI / 2, .25, 2, .5, 'N'), [2.5, 0, 1])
  closeTo(computeDiagramPoint([0, 0, 0], [10, 0, 0], [0, 0, 1], Math.PI / 2, .25, 2, .5, 'M2'), [2.5, -1, 0])
  closeTo(computeDiagramPoint([10, 0, 0], [0, 0, 0], [0, 0, 1], 0, .25, 2, .5, 'N'), [7.5, -1, 0])
})

test('component/filter switches update buffers without replacing the two draw batches', () => {
  const database = new StructuralSceneDB(compactSource())
  const scene = new THREE.Scene()
  const renderer = new DiagramRenderer(scene, 0)
  renderer.upload(database)
  const store = new ResultStore(20)
  store.ingest({ key: 'LC1', members: [{ entityId: 10, stations: [
    { position: 0, values: { N: -1, M2: 2 } },
    { position: 1, values: { N: 1, M2: -2 } },
  ] }] }, database)
  const ribbonGeometry = renderer.ribbonGeometry
  const lineGeometry = renderer.lineGeometry
  renderer.show(store.getBinding('LC1', 'N')!, {
    component: 'N', scale: 1, min: -1, max: 1, contour: true, ribbon: true, hatch: true,
  })
  renderer.show(store.getBinding('LC1', 'M2')!, {
    component: 'M2', scale: 2, min: -2, max: 2, contour: false, ribbon: false, hatch: false, memberIds: [999],
  })
  assert.equal(renderer.ribbonGeometry, ribbonGeometry)
  assert.equal(renderer.lineGeometry, lineGeometry)
  assert.equal(renderer.ribbon.visible, false)
  assert.equal(renderer.group.visible, true)
  assert.equal((renderer.lineGeometry.getAttribute('instanceDiagramVisible') as THREE.BufferAttribute).getX(0), 0)
})

test('10k diagrams remain exactly two renderer objects and two instanced batches', () => {
  const fixture = generateStructuralBenchmarkFixture({ beamCount: 10_000 })
  const database = new StructuralSceneDB(fixtureToStructuralSource(fixture))
  const scene = new THREE.Scene()
  const renderer = new DiagramRenderer(scene, 0)
  renderer.upload(database)
  assert.equal(renderer.group.children.length, 2)
  assert.equal(renderer.ribbonGeometry.instanceCount, 10_000)
  assert.equal(renderer.lineGeometry.instanceCount, 10_000)
  assert.equal(renderer.ribbonGeometry.getAttribute('position').count, 114)
  assert.equal(renderer.lineGeometry.getAttribute('position').count, 80)
})
