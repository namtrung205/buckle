export type ThinShellTemplate = {
  positions: Float32Array
  normals: Float32Array
  thicknessWeights: Float32Array
  vertexCount: number
}

type TemplateVertex = {
  u: number
  b: number
  h: number
  t1: number
  t2: number
  ny: number
  nz: number
}

const vertex = (u: number, b: number, h: number, t1: number, t2: number, ny: number, nz: number): TemplateVertex =>
  ({ u, b, h, t1, t2, ny, nz })

const pushQuad = (target: TemplateVertex[], a: TemplateVertex, b: TemplateVertex, c: TemplateVertex, d: TemplateVertex) =>
  target.push(a, b, d, b, c, d)

const face = (
  target: TemplateVertex[],
  y0: [number, number], z0: [number, number],
  y1: [number, number], z1: [number, number],
  ny: number, nz: number,
) => pushQuad(
  target,
  vertex(0, y0[0], z0[0], y0[1], z0[1], ny, nz),
  vertex(1, y0[0], z0[0], y0[1], z0[1], ny, nz),
  vertex(1, y1[0], z1[0], y1[1], z1[1], ny, nz),
  vertex(0, y1[0], z1[0], y1[1], z1[1], ny, nz),
)

const pack = (vertices: TemplateVertex[]): ThinShellTemplate => {
  const positions = new Float32Array(vertices.length * 3)
  const normals = new Float32Array(vertices.length * 3)
  const thicknessWeights = new Float32Array(vertices.length * 2)
  vertices.forEach((item, index) => {
    positions.set([item.u, item.b, item.h], index * 3)
    normals.set([0, item.ny, item.nz], index * 3)
    thicknessWeights.set([item.t1, item.t2], index * 2)
  })
  return { positions, normals, thicknessWeights, vertexCount: vertices.length }
}

/** h,b,t1=tw,t2=tf. */
export const createHThinShellTemplate = (): ThinShellTemplate => {
  const vertices: TemplateVertex[] = []
  face(vertices, [-.5, 0], [.5, 0], [.5, 0], [.5, 0], 0, 1)
  face(vertices, [-.5, 0], [.5, -1], [.5, 0], [.5, -1], 0, -1)
  face(vertices, [-.5, 0], [-.5, 0], [.5, 0], [-.5, 0], 0, -1)
  face(vertices, [-.5, 0], [-.5, 1], [.5, 0], [-.5, 1], 0, 1)
  face(vertices, [0, -.5], [-.5, 1], [0, -.5], [.5, -1], -1, 0)
  face(vertices, [0, .5], [-.5, 1], [0, .5], [.5, -1], 1, 0)
  return pack(vertices)
}

/** Channel opens toward +Y; h,b,t1=tw,t2=tf. */
export const createChannelThinShellTemplate = (): ThinShellTemplate => {
  const vertices: TemplateVertex[] = []
  face(vertices, [-.5, 0], [.5, 0], [.5, 0], [.5, 0], 0, 1)
  face(vertices, [-.5, 1], [.5, -1], [.5, 0], [.5, -1], 0, -1)
  face(vertices, [-.5, 0], [-.5, 0], [.5, 0], [-.5, 0], 0, -1)
  face(vertices, [-.5, 1], [-.5, 1], [.5, 0], [-.5, 1], 0, 1)
  face(vertices, [-.5, 0], [-.5, 1], [-.5, 0], [.5, -1], -1, 0)
  face(vertices, [-.5, 1], [-.5, 1], [-.5, 1], [.5, -1], 1, 0)
  return pack(vertices)
}

/** Equal/unequal angle anchored at the -Y/-Z corner; h,b,t1=t2=thickness. */
export const createAngleThinShellTemplate = (): ThinShellTemplate => {
  const vertices: TemplateVertex[] = []
  face(vertices, [-.5, 0], [-.5, 0], [-.5, 0], [.5, 0], -1, 0)
  face(vertices, [-.5, 1], [-.5, 1], [-.5, 1], [.5, 0], 1, 0)
  face(vertices, [-.5, 0], [-.5, 0], [.5, 0], [-.5, 0], 0, -1)
  face(vertices, [-.5, 1], [-.5, 1], [.5, 0], [-.5, 1], 0, 1)
  return pack(vertices)
}

/** Rectangular hollow section; h,b,t1=t2=wall thickness. */
export const createBoxThinShellTemplate = (): ThinShellTemplate => {
  const vertices: TemplateVertex[] = []
  // Outer perimeter.
  face(vertices, [-.5, 0], [-.5, 0], [-.5, 0], [.5, 0], -1, 0)
  face(vertices, [.5, 0], [-.5, 0], [.5, 0], [.5, 0], 1, 0)
  face(vertices, [-.5, 0], [-.5, 0], [.5, 0], [-.5, 0], 0, -1)
  face(vertices, [-.5, 0], [.5, 0], [.5, 0], [.5, 0], 0, 1)
  // Inner perimeter; corrected inward normals.
  face(vertices, [-.5, 1], [-.5, 1], [-.5, 1], [.5, -1], 1, 0)
  face(vertices, [.5, -1], [-.5, 1], [.5, -1], [.5, -1], -1, 0)
  face(vertices, [-.5, 1], [-.5, 1], [.5, -1], [-.5, 1], 0, 1)
  face(vertices, [-.5, 1], [.5, -1], [.5, -1], [.5, -1], 0, -1)
  return pack(vertices)
}

/** Circular thin-shell surface; diameter is supplied as both h and b. */
export const createPipeThinShellTemplate = (segments: number): ThinShellTemplate => {
  const vertices: TemplateVertex[] = []
  const count = Math.max(6, Math.floor(segments))
  for (let index = 0; index < count; index++) {
    const a = index * Math.PI * 2 / count
    const b = (index + 1) * Math.PI * 2 / count
    const ay = Math.cos(a) * .5
    const az = Math.sin(a) * .5
    const by = Math.cos(b) * .5
    const bz = Math.sin(b) * .5
    pushQuad(vertices,
      vertex(0, ay, az, 0, 0, Math.cos(a), Math.sin(a)),
      vertex(1, ay, az, 0, 0, Math.cos(a), Math.sin(a)),
      vertex(1, by, bz, 0, 0, Math.cos(b), Math.sin(b)),
      vertex(0, by, bz, 0, 0, Math.cos(b), Math.sin(b)))
  }
  return pack(vertices)
}

/** Longitudinal ribbons following a normalized custom open/closed contour. */
export const createCustomThinShellTemplate = (
  coordinates: ArrayLike<number>,
  closed: boolean,
): ThinShellTemplate & { dimensions: readonly [number, number, number, number] } => {
  if (coordinates.length < 4 || coordinates.length % 2 !== 0) {
    throw new Error('Custom thin-shell contour requires at least two [y,z] points')
  }
  const points: Array<[number, number]> = []
  for (let index = 0; index < coordinates.length; index += 2) points.push([coordinates[index], coordinates[index + 1]])
  const ys = points.map(point => point[0])
  const zs = points.map(point => point[1])
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const minZ = Math.min(...zs), maxZ = Math.max(...zs)
  const width = Math.max(maxY - minY, 1e-9)
  const height = Math.max(maxZ - minZ, 1e-9)
  const centerY = (minY + maxY) * .5
  const centerZ = (minZ + maxZ) * .5
  const vertices: TemplateVertex[] = []
  const edgeCount = closed ? points.length : points.length - 1
  for (let edge = 0; edge < edgeCount; edge++) {
    const a = points[edge]
    const b = points[(edge + 1) % points.length]
    const dy = b[0] - a[0], dz = b[1] - a[1]
    const inverseLength = 1 / Math.max(Math.hypot(dy, dz), 1e-9)
    const ny = -dz * inverseLength, nz = dy * inverseLength
    pushQuad(vertices,
      vertex(0, (a[0] - centerY) / width, (a[1] - centerZ) / height, 0, 0, ny, nz),
      vertex(1, (a[0] - centerY) / width, (a[1] - centerZ) / height, 0, 0, ny, nz),
      vertex(1, (b[0] - centerY) / width, (b[1] - centerZ) / height, 0, 0, ny, nz),
      vertex(0, (b[0] - centerY) / width, (b[1] - centerZ) / height, 0, 0, ny, nz))
  }
  return { ...pack(vertices), dimensions: [height, width, 0, 0] }
}
