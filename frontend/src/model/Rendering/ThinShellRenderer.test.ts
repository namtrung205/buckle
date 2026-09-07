import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { generateStructuralBenchmarkFixture } from '../Benchmark/structuralFixture.ts'
import {
  ENTITY_SELECTED,
  ENTITY_VISIBLE,
  MEMBER_MIRROR_Y,
  MEMBER_MIRROR_Z,
  StructuralSceneDB,
  type StructuralSceneSource,
} from './StructuralSceneDB.ts'
import { fixtureToStructuralSource } from './structuralSceneAdapters.ts'
import ThinShellRenderer from './ThinShellRenderer.ts'
import {
  createAngleThinShellTemplate,
  createBoxThinShellTemplate,
  createChannelThinShellTemplate,
  createCustomThinShellTemplate,
  createHThinShellTemplate,
  createPipeThinShellTemplate,
} from './thinShellTemplates.ts'

const makeRenderer = (source: StructuralSceneSource) => {
  const database = new StructuralSceneDB(source)
  const scene = new THREE.Scene()
  const renderer = new ThinShellRenderer(scene, 0)
  renderer.upload(database)
  database.clearDirtyRanges()
  return { database, scene, renderer }
}

const compactSource = (): StructuralSceneSource => ({
  nodes: [
    { id: 1, position: [0, 0, 0] },
    { id: 2, position: [5, 0, 0] },
    { id: 3, position: [0, 5, 0] },
  ],
  profiles: [
    { id: 10, family: 'h', parameters: [.3, .3, .01, .015] },
    { id: 20, family: 'h', parameters: [.4, .4, .013, .021] },
    { id: 30, family: 'box', parameters: [.3, .3, 0, 0, 0, .012] },
  ],
  members: [
    { id: 100, startNodeId: 1, endNodeId: 2, profileId: 10, referenceAxis: [0, 0, 1] },
    { id: 200, startNodeId: 1, endNodeId: 3, profileId: 20, referenceAxis: [0, 1, 0] },
    { id: 300, startNodeId: 2, endNodeId: 3, profileId: 30 },
  ],
})

const mixedSource = (): StructuralSceneSource => {
  const profiles: StructuralSceneSource['profiles'] = [
    { id: 10, family: 'h', parameters: [.3, .3, .01, .015] },
    { id: 20, family: 'channel', parameters: [.25, .09, .008, .012] },
    { id: 30, family: 'angle', parameters: [.1, .08, 0, 0, 0, .008] },
    { id: 40, family: 'box', parameters: [.3, .2, 0, 0, 0, .012] },
    { id: 50, family: 'pipe', parameters: [0, 0, 0, 0, .22, .01] },
    { id: 60, family: 'custom', contour: [[-.1, -.15], [.1, -.15], [0, .15]], contourClosed: true },
    { id: 70, family: 'unknown' },
  ]
  return {
    nodes: [
      { id: 1, position: [0, 0, 0] },
      { id: 2, position: [5, 0, 0] },
    ],
    profiles,
    members: profiles.map((profile, index) => ({
      id: 100 + index,
      startNodeId: 1,
      endNodeId: 2,
      profileId: profile.id,
      referenceAxis: [0, 0, 1],
      gammaRadians: index * Math.PI / 12,
      mirrorY: index === 1,
      mirrorZ: index === 2,
    })),
  }
}

const assertFiniteUnitNormals = (template: { normals: Float32Array }) => {
  for (let index = 0; index < template.normals.length; index += 3) {
    const length = Math.hypot(template.normals[index], template.normals[index + 1], template.normals[index + 2])
    assert.ok(Number.isFinite(length))
    assert.ok(Math.abs(length - 1) < 1e-6)
  }
}

test('standard and custom templates have stable topology and unit normals', () => {
  const templates = [
    [createHThinShellTemplate(), 96],
    [createChannelThinShellTemplate(), 84],
    [createAngleThinShellTemplate(), 60],
    [createBoxThinShellTemplate(), 96],
    [createPipeThinShellTemplate(12), 288],
    [createCustomThinShellTemplate(new Float32Array([0, 0, 1, 0, 1, 1]), false), 12],
    [createCustomThinShellTemplate(new Float32Array([0, 0, 1, 0, 1, 1]), true), 18],
  ] as const
  for (const [template, expectedVertices] of templates) {
    assert.equal(template.vertexCount, expectedVertices)
    assert.ok(template.edgeVertexCount > 0)
    assert.equal(template.edgePositions.length, template.edgeVertexCount * 3)
    assert.equal(template.edgeThicknessWeights.length, template.edgeVertexCount * 2)
    assertFiniteUnitNormals(template)
  }
})

test('closed standard profiles contain start/end cap normals', () => {
  for (const template of [
    createHThinShellTemplate(), createChannelThinShellTemplate(), createAngleThinShellTemplate(),
    createBoxThinShellTemplate(), createPipeThinShellTemplate(8),
  ]) {
    let negative = false, positive = false
    for (let index = 0; index < template.normals.length; index += 3) {
      negative ||= template.normals[index] < -.5
      positive ||= template.normals[index] > .5
    }
    assert.equal(negative, true)
    assert.equal(positive, true)
  }
})

test('empty scene submits zero thin-shell instances', () => {
  const renderer = new ThinShellRenderer(new THREE.Scene(), 0)
  assert.equal(renderer.instanceCount, 0)
  assert.equal(renderer.activeBatchCount, 0)
})

test('mixed standard profiles use one batch per family and custom uses one topology batch', () => {
  const { renderer } = makeRenderer(mixedSource())
  assert.equal(renderer.instanceCount, 6)
  assert.equal(renderer.activeBatchCount, 6)
  for (const key of ['h', 'channel', 'angle', 'box', 'pipe', 'custom:60']) {
    assert.equal(renderer.batchInstanceCount(key), 1)
  }
  assert.equal(renderer.fallbackGeometry.drawRange.count, 2)
})

test('H300/H400 share topology while dimensions remain per instance', () => {
  const { renderer } = makeRenderer(compactSource())
  assert.equal(renderer.batchInstanceCount('h'), 2)
  assert.equal(renderer.batchInstanceCount('box'), 1)
  const dimensions = renderer.geometry.getAttribute('instanceDimensions') as THREE.InstancedBufferAttribute
  assert.deepEqual(Array.from(dimensions.array.slice(0, 4)), Array.from(new Float32Array([.3, .3, .01, .015])))
  assert.deepEqual(Array.from(dimensions.array.slice(4, 8)), Array.from(new Float32Array([.4, .4, .013, .021])))
})

test('quality profile changes pipe segments without replacing its batch geometry', () => {
  const { renderer } = makeRenderer(mixedSource())
  const geometry = renderer.batchGeometry('pipe')!
  renderer.setQualityProfile('low')
  assert.equal(geometry.getAttribute('position').count, 8 * 24)
  renderer.setQualityProfile('high')
  assert.equal(geometry.getAttribute('position').count, 20 * 24)
  assert.equal(renderer.batchGeometry('pipe'), geometry)
  assert.equal(renderer.batchInstanceCount('pipe'), 1)
})

test('mirror flags are packed per member and uploaded without negative Object3D scale', () => {
  const { database, renderer } = makeRenderer(mixedSource())
  const channelOrientation = renderer.batchGeometry('channel')!.getAttribute('instanceOrientationFlags') as THREE.InstancedBufferAttribute
  const angleOrientation = renderer.batchGeometry('angle')!.getAttribute('instanceOrientationFlags') as THREE.InstancedBufferAttribute
  assert.equal(Number(channelOrientation.array[0]), MEMBER_MIRROR_Y)
  assert.equal(Number(angleOrientation.array[0]), MEMBER_MIRROR_Z)
  database.updateMember(100, { mirrorY: true, mirrorZ: true })
  renderer.syncDirty()
  const hOrientation = renderer.geometry.getAttribute('instanceOrientationFlags') as THREE.InstancedBufferAttribute
  assert.equal(Number(hOrientation.array[0]), MEMBER_MIRROR_Y | MEMBER_MIRROR_Z)
  assert.deepEqual(renderer.mesh.scale.toArray(), [1, 1, 1])
})

test('gamma, endpoints and standard dimensions update without replacing the batch', () => {
  const { database, renderer } = makeRenderer(compactSource())
  const meshBefore = renderer.mesh
  const geometryBefore = renderer.geometry
  const starts = renderer.geometry.getAttribute('instanceStart') as THREE.InstancedBufferAttribute
  const startsBefore = Array.from(starts.array)
  database.updateMember(100, { gammaRadians: Math.PI / 2, referenceAxis: [0, 1, 0] })
  renderer.syncDirty()
  const gamma = renderer.geometry.getAttribute('instanceGamma') as THREE.InstancedBufferAttribute
  assert.ok(Math.abs(Number(gamma.array[0]) - Math.PI / 2) < 1e-6)
  assert.deepEqual(Array.from(starts.array), startsBefore)
  database.clearDirtyRanges()
  database.updateProfile(10, { parameters: [.35, .2, .012, .018] })
  renderer.syncDirty()
  const dimensions = renderer.geometry.getAttribute('instanceDimensions') as THREE.InstancedBufferAttribute
  assert.deepEqual(Array.from(dimensions.array.slice(0, 4)), Array.from(new Float32Array([.35, .2, .012, .018])))
  assert.equal(renderer.mesh, meshBefore)
  assert.equal(renderer.geometry, geometryBefore)
})

test('selection and visibility flags work for every instanced family', () => {
  const { database, renderer } = makeRenderer(mixedSource())
  for (const [entityId, key] of [[100, 'h'], [101, 'channel'], [102, 'angle'], [103, 'box'], [104, 'pipe'], [105, 'custom:60']] as const) {
    database.setMemberFlag(entityId, ENTITY_SELECTED, true)
    database.setMemberFlag(entityId, ENTITY_VISIBLE, false)
    renderer.syncMemberState(entityId)
    const flags = renderer.batchGeometry(key)!.getAttribute('instanceFlags') as THREE.InstancedBufferAttribute
    assert.equal(Number(flags.array[0]) & ENTITY_SELECTED, ENTITY_SELECTED)
    assert.equal(Number(flags.array[0]) & ENTITY_VISIBLE, 0)
  }
})

test('profile-family change repartitions members without fallback', () => {
  const { database, renderer } = makeRenderer(compactSource())
  database.updateProfile(10, { family: 'box', parameters: [.3, .3, 0, 0, 0, .01] })
  renderer.syncDirty()
  assert.equal(renderer.batchInstanceCount('h'), 1)
  assert.equal(renderer.batchInstanceCount('box'), 2)
  assert.equal(renderer.fallbackGeometry.drawRange.count, 0)
})

test('10k and 100k mixed fixtures keep constant standard renderer objects', () => {
  const fixture10k = generateStructuralBenchmarkFixture({ beamCount: 10_000, seed: 123 })
  const fixture100k = generateStructuralBenchmarkFixture({ beamCount: 100_000, seed: 123 })
  const small = makeRenderer(fixtureToStructuralSource(fixture10k))
  const large = makeRenderer(fixtureToStructuralSource(fixture100k))
  assert.equal(small.renderer.instanceCount, 10_000)
  assert.equal(large.renderer.instanceCount, 100_000)
  assert.equal(small.renderer.activeBatchCount, 5)
  assert.equal(large.renderer.activeBatchCount, 5)
  assert.equal(small.renderer.group.children.length, 11)
  assert.equal(large.renderer.group.children.length, 11)
})

test('growing a reused batch invalidates the Three.js cached instance capacity', () => {
  const smallFixture = generateStructuralBenchmarkFixture({ beamCount: 1_000, seed: 321 })
  const largeFixture = generateStructuralBenchmarkFixture({ beamCount: 10_000, seed: 321 })
  const { renderer } = makeRenderer(fixtureToStructuralSource(smallFixture))
  for (const key of ['h', 'channel', 'angle', 'box', 'pipe']) {
    const geometry = renderer.batchGeometry(key)! as THREE.InstancedBufferGeometry & { _maxInstanceCount?: number }
    geometry._maxInstanceCount = geometry.instanceCount
  }
  renderer.upload(new StructuralSceneDB(fixtureToStructuralSource(largeFixture)))
  for (const key of ['h', 'channel', 'angle', 'box', 'pipe']) {
    const geometry = renderer.batchGeometry(key)! as THREE.InstancedBufferGeometry & { _maxInstanceCount?: number }
    assert.equal(geometry._maxInstanceCount, undefined)
  }
  assert.equal(renderer.instanceCount, 10_000)
})

test('custom entropy grows by unique contour topology, not member count', () => {
  const source = mixedSource()
  source.profiles = [...source.profiles, {
    id: 80, family: 'custom', contour: [[-.1, -.1], [.1, -.1], [.1, .1], [-.1, .1]], contourClosed: true,
  }]
  source.members = [
    ...source.members,
    ...Array.from({ length: 1_000 }, (_, index) => ({
      id: 1_000 + index, startNodeId: 1, endNodeId: 2, profileId: index % 2 ? 60 : 80,
    })),
  ]
  const { renderer } = makeRenderer(source)
  assert.equal(renderer.batchInstanceCount('custom:60'), 501)
  assert.equal(renderer.batchInstanceCount('custom:80'), 500)
  assert.equal(renderer.activeBatchCount, 7)
  assert.equal(renderer.group.children.length, 15)
})

test('shrink drives the uShrink uniform on surface and edge materials', () => {
  const renderer = new ThinShellRenderer(new THREE.Scene(), 0)
  const materials = renderer as unknown as { material: THREE.ShaderMaterial; edgeMaterial: THREE.ShaderMaterial }
  assert.equal(materials.material.uniforms.uShrink.value, 0)
  renderer.setShrink(0.05)
  assert.equal(materials.material.uniforms.uShrink.value, 0.05)
  assert.equal(materials.edgeMaterial.uniforms.uShrink.value, 0.05)
  renderer.setShrink(0)
  assert.equal(materials.material.uniforms.uShrink.value, 0)
})

test('shrink trims fallback centerlines for unbatched profile families', () => {
  const source: StructuralSceneSource = {
    nodes: [
      { id: 1, position: [0, 0, 0] },
      { id: 2, position: [2, 0, 0] },
    ],
    profiles: [{ id: 10, family: 'rectangular', parameters: [.3, .5, 0, 0] }],
    members: [{ id: 100, startNodeId: 1, endNodeId: 2, profileId: 10 }],
  }
  const database = new StructuralSceneDB(source)
  const renderer = new ThinShellRenderer(new THREE.Scene(), 0)
  renderer.setShrink(0.1)
  renderer.upload(database)
  const positions = renderer.fallbackGeometry.getAttribute('position') as THREE.BufferAttribute
  assert.deepEqual(
    Array.from(positions.array.slice(0, 6)),
    Array.from(new Float32Array([0.2, 0, 0, 1.8, 0, 0])),
  )
  renderer.setShrink(0)
  assert.deepEqual(
    Array.from(positions.array.slice(0, 6)),
    Array.from(new Float32Array([0, 0, 0, 2, 0, 0])),
  )
})

