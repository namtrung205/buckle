import * as THREE from 'three'
import type { QualityProfile } from './contracts'
import type { ResultBinding } from './ResultStore.ts'
import {
  PROFILE_FAMILIES,
  PROFILE_PARAMETER_STRIDE,
  type ProfileFamily,
  type StructuralSceneDB,
} from './StructuralSceneDB.ts'
import {
  createAngleThinShellTemplate,
  createBoxThinShellTemplate,
  createChannelThinShellTemplate,
  createCustomThinShellTemplate,
  createHThinShellTemplate,
  createPipeThinShellTemplate,
  type ThinShellTemplate,
} from './thinShellTemplates.ts'

export { createHThinShellTemplate } from './thinShellTemplates.ts'

const VERTEX_SHADER = /* glsl */ `
  attribute vec2 thicknessWeights;
  attribute vec3 instanceStart;
  attribute vec3 instanceEnd;
  attribute vec3 instanceReferenceAxis;
  attribute vec4 instanceDimensions;
  attribute float instanceGamma;
  attribute float instanceFlags;
  attribute float instanceOrientationFlags;
  attribute float instanceResultRow;
  varying vec3 vNormal;
  varying float vFlags;
  varying float vResultU;
  varying float vResultRow;

  bool hasFlag(float value, float flag) {
    return mod(floor(value / flag), 2.0) > 0.5;
  }
  vec3 safeReference(vec3 axisX, vec3 referenceAxis) {
    vec3 projected = referenceAxis - axisX * dot(referenceAxis, axisX);
    if (length(projected) < 0.000001) {
      vec3 fallbackAxis = abs(axisX.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      projected = fallbackAxis - axisX * dot(fallbackAxis, axisX);
    }
    return normalize(projected);
  }
  void main() {
    vec3 axisX = normalize(instanceEnd - instanceStart);
    vec3 baseZ = safeReference(axisX, instanceReferenceAxis);
    vec3 baseY = normalize(cross(baseZ, axisX));
    float c = cos(instanceGamma);
    float s = sin(instanceGamma);
    vec3 axisY = baseY * c + baseZ * s;
    vec3 axisZ = baseZ * c - baseY * s;
    float mirrorY = hasFlag(instanceOrientationFlags, 1.0) ? -1.0 : 1.0;
    float mirrorZ = hasFlag(instanceOrientationFlags, 2.0) ? -1.0 : 1.0;
    float profileY = (position.y * instanceDimensions.y + thicknessWeights.x * instanceDimensions.z) * mirrorY;
    float profileZ = (position.z * instanceDimensions.x + thicknessWeights.y * instanceDimensions.w) * mirrorZ;
    vec3 worldPosition = mix(instanceStart, instanceEnd, position.x) + axisY * profileY + axisZ * profileZ;
    vNormal = normalize(axisX * normal.x + axisY * normal.y * mirrorY + axisZ * normal.z * mirrorZ);
    vFlags = instanceFlags;
    vResultU = position.x;
    vResultRow = instanceResultRow;
    gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
  }
`

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  varying vec3 vNormal;
  varying float vFlags;
  varying float vResultU;
  varying float vResultRow;
  uniform sampler2D resultTexture;
  uniform sampler2D resultColorLut;
  uniform vec2 resultTextureSize;
  uniform float resultStationCount;
  uniform float resultEnabled;
  uniform float resultMin;
  uniform float resultMax;
  bool hasFlag(float value, float flag) { return mod(floor(value / flag), 2.0) > 0.5; }
  float resultTexel(float linearIndex) {
    float x = mod(linearIndex, resultTextureSize.x);
    float y = floor(linearIndex / resultTextureSize.x);
    return texture2D(resultTexture, (vec2(x, y) + 0.5) / resultTextureSize).r;
  }
  float sampleResult() {
    float station = clamp(vResultU, 0.0, 1.0) * (resultStationCount - 1.0);
    float lower = floor(station);
    float upper = min(lower + 1.0, resultStationCount - 1.0);
    float rowStart = floor(vResultRow + 0.5) * resultStationCount;
    return mix(resultTexel(rowStart + lower), resultTexel(rowStart + upper), fract(station));
  }
  void main() {
    if (!hasFlag(vFlags, 1.0)) discard;
    vec3 base = vec3(0.64, 0.68, 0.71);
    if (hasFlag(vFlags, 4.0)) base = vec3(1.0, 0.72, 0.12);
    if (hasFlag(vFlags, 2.0)) base = vec3(1.0, 0.22, 0.12);
    vec3 lightDirection = normalize(vec3(0.35, 0.75, 0.55));
    float diffuse = 0.42 + 0.58 * abs(dot(normalize(vNormal), lightDirection));
    base *= diffuse;
    if (resultEnabled > 0.5 && !hasFlag(vFlags, 2.0) && !hasFlag(vFlags, 4.0)) {
      float value = sampleResult();
      if (value == value) {
        float maxAbs = max(max(abs(resultMin), abs(resultMax)), 0.000000000001);
        float t = clamp(0.5 + 0.5 * value / maxAbs, 0.0, 1.0);
        base = texture2D(resultColorLut, vec2(t, 0.5)).rgb;
      }
    }
    gl_FragColor = vec4(base, 1.0);
  }
`

const EDGE_VERTEX_SHADER = /* glsl */ `
  attribute vec2 thicknessWeights;
  attribute vec3 instanceStart;
  attribute vec3 instanceEnd;
  attribute vec3 instanceReferenceAxis;
  attribute vec4 instanceDimensions;
  attribute float instanceGamma;
  attribute float instanceFlags;
  attribute float instanceOrientationFlags;
  varying float vFlags;
  bool hasFlag(float value, float flag) { return mod(floor(value / flag), 2.0) > 0.5; }
  vec3 safeReference(vec3 axisX, vec3 referenceAxis) {
    vec3 projected = referenceAxis - axisX * dot(referenceAxis, axisX);
    if (length(projected) < 0.000001) {
      vec3 fallbackAxis = abs(axisX.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      projected = fallbackAxis - axisX * dot(fallbackAxis, axisX);
    }
    return normalize(projected);
  }
  void main() {
    vec3 axisX = normalize(instanceEnd - instanceStart);
    vec3 baseZ = safeReference(axisX, instanceReferenceAxis);
    vec3 baseY = normalize(cross(baseZ, axisX));
    float c = cos(instanceGamma), s = sin(instanceGamma);
    vec3 axisY = baseY * c + baseZ * s;
    vec3 axisZ = baseZ * c - baseY * s;
    float mirrorY = hasFlag(instanceOrientationFlags, 1.0) ? -1.0 : 1.0;
    float mirrorZ = hasFlag(instanceOrientationFlags, 2.0) ? -1.0 : 1.0;
    float profileY = (position.y * instanceDimensions.y + thicknessWeights.x * instanceDimensions.z) * mirrorY;
    float profileZ = (position.z * instanceDimensions.x + thicknessWeights.y * instanceDimensions.w) * mirrorZ;
    vec3 worldPosition = mix(instanceStart, instanceEnd, position.x) + axisY * profileY + axisZ * profileZ;
    vFlags = instanceFlags;
    gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
  }
`
const EDGE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  varying float vFlags;
  bool hasFlag(float value, float flag) { return mod(floor(value / flag), 2.0) > 0.5; }
  void main() {
    if (!hasFlag(vFlags, 1.0)) discard;
    vec3 color = hasFlag(vFlags, 2.0) ? vec3(.38, .08, .04) : vec3(.08, .10, .12);
    gl_FragColor = vec4(color, .78);
  }
`

const FALLBACK_VERTEX_SHADER = /* glsl */ `
  attribute float entityFlags;
  attribute float resultU;
  attribute float resultRow;
  varying float vFlags;
  varying float vResultU;
  varying float vResultRow;
  void main() {
    vFlags = entityFlags;
    vResultU = resultU;
    vResultRow = resultRow;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const FALLBACK_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  varying float vFlags;
  varying float vResultU;
  varying float vResultRow;
  uniform sampler2D resultTexture;
  uniform sampler2D resultColorLut;
  uniform vec2 resultTextureSize;
  uniform float resultStationCount;
  uniform float resultEnabled;
  uniform float resultMin;
  uniform float resultMax;
  bool hasFlag(float value, float flag) { return mod(floor(value / flag), 2.0) > 0.5; }
  float resultTexel(float linearIndex) {
    float x = mod(linearIndex, resultTextureSize.x);
    float y = floor(linearIndex / resultTextureSize.x);
    return texture2D(resultTexture, (vec2(x, y) + 0.5) / resultTextureSize).r;
  }
  void main() {
    if (!hasFlag(vFlags, 1.0)) discard;
    vec3 color = vec3(0.54, 0.58, 0.61);
    if (hasFlag(vFlags, 4.0)) color = vec3(1.0, 0.72, 0.12);
    if (hasFlag(vFlags, 2.0)) color = vec3(1.0, 0.22, 0.12);
    if (resultEnabled > 0.5 && !hasFlag(vFlags, 2.0) && !hasFlag(vFlags, 4.0)) {
      float station = clamp(vResultU, 0.0, 1.0) * (resultStationCount - 1.0);
      float lower = floor(station);
      float rowStart = floor(vResultRow + 0.5) * resultStationCount;
      float value = mix(resultTexel(rowStart + lower), resultTexel(rowStart + min(lower + 1.0, resultStationCount - 1.0)), fract(station));
      if (value == value) {
        float maxAbs = max(max(abs(resultMin), abs(resultMax)), 0.000000000001);
        color = texture2D(resultColorLut, vec2(clamp(0.5 + 0.5 * value / maxAbs, 0.0, 1.0), 0.5)).rgb;
      }
    }
    gl_FragColor = vec4(color, 1.0);
  }
`

const PIPE_SEGMENTS: Record<QualityProfile, number> = { low: 8, balanced: 12, high: 20, custom: 16 }
const resultUniforms = () => ({
  resultTexture: { value: null as THREE.DataTexture | null },
  resultColorLut: { value: null as THREE.DataTexture | null },
  resultTextureSize: { value: new THREE.Vector2(1, 1) },
  resultStationCount: { value: 2 },
  resultEnabled: { value: 0 },
  resultMin: { value: 0 },
  resultMax: { value: 1 },
})
type StandardFamily = 'h' | 'channel' | 'angle' | 'box' | 'pipe'
type Batch = {
  key: string
  family: ProfileFamily
  geometry: THREE.InstancedBufferGeometry
  mesh: THREE.Mesh
  edgeGeometry: THREE.InstancedBufferGeometry
  edges: THREE.LineSegments
  flags: Float32Array
  entityIds: number[]
  customDimensions?: readonly [number, number, number, number]
}
type InstanceLocation = { batch: Batch; instanceIndex: number }

const familyForCode = (code: number): ProfileFamily => PROFILE_FAMILIES[code] ?? 'unknown'
const createGeometry = (template: ThinShellTemplate) => {
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(template.positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(template.normals, 3))
  geometry.setAttribute('thicknessWeights', new THREE.BufferAttribute(template.thicknessWeights, 2))
  geometry.instanceCount = 0
  return geometry
}
const createEdgeGeometry = (template: ThinShellTemplate) => {
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(template.edgePositions, 3))
  geometry.setAttribute('thicknessWeights', new THREE.BufferAttribute(template.edgeThicknessWeights, 2))
  geometry.instanceCount = 0
  return geometry
}
const setTemplate = (geometry: THREE.InstancedBufferGeometry, edgeGeometry: THREE.InstancedBufferGeometry, template: ThinShellTemplate) => {
  geometry.setAttribute('position', new THREE.BufferAttribute(template.positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(template.normals, 3))
  geometry.setAttribute('thicknessWeights', new THREE.BufferAttribute(template.thicknessWeights, 2))
  edgeGeometry.setAttribute('position', new THREE.BufferAttribute(template.edgePositions, 3))
  edgeGeometry.setAttribute('thicknessWeights', new THREE.BufferAttribute(template.edgeThicknessWeights, 2))
}

export default class ThinShellRenderer {
  readonly group = new THREE.Group()
  readonly fallbackGeometry = new THREE.BufferGeometry()
  readonly fallbackLines: THREE.LineSegments
  private readonly material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER,
    uniforms: resultUniforms(),
    side: THREE.DoubleSide, depthTest: true, depthWrite: true,
  })
  private readonly fallbackMaterial = new THREE.ShaderMaterial({
    vertexShader: FALLBACK_VERTEX_SHADER, fragmentShader: FALLBACK_FRAGMENT_SHADER,
    uniforms: resultUniforms(),
  })
  private readonly edgeMaterial = new THREE.ShaderMaterial({
    vertexShader: EDGE_VERTEX_SHADER, fragmentShader: EDGE_FRAGMENT_SHADER,
    transparent: true, depthTest: true, depthWrite: false,
  })
  private readonly batches = new Map<string, Batch>()
  private readonly instanceLocationByEntityId = new Map<number, InstanceLocation>()
  private readonly fallbackVertexByEntityId = new Map<number, number>()
  private database: StructuralSceneDB | null = null
  private fallbackFlags = new Float32Array(0)
  private uploadedMemberCount = 0
  private uploadedProfileCount = 0
  private qualityProfile: QualityProfile = 'balanced'
  private membersVisible = true
  private readonly layer: number

  constructor(scene: THREE.Scene, layer: number) {
    this.layer = layer
    this.group.name = 'StructuralThinShellRenderer'
    this.group.layers.set(layer)
    this.createBatch('h', 'h', createHThinShellTemplate())
    this.createBatch('channel', 'channel', createChannelThinShellTemplate())
    this.createBatch('angle', 'angle', createAngleThinShellTemplate())
    this.createBatch('box', 'box', createBoxThinShellTemplate())
    this.createBatch('pipe', 'pipe', createPipeThinShellTemplate(PIPE_SEGMENTS[this.qualityProfile]))
    this.fallbackLines = new THREE.LineSegments(this.fallbackGeometry, this.fallbackMaterial)
    this.fallbackLines.frustumCulled = true
    this.fallbackLines.layers.set(layer)
    this.group.add(this.fallbackLines)
    this.group.visible = false
    scene.add(this.group)
  }

  get geometry() { return this.batches.get('h')!.geometry }
  get mesh() { return this.batches.get('h')!.mesh }

  private createBatch(
    key: string,
    family: ProfileFamily,
    template: ThinShellTemplate,
    customDimensions?: readonly [number, number, number, number],
  ) {
    const geometry = createGeometry(template)
    const mesh = new THREE.Mesh(geometry, this.material)
    const edgeGeometry = createEdgeGeometry(template)
    const edges = new THREE.LineSegments(edgeGeometry, this.edgeMaterial)
    mesh.name = `ThinShell:${key}`
    edges.name = `ThinShellEdges:${key}`
    mesh.frustumCulled = false
    edges.frustumCulled = false
    mesh.layers.set(this.layer)
    edges.layers.set(this.layer)
    mesh.visible = this.membersVisible
    edges.visible = this.membersVisible
    edges.renderOrder = 1
    const batch: Batch = { key, family, geometry, mesh, edgeGeometry, edges, flags: new Float32Array(0), entityIds: [], customDimensions }
    this.batches.set(key, batch)
    this.group.add(mesh, edges)
    return batch
  }

  private removeCustomBatches() {
    for (const [key, batch] of this.batches) {
      if (!key.startsWith('custom:')) continue
      batch.mesh.removeFromParent()
      batch.edges.removeFromParent()
      batch.geometry.dispose()
      batch.edgeGeometry.dispose()
      this.batches.delete(key)
    }
  }

  private batchKey(database: StructuralSceneDB, memberIndex: number) {
    const profileIndex = database.memberProfileIndices[memberIndex]
    const family = familyForCode(database.profileFamilies[profileIndex])
    if (family === 'h' || family === 'channel' || family === 'angle' || family === 'box' || family === 'pipe') return family
    if (family === 'custom') {
      const profileId = database.profileIds[profileIndex]
      return database.profileContours.has(profileId) ? `custom:${profileId}` : null
    }
    return null
  }

  private profileDimensions(database: StructuralSceneDB, memberIndex: number, batch: Batch): [number, number, number, number] {
    if (batch.customDimensions) return [...batch.customDimensions]
    const offset = database.memberProfileIndices[memberIndex] * PROFILE_PARAMETER_STRIDE
    const p = database.profileParameters
    switch (batch.family as StandardFamily) {
      case 'h': case 'channel': return [p[offset], p[offset + 1], p[offset + 2], p[offset + 3]]
      case 'box': {
        const thickness = p[offset + 5]
        return [p[offset], p[offset + 1], thickness, thickness]
      }
      case 'pipe': {
        const diameter = p[offset + 4]
        return [diameter, diameter, p[offset + 5], p[offset + 5]]
      }
      case 'angle': {
        const thickness = p[offset + 5]
        return [p[offset], p[offset + 1], thickness, thickness]
      }
    }
  }

  upload(database: StructuralSceneDB) {
    this.database = database
    this.uploadedMemberCount = database.memberCount
    this.uploadedProfileCount = database.profileCount
    this.instanceLocationByEntityId.clear()
    this.fallbackVertexByEntityId.clear()
    this.removeCustomBatches()

    for (let profileIndex = 0; profileIndex < database.profileCount; profileIndex++) {
      if (familyForCode(database.profileFamilies[profileIndex]) !== 'custom') continue
      const profileId = database.profileIds[profileIndex]
      const contour = database.profileContours.get(profileId)
      if (!contour) continue
      const template = createCustomThinShellTemplate(contour.coordinates, contour.closed)
      this.createBatch(`custom:${profileId}`, 'custom', template, template.dimensions)
    }

    const membersByBatch = new Map<string, number[]>()
    const fallbackMembers: number[] = []
    for (let memberIndex = 0; memberIndex < database.memberCount; memberIndex++) {
      const key = this.batchKey(database, memberIndex)
      if (!key || !this.batches.has(key)) fallbackMembers.push(memberIndex)
      else {
        const indices = membersByBatch.get(key) ?? []
        indices.push(memberIndex)
        membersByBatch.set(key, indices)
      }
    }
    for (const batch of this.batches.values()) this.uploadBatch(database, batch, membersByBatch.get(batch.key) ?? [])
    this.uploadFallback(database, fallbackMembers)
  }

  private uploadBatch(database: StructuralSceneDB, batch: Batch, memberIndices: number[]) {
    const starts = new Float32Array(memberIndices.length * 3)
    const ends = new Float32Array(memberIndices.length * 3)
    const references = new Float32Array(memberIndices.length * 3)
    const dimensions = new Float32Array(memberIndices.length * 4)
    const gamma = new Float32Array(memberIndices.length)
    const orientationFlags = new Float32Array(memberIndices.length)
    const resultRows = new Float32Array(memberIndices.length)
    batch.flags = new Float32Array(memberIndices.length)
    batch.entityIds = new Array(memberIndices.length)
    memberIndices.forEach((memberIndex, instanceIndex) => {
      const endpointOffset = memberIndex * 6
      const referenceOffset = memberIndex * 3
      starts.set(database.memberEndpoints.subarray(endpointOffset, endpointOffset + 3), instanceIndex * 3)
      ends.set(database.memberEndpoints.subarray(endpointOffset + 3, endpointOffset + 6), instanceIndex * 3)
      references.set(database.memberReferenceAxes.subarray(referenceOffset, referenceOffset + 3), instanceIndex * 3)
      dimensions.set(this.profileDimensions(database, memberIndex, batch), instanceIndex * 4)
      gamma[instanceIndex] = database.memberGammaRadians[memberIndex]
      batch.flags[instanceIndex] = database.memberFlags[memberIndex]
      orientationFlags[instanceIndex] = database.memberOrientationFlags[memberIndex]
      resultRows[instanceIndex] = memberIndex
      const entityId = database.memberIds[memberIndex]
      batch.entityIds[instanceIndex] = entityId
      this.instanceLocationByEntityId.set(entityId, { batch, instanceIndex })
    })
    batch.geometry.setAttribute('instanceStart', new THREE.InstancedBufferAttribute(starts, 3))
    batch.geometry.setAttribute('instanceEnd', new THREE.InstancedBufferAttribute(ends, 3))
    batch.geometry.setAttribute('instanceReferenceAxis', new THREE.InstancedBufferAttribute(references, 3))
    batch.geometry.setAttribute('instanceDimensions', new THREE.InstancedBufferAttribute(dimensions, 4))
    batch.geometry.setAttribute('instanceGamma', new THREE.InstancedBufferAttribute(gamma, 1))
    batch.geometry.setAttribute('instanceFlags', new THREE.InstancedBufferAttribute(batch.flags, 1))
    batch.geometry.setAttribute('instanceOrientationFlags', new THREE.InstancedBufferAttribute(orientationFlags, 1))
    batch.geometry.setAttribute('instanceResultRow', new THREE.InstancedBufferAttribute(resultRows, 1))
    for (const name of ['instanceStart', 'instanceEnd', 'instanceReferenceAxis', 'instanceDimensions', 'instanceGamma', 'instanceFlags', 'instanceOrientationFlags']) {
      batch.edgeGeometry.setAttribute(name, batch.geometry.getAttribute(name))
    }
    // WebGLBindingStates caches the smallest instanced-attribute capacity on
    // the geometry. Replacing 1k buffers with 10k buffers must invalidate it or
    // Three.js silently keeps drawing only the first 1k instances.
    delete (batch.geometry as THREE.InstancedBufferGeometry & { _maxInstanceCount?: number })._maxInstanceCount
    delete (batch.edgeGeometry as THREE.InstancedBufferGeometry & { _maxInstanceCount?: number })._maxInstanceCount
    batch.geometry.instanceCount = memberIndices.length
    batch.edgeGeometry.instanceCount = memberIndices.length
  }

  private uploadFallback(database: StructuralSceneDB, memberIndices: number[]) {
    const positions = new Float32Array(memberIndices.length * 6)
    const resultU = new Float32Array(memberIndices.length * 2)
    const resultRows = new Float32Array(memberIndices.length * 2)
    this.fallbackFlags = new Float32Array(memberIndices.length * 2)
    memberIndices.forEach((memberIndex, fallbackIndex) => {
      positions.set(database.memberEndpoints.subarray(memberIndex * 6, memberIndex * 6 + 6), fallbackIndex * 6)
      this.fallbackFlags.fill(database.memberFlags[memberIndex], fallbackIndex * 2, fallbackIndex * 2 + 2)
      resultU[fallbackIndex * 2 + 1] = 1
      resultRows.fill(memberIndex, fallbackIndex * 2, fallbackIndex * 2 + 2)
      this.fallbackVertexByEntityId.set(database.memberIds[memberIndex], fallbackIndex * 2)
    })
    this.fallbackGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.fallbackGeometry.setAttribute('entityFlags', new THREE.BufferAttribute(this.fallbackFlags, 1))
    this.fallbackGeometry.setAttribute('resultU', new THREE.BufferAttribute(resultU, 1))
    this.fallbackGeometry.setAttribute('resultRow', new THREE.BufferAttribute(resultRows, 1))
    this.fallbackGeometry.setDrawRange(0, memberIndices.length * 2)
    this.fallbackGeometry.computeBoundingSphere()
    this.fallbackLines.visible = this.membersVisible && memberIndices.length > 0
  }

  syncMemberState(entityId: number) {
    const database = this.database
    const memberIndex = database?.memberIndexById.get(entityId)
    if (!database || memberIndex === undefined) return
    const location = this.instanceLocationByEntityId.get(entityId)
    if (location) {
      location.batch.flags[location.instanceIndex] = database.memberFlags[memberIndex]
      ;(location.batch.geometry.getAttribute('instanceFlags') as THREE.InstancedBufferAttribute).needsUpdate = true
    }
    const fallbackVertex = this.fallbackVertexByEntityId.get(entityId)
    if (fallbackVertex !== undefined) {
      this.fallbackFlags[fallbackVertex] = this.fallbackFlags[fallbackVertex + 1] = database.memberFlags[memberIndex]
      ;(this.fallbackGeometry.getAttribute('entityFlags') as THREE.BufferAttribute).needsUpdate = true
    }
  }

  syncDirty() {
    const database = this.database
    if (!database) return
    if (database.memberCount !== this.uploadedMemberCount || database.profileCount !== this.uploadedProfileCount) {
      this.upload(database)
      return
    }
    if (database.dirtyProfiles) {
      for (let profileIndex = database.dirtyProfiles.min; profileIndex < database.dirtyProfiles.maxExclusive; profileIndex++) {
        if (familyForCode(database.profileFamilies[profileIndex]) === 'custom') {
          this.upload(database)
          return
        }
      }
      for (let memberIndex = 0; memberIndex < database.memberCount; memberIndex++) {
        const entityId = database.memberIds[memberIndex]
        const expectedKey = this.batchKey(database, memberIndex)
        const actualKey = this.instanceLocationByEntityId.get(entityId)?.batch.key ?? null
        if (expectedKey !== actualKey) {
          this.upload(database)
          return
        }
      }
    }
    if (database.dirtyMembers) {
      for (let memberIndex = database.dirtyMembers.min; memberIndex < database.dirtyMembers.maxExclusive; memberIndex++) {
        const entityId = database.memberIds[memberIndex]
        const expectedKey = this.batchKey(database, memberIndex)
        const actualKey = this.instanceLocationByEntityId.get(entityId)?.batch.key ?? null
        if (expectedKey !== actualKey) {
          this.upload(database)
          return
        }
      }
      this.updateDirtyMembers(database)
    }
    if (database.dirtyProfiles) this.updateProfileDimensions(database)
  }

  private updateDirtyMembers(database: StructuralSceneDB) {
    const range = database.dirtyMembers!
    for (let memberIndex = range.min; memberIndex < range.maxExclusive; memberIndex++) {
      const entityId = database.memberIds[memberIndex]
      const location = this.instanceLocationByEntityId.get(entityId)
      const endpointOffset = memberIndex * 6
      if (location) {
        const { batch, instanceIndex } = location
        const starts = batch.geometry.getAttribute('instanceStart') as THREE.InstancedBufferAttribute
        const ends = batch.geometry.getAttribute('instanceEnd') as THREE.InstancedBufferAttribute
        const references = batch.geometry.getAttribute('instanceReferenceAxis') as THREE.InstancedBufferAttribute
        const gamma = batch.geometry.getAttribute('instanceGamma') as THREE.InstancedBufferAttribute
        const flags = batch.geometry.getAttribute('instanceFlags') as THREE.InstancedBufferAttribute
        const orientation = batch.geometry.getAttribute('instanceOrientationFlags') as THREE.InstancedBufferAttribute
        starts.setXYZ(instanceIndex, database.memberEndpoints[endpointOffset], database.memberEndpoints[endpointOffset + 1], database.memberEndpoints[endpointOffset + 2])
        ends.setXYZ(instanceIndex, database.memberEndpoints[endpointOffset + 3], database.memberEndpoints[endpointOffset + 4], database.memberEndpoints[endpointOffset + 5])
        const referenceOffset = memberIndex * 3
        references.setXYZ(instanceIndex, database.memberReferenceAxes[referenceOffset], database.memberReferenceAxes[referenceOffset + 1], database.memberReferenceAxes[referenceOffset + 2])
        gamma.setX(instanceIndex, database.memberGammaRadians[memberIndex])
        batch.flags[instanceIndex] = database.memberFlags[memberIndex]
        orientation.setX(instanceIndex, database.memberOrientationFlags[memberIndex])
        starts.needsUpdate = ends.needsUpdate = references.needsUpdate = gamma.needsUpdate = flags.needsUpdate = orientation.needsUpdate = true
      }
      const fallbackVertex = this.fallbackVertexByEntityId.get(entityId)
      if (fallbackVertex !== undefined) {
        const positions = this.fallbackGeometry.getAttribute('position') as THREE.BufferAttribute
        positions.setXYZ(fallbackVertex, database.memberEndpoints[endpointOffset], database.memberEndpoints[endpointOffset + 1], database.memberEndpoints[endpointOffset + 2])
        positions.setXYZ(fallbackVertex + 1, database.memberEndpoints[endpointOffset + 3], database.memberEndpoints[endpointOffset + 4], database.memberEndpoints[endpointOffset + 5])
        this.fallbackFlags[fallbackVertex] = this.fallbackFlags[fallbackVertex + 1] = database.memberFlags[memberIndex]
        positions.needsUpdate = true
        ;(this.fallbackGeometry.getAttribute('entityFlags') as THREE.BufferAttribute).needsUpdate = true
      }
    }
  }

  private updateProfileDimensions(database: StructuralSceneDB) {
    for (const location of this.instanceLocationByEntityId.values()) {
      const entityId = location.batch.entityIds[location.instanceIndex]
      const memberIndex = database.memberIndexById.get(entityId)!
      const values = this.profileDimensions(database, memberIndex, location.batch)
      const dimensions = location.batch.geometry.getAttribute('instanceDimensions') as THREE.InstancedBufferAttribute
      dimensions.setXYZW(location.instanceIndex, values[0], values[1], values[2], values[3])
      dimensions.needsUpdate = true
    }
  }

  setVisible(visible: boolean) { this.group.visible = visible }
  setMembersVisible(visible: boolean) {
    this.membersVisible = visible
    for (const batch of this.batches.values()) {
      batch.mesh.visible = visible
      batch.edges.visible = visible
    }
    this.fallbackLines.visible = visible && this.fallbackGeometry.drawRange.count > 0
  }
  setQualityProfile(profile: QualityProfile) {
    if (profile === this.qualityProfile) return
    this.qualityProfile = profile
    const pipe = this.batches.get('pipe')
    if (pipe) setTemplate(pipe.geometry, pipe.edgeGeometry, createPipeThinShellTemplate(PIPE_SEGMENTS[profile]))
  }

  bindResult(binding: ResultBinding | null) {
    for (const material of [this.material, this.fallbackMaterial]) {
      const uniforms = material.uniforms
      uniforms.resultEnabled.value = binding ? 1 : 0
      if (!binding) continue
      uniforms.resultTexture.value = binding.texture
      uniforms.resultColorLut.value = binding.colorLut
      uniforms.resultTextureSize.value.set(binding.textureWidth, binding.textureHeight)
      uniforms.resultStationCount.value = binding.stationCount
      uniforms.resultMin.value = binding.min
      uniforms.resultMax.value = binding.max
    }
  }

  setResultRange(min: number, max: number) {
    for (const material of [this.material, this.fallbackMaterial]) {
      material.uniforms.resultMin.value = min
      material.uniforms.resultMax.value = max
    }
  }

  get instanceCount() {
    let count = 0
    for (const batch of this.batches.values()) count += batch.geometry.instanceCount
    return count
  }
  get activeBatchCount() {
    let count = 0
    for (const batch of this.batches.values()) if (batch.geometry.instanceCount > 0) count++
    return count
  }
  batchInstanceCount(key: string) { return this.batches.get(key)?.geometry.instanceCount ?? 0 }
  batchGeometry(key: string) { return this.batches.get(key)?.geometry }
  instanceIndexForEntityId(entityId: number) { return this.instanceLocationByEntityId.get(entityId)?.instanceIndex }

  dispose() {
    this.group.removeFromParent()
    for (const batch of this.batches.values()) {
      batch.geometry.dispose()
      batch.edgeGeometry.dispose()
    }
    this.fallbackGeometry.dispose()
    this.material.dispose()
    this.edgeMaterial.dispose()
    this.fallbackMaterial.dispose()
  }
}
