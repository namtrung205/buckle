import * as THREE from 'three'
import {
  type LoadArrowInstance,
  type LoadBandInstance,
  type LoadInstances,
  type Vec3,
  vecLength,
  vecNormalize,
  vecScale,
  vecSub,
} from '../Load/loadInstances.ts'

// The whole model's load set renders in THREE constant draw calls:
//   1. shafts  — one LineSegments (the line language of the legacy ArrowHelper)
//   2. heads   — one instanced cone template (mesh language, 12 segments)
//   3. bands   — one instanced quad template (semi-transparent load band)

const HEAD_RADIAL_SEGMENTS = 12 // legacy ArrowHelper used 5 — smoother silhouette at identical cost
const BAND_OPACITY = 0.3 // legacy MeshBasicMaterial opacity

const HEADS_VERTEX_SHADER = /* glsl */ `
  attribute vec3 iTip;
  attribute vec3 iDir;
  attribute vec2 iSize;
  attribute vec3 iColor;
  varying vec3 vColor;
  vec3 safePerpendicular(vec3 direction) {
    vec3 fallback = abs(direction.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 projected = fallback - direction * dot(fallback, direction);
    if (length(projected) < 0.000001) projected = vec3(1.0, 0.0, 0.0);
    return normalize(projected);
  }
  void main() {
    // Template cone: apex at (0, 1, 0), unit-radius base ring at y = 0.
    float axial = position.y;
    float radial = length(position.xz);
    vec3 base = iTip - iDir * iSize.x;
    vec3 side = safePerpendicular(iDir);
    vec3 up = cross(iDir, side);
    vec3 world = base
      + iDir * (axial * iSize.x)
      + (side * position.x + up * position.z) * radial * iSize.y;
    vColor = iColor;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`

const HEADS_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor, 1.0);
  }
`

const BANDS_VERTEX_SHADER = /* glsl */ `
  attribute vec3 iP0;
  attribute vec3 iP1;
  attribute vec3 iOffset;
  attribute vec3 iColor;
  varying vec3 vColor;
  void main() {
    // Template quad: position.x spans the member axis, position.y the offset.
    vec3 world = mix(iP0, iP1, position.x) + iOffset * position.y;
    vColor = iColor;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`

const BANDS_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor, uOpacity);
  }
`

/** Cone template matching the shader convention: base ring y=0 (radius 1), apex y=1. */
const createHeadTemplate = () => {
  const template = new THREE.ConeGeometry(1, 1, HEAD_RADIAL_SEGMENTS, 1)
  template.translate(0, 0.5, 0)
  return template
}

/** Quad template: position.x ∈ {0,1} along the member, position.y ∈ {0,1} along the offset. */
const createBandTemplate = () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0, 1, 0, 0, 1, 1, 0,
    0, 0, 0, 1, 1, 0, 0, 1, 0,
  ]), 3))
  return geometry
}

const invalidateInstanceCapacity = (geometry: THREE.InstancedBufferGeometry) => {
  // Three.js caches the maximum instance capacity after the first draw; growing
  // the batch must invalidate the cache or it silently skips new instances.
  delete (geometry as THREE.InstancedBufferGeometry & { _maxInstanceCount?: number })._maxInstanceCount
}

/** Arrow direction with a safe fallback for degenerate zero-length shafts. */
const shaftDirection = (arrow: LoadArrowInstance): Vec3 => {
  const direction = vecNormalize(vecSub(arrow.tip, arrow.origin))
  return vecLength(direction) < 1e-9 ? ([0, 1, 0] as Vec3) : direction
}

/**
 * Instanced GPU batch for every load visual in the model. Replaces the legacy
 * per-load ArrowHelper/quad objects (≈21 draw calls per loaded member) with a
 * constant 3-draw-call batch rebuilt from pure instance descriptors.
 */
export default class LoadGpuRenderer {
  readonly group = new THREE.Group()
  private readonly shaftGeometry = new THREE.BufferGeometry()
  private readonly headGeometry = new THREE.InstancedBufferGeometry()
  private readonly bandGeometry = new THREE.InstancedBufferGeometry()
  private readonly shaftMaterial: THREE.LineBasicMaterial
  private readonly headMaterial: THREE.ShaderMaterial
  private readonly bandMaterial: THREE.ShaderMaterial

  constructor(scene: THREE.Scene, layer: number) {
    this.shaftMaterial = new THREE.LineBasicMaterial({ vertexColors: true })
    const shafts = new THREE.LineSegments(this.shaftGeometry, this.shaftMaterial)
    shafts.name = 'LoadArrows:shafts'
    shafts.frustumCulled = false

    const headTemplate = createHeadTemplate()
    this.headGeometry.setAttribute('position', headTemplate.getAttribute('position'))
    this.headGeometry.setIndex(headTemplate.getIndex())
    this.headGeometry.instanceCount = 0
    this.headMaterial = new THREE.ShaderMaterial({
      vertexShader: HEADS_VERTEX_SHADER,
      fragmentShader: HEADS_FRAGMENT_SHADER,
    })
    const heads = new THREE.Mesh(this.headGeometry, this.headMaterial)
    heads.name = 'LoadArrows:heads'
    heads.frustumCulled = false

    this.bandGeometry.setAttribute('position', createBandTemplate().getAttribute('position'))
    this.bandGeometry.instanceCount = 0
    this.bandMaterial = new THREE.ShaderMaterial({
      vertexShader: BANDS_VERTEX_SHADER,
      fragmentShader: BANDS_FRAGMENT_SHADER,
      uniforms: { uOpacity: { value: BAND_OPACITY } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const bands = new THREE.Mesh(this.bandGeometry, this.bandMaterial)
    bands.name = 'LoadBands'
    bands.frustumCulled = false
    bands.renderOrder = 1

    this.group.add(shafts, heads, bands)
    this.group.name = 'LoadGpuRenderer'
    this.group.layers.set(layer)
    for (const object of [shafts, heads, bands]) object.layers.set(layer)
    this.group.visible = false
    scene.add(this.group)
  }

  /** Rebuilds every batch from pure instance descriptors. O(N) on load edits. */
  upload(instances: LoadInstances) {
    this.uploadShafts(instances.arrows)
    this.uploadHeads(instances.arrows)
    this.uploadBands(instances.bands)
  }

  private uploadShafts(arrows: readonly LoadArrowInstance[]) {
    const positions = new Float32Array(arrows.length * 6)
    const colors = new Float32Array(arrows.length * 6)
    arrows.forEach((arrow, index) => {
      // The shaft stops where the cone base begins — the ArrowHelper look.
      const shaftEnd = vecSub(arrow.tip, vecScale(shaftDirection(arrow), arrow.headLength))
      positions.set([...arrow.origin, ...shaftEnd], index * 6)
      colors.set([...arrow.color, ...arrow.color], index * 6)
    })
    this.shaftGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.shaftGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.shaftGeometry.setDrawRange(0, arrows.length * 2)
    if (arrows.length > 0) this.shaftGeometry.computeBoundingSphere()
  }

  private uploadHeads(arrows: readonly LoadArrowInstance[]) {
    const count = arrows.length
    const tips = new Float32Array(count * 3)
    const directions = new Float32Array(count * 3)
    const sizes = new Float32Array(count * 2)
    const colors = new Float32Array(count * 3)
    arrows.forEach((arrow, index) => {
      tips.set(arrow.tip, index * 3)
      directions.set(shaftDirection(arrow), index * 3)
      sizes.set([arrow.headLength, arrow.headWidth], index * 2)
      colors.set(arrow.color, index * 3)
    })
    this.headGeometry.setAttribute('iTip', new THREE.InstancedBufferAttribute(tips, 3))
    this.headGeometry.setAttribute('iDir', new THREE.InstancedBufferAttribute(directions, 3))
    this.headGeometry.setAttribute('iSize', new THREE.InstancedBufferAttribute(sizes, 2))
    this.headGeometry.setAttribute('iColor', new THREE.InstancedBufferAttribute(colors, 3))
    this.headGeometry.instanceCount = count
    invalidateInstanceCapacity(this.headGeometry)
  }

  private uploadBands(bands: readonly LoadBandInstance[]) {
    const count = bands.length
    const starts = new Float32Array(count * 3)
    const ends = new Float32Array(count * 3)
    const offsets = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    bands.forEach((band, index) => {
      starts.set(band.start, index * 3)
      ends.set(band.end, index * 3)
      offsets.set(band.offset, index * 3)
      colors.set(band.color, index * 3)
    })
    this.bandGeometry.setAttribute('iP0', new THREE.InstancedBufferAttribute(starts, 3))
    this.bandGeometry.setAttribute('iP1', new THREE.InstancedBufferAttribute(ends, 3))
    this.bandGeometry.setAttribute('iOffset', new THREE.InstancedBufferAttribute(offsets, 3))
    this.bandGeometry.setAttribute('iColor', new THREE.InstancedBufferAttribute(colors, 3))
    this.bandGeometry.instanceCount = count
    invalidateInstanceCapacity(this.bandGeometry)
  }

  /** Show/hide the whole load layer without touching any instance data. */
  setVisible(visible: boolean) {
    this.group.visible = visible
  }

  get arrowCount() {
    return this.headGeometry.instanceCount
  }

  get bandCount() {
    return this.bandGeometry.instanceCount
  }

  get shaftVertexCount() {
    return this.shaftGeometry.drawRange.count
  }

  getStats() {
    return { arrows: this.arrowCount, bands: this.bandCount, drawObjects: 3 }
  }

  dispose() {
    this.group.removeFromParent()
    this.shaftGeometry.dispose()
    this.headGeometry.dispose()
    this.bandGeometry.dispose()
    this.shaftMaterial.dispose()
    this.headMaterial.dispose()
    this.bandMaterial.dispose()
  }
}

