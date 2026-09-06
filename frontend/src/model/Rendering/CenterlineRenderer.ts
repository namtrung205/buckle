import * as THREE from 'three'
import {
  ENTITY_HOVERED,
  ENTITY_SELECTED,
  ENTITY_VISIBLE,
  type StructuralSceneDB,
} from './StructuralSceneDB.ts'
import type { QualityProfile } from './contracts'

const VERTICES_PER_MEMBER = 2

const LINE_VERTEX_SHADER = /* glsl */ `
  attribute float entityFlags;
  varying float vFlags;

  void main() {
    vFlags = entityFlags;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const LINE_FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;
  varying float vFlags;

  bool hasFlag(float value, float flag) {
    return mod(floor(value / flag), 2.0) > 0.5;
  }

  void main() {
    if (!hasFlag(vFlags, 1.0)) discard;
    vec3 color = vec3(0.63, 0.68, 0.72);
    if (hasFlag(vFlags, 4.0)) color = vec3(1.0, 0.72, 0.12);
    if (hasFlag(vFlags, 2.0)) color = vec3(1.0, 0.22, 0.12);
    gl_FragColor = vec4(color, 1.0);
  }
`

const NODE_VERTEX_SHADER = /* glsl */ `
  attribute float entityFlags;
  uniform float pointSize;
  varying float vFlags;

  void main() {
    vFlags = entityFlags;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = pointSize;
  }
`

const NODE_FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;
  varying float vFlags;

  bool hasFlag(float value, float flag) {
    return mod(floor(value / flag), 2.0) > 0.5;
  }

  void main() {
    if (!hasFlag(vFlags, 1.0)) discard;
    vec2 centered = gl_PointCoord * 2.0 - 1.0;
    if (dot(centered, centered) > 1.0) discard;
    vec3 color = vec3(0.15, 0.36, 1.0);
    if (hasFlag(vFlags, 4.0)) color = vec3(1.0, 0.72, 0.12);
    if (hasFlag(vFlags, 2.0)) color = vec3(1.0, 0.22, 0.12);
    gl_FragColor = vec4(color, 1.0);
  }
`

/**
 * Goal-2 WebGL2 centerline pass. One LineSegments plus one Points object render
 * every structural member/node; no per-entity Object3D is created.
 */
export default class CenterlineRenderer {
  readonly group = new THREE.Group()
  readonly lineGeometry = new THREE.BufferGeometry()
  readonly nodeGeometry = new THREE.BufferGeometry()
  readonly lines: THREE.LineSegments
  readonly nodes: THREE.Points
  private database: StructuralSceneDB | null = null
  private memberFlags = new Float32Array(0)
  private nodeFlags = new Float32Array(0)

  constructor(scene: THREE.Scene, layer: number) {
    const lineMaterial = new THREE.ShaderMaterial({
      vertexShader: LINE_VERTEX_SHADER,
      fragmentShader: LINE_FRAGMENT_SHADER,
      depthTest: true,
      depthWrite: true,
    })
    const nodeMaterial = new THREE.ShaderMaterial({
      vertexShader: NODE_VERTEX_SHADER,
      fragmentShader: NODE_FRAGMENT_SHADER,
      uniforms: { pointSize: { value: 4 } },
      depthTest: true,
      depthWrite: true,
    })
    this.lines = new THREE.LineSegments(this.lineGeometry, lineMaterial)
    this.nodes = new THREE.Points(this.nodeGeometry, nodeMaterial)
    // The single global batch is also the first spatial chunk. Three.js can
    // reject it as a unit when the complete model is outside the frustum.
    this.lines.frustumCulled = true
    this.nodes.frustumCulled = true
    this.lines.userData.type = 'structural-centerlines'
    this.nodes.userData.type = 'structural-nodes'
    this.group.name = 'StructuralCenterlineRenderer'
    this.group.layers.set(layer)
    this.lines.layers.set(layer)
    this.nodes.layers.set(layer)
    this.group.add(this.lines, this.nodes)
    this.group.visible = false
    scene.add(this.group)
  }

  upload(database: StructuralSceneDB) {
    this.database = database
    const memberCount = database.memberCount
    const nodeCount = database.nodeCount
    const positions = database.memberEndpoints.slice(0, memberCount * 6)
    this.memberFlags = new Float32Array(memberCount * VERTICES_PER_MEMBER)
    for (let index = 0; index < memberCount; index++) {
      const flags = database.memberFlags[index]
      this.memberFlags[index * 2] = flags
      this.memberFlags[index * 2 + 1] = flags
    }
    const nodePositions = new Float32Array(nodeCount * 3)
    nodePositions.set(database.nodePositions.subarray(0, nodeCount * 3))
    this.nodeFlags = new Float32Array(nodeCount)
    for (let index = 0; index < nodeCount; index++) this.nodeFlags[index] = database.nodeFlags[index]
    this.lineGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.lineGeometry.setAttribute('entityFlags', new THREE.BufferAttribute(this.memberFlags, 1))
    this.lineGeometry.setDrawRange(0, memberCount * VERTICES_PER_MEMBER)
    this.nodeGeometry.setAttribute('position', new THREE.BufferAttribute(nodePositions, 3))
    this.nodeGeometry.setAttribute('entityFlags', new THREE.BufferAttribute(this.nodeFlags, 1))
    this.nodeGeometry.setDrawRange(0, nodeCount)
    this.lineGeometry.computeBoundingSphere()
    this.nodeGeometry.computeBoundingSphere()
    database.clearDirtyRanges()
  }

  syncDirty() {
    const database = this.database
    if (!database) return
    const range = database.dirtyMembers
    if (range) {
      const position = this.lineGeometry.getAttribute('position') as THREE.BufferAttribute
      const flags = this.lineGeometry.getAttribute('entityFlags') as THREE.BufferAttribute
      for (let index = range.min; index < range.maxExclusive; index++) {
        const endpointOffset = index * 6
        for (let component = 0; component < 6; component++) {
          position.array[endpointOffset + component] = database.memberEndpoints[endpointOffset + component]
        }
        this.memberFlags[index * 2] = database.memberFlags[index]
        this.memberFlags[index * 2 + 1] = database.memberFlags[index]
      }
      position.needsUpdate = true
      flags.needsUpdate = true
      this.lineGeometry.setDrawRange(0, database.memberCount * 2)
    }
    const nodeRange = database.dirtyNodes
    if (nodeRange) {
      const position = this.nodeGeometry.getAttribute('position') as THREE.BufferAttribute
      const flags = this.nodeGeometry.getAttribute('entityFlags') as THREE.BufferAttribute
      for (let index = nodeRange.min; index < nodeRange.maxExclusive; index++) {
        const offset = index * 3
        position.setXYZ(
          index,
          database.nodePositions[offset],
          database.nodePositions[offset + 1],
          database.nodePositions[offset + 2],
        )
        this.nodeFlags[index] = database.nodeFlags[index]
      }
      position.needsUpdate = true
      flags.needsUpdate = true
      this.nodeGeometry.setDrawRange(0, database.nodeCount)
    }
    database.clearDirtyRanges()
  }

  setVisible(visible: boolean) {
    this.group.visible = visible
  }

  setMembersVisible(visible: boolean) {
    this.lines.visible = visible
  }

  setNodesVisible(visible: boolean) {
    this.nodes.visible = visible
  }

  setQualityProfile(profile: QualityProfile) {
    const sizes: Record<QualityProfile, number> = { low: 3, balanced: 4, high: 5, custom: 4 }
    ;(this.nodes.material as THREE.ShaderMaterial).uniforms.pointSize.value = sizes[profile]
  }

  setMemberState(entityId: number, state: { visible?: boolean; selected?: boolean; hovered?: boolean }) {
    const database = this.database
    if (!database) return
    if (state.visible !== undefined) database.setMemberFlag(entityId, ENTITY_VISIBLE, state.visible)
    if (state.selected !== undefined) database.setMemberFlag(entityId, ENTITY_SELECTED, state.selected)
    if (state.hovered !== undefined) database.setMemberFlag(entityId, ENTITY_HOVERED, state.hovered)
    this.syncDirty()
  }

  setNodeState(entityId: number, state: { visible?: boolean; selected?: boolean; hovered?: boolean }) {
    const database = this.database
    if (!database) return
    if (state.visible !== undefined) database.setNodeFlag(entityId, ENTITY_VISIBLE, state.visible)
    if (state.selected !== undefined) database.setNodeFlag(entityId, ENTITY_SELECTED, state.selected)
    if (state.hovered !== undefined) database.setNodeFlag(entityId, ENTITY_HOVERED, state.hovered)
    this.syncDirty()
  }

  entityIdForVertexIndex(vertexIndex: number) {
    return this.database?.entityIdForMemberIndex(Math.floor(vertexIndex / VERTICES_PER_MEMBER))
  }

  dispose() {
    this.group.removeFromParent()
    this.lineGeometry.dispose()
    this.nodeGeometry.dispose()
    ;(this.lines.material as THREE.Material).dispose()
    ;(this.nodes.material as THREE.Material).dispose()
    this.database = null
  }
}
