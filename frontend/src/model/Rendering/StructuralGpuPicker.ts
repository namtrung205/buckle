import * as THREE from 'three'
import { ENTITY_VISIBLE, type StructuralSceneDB } from './StructuralSceneDB.ts'
import type { StructuralPickResult } from './contracts.ts'

const PICK_VERTEX_SHADER = /* glsl */ `
  attribute vec3 instanceStart;
  attribute vec3 instanceEnd;
  attribute float instanceRenderIndex;
  attribute float instanceFlags;
  uniform vec2 viewportSize;
  uniform float lineWidthPx;
  varying float vRenderIndex;
  varying float vFlags;

  void main() {
    vec4 clipStart = projectionMatrix * viewMatrix * vec4(instanceStart, 1.0);
    vec4 clipEnd = projectionMatrix * viewMatrix * vec4(instanceEnd, 1.0);
    vec2 ndcStart = clipStart.xy / max(abs(clipStart.w), 0.000001);
    vec2 ndcEnd = clipEnd.xy / max(abs(clipEnd.w), 0.000001);
    vec2 pixelDirection = (ndcEnd - ndcStart) * viewportSize;
    float directionLength = length(pixelDirection);
    vec2 direction = directionLength > 0.000001 ? pixelDirection / directionLength : vec2(1.0, 0.0);
    vec2 perpendicular = vec2(-direction.y, direction.x);
    vec4 clipPosition = position.x < 0.5 ? clipStart : clipEnd;
    vec2 pixelOffset = perpendicular * position.y * lineWidthPx;
    clipPosition.xy += pixelOffset * (2.0 / viewportSize) * clipPosition.w;
    gl_Position = clipPosition;
    vRenderIndex = instanceRenderIndex;
    vFlags = instanceFlags;
  }
`

const PICK_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  varying float vRenderIndex;
  varying float vFlags;
  bool hasFlag(float value, float flag) { return mod(floor(value / flag), 2.0) > 0.5; }
  void main() {
    if (!hasFlag(vFlags, 1.0)) discard;
    float value = vRenderIndex + 1.0;
    float r = mod(value, 256.0);
    float g = mod(floor(value / 256.0), 256.0);
    float b = mod(floor(value / 65536.0), 256.0);
    gl_FragColor = vec4(r, g, b, 255.0) / 255.0;
  }
`

const PICK_NODE_VERTEX_SHADER = /* glsl */ `
  attribute float instanceRenderIndex;
  attribute float instanceFlags;
  uniform float pointSizePx;
  varying float vRenderIndex;
  varying float vFlags;

  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = pointSizePx;
    vRenderIndex = instanceRenderIndex;
    vFlags = instanceFlags;
  }
`

const PICK_NODE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  varying float vRenderIndex;
  varying float vFlags;
  bool hasFlag(float value, float flag) { return mod(floor(value / flag), 2.0) > 0.5; }
  void main() {
    if (!hasFlag(vFlags, 1.0)) discard;
    vec2 centered = gl_PointCoord * 2.0 - 1.0;
    if (dot(centered, centered) > 1.0) discard;
    float value = vRenderIndex + 1.0;
    float r = mod(value, 256.0);
    float g = mod(floor(value / 256.0), 256.0);
    float b = mod(floor(value / 65536.0), 256.0);
    gl_FragColor = vec4(r, g, b, 255.0) / 255.0;
  }
`

const QUAD_POSITIONS = new Float32Array([
  0, -1, 0, 1, -1, 0, 1, 1, 0,
  0, -1, 0, 1, 1, 0, 0, 1, 0,
])

export const decodeRenderIndex = (pixel: ArrayLike<number>) => {
  const encoded = pixel[0] + pixel[1] * 256 + pixel[2] * 65536
  return encoded === 0 ? null : encoded - 1
}

export type StructuralPickBuffers = {
  starts: Float32Array
  ends: Float32Array
  renderIndices: Float32Array
  flags: Float32Array
  nodePositions: Float32Array
  nodeRenderIndices: Float32Array
  nodeFlags: Float32Array
}

export const buildStructuralPickBuffers = (database: StructuralSceneDB): StructuralPickBuffers => {
  const starts = new Float32Array(database.memberCount * 3)
  const ends = new Float32Array(database.memberCount * 3)
  const renderIndices = new Float32Array(database.memberCount)
  const flags = new Float32Array(database.memberCount)
  const nodePositions = new Float32Array(database.nodeCount * 3)
  const nodeRenderIndices = new Float32Array(database.nodeCount)
  const nodeFlags = new Float32Array(database.nodeCount)
  for (let index = 0; index < database.memberCount; index++) {
    starts.set(database.memberEndpoints.subarray(index * 6, index * 6 + 3), index * 3)
    ends.set(database.memberEndpoints.subarray(index * 6 + 3, index * 6 + 6), index * 3)
    renderIndices[index] = index
    flags[index] = database.memberFlags[index]
  }
  for (let index = 0; index < database.nodeCount; index++) {
    nodePositions.set(database.nodePositions.subarray(index * 3, index * 3 + 3), index * 3)
    nodeRenderIndices[index] = index
    nodeFlags[index] = database.nodeFlags[index]
  }
  return { starts, ends, renderIndices, flags, nodePositions, nodeRenderIndices, nodeFlags }
}

type SpatialChunk = { first: number; count: number; box: THREE.Box3 }

/** CPU rectangle query performed only on pointer-up. Spatial chunks reject most
 * members before endpoint projection; pointer-move picking remains GPU-only. */
export class StructuralWindowSelector {
  private database: StructuralSceneDB | null = null
  private chunks: SpatialChunk[] = []

  upload(database: StructuralSceneDB, chunkSize = 256) {
    this.database = database
    this.chunks = []
    for (let first = 0; first < database.memberCount; first += chunkSize) {
      const count = Math.min(chunkSize, database.memberCount - first)
      const box = new THREE.Box3()
      for (let index = first; index < first + count; index++) {
        const offset = index * 6
        box.expandByPoint(new THREE.Vector3().fromArray(database.memberEndpoints, offset))
        box.expandByPoint(new THREE.Vector3().fromArray(database.memberEndpoints, offset + 3))
      }
      this.chunks.push({ first, count, box })
    }
  }

  select(camera: THREE.Camera, start: { x: number; y: number }, end: { x: number; y: number }) {
    const database = this.database
    if (!database) return []
    camera.updateMatrixWorld()
    const minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x)
    const minY = Math.min(start.y, end.y), maxY = Math.max(start.y, end.y)
    const crossing = end.x < start.x
    const result: number[] = []
    for (const chunk of this.chunks) {
      if (!projectedBoxIntersects(chunk.box, camera, minX, minY, maxX, maxY)) continue
      for (let index = chunk.first; index < chunk.first + chunk.count; index++) {
        if (!(database.memberFlags[index] & ENTITY_VISIBLE)) continue
        const offset = index * 6
        const a = new THREE.Vector3().fromArray(database.memberEndpoints, offset).project(camera)
        const b = new THREE.Vector3().fromArray(database.memberEndpoints, offset + 3).project(camera)
        if ((a.z < -1 && b.z < -1) || (a.z > 1 && b.z > 1)) continue
        const aInside = pointInside(a.x, a.y, minX, minY, maxX, maxY)
        const bInside = pointInside(b.x, b.y, minX, minY, maxX, maxY)
        const selected = crossing
          ? aInside || bInside || segmentIntersectsRect(a.x, a.y, b.x, b.y, minX, minY, maxX, maxY)
          : aInside && bInside
        if (selected) result.push(database.memberIds[index])
      }
    }
    return result
  }

  selectNodes(camera: THREE.Camera, start: { x: number; y: number }, end: { x: number; y: number }) {
    const database = this.database
    if (!database) return []
    camera.updateMatrixWorld()
    const minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x)
    const minY = Math.min(start.y, end.y), maxY = Math.max(start.y, end.y)
    const result: number[] = []
    for (let index = 0; index < database.nodeCount; index++) {
      if (!(database.nodeFlags[index] & ENTITY_VISIBLE)) continue
      const point = new THREE.Vector3().fromArray(database.nodePositions, index * 3).project(camera)
      if (point.z < -1 || point.z > 1) continue
      if (pointInside(point.x, point.y, minX, minY, maxX, maxY)) result.push(database.nodeIds[index])
    }
    return result
  }
}

const pointInside = (x: number, y: number, minX: number, minY: number, maxX: number, maxY: number) =>
  x >= minX && x <= maxX && y >= minY && y <= maxY

const segmentIntersectsRect = (
  ax: number, ay: number, bx: number, by: number,
  minX: number, minY: number, maxX: number, maxY: number,
) => {
  let t0 = 0, t1 = 1
  const dx = bx - ax, dy = by - ay
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0
    const r = q / p
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r }
    else { if (r < t0) return false; if (r < t1) t1 = r }
    return true
  }
  return clip(-dx, ax - minX) && clip(dx, maxX - ax) && clip(-dy, ay - minY) && clip(dy, maxY - ay)
}

const projectedBoxIntersects = (
  box: THREE.Box3, camera: THREE.Camera,
  minX: number, minY: number, maxX: number, maxY: number,
) => {
  let projectedMinX = Infinity, projectedMinY = Infinity
  let projectedMaxX = -Infinity, projectedMaxY = -Infinity
  for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) {
    const point = new THREE.Vector3(
      x ? box.max.x : box.min.x,
      y ? box.max.y : box.min.y,
      z ? box.max.z : box.min.z,
    ).project(camera)
    projectedMinX = Math.min(projectedMinX, point.x); projectedMaxX = Math.max(projectedMaxX, point.x)
    projectedMinY = Math.min(projectedMinY, point.y); projectedMaxY = Math.max(projectedMaxY, point.y)
  }
  return projectedMaxX >= minX && projectedMinX <= maxX && projectedMaxY >= minY && projectedMinY <= maxY
}

/** One offscreen draw encodes dense render indices. The texture is reused while
 * camera/model state is unchanged, so pointer sweeps normally perform readback
 * only rather than an extra render per event. */
export default class StructuralGpuPicker {
  readonly geometry = new THREE.InstancedBufferGeometry()
  readonly scene = new THREE.Scene()
  readonly mesh: THREE.Mesh
  readonly nodeGeometry = new THREE.BufferGeometry()
  readonly nodePoints: THREE.Points
  readonly windowSelector = new StructuralWindowSelector()
  private readonly target = new THREE.WebGLRenderTarget(1, 1, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
    stencilBuffer: false,
  })
  private readonly pixel = new Uint8Array(4)
  private database: StructuralSceneDB | null = null
  private flags = new Float32Array(0)
  private nodeFlags = new Float32Array(0)
  private signature = ''
  private dirty = true
  private readonly renderer: THREE.WebGLRenderer

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    this.target.texture.colorSpace = THREE.NoColorSpace
    this.geometry.setAttribute('position', new THREE.BufferAttribute(QUAD_POSITIONS, 3))
    const material = new THREE.ShaderMaterial({
      vertexShader: PICK_VERTEX_SHADER,
      fragmentShader: PICK_FRAGMENT_SHADER,
      uniforms: {
        viewportSize: { value: new THREE.Vector2(1, 1) },
        lineWidthPx: { value: 6 },
      },
      blending: THREE.NoBlending,
      depthTest: true,
      depthWrite: true,
      toneMapped: false,
    })
    this.mesh = new THREE.Mesh(this.geometry, material)
    this.mesh.frustumCulled = false
    const nodeMaterial = new THREE.ShaderMaterial({
      vertexShader: PICK_NODE_VERTEX_SHADER,
      fragmentShader: PICK_NODE_FRAGMENT_SHADER,
      uniforms: { pointSizePx: { value: 14 } },
      blending: THREE.NoBlending,
      depthTest: true,
      depthWrite: true,
      toneMapped: false,
    })
    this.nodePoints = new THREE.Points(this.nodeGeometry, nodeMaterial)
    this.nodePoints.frustumCulled = false
    this.nodePoints.visible = false
    this.scene.add(this.mesh, this.nodePoints)
  }

  upload(database: StructuralSceneDB) {
    this.database = database
    const buffers = buildStructuralPickBuffers(database)
    this.flags = buffers.flags
    this.nodeFlags = buffers.nodeFlags
    this.geometry.setAttribute('instanceStart', new THREE.InstancedBufferAttribute(buffers.starts, 3))
    this.geometry.setAttribute('instanceEnd', new THREE.InstancedBufferAttribute(buffers.ends, 3))
    this.geometry.setAttribute('instanceRenderIndex', new THREE.InstancedBufferAttribute(buffers.renderIndices, 1))
    this.geometry.setAttribute('instanceFlags', new THREE.InstancedBufferAttribute(buffers.flags, 1))
    delete (this.geometry as THREE.InstancedBufferGeometry & { _maxInstanceCount?: number })._maxInstanceCount
    this.geometry.instanceCount = database.memberCount
    this.nodeGeometry.setAttribute('position', new THREE.BufferAttribute(buffers.nodePositions, 3))
    this.nodeGeometry.setAttribute('instanceRenderIndex', new THREE.BufferAttribute(buffers.nodeRenderIndices, 1))
    this.nodeGeometry.setAttribute('instanceFlags', new THREE.BufferAttribute(buffers.nodeFlags, 1))
    this.nodeGeometry.setDrawRange(0, database.nodeCount)
    this.windowSelector.upload(database)
    this.invalidate()
  }

  syncMemberState(entityId: number) {
    const index = this.database?.memberIndexById.get(entityId)
    if (index === undefined || !this.database) return
    this.flags[index] = this.database.memberFlags[index]
    ;(this.geometry.getAttribute('instanceFlags') as THREE.InstancedBufferAttribute).needsUpdate = true
    this.invalidate()
  }

  syncNodeState(entityId: number) {
    const index = this.database?.nodeIndexById.get(entityId)
    if (index === undefined || !this.database) return
    this.nodeFlags[index] = this.database.nodeFlags[index]
    ;(this.nodeGeometry.getAttribute('instanceFlags') as THREE.BufferAttribute).needsUpdate = true
    this.invalidate()
  }

  invalidate() { this.dirty = true }

  /** Compile and populate the ID target during model loading, avoiding a shader
   * compilation hitch on the user's first hover/click. */
  warmup(camera: THREE.Camera) {
    this.pick(-1, -1, camera, 'member')
    this.pick(-1, -1, camera, 'node')
  }

  pick(ndcX: number, ndcY: number, camera: THREE.Camera, kind: 'member' | 'node' = 'member'): StructuralPickResult | null {
    const database = this.database
    const count = kind === 'member' ? database?.memberCount ?? 0 : database?.nodeCount ?? 0
    if (!database || count === 0) return null
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2())
    const width = Math.max(1, Math.floor(size.x)), height = Math.max(1, Math.floor(size.y))
    const signature = `${kind}:${width}:${height}:${camera.projectionMatrix.elements.join(',')}:${camera.matrixWorld.elements.join(',')}`
    if (this.dirty || signature !== this.signature || this.target.width !== width || this.target.height !== height) {
      this.target.setSize(width, height)
      ;(this.mesh.material as THREE.ShaderMaterial).uniforms.viewportSize.value.set(width, height)
      const previousTarget = this.renderer.getRenderTarget()
      const previousClearColor = this.renderer.getClearColor(new THREE.Color()).clone()
      const previousClearAlpha = this.renderer.getClearAlpha()
      this.renderer.setRenderTarget(this.target)
      this.mesh.visible = kind === 'member'
      this.nodePoints.visible = kind === 'node'
      this.renderer.setClearColor(0x000000, 0)
      this.renderer.clear(true, true, false)
      this.renderer.render(this.scene, camera)
      this.renderer.setRenderTarget(previousTarget)
      this.renderer.setClearColor(previousClearColor, previousClearAlpha)
      this.signature = signature
      this.dirty = false
    }
    const x = THREE.MathUtils.clamp(Math.floor((ndcX + 1) * 0.5 * width), 0, width - 1)
    const y = THREE.MathUtils.clamp(Math.floor((ndcY + 1) * 0.5 * height), 0, height - 1)
    this.renderer.readRenderTargetPixels(this.target, x, y, 1, 1, this.pixel)
    const renderIndex = decodeRenderIndex(this.pixel)
    if (renderIndex === null || renderIndex >= count) return null
    const flags = kind === 'member' ? database.memberFlags : database.nodeFlags
    const ids = kind === 'member' ? database.memberIds : database.nodeIds
    if (!(flags[renderIndex] & ENTITY_VISIBLE)) return null
    return { renderIndex, entityId: ids[renderIndex] }
  }

  dispose() {
    this.geometry.dispose()
    this.nodeGeometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    ;(this.nodePoints.material as THREE.Material).dispose()
    this.target.dispose()
  }
}
