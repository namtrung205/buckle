import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { buildLoadInstances, hexToRgb, type LoadInstanceModel } from '../Load/loadInstances.ts'
import LoadGpuRenderer from './LoadGpuRenderer.ts'

const distributedModel = (): LoadInstanceModel => ({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 },
    { id: 2, x: 4, y: 0, z: 0 },
  ],
  members: [{ id: 10, nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }] }],
  shells: [],
  loads: [{ id: 100, type: 'linear', targets: [10], value: { x: 0, y: -5, z: 0 } }],
})

test('distributed load draws two end arrows plus one band', () => {
  const instances = buildLoadInstances(distributedModel())
  assert.equal(instances.arrows.length, 2)
  assert.equal(instances.bands.length, 1)
  const [first, last] = instances.arrows
  // Arrow tips land on the member end nodes; the load points down (-Y) and a
  // single-magnitude set normalises to the mid arrow length (1.0 + 0.3) / 2.
  assert.deepEqual(first.tip, [0, 0, 0])
  assert.deepEqual(last.tip, [4, 0, 0])
  assert.deepEqual(first.origin, [0, 0.65, 0])
  assert.deepEqual(last.origin, [4, 0.65, 0])
  // The band spans the member axis with the same offset vector (numeric
  // compare — the scaled offset carries -0 on its zero components).
  assert.deepEqual(instances.bands[0].start, [0, 0, 0])
  assert.deepEqual(instances.bands[0].end, [4, 0, 0])
  const bandOffset = instances.bands[0].offset
  assert.ok(Math.abs(bandOffset[0]) < 1e-12)
  assert.ok(Math.abs(bandOffset[1] - 0.65) < 1e-12)
  assert.ok(Math.abs(bandOffset[2]) < 1e-12)
  assert.deepEqual(instances.bands[0].color, [1, 0, 0])
})

test('distributed arrow length normalises between 0.3 and 1.0', () => {
  const model = distributedModel()
  model.loads = [
    { id: 100, type: 'linear', targets: [10], value: { x: 0, y: -1, z: 0 } },
    { id: 101, type: 'linear', targets: [10], value: { x: 0, y: -10, z: 0 } },
  ]
  const instances = buildLoadInstances(model)
  // Both loads hit both ends of the only member.
  assert.equal(instances.arrows.length, 4)
  const lengths = instances.arrows.map(arrow => Math.abs(arrow.origin[1] - arrow.tip[1]))
  assert.ok(Math.abs(Math.min(...lengths) - 0.3) < 1e-9)
  assert.ok(Math.abs(Math.max(...lengths) - 1.0) < 1e-9)
})

test('a load parallel to the member axis keeps arrows but hides the band', () => {
  const model = distributedModel()
  model.loads = [{ id: 100, type: 'linear', targets: [10], value: { x: 2, y: 0, z: 0 } }]
  const instances = buildLoadInstances(model)
  assert.equal(instances.arrows.length, 2)
  assert.equal(instances.bands.length, 0)
})

test('nodal load draws one arrow per non-zero component along its own axis', () => {
  const model: LoadInstanceModel = {
    nodes: [{ id: 1, x: 2, y: 3, z: 4 }],
    members: [],
    shells: [],
    loads: [{ id: 7, type: 'nodal', targets: [1], value: { x: -10, y: 0.0005, z: 25 } }],
  }
  const instances = buildLoadInstances(model)
  // Fx (-10) and Fz (25) — Fy sits below the 0.001 significance threshold.
  assert.equal(instances.arrows.length, 2)
  const fx = instances.arrows[0]
  const fz = instances.arrows[1]
  assert.deepEqual(fx.tip, [2, 3, 4])
  assert.deepEqual(fx.origin, [3, 3, 4]) // -X load: the arrow starts +X of the node
  assert.deepEqual(fz.origin, [2, 3, 3]) // +Z load: the arrow starts -Z of the node
  assert.deepEqual(fx.color, [1, 0, 0])
  assert.deepEqual(fz.color, [0, 0, 1])
})

test('pressure load uses the surface normal for wind and the value direction for snow', () => {
  const model: LoadInstanceModel = {
    nodes: [],
    members: [],
    shells: [{
      id: 5,
      nodes: [
        { id: 1, x: 0, y: 0, z: 0 },
        { id: 2, x: 2, y: 0, z: 0 },
        { id: 3, x: 0, y: 0, z: 2 },
      ],
    }],
    loads: [
      { id: 1, type: 'pressure', targets: [5], value: { x: 0, y: 0, z: 0 }, magnitude: -3 },
      { id: 2, type: 'pressure', targets: [5], value: { x: 0, y: 1, z: 0 } },
    ],
  }
  const instances = buildLoadInstances(model)
  assert.equal(instances.arrows.length, 2)
  const wind = instances.arrows[0]
  const snow = instances.arrows[1]
  // Shell normal for (0,0,0)(2,0,0)(0,0,2) is (0,-1,0); the negative wind
  // magnitude flips it to +Y, so both arrows start one length below the centre.
  assert.deepEqual(wind.tip, [2 / 3, 0, 2 / 3])
  assert.deepEqual(wind.origin, [2 / 3, -1, 2 / 3])
  assert.deepEqual(wind.color, hexToRgb(0x9c27b0))
  assert.deepEqual(snow.origin, [2 / 3, -1, 2 / 3])
  assert.deepEqual(snow.color, hexToRgb(0x00bcd4))
})

test('upload fills three constant batches and visibility flips the group', () => {
  const scene = new THREE.Scene()
  const renderer = new LoadGpuRenderer(scene, 0)
  assert.equal(renderer.group.visible, false)
  assert.equal(scene.children.includes(renderer.group), true)
  renderer.setVisible(true)
  assert.equal(renderer.group.visible, true)
  renderer.upload(buildLoadInstances(distributedModel()))
  assert.equal(renderer.arrowCount, 2)
  assert.equal(renderer.bandCount, 1)
  assert.equal(renderer.shaftVertexCount, 4)
  assert.equal(renderer.getStats().drawObjects, 3)

  // Shaft: origin → (tip − headLength·dir); f32 rounding on both sides.
  const shaftGeometry = (renderer as unknown as { shaftGeometry: THREE.BufferGeometry }).shaftGeometry
  const positions = shaftGeometry.getAttribute('position') as THREE.BufferAttribute
  const expectedShaft = new Float32Array([0, 0.65, 0, 0, 0.1, 0])
  assert.deepEqual(Array.from(positions.array.slice(0, 6)), Array.from(expectedShaft))
  const shaftColors = shaftGeometry.getAttribute('color') as THREE.BufferAttribute
  assert.deepEqual(Array.from(shaftColors.array.slice(0, 6)), Array.from(new Float32Array([1, 0, 0, 1, 0, 0])))

  // Head instance: tip on the node, direction along the load, legacy head size.
  const headGeometry = (renderer as unknown as { headGeometry: THREE.InstancedBufferGeometry }).headGeometry
  const iTip = headGeometry.getAttribute('iTip') as THREE.InstancedBufferAttribute
  const iDir = headGeometry.getAttribute('iDir') as THREE.InstancedBufferAttribute
  const iSize = headGeometry.getAttribute('iSize') as THREE.InstancedBufferAttribute
  assert.deepEqual(Array.from(iTip.array.slice(0, 3)), [0, 0, 0])
  assert.deepEqual(Array.from(iDir.array.slice(0, 3)), Array.from(new Float32Array([0, -1, 0])))
  assert.deepEqual(Array.from(iSize.array.slice(0, 2)), Array.from(new Float32Array([0.1, 0.1])))

  // Band instance spans the member with the load offset.
  const bandGeometry = (renderer as unknown as { bandGeometry: THREE.InstancedBufferGeometry }).bandGeometry
  assert.equal(bandGeometry.instanceCount, 1)
  const iP0 = bandGeometry.getAttribute('iP0') as THREE.InstancedBufferAttribute
  const iOffset = bandGeometry.getAttribute('iOffset') as THREE.InstancedBufferAttribute
  assert.deepEqual(Array.from(iP0.array.slice(0, 3)), [0, 0, 0])
  // Numeric compare — the scaled offset carries -0 on its zero components.
  const offset = Array.from(iOffset.array.slice(0, 3))
  assert.ok(Math.abs(offset[0]) < 1e-9)
  assert.ok(Math.abs(offset[1] - 0.65) < 1e-6)
  assert.ok(Math.abs(offset[2]) < 1e-9)

  // Disposing removes the group from the scene.
  renderer.dispose()
  assert.equal(renderer.group.parent, null)
})

