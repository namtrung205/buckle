import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import test from 'node:test'
import * as THREE from 'three'
import { generateStructuralBenchmarkFixture } from '../Benchmark/structuralFixture.ts'
import CenterlineRenderer from './CenterlineRenderer.ts'
import ResultStore, { canonicalResultComponent, sampleStations } from './ResultStore.ts'
import { StructuralSceneDB, type StructuralSceneSource } from './StructuralSceneDB.ts'
import { fixtureToStructuralSource } from './structuralSceneAdapters.ts'
import ThinShellRenderer from './ThinShellRenderer.ts'

const compactSource = (): StructuralSceneSource => ({
  nodes: [{ id: 1, position: [0, 0, 0] }, { id: 2, position: [5, 0, 0] }],
  profiles: [{ id: 10, family: 'h', parameters: [.3, .3, .01, .015] }],
  members: [{
    id: 100, startNodeId: 1, endNodeId: 2, profileId: 10,
    referenceAxis: [0, 0, 1], gammaRadians: Math.PI / 2,
  }],
})

test('station interpolation is numeric, normalized, and supports engineering aliases', () => {
  const stations = [
    { position: 0, values: { N: -10, Vy: 20 } },
    { position: .25, values: { N: 0, Vy: 30 } },
    { position: 1, values: { N: 30, Vy: 50 } },
  ]
  assert.equal(sampleStations(stations, 'N', .125), -5)
  assert.equal(sampleStations(stations, 'N', .625), 15)
  assert.equal(sampleStations(stations, 'V2', .25), 30)
  assert.equal(canonicalResultComponent('Mz'), 'M3')
})

test('result binding preserves geometry, local-axis and gamma buffers', () => {
  const database = new StructuralSceneDB(compactSource())
  const scene = new THREE.Scene()
  const centerline = new CenterlineRenderer(scene, 0)
  const thinShell = new ThinShellRenderer(scene, 0)
  centerline.upload(database)
  thinShell.upload(database)
  const store = new ResultStore(20)
  store.ingest({ key: 'LC1', members: [{ entityId: 100, stations: [
    { position: 0, values: { N: -100, stress: 80 } },
    { position: 1, values: { N: 200, stress: 500 } },
  ] }] }, database)

  const lineGeometry = centerline.lineGeometry
  const shellGeometry = thinShell.batchGeometry('h')!
  const endpoints = shellGeometry.getAttribute('instanceStart')
  const reference = shellGeometry.getAttribute('instanceReferenceAxis')
  const gamma = shellGeometry.getAttribute('instanceGamma')
  centerline.bindResult(store.getBinding('LC1', 'N'))
  thinShell.bindResult(store.getBinding('LC1', 'stress'))
  centerline.setResultRange(-50, 50)
  thinShell.setResultRange(-50, 50)

  assert.equal(centerline.lineGeometry, lineGeometry)
  assert.equal(thinShell.batchGeometry('h'), shellGeometry)
  assert.equal(shellGeometry.getAttribute('instanceStart'), endpoints)
  assert.equal(shellGeometry.getAttribute('instanceReferenceAxis'), reference)
  assert.equal(shellGeometry.getAttribute('instanceGamma'), gamma)
  assert.equal((shellGeometry.getAttribute('instanceResultRow') as THREE.BufferAttribute).getX(0), 0)
  assert.deepEqual(Array.from((centerline.lineGeometry.getAttribute('resultU') as THREE.BufferAttribute).array), [0, 1])
})

test('10k x 20 station case switches component/range without rebuilding draw batches in <=150ms', () => {
  const fixture = generateStructuralBenchmarkFixture({ beamCount: 10_000 })
  const database = new StructuralSceneDB(fixtureToStructuralSource(fixture))
  const store = new ResultStore(20)
  store.ingest({
    key: 'LC-large',
    members: fixture.members.map((member, index) => ({
      entityId: member.id,
      stations: [
        { position: 0, values: { N: -index, M2: index * .5, stress: index % 500 } },
        { position: 1, values: { N: index, M2: -index * .25, stress: 500 - index % 500 } },
      ],
    })),
  }, database)
  const scene = new THREE.Scene()
  const centerline = new CenterlineRenderer(scene, 0)
  const thinShell = new ThinShellRenderer(scene, 0)
  centerline.upload(database)
  thinShell.upload(database)
  const lineGeometry = centerline.lineGeometry
  const shellGeometries = ['h', 'channel', 'angle', 'box', 'pipe'].map(key => thinShell.batchGeometry(key))

  const started = performance.now()
  for (const component of ['N', 'M2', 'stress', 'N', 'M2']) {
    const binding = store.getBinding('LC-large', component)
    assert.ok(binding)
    centerline.bindResult(binding)
    thinShell.bindResult(binding)
    centerline.setResultRange(-800, 800)
    thinShell.setResultRange(-800, 800)
  }
  const durationMs = performance.now() - started
  assert.ok(durationMs <= 150, `switching took ${durationMs.toFixed(2)}ms`)
  assert.equal(centerline.lineGeometry, lineGeometry)
  assert.deepEqual(['h', 'channel', 'angle', 'box', 'pipe'].map(key => thinShell.batchGeometry(key)), shellGeometries)
})
