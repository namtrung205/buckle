export type Vec3Tuple = readonly [number, number, number]

const subtract = (a: Vec3Tuple, b: Vec3Tuple): [number, number, number] =>
  [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3Tuple, b: Vec3Tuple) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3Tuple, b: Vec3Tuple): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const normalize = (value: Vec3Tuple): [number, number, number] => {
  const length = Math.hypot(value[0], value[1], value[2])
  if (length < 1e-10) throw new Error('Cannot normalize a zero-length vector')
  return [value[0] / length, value[1] / length, value[2] / length]
}
const scale = (value: Vec3Tuple, factor: number): [number, number, number] =>
  [value[0] * factor, value[1] * factor, value[2] * factor]
const add = (a: Vec3Tuple, b: Vec3Tuple): [number, number, number] =>
  [a[0] + b[0], a[1] + b[1], a[2] + b[2]]

/** CPU reference implementation mirrored by the thin-shell vertex shader. */
export const computeMemberFrame = (
  start: Vec3Tuple,
  end: Vec3Tuple,
  referenceAxis: Vec3Tuple,
  gammaRadians: number,
) => {
  const x = normalize(subtract(end, start))
  let projectedZ = subtract(referenceAxis, scale(x, dot(referenceAxis, x)))
  if (Math.hypot(...projectedZ) < 1e-7) {
    const fallback: Vec3Tuple = Math.abs(x[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
    projectedZ = subtract(fallback, scale(x, dot(fallback, x)))
  }
  const baseZ = normalize(projectedZ)
  const baseY = normalize(cross(baseZ, x))
  const cosine = Math.cos(gammaRadians)
  const sine = Math.sin(gammaRadians)
  const y = add(scale(baseY, cosine), scale(baseZ, sine))
  const z = add(scale(baseZ, cosine), scale(baseY, -sine))
  return { x, y, z }
}

