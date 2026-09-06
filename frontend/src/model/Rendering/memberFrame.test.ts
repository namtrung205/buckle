import assert from 'node:assert/strict'
import test from 'node:test'
import { computeMemberFrame, type Vec3Tuple } from './memberFrame.ts'

const EPSILON = 1e-6
const close = (actual: readonly number[], expected: readonly number[], epsilon = EPSILON) => {
  assert.equal(actual.length, expected.length)
  actual.forEach((value, index) => assert.ok(
    Math.abs(value - expected[index]) <= epsilon,
    `component ${index}: expected ${expected[index]}, received ${value}`,
  ))
}
const dot = (a: Vec3Tuple, b: Vec3Tuple) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

test('horizontal H profile has golden gamma orientations at 0/37/90/180 degrees', () => {
  const degrees = (value: number) => value * Math.PI / 180
  const c37 = Math.cos(degrees(37))
  const s37 = Math.sin(degrees(37))
  const cases = [
    { gamma: 0, y: [0, 1, 0], z: [0, 0, 1] },
    { gamma: 37, y: [0, c37, s37], z: [0, -s37, c37] },
    { gamma: 90, y: [0, 0, 1], z: [0, -1, 0] },
    { gamma: 180, y: [0, -1, 0], z: [0, 0, -1] },
  ]
  for (const fixture of cases) {
    const frame = computeMemberFrame([0, 0, 0], [5, 0, 0], [0, 0, 1], degrees(fixture.gamma))
    close(frame.x, [1, 0, 0])
    close(frame.y, fixture.y)
    close(frame.z, fixture.z)
  }
})

test('vertical, skew and reversed members stay orthonormal for all golden gamma angles', () => {
  const members: Array<{ start: Vec3Tuple; end: Vec3Tuple; reference: Vec3Tuple }> = [
    { start: [0, 0, 0], end: [0, 5, 0], reference: [0, 1, 0] },
    { start: [1, 2, 3], end: [5, 7, 11], reference: [0, 0, 1] },
    { start: [5, 0, 0], end: [0, 0, 0], reference: [0, 0, 1] },
  ]
  for (const member of members) {
    for (const gamma of [0, 37, 90, 180]) {
      const frame = computeMemberFrame(member.start, member.end, member.reference, gamma * Math.PI / 180)
      close([dot(frame.x, frame.x), dot(frame.y, frame.y), dot(frame.z, frame.z)], [1, 1, 1])
      close([dot(frame.x, frame.y), dot(frame.x, frame.z), dot(frame.y, frame.z)], [0, 0, 0])
      close(cross(frame.x, frame.y), frame.z)
    }
  }
})

test('parallel reference axis uses deterministic vertical-member fallback', () => {
  const frame = computeMemberFrame([0, 0, 0], [0, 5, 0], [0, 1, 0], 0)
  close(frame.x, [0, 1, 0])
  close(frame.y, [0, 0, 1])
  close(frame.z, [1, 0, 0])
})
