export type ThinShellTemplate = {
  positions: Float32Array
  normals: Float32Array
  thicknessWeights: Float32Array
  edgePositions: Float32Array
  edgeThicknessWeights: Float32Array
  vertexCount: number
  edgeVertexCount: number
}

type TemplateVertex = {
  u: number
  b: number
  h: number
  t1: number
  t2: number
  nx: number
  ny: number
  nz: number
}

const vertex = (u: number, b: number, h: number, t1: number, t2: number, ny: number, nz: number, nx = 0): TemplateVertex =>
  ({ u, b, h, t1, t2, nx, ny, nz })

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

type CrossSectionPoint = readonly [b: number, h: number, t1: number, t2: number]
const capFace = (target: TemplateVertex[], u: 0 | 1, points: readonly [CrossSectionPoint, CrossSectionPoint, CrossSectionPoint, CrossSectionPoint]) => {
  const nx = u === 0 ? -1 : 1
  pushQuad(target, ...points.map(point => vertex(u, point[0], point[1], point[2], point[3], 0, 0, nx)) as [TemplateVertex, TemplateVertex, TemplateVertex, TemplateVertex])
}
const capBoth = (target: TemplateVertex[], points: readonly [CrossSectionPoint, CrossSectionPoint, CrossSectionPoint, CrossSectionPoint]) => {
  capFace(target, 0, points)
  capFace(target, 1, points)
}

const keyOf = (item: TemplateVertex) => `${item.u}/${item.b}/${item.h}/${item.t1}/${item.t2}`
const packEdges = (vertices: TemplateVertex[]) => {
  const edges = new Map<string, readonly [TemplateVertex, TemplateVertex]>()
  for (let offset = 0; offset < vertices.length; offset += 6) {
    const corners = [vertices[offset], vertices[offset + 1], vertices[offset + 4], vertices[offset + 2]]
    for (let edge = 0; edge < 4; edge++) {
      const a = corners[edge], b = corners[(edge + 1) % 4]
      const ka = keyOf(a), kb = keyOf(b)
      edges.set(ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`, [a, b])
    }
  }
  const positions = new Float32Array(edges.size * 6)
  const thicknessWeights = new Float32Array(edges.size * 4)
  let index = 0
  for (const [a, b] of edges.values()) {
    positions.set([a.u, a.b, a.h, b.u, b.b, b.h], index * 6)
    thicknessWeights.set([a.t1, a.t2, b.t1, b.t2], index * 4)
    index++
  }
  return { positions, thicknessWeights, vertexCount: edges.size * 2 }
}

const pack = (vertices: TemplateVertex[]): ThinShellTemplate => {
  const positions = new Float32Array(vertices.length * 3)
  const normals = new Float32Array(vertices.length * 3)
  const thicknessWeights = new Float32Array(vertices.length * 2)
  vertices.forEach((item, index) => {
    positions.set([item.u, item.b, item.h], index * 3)
    normals.set([item.nx, item.ny, item.nz], index * 3)
    thicknessWeights.set([item.t1, item.t2], index * 2)
  })
  const edges = packEdges(vertices)
  return {
    positions, normals, thicknessWeights,
    edgePositions: edges.positions,
    edgeThicknessWeights: edges.thicknessWeights,
    vertexCount: vertices.length,
    edgeVertexCount: edges.vertexCount,
  }
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
  // Flange edge faces (vertical tip faces of height tf) close the profile sides.
  face(vertices, [-.5, 0], [.5, -1], [-.5, 0], [.5, 0], -1, 0)
  face(vertices, [.5, 0], [.5, 0], [.5, 0], [.5, -1], 1, 0)
  face(vertices, [-.5, 0], [-.5, 0], [-.5, 0], [-.5, 1], -1, 0)
  face(vertices, [.5, 0], [-.5, 1], [.5, 0], [-.5, 0], 1, 0)
  capBoth(vertices, [[-.5, .5, 0, 0], [.5, .5, 0, 0], [.5, .5, 0, -1], [-.5, .5, 0, -1]])
  capBoth(vertices, [[-.5, -.5, 0, 1], [.5, -.5, 0, 1], [.5, -.5, 0, 0], [-.5, -.5, 0, 0]])
  capBoth(vertices, [[0, -.5, -.5, 1], [0, .5, -.5, 1], [0, .5, .5, -1], [0, -.5, .5, -1]])
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
  // Flange tip faces at the open +Y edge (height tf).
  face(vertices, [.5, 0], [.5, 0], [.5, 0], [.5, -1], 1, 0)
  face(vertices, [.5, 0], [-.5, 1], [.5, 0], [-.5, 0], 1, 0)
  capBoth(vertices, [[-.5, .5, 1, 0], [.5, .5, 0, 0], [.5, .5, 0, -1], [-.5, .5, 1, -1]])
  capBoth(vertices, [[-.5, -.5, 1, 1], [.5, -.5, 0, 1], [.5, -.5, 0, 0], [-.5, -.5, 1, 0]])
  capBoth(vertices, [[-.5, -.5, 0, 1], [-.5, -.5, 1, 1], [-.5, .5, 1, -1], [-.5, .5, 0, -1]])
  return pack(vertices)
}

/** Equal/unequal angle anchored at the -Y/-Z corner; h,b,t1=t2=thickness. */
export const createAngleThinShellTemplate = (): ThinShellTemplate => {
  const vertices: TemplateVertex[] = []
  face(vertices, [-.5, 0], [-.5, 0], [-.5, 0], [.5, 0], -1, 0)
  face(vertices, [-.5, 1], [-.5, 1], [-.5, 1], [.5, 0], 1, 0)
  face(vertices, [-.5, 0], [-.5, 0], [.5, 0], [-.5, 0], 0, -1)
  face(vertices, [-.5, 1], [-.5, 1], [.5, 0], [-.5, 1], 0, 1)
  // Leg tip faces (thickness t) close the L profile sides.
  face(vertices, [-.5, 0], [.5, 0], [-.5, 1], [.5, 0], 0, 1)
  face(vertices, [.5, 0], [-.5, 1], [.5, 0], [-.5, 0], 1, 0)
  capBoth(vertices, [[-.5, -.5, 0, 0], [-.5, -.5, 1, 0], [-.5, .5, 1, 0], [-.5, .5, 0, 0]])
  capBoth(vertices, [[-.5, -.5, 0, 0], [.5, -.5, 0, 0], [.5, -.5, 0, 1], [-.5, -.5, 0, 1]])
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
  // Four end-wall rectangles preserve the hollow opening.
  capBoth(vertices, [[-.5, -.5, 0, 0], [-.5, .5, 0, 0], [-.5, .5, 1, -1], [-.5, -.5, 1, 1]])
  capBoth(vertices, [[.5, -.5, -1, 1], [.5, .5, -1, -1], [.5, .5, 0, 0], [.5, -.5, 0, 0]])
  capBoth(vertices, [[-.5, .5, 1, -1], [.5, .5, -1, -1], [.5, .5, 0, 0], [-.5, .5, 0, 0]])
  capBoth(vertices, [[-.5, -.5, 0, 0], [.5, -.5, 0, 0], [.5, -.5, -1, 1], [-.5, -.5, 1, 1]])
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
    // Inner wall and annular end caps. Thickness weights move the same
    // normalized circle inward by the physical pipe wall thickness.
    pushQuad(vertices,
      vertex(0, ay, az, -Math.cos(a), -Math.sin(a), -Math.cos(a), -Math.sin(a)),
      vertex(0, by, bz, -Math.cos(b), -Math.sin(b), -Math.cos(b), -Math.sin(b)),
      vertex(1, by, bz, -Math.cos(b), -Math.sin(b), -Math.cos(b), -Math.sin(b)),
      vertex(1, ay, az, -Math.cos(a), -Math.sin(a), -Math.cos(a), -Math.sin(a)))
    const outerA: CrossSectionPoint = [ay, az, 0, 0]
    const outerB: CrossSectionPoint = [by, bz, 0, 0]
    const innerB: CrossSectionPoint = [by, bz, -Math.cos(b), -Math.sin(b)]
    const innerA: CrossSectionPoint = [ay, az, -Math.cos(a), -Math.sin(a)]
    capFace(vertices, 0, [outerA, outerB, innerB, innerA])
    capFace(vertices, 1, [outerA, innerA, innerB, outerB])
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
