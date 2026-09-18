import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveViewportPoint } from './index.ts'
import type { PointResolveContext, SnapCandidate, ViewportPlane } from './index.ts'

const PLANE: ViewportPlane = { normal: [0, 1, 0], distance: 0 }

const ctx = (overrides: Partial<PointResolveContext> & { candidate?: SnapCandidate }): PointResolveContext => ({
  plane: PLANE,
  planePosition: null,
  candidate: {},
  ...overrides,
})

const node = (id: number, position: readonly [number, number, number], onPlane = true, exact = onPlane) =>
  ({ id, position, onPlane, exact })
const member = (id: number, ratio: number, position: readonly [number, number, number], onPlane = true) =>
  ({ id, ratio, position, onPlane })

test('workplane mode prefers an exact on-plane node snap with its identity', () => {
  const point = resolveViewportPoint(ctx({
    candidate: { node: node(7, [1, 0, 2]) },
  }))
  assert.deepEqual(point, { position: [1, 0, 2], snappedNodeId: 7 })
})

test('an off-plane node never captures — the on-plane member point wins', () => {
  const point = resolveViewportPoint(ctx({
    candidate: {
      node: node(7, [1, 5, 2], false),
      member: member(11, 0.5, [3, 0, 4]),
    },
  }))
  assert.deepEqual(point, { position: [3, 0, 4], memberId: 11, memberRatio: 0.5 })
})

test('a near-plane projected node keeps its position but not its identity', () => {
  const point = resolveViewportPoint(ctx({
    candidate: { node: node(7, [1, 0.0002, 2], true, false) },
  }))
  assert.deepEqual(point, { position: [1, 0.0002, 2] })
})

test('without captures, the free plane point is accepted only under host defaults', () => {
  const free = resolveViewportPoint(ctx({ planePosition: [4, 0, 6] }))
  assert.deepEqual(free, { position: [4, 0, 6] })
  // An explicit snap list never falls through to a free point.
  const restricted = resolveViewportPoint(ctx({
    planePosition: [4, 0, 6],
    snap: ['node'],
  }))
  assert.equal(restricted, null)
})

test('explicit snap lists restrict which captures are allowed', () => {
  const gridOnly = resolveViewportPoint(ctx({
    candidate: {
      node: node(7, [1, 0, 2]),
      grid: [0, 0, 0],
    },
    snap: ['grid'],
  }))
  assert.deepEqual(gridOnly, { position: [0, 0, 0] })

  const nodeOnly = resolveViewportPoint(ctx({
    candidate: { grid: [0, 0, 0] },
    planePosition: [4, 0, 6],
    snap: ['node'],
  }))
  assert.equal(nodeOnly, null)
})

test('true 3D mode only accepts existing geometry — never grid or free points', () => {
  const spatial = resolveViewportPoint(ctx({
    plane: null,
    planePosition: [4, 0, 6],
    candidate: { grid: [0, 0, 0] },
  }))
  assert.equal(spatial, null)

  const onNode = resolveViewportPoint(ctx({
    plane: null,
    planePosition: [4, 0, 6],
    candidate: { node: node(7, [1, 0, 2]) },
  }))
  assert.deepEqual(onNode, { position: [1, 0, 2], snappedNodeId: 7 })

  const onMember = resolveViewportPoint(ctx({
    plane: null,
    candidate: { member: member(11, 0.5, [3, 0, 4]) },
  }))
  assert.deepEqual(onMember, { position: [3, 0, 4], memberId: 11, memberRatio: 0.5 })
})

test('endpoint is accepted as a node snap family', () => {
  const point = resolveViewportPoint(ctx({
    candidate: { node: node(7, [1, 0, 2]) },
    snap: ['endpoint'],
  }))
  assert.deepEqual(point, { position: [1, 0, 2], snappedNodeId: 7 })
})