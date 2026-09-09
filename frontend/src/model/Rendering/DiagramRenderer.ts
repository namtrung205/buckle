import * as THREE from 'three'
import type { ResultBinding } from './ResultStore.ts'
import { ENTITY_HOVERED, ENTITY_SELECTED, ENTITY_VISIBLE, type StructuralSceneDB } from './StructuralSceneDB.ts'
import { computeMemberFrame, type Vec3Tuple } from './memberFrame.ts'

export const DIAGRAM_STATION_COUNT = 20

const FRAME_GLSL = /* glsl */ `
  bool hasFlag(float value, float flag) { return mod(floor(value / flag), 2.0) > 0.5; }
  vec3 safeReference(vec3 axisX, vec3 referenceAxis) {
    vec3 projected = referenceAxis - axisX * dot(referenceAxis, axisX);
    if (length(projected) < 0.000001) {
      vec3 fallbackAxis = abs(axisX.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      projected = fallbackAxis - axisX * dot(fallbackAxis, axisX);
    }
    return normalize(projected);
  }
  float resultTexel(sampler2D sourceTexture, float linearIndex) {
    float x = mod(linearIndex, resultTextureSize.x);
    float y = floor(linearIndex / resultTextureSize.x);
    return texture2D(sourceTexture, (vec2(x, y) + 0.5) / resultTextureSize).r;
  }
  float sampleField(sampler2D sourceTexture, float u) {
    float station = clamp(u, 0.0, 1.0) * (resultStationCount - 1.0);
    float lower = floor(station);
    float upper = min(lower + 1.0, resultStationCount - 1.0);
    float rowStart = floor(instanceResultRow + 0.5) * resultStationCount;
    return mix(resultTexel(sourceTexture, rowStart + lower), resultTexel(sourceTexture, rowStart + upper), fract(station));
  }
`

const VERTEX_SHADER = /* glsl */ `
  attribute vec3 instanceStart;
  attribute vec3 instanceEnd;
  attribute vec3 instanceReferenceAxis;
  attribute float instanceGamma;
  attribute float instanceFlags;
  attribute float instanceResultRow;
  attribute float instanceDiagramVisible;
  attribute float lineKind;
  uniform sampler2D resultTexture;
  uniform sampler2D displacementXTexture;
  uniform sampler2D displacementYTexture;
  uniform sampler2D displacementZTexture;
  uniform vec2 resultTextureSize;
  uniform float resultStationCount;
  uniform float diagramScale;
  uniform float directionMode;
  uniform float referenceDeformed;
  uniform float deformationScale;
  varying float vValue;
  varying float vFlags;
  varying float vDiagramVisible;
  varying float vLineKind;
varying vec3 vNormal;
  ${FRAME_GLSL}
  void main() {
    float u = position.x;
    float side = position.y;
    vec3 axisX = normalize(instanceEnd - instanceStart);
    vec3 baseZ = safeReference(axisX, instanceReferenceAxis);
    vec3 baseY = normalize(cross(baseZ, axisX));
    float c = cos(instanceGamma);
    float s = sin(instanceGamma);
    vec3 axisY = baseY * c + baseZ * s;
    vec3 axisZ = baseZ * c - baseY * s;
    vec3 base = mix(instanceStart, instanceEnd, u);
    if (referenceDeformed > 0.5) {
      vec3 displacement = vec3(
        sampleField(displacementXTexture, u),
        sampleField(displacementYTexture, u),
        sampleField(displacementZTexture, u)
      );
      if (displacement.x == displacement.x && displacement.y == displacement.y && displacement.z == displacement.z) {
        base += displacement * deformationScale;
      }
    }
    float value = sampleField(resultTexture, u);
    vec3 direction = directionMode < 0.5 ? axisY : axisZ;
    vec3 worldPosition = base;
    if (value == value) worldPosition += direction * value * diagramScale * side;
    vValue = value;
    vFlags = instanceFlags;
    vDiagramVisible = instanceDiagramVisible;
    vLineKind = lineKind;
    // Geometric surface normal of the ribbon plane (member axis × diagram
    // offset axis) — used by the ribbon's ambient+diffuse lighting.
    vNormal = normalize(cross(axisX, direction));
    gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
  }
`

const RIBBON_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform sampler2D resultColorLut;
  uniform float resultMin;
  uniform float resultMax;
  uniform float contourEnabled;
  uniform vec3 lightDirection;
  uniform float ambientStrength;
  uniform float diffuseStrength;
  varying float vValue;
  varying float vFlags;
  varying float vDiagramVisible;
  varying vec3 vNormal;
  bool hasFlag(float value, float flag) { return mod(floor(value / flag), 2.0) > 0.5; }
  void main() {
    if (!hasFlag(vFlags, 1.0) || vDiagramVisible < 0.5 || vValue != vValue) discard;
    vec3 color = vec3(0.15, 0.68, 0.92);
    if (contourEnabled > 0.5) {
      float maxAbs = max(max(abs(resultMin), abs(resultMax)), 0.000000000001);
      color = texture2D(resultColorLut, vec2(clamp(0.5 + 0.5 * vValue / maxAbs, 0.0, 1.0), 0.5)).rgb;
    }
    if (hasFlag(vFlags, 4.0)) color = vec3(1.0, 0.72, 0.12);
    if (hasFlag(vFlags, 2.0)) color = vec3(1.0, 0.22, 0.12);
    // Ambient + one directional light so the ribbon reads like a material-lit
    // solid instead of a flat constant shader. abs() keeps both faces lit
    // (DoubleSide ribbon flips the interpolated normal per face).
    float ndl = abs(dot(normalize(vNormal), normalize(lightDirection)));
    float lighting = min(ambientStrength + diffuseStrength * ndl, 1.2);
    gl_FragColor = vec4(color * lighting, 1.0);
  }
`

const LINE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform sampler2D resultColorLut;
  uniform float resultMin;
  uniform float resultMax;
  uniform float contourEnabled;
  uniform float hatchEnabled;
  varying float vValue;
  varying float vFlags;
  varying float vDiagramVisible;
  varying float vLineKind;
  bool hasFlag(float value, float flag) { return mod(floor(value / flag), 2.0) > 0.5; }
  void main() {
    if (!hasFlag(vFlags, 1.0) || vDiagramVisible < 0.5 || vValue != vValue) discard;
    if (vLineKind > 0.5 && hatchEnabled < 0.5) discard;
    // Bright lines like the legacy diagram: outline/baseline near-white, hatch
    // light silver (legacy 0xaeb9c4). The old GPU hatch was near-black navy and
    // dragged the whole diagram dark.
    vec3 base = vLineKind > 0.5 ? vec3(0.72, 0.77, 0.82) : vec3(0.90, 0.93, 0.96);
    vec3 color = hasFlag(vFlags, 2.0) ? vec3(1.0, 0.22, 0.12) : base;
    // Hatch / baseline / outline inherit the contour colormap (same normalisation
    // as the ribbon) so a contour diagram's lines change colour by value again.
    if (contourEnabled > 0.5 && !hasFlag(vFlags, 2.0)) {
      float maxAbs = max(max(abs(resultMin), abs(resultMax)), 0.000000000001);
      color = texture2D(resultColorLut, vec2(clamp(0.5 + 0.5 * vValue / maxAbs, 0.0, 1.0), 0.5)).rgb;
    }
    if (hasFlag(vFlags, 4.0)) color = vec3(1.0, 0.72, 0.12);
    gl_FragColor = vec4(color, vLineKind > 0.5 ? 0.6 : 0.95);
  }
`

const createRibbonTemplate = (stationCount: number) => {
  const values: number[] = []
  for (let index = 0; index < stationCount - 1; index++) {
    const a = index / (stationCount - 1)
    const b = (index + 1) / (stationCount - 1)
    values.push(a, 0, 0, a, 1, 0, b, 0, 0, b, 0, 0, a, 1, 0, b, 1, 0)
  }
  return new Float32Array(values)
}

const createLineTemplate = (stationCount: number) => {
  const positions: number[] = []
  const kinds: number[] = []
  const segment = (a: number, aSide: number, b: number, bSide: number, kind: number) => {
    positions.push(a, aSide, 0, b, bSide, 0)
    kinds.push(kind, kind)
  }
  segment(0, 0, 1, 0, 0)
  for (let index = 0; index < stationCount - 1; index++) {
    segment(index / (stationCount - 1), 1, (index + 1) / (stationCount - 1), 1, 0)
  }
  for (let index = 0; index < stationCount; index++) {
    const u = index / (stationCount - 1)
    segment(u, 0, u, 1, 1)
  }
  return { positions: new Float32Array(positions), kinds: new Float32Array(kinds) }
}

const resultUniforms = () => ({
  resultTexture: { value: null as THREE.DataTexture | null },
  resultColorLut: { value: null as THREE.DataTexture | null },
  displacementXTexture: { value: null as THREE.DataTexture | null },
  displacementYTexture: { value: null as THREE.DataTexture | null },
  displacementZTexture: { value: null as THREE.DataTexture | null },
  resultTextureSize: { value: new THREE.Vector2(1, 1) },
  resultStationCount: { value: DIAGRAM_STATION_COUNT },
  resultMin: { value: 0 }, resultMax: { value: 1 },
  diagramScale: { value: 1 }, directionMode: { value: 0 },
  referenceDeformed: { value: 0 }, deformationScale: { value: 1 },
  contourEnabled: { value: 0 }, hatchEnabled: { value: 1 },
  // Photo-style lighting for the diagram ribbon (ambient + one directional).
  // Hardcoded "sun" light: brighten the diagram just like a material-lit solid.
  lightDirection: { value: new THREE.Vector3(0.55, 0.75, 0.38).normalize() },
  ambientStrength: { value: 0.82 },
  diffuseStrength: { value: 0.5 },
})

export const diagramDirectionForComponent = (component: string) =>
  component === 'V3' || component === 'M2' || component === 'Vz' || component === 'My' ? 1 : 0

/** CPU golden implementation of the procedural vertex displacement. */
export const computeDiagramPoint = (
  start: Vec3Tuple,
  end: Vec3Tuple,
  referenceAxis: Vec3Tuple,
  gammaRadians: number,
  u: number,
  value: number,
  scale: number,
  component: string,
): [number, number, number] => {
  const frame = computeMemberFrame(start, end, referenceAxis, gammaRadians)
  const direction = diagramDirectionForComponent(component) === 0 ? frame.y : frame.z
  return [0, 1, 2].map(axis =>
    start[axis] + (end[axis] - start[axis]) * u + direction[axis] * value * scale,
  ) as [number, number, number]
}

/** Two constant draw passes render every member diagram. */
export default class DiagramRenderer {
  readonly group = new THREE.Group()
  readonly ribbonGeometry = new THREE.InstancedBufferGeometry()
  readonly lineGeometry = new THREE.InstancedBufferGeometry()
  readonly ribbon: THREE.Mesh
  readonly lines: THREE.LineSegments
  private readonly ribbonMaterial: THREE.ShaderMaterial
  private readonly lineMaterial: THREE.ShaderMaterial
  private database: StructuralSceneDB | null = null
  private flags = new Float32Array(0)
  private diagramVisible = new Float32Array(0)

  constructor(scene: THREE.Scene, layer: number) {
    this.ribbonGeometry.setAttribute('position', new THREE.BufferAttribute(createRibbonTemplate(DIAGRAM_STATION_COUNT), 3))
    const lineTemplate = createLineTemplate(DIAGRAM_STATION_COUNT)
    this.lineGeometry.setAttribute('position', new THREE.BufferAttribute(lineTemplate.positions, 3))
    this.lineGeometry.setAttribute('lineKind', new THREE.BufferAttribute(lineTemplate.kinds, 1))
    this.ribbonMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER, fragmentShader: RIBBON_FRAGMENT_SHADER,
      uniforms: resultUniforms(), transparent: true, depthTest: false, depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.lineMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER, fragmentShader: LINE_FRAGMENT_SHADER,
      uniforms: resultUniforms(), transparent: true, depthTest: false, depthWrite: false,
    })
    this.ribbon = new THREE.Mesh(this.ribbonGeometry, this.ribbonMaterial)
    this.lines = new THREE.LineSegments(this.lineGeometry, this.lineMaterial)
    // Overlay semantics: depthTest off + high renderOrder keep the diagram
    // bright and never buried behind the member solids on a dark background.
    this.ribbon.renderOrder = 90
    this.lines.renderOrder = 91
    this.ribbon.frustumCulled = this.lines.frustumCulled = false
    this.ribbon.layers.set(layer)
    this.lines.layers.set(layer)
    this.group.layers.set(layer)
    this.group.name = 'StructuralDiagramRenderer'
    this.group.add(this.ribbon, this.lines)
    this.group.visible = false
    scene.add(this.group)
  }

  upload(database: StructuralSceneDB) {
    this.database = database
    const starts = new Float32Array(database.memberCount * 3)
    const ends = new Float32Array(database.memberCount * 3)
    const references = new Float32Array(database.memberCount * 3)
    const gamma = new Float32Array(database.memberCount)
    const rows = new Float32Array(database.memberCount)
    this.flags = new Float32Array(database.memberCount)
    this.diagramVisible = new Float32Array(database.memberCount)
    for (let index = 0; index < database.memberCount; index++) {
      starts.set(database.memberEndpoints.subarray(index * 6, index * 6 + 3), index * 3)
      ends.set(database.memberEndpoints.subarray(index * 6 + 3, index * 6 + 6), index * 3)
      references.set(database.memberReferenceAxes.subarray(index * 3, index * 3 + 3), index * 3)
      gamma[index] = database.memberGammaRadians[index]
      this.flags[index] = database.memberFlags[index]
      this.diagramVisible[index] = 1
      rows[index] = index
    }
    for (const geometry of [this.ribbonGeometry, this.lineGeometry]) {
      geometry.setAttribute('instanceStart', new THREE.InstancedBufferAttribute(starts, 3))
      geometry.setAttribute('instanceEnd', new THREE.InstancedBufferAttribute(ends, 3))
      geometry.setAttribute('instanceReferenceAxis', new THREE.InstancedBufferAttribute(references, 3))
      geometry.setAttribute('instanceGamma', new THREE.InstancedBufferAttribute(gamma, 1))
      geometry.setAttribute('instanceFlags', new THREE.InstancedBufferAttribute(this.flags, 1))
      geometry.setAttribute('instanceResultRow', new THREE.InstancedBufferAttribute(rows, 1))
      geometry.setAttribute('instanceDiagramVisible', new THREE.InstancedBufferAttribute(this.diagramVisible, 1))
      delete (geometry as THREE.InstancedBufferGeometry & { _maxInstanceCount?: number })._maxInstanceCount
      geometry.instanceCount = database.memberCount
    }
  }

  show(binding: ResultBinding, options: {
    component: string; scale: number; min: number; max: number; contour: boolean;
    ribbon: boolean; hatch: boolean; memberIds?: readonly number[];
  }) {
    this.bindResult(binding)
    const selected = options.memberIds?.length ? new Set(options.memberIds) : null
    if (this.database) for (let index = 0; index < this.database.memberCount; index++) {
      this.diagramVisible[index] = selected?.has(this.database.memberIds[index]) === false ? 0 : 1
    }
    for (const geometry of [this.ribbonGeometry, this.lineGeometry]) {
      (geometry.getAttribute('instanceDiagramVisible') as THREE.InstancedBufferAttribute).needsUpdate = true
    }
    for (const material of [this.ribbonMaterial, this.lineMaterial]) {
      material.uniforms.diagramScale.value = options.scale
      material.uniforms.directionMode.value = diagramDirectionForComponent(options.component)
      material.uniforms.resultMin.value = options.min
      material.uniforms.resultMax.value = options.max
      material.uniforms.contourEnabled.value = options.contour ? 1 : 0
      material.uniforms.hatchEnabled.value = options.hatch ? 1 : 0
    }
    this.ribbon.visible = options.ribbon
    this.lines.visible = true
    this.group.visible = true
  }

  bindDeformedReference(bindings: { x: ResultBinding; y: ResultBinding; z: ResultBinding } | null, scale = 1) {
    for (const material of [this.ribbonMaterial, this.lineMaterial]) {
      material.uniforms.referenceDeformed.value = bindings ? 1 : 0
      material.uniforms.deformationScale.value = scale
      if (!bindings) continue
      material.uniforms.displacementXTexture.value = bindings.x.texture
      material.uniforms.displacementYTexture.value = bindings.y.texture
      material.uniforms.displacementZTexture.value = bindings.z.texture
    }
  }

  syncMemberState(entityId: number) {
    const index = this.database?.memberIndexById.get(entityId)
    if (index === undefined || !this.database) return
    this.flags[index] = this.database.memberFlags[index]
    for (const geometry of [this.ribbonGeometry, this.lineGeometry]) {
      (geometry.getAttribute('instanceFlags') as THREE.InstancedBufferAttribute).needsUpdate = true
    }
  }

  syncAllMemberStates() {
    if (!this.database) return
    this.flags.set(this.database.memberFlags.subarray(0, this.database.memberCount))
    for (const geometry of [this.ribbonGeometry, this.lineGeometry]) {
      ;(geometry.getAttribute('instanceFlags') as THREE.InstancedBufferAttribute).needsUpdate = true
    }
  }

  setMemberState(entityId: number, state: { visible?: boolean; selected?: boolean; hovered?: boolean }) {
    if (!this.database) return
    if (state.visible !== undefined) this.database.setMemberFlag(entityId, ENTITY_VISIBLE, state.visible)
    if (state.selected !== undefined) this.database.setMemberFlag(entityId, ENTITY_SELECTED, state.selected)
    if (state.hovered !== undefined) this.database.setMemberFlag(entityId, ENTITY_HOVERED, state.hovered)
    this.syncMemberState(entityId)
  }

  hide() { this.group.visible = false }

  /** Stable entity IDs consumed by the later label/symbol LOD pass. */
  setExtrema(minEntityId: number | null, maxEntityId: number | null) {
    this.group.userData.extrema = { minEntityId, maxEntityId }
  }

  private bindResult(binding: ResultBinding) {
    for (const material of [this.ribbonMaterial, this.lineMaterial]) {
      material.uniforms.resultTexture.value = binding.texture
      material.uniforms.resultColorLut.value = binding.colorLut
      material.uniforms.resultTextureSize.value.set(binding.textureWidth, binding.textureHeight)
      material.uniforms.resultStationCount.value = binding.stationCount
    }
  }

  dispose() {
    this.group.removeFromParent()
    this.ribbonGeometry.dispose()
    this.lineGeometry.dispose()
    this.ribbonMaterial.dispose()
    this.lineMaterial.dispose()
    this.database = null
  }
}
