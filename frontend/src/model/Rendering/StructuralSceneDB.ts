import type { EntityId, RenderIndex } from './contracts'

export const ENTITY_VISIBLE = 1 << 0
export const ENTITY_SELECTED = 1 << 1
export const ENTITY_HOVERED = 1 << 2
export const MEMBER_MIRROR_Y = 1 << 0
export const MEMBER_MIRROR_Z = 1 << 1

export const PROFILE_PARAMETER_STRIDE = 8
export const MEMBER_ENDPOINT_STRIDE = 6
export const MEMBER_REFERENCE_AXIS_STRIDE = 3

export const PROFILE_FAMILIES = [
  'unknown', 'h', 'box', 'pipe', 'rectangular', 'channel', 'angle', 'tee', 'custom',
] as const
export type ProfileFamily = (typeof PROFILE_FAMILIES)[number]

const PROFILE_FAMILY_CODE = new Map<ProfileFamily, number>(
  PROFILE_FAMILIES.map((family, index) => [family, index]),
)

export type SceneNodeInput = {
  id: EntityId
  position: readonly [number, number, number]
  visible?: boolean
}

export type SceneProfileInput = {
  id: EntityId
  family: ProfileFamily
  /** SI metres: h, b, tw, tf, diameter, thickness, radius, reserved. */
  parameters?: readonly number[]
  materialId?: EntityId
  /** Custom section contour in local section coordinates [y, z], SI metres. */
  contour?: readonly (readonly [number, number])[]
  contourClosed?: boolean
}

export type SceneMemberInput = {
  id: EntityId
  startNodeId: EntityId
  endNodeId: EntityId
  profileId: EntityId
  /** Reference local axis in render-space coordinates. */
  referenceAxis?: readonly [number, number, number]
  gammaRadians?: number
  visible?: boolean
  mirrorY?: boolean
  mirrorZ?: boolean
}

export type StructuralSceneSource = {
  nodes: readonly SceneNodeInput[]
  profiles: readonly SceneProfileInput[]
  members: readonly SceneMemberInput[]
}

export type DirtyRange = { min: number; maxExclusive: number } | null

export type StructuralSceneDBSnapshot = {
  version: 2
  counts: { nodes: number; profiles: number; members: number }
  nodeIds: Uint32Array
  nodePositions: Float64Array
  nodeFlags: Uint8Array
  profileIds: Uint32Array
  profileFamilies: Uint8Array
  profileParameters: Float32Array
  profileMaterialIds: Uint32Array
  memberIds: Uint32Array
  memberStartNodeIndices: Uint32Array
  memberEndNodeIndices: Uint32Array
  memberProfileIndices: Uint32Array
  memberEndpoints: Float32Array
  memberReferenceAxes: Float32Array
  memberGammaRadians: Float32Array
  memberFlags: Uint8Array
  memberOrientationFlags: Uint8Array
  profileContourOffsets: Uint32Array
  profileContourCoordinates: Float32Array
  profileContourClosed: Uint8Array
}

const validateId = (id: number, label: string) => {
  if (!Number.isSafeInteger(id) || id < 0 || id > 0xffffffff) {
    throw new Error(`${label} must be an unsigned 32-bit integer; received ${id}`)
  }
}

const nextCapacity = (required: number, current: number) => {
  let capacity = Math.max(4, current)
  while (capacity < required) capacity *= 2
  return capacity
}

const resized = <T extends ArrayBufferView>(
  source: T,
  length: number,
  make: (length: number) => T,
) => {
  const target = make(length)
  ;(target as unknown as { set(values: T): void }).set(source)
  return target
}

const markRange = (range: DirtyRange, index: number): DirtyRange => ({
  min: range ? Math.min(range.min, index) : index,
  maxExclusive: range ? Math.max(range.maxExclusive, index + 1) : index + 1,
})

/**
 * CPU-side render database. It owns no Object3D and exposes contiguous buffers
 * that can be uploaded by either a WebGL2 or WebGPU renderer.
 */
export class StructuralSceneDB {
  version = 0
  nodeCount = 0
  profileCount = 0
  memberCount = 0

  nodeIds = new Uint32Array(0)
  nodePositions = new Float64Array(0)
  nodeFlags = new Uint8Array(0)
  profileIds = new Uint32Array(0)
  profileFamilies = new Uint8Array(0)
  profileParameters = new Float32Array(0)
  profileMaterialIds = new Uint32Array(0)
  memberIds = new Uint32Array(0)
  memberStartNodeIndices = new Uint32Array(0)
  memberEndNodeIndices = new Uint32Array(0)
  memberProfileIndices = new Uint32Array(0)
  memberEndpoints = new Float32Array(0)
  memberReferenceAxes = new Float32Array(0)
  memberGammaRadians = new Float32Array(0)
  memberFlags = new Uint8Array(0)
  memberOrientationFlags = new Uint8Array(0)

  readonly nodeIndexById = new Map<EntityId, RenderIndex>()
  readonly profileIndexById = new Map<EntityId, RenderIndex>()
  readonly memberIndexById = new Map<EntityId, RenderIndex>()
  readonly profileContours = new Map<EntityId, { coordinates: Float32Array; closed: boolean }>()
  private readonly memberIdsByNodeId = new Map<EntityId, Set<EntityId>>()

  dirtyNodes: DirtyRange = null
  dirtyProfiles: DirtyRange = null
  dirtyMembers: DirtyRange = null

  constructor(source?: StructuralSceneSource) {
    if (source) this.replace(source)
  }

  get byteLength() {
    return [
      this.nodeIds, this.nodePositions, this.nodeFlags,
      this.profileIds, this.profileFamilies, this.profileParameters, this.profileMaterialIds,
      this.memberIds, this.memberStartNodeIndices, this.memberEndNodeIndices,
      this.memberProfileIndices, this.memberEndpoints, this.memberReferenceAxes,
      this.memberGammaRadians, this.memberFlags,
      this.memberOrientationFlags,
    ].reduce((total, view) => total + view.byteLength, 0) +
      [...this.profileContours.values()].reduce((total, contour) => total + contour.coordinates.byteLength, 0)
  }

  replace(source: StructuralSceneSource) {
    this.clear()
    this.ensureNodeCapacity(source.nodes.length)
    this.ensureProfileCapacity(source.profiles.length)
    this.ensureMemberCapacity(source.members.length)
    for (const profile of source.profiles) this.addProfile(profile)
    for (const node of source.nodes) this.addNode(node)
    for (const member of source.members) this.addMember(member)
    this.dirtyNodes = this.nodeCount ? { min: 0, maxExclusive: this.nodeCount } : null
    this.dirtyProfiles = this.profileCount ? { min: 0, maxExclusive: this.profileCount } : null
    this.dirtyMembers = this.memberCount ? { min: 0, maxExclusive: this.memberCount } : null
    return this
  }

  clear() {
    this.nodeCount = this.profileCount = this.memberCount = 0
    this.nodeIndexById.clear()
    this.profileIndexById.clear()
    this.memberIndexById.clear()
    this.profileContours.clear()
    this.memberIdsByNodeId.clear()
    this.dirtyNodes = this.dirtyProfiles = this.dirtyMembers = null
    this.version++
  }

  clearDirtyRanges() {
    this.dirtyNodes = this.dirtyProfiles = this.dirtyMembers = null
  }

  entityIdForMemberIndex(index: RenderIndex) {
    return index >= 0 && index < this.memberCount ? this.memberIds[index] : undefined
  }

  entityIdForNodeIndex(index: RenderIndex) {
    return index >= 0 && index < this.nodeCount ? this.nodeIds[index] : undefined
  }

  addNode(node: SceneNodeInput) {
    validateId(node.id, 'Node id')
    if (this.nodeIndexById.has(node.id)) throw new Error(`Duplicate node id ${node.id}`)
    const index = this.nodeCount++
    this.ensureNodeCapacity(this.nodeCount)
    this.nodeIds[index] = node.id
    this.nodePositions.set(node.position, index * 3)
    this.nodeFlags[index] = node.visible === false ? 0 : ENTITY_VISIBLE
    this.nodeIndexById.set(node.id, index)
    this.memberIdsByNodeId.set(node.id, new Set())
    this.dirtyNodes = markRange(this.dirtyNodes, index)
    this.version++
    return index
  }

  updateNode(id: EntityId, position: readonly [number, number, number]) {
    const index = this.requireIndex(this.nodeIndexById, id, 'node')
    this.nodePositions.set(position, index * 3)
    this.dirtyNodes = markRange(this.dirtyNodes, index)
    for (const memberId of this.memberIdsByNodeId.get(id) ?? []) {
      const memberIndex = this.requireIndex(this.memberIndexById, memberId, 'member')
      this.writeMemberEndpoints(memberIndex)
      this.dirtyMembers = markRange(this.dirtyMembers, memberIndex)
    }
    this.version++
  }

  removeNode(id: EntityId) {
    if ((this.memberIdsByNodeId.get(id)?.size ?? 0) > 0) throw new Error(`Node ${id} is still referenced`)
    const index = this.requireIndex(this.nodeIndexById, id, 'node')
    const last = this.nodeCount - 1
    if (index !== last) {
      const movedId = this.nodeIds[last]
      this.nodeIds[index] = movedId
      this.nodePositions.copyWithin(index * 3, last * 3, last * 3 + 3)
      this.nodeFlags[index] = this.nodeFlags[last]
      this.nodeIndexById.set(movedId, index)
      for (const memberId of this.memberIdsByNodeId.get(movedId) ?? []) {
        const memberIndex = this.requireIndex(this.memberIndexById, memberId, 'member')
        if (this.memberStartNodeIndices[memberIndex] === last) this.memberStartNodeIndices[memberIndex] = index
        if (this.memberEndNodeIndices[memberIndex] === last) this.memberEndNodeIndices[memberIndex] = index
        this.dirtyMembers = markRange(this.dirtyMembers, memberIndex)
      }
    }
    this.nodeCount--
    this.nodeIndexById.delete(id)
    this.memberIdsByNodeId.delete(id)
    this.dirtyNodes = this.nodeCount ? { min: Math.min(index, this.nodeCount - 1), maxExclusive: this.nodeCount } : null
    this.version++
  }

  addProfile(profile: SceneProfileInput) {
    validateId(profile.id, 'Profile id')
    if (this.profileIndexById.has(profile.id)) throw new Error(`Duplicate profile id ${profile.id}`)
    const familyCode = PROFILE_FAMILY_CODE.get(profile.family)
    if (familyCode === undefined) throw new Error(`Unsupported profile family ${profile.family}`)
    const index = this.profileCount++
    this.ensureProfileCapacity(this.profileCount)
    this.profileIds[index] = profile.id
    this.profileFamilies[index] = familyCode
    this.profileParameters.fill(0, index * PROFILE_PARAMETER_STRIDE, (index + 1) * PROFILE_PARAMETER_STRIDE)
    this.profileParameters.set(profile.parameters?.slice(0, PROFILE_PARAMETER_STRIDE) ?? [], index * PROFILE_PARAMETER_STRIDE)
    this.profileMaterialIds[index] = profile.materialId ?? 0
    this.writeProfileContour(profile.id, profile.contour, profile.contourClosed)
    this.profileIndexById.set(profile.id, index)
    this.dirtyProfiles = markRange(this.dirtyProfiles, index)
    this.version++
    return index
  }

  updateProfile(id: EntityId, patch: Partial<Omit<SceneProfileInput, 'id'>>) {
    const index = this.requireIndex(this.profileIndexById, id, 'profile')
    if (patch.family !== undefined) {
      const familyCode = PROFILE_FAMILY_CODE.get(patch.family)
      if (familyCode === undefined) throw new Error(`Unsupported profile family ${patch.family}`)
      this.profileFamilies[index] = familyCode
    }
    if (patch.parameters !== undefined) {
      const offset = index * PROFILE_PARAMETER_STRIDE
      this.profileParameters.fill(0, offset, offset + PROFILE_PARAMETER_STRIDE)
      this.profileParameters.set(patch.parameters.slice(0, PROFILE_PARAMETER_STRIDE), offset)
    }
    if (patch.materialId !== undefined) this.profileMaterialIds[index] = patch.materialId
    if (patch.contour !== undefined || patch.contourClosed !== undefined) {
      const existing = this.profileContours.get(id)
      const contour = patch.contour ?? (existing
        ? Array.from({ length: existing.coordinates.length / 2 }, (_, pointIndex) =>
            [existing.coordinates[pointIndex * 2], existing.coordinates[pointIndex * 2 + 1]] as const)
        : undefined)
      this.writeProfileContour(id, contour, patch.contourClosed ?? existing?.closed)
    }
    this.dirtyProfiles = markRange(this.dirtyProfiles, index)
    this.version++
  }

  removeProfile(id: EntityId) {
    const index = this.requireIndex(this.profileIndexById, id, 'profile')
    for (let memberIndex = 0; memberIndex < this.memberCount; memberIndex++) {
      if (this.memberProfileIndices[memberIndex] === index) throw new Error(`Profile ${id} is still referenced`)
    }
    const last = this.profileCount - 1
    if (index !== last) {
      const movedId = this.profileIds[last]
      this.profileIds[index] = movedId
      this.profileFamilies[index] = this.profileFamilies[last]
      this.profileParameters.copyWithin(
        index * PROFILE_PARAMETER_STRIDE,
        last * PROFILE_PARAMETER_STRIDE,
        (last + 1) * PROFILE_PARAMETER_STRIDE,
      )
      this.profileMaterialIds[index] = this.profileMaterialIds[last]
      this.profileIndexById.set(movedId, index)
      for (let memberIndex = 0; memberIndex < this.memberCount; memberIndex++) {
        if (this.memberProfileIndices[memberIndex] === last) {
          this.memberProfileIndices[memberIndex] = index
          this.dirtyMembers = markRange(this.dirtyMembers, memberIndex)
        }
      }
    }
    this.profileCount--
    this.profileIndexById.delete(id)
    this.profileContours.delete(id)
    this.dirtyProfiles = this.profileCount
      ? { min: Math.min(index, this.profileCount - 1), maxExclusive: this.profileCount }
      : null
    this.version++
  }

  addMember(member: SceneMemberInput) {
    validateId(member.id, 'Member id')
    if (this.memberIndexById.has(member.id)) throw new Error(`Duplicate member id ${member.id}`)
    const startIndex = this.requireIndex(this.nodeIndexById, member.startNodeId, 'start node')
    const endIndex = this.requireIndex(this.nodeIndexById, member.endNodeId, 'end node')
    const profileIndex = this.requireIndex(this.profileIndexById, member.profileId, 'profile')
    const index = this.memberCount++
    this.ensureMemberCapacity(this.memberCount)
    this.memberIds[index] = member.id
    this.memberStartNodeIndices[index] = startIndex
    this.memberEndNodeIndices[index] = endIndex
    this.memberProfileIndices[index] = profileIndex
    this.memberReferenceAxes.set(member.referenceAxis ?? [0, 1, 0], index * MEMBER_REFERENCE_AXIS_STRIDE)
    this.memberGammaRadians[index] = member.gammaRadians ?? 0
    this.memberFlags[index] = member.visible === false ? 0 : ENTITY_VISIBLE
    this.memberOrientationFlags[index] =
      (member.mirrorY ? MEMBER_MIRROR_Y : 0) |
      (member.mirrorZ ? MEMBER_MIRROR_Z : 0)
    this.memberIndexById.set(member.id, index)
    this.memberIdsByNodeId.get(member.startNodeId)?.add(member.id)
    this.memberIdsByNodeId.get(member.endNodeId)?.add(member.id)
    this.writeMemberEndpoints(index)
    this.dirtyMembers = markRange(this.dirtyMembers, index)
    this.version++
    return index
  }

  updateMember(id: EntityId, patch: Partial<Omit<SceneMemberInput, 'id'>>) {
    const index = this.requireIndex(this.memberIndexById, id, 'member')
    const oldStartId = this.nodeIds[this.memberStartNodeIndices[index]]
    const oldEndId = this.nodeIds[this.memberEndNodeIndices[index]]
    const startId = patch.startNodeId ?? oldStartId
    const endId = patch.endNodeId ?? oldEndId
    const startIndex = this.requireIndex(this.nodeIndexById, startId, 'start node')
    const endIndex = this.requireIndex(this.nodeIndexById, endId, 'end node')
    const profileIndex = patch.profileId === undefined
      ? this.memberProfileIndices[index]
      : this.requireIndex(this.profileIndexById, patch.profileId, 'profile')
    if (startId !== oldStartId) {
      this.memberIdsByNodeId.get(oldStartId)?.delete(id)
      this.memberIdsByNodeId.get(startId)?.add(id)
      this.memberStartNodeIndices[index] = startIndex
    }
    if (endId !== oldEndId) {
      this.memberIdsByNodeId.get(oldEndId)?.delete(id)
      this.memberIdsByNodeId.get(endId)?.add(id)
      this.memberEndNodeIndices[index] = endIndex
    }
    this.memberProfileIndices[index] = profileIndex
    if (patch.referenceAxis) this.memberReferenceAxes.set(patch.referenceAxis, index * MEMBER_REFERENCE_AXIS_STRIDE)
    if (patch.gammaRadians !== undefined) this.memberGammaRadians[index] = patch.gammaRadians
    if (patch.mirrorY !== undefined) {
      this.memberOrientationFlags[index] = patch.mirrorY
        ? this.memberOrientationFlags[index] | MEMBER_MIRROR_Y
        : this.memberOrientationFlags[index] & ~MEMBER_MIRROR_Y
    }
    if (patch.mirrorZ !== undefined) {
      this.memberOrientationFlags[index] = patch.mirrorZ
        ? this.memberOrientationFlags[index] | MEMBER_MIRROR_Z
        : this.memberOrientationFlags[index] & ~MEMBER_MIRROR_Z
    }
    if (patch.visible !== undefined) this.setMemberFlag(id, ENTITY_VISIBLE, patch.visible)
    this.writeMemberEndpoints(index)
    this.dirtyMembers = markRange(this.dirtyMembers, index)
    this.version++
  }

  removeMember(id: EntityId) {
    const index = this.requireIndex(this.memberIndexById, id, 'member')
    this.detachMember(index, id)
    const last = this.memberCount - 1
    if (index !== last) {
      const movedId = this.memberIds[last]
      this.memberIds[index] = movedId
      this.memberStartNodeIndices[index] = this.memberStartNodeIndices[last]
      this.memberEndNodeIndices[index] = this.memberEndNodeIndices[last]
      this.memberProfileIndices[index] = this.memberProfileIndices[last]
      this.memberEndpoints.copyWithin(index * 6, last * 6, last * 6 + 6)
      this.memberReferenceAxes.copyWithin(index * 3, last * 3, last * 3 + 3)
      this.memberGammaRadians[index] = this.memberGammaRadians[last]
      this.memberFlags[index] = this.memberFlags[last]
      this.memberOrientationFlags[index] = this.memberOrientationFlags[last]
      this.memberIndexById.set(movedId, index)
    }
    this.memberCount--
    this.memberIndexById.delete(id)
    this.dirtyMembers = this.memberCount ? { min: Math.min(index, this.memberCount - 1), maxExclusive: this.memberCount } : null
    this.version++
  }

  setMemberFlag(id: EntityId, flag: number, enabled: boolean) {
    const index = this.requireIndex(this.memberIndexById, id, 'member')
    this.memberFlags[index] = enabled ? this.memberFlags[index] | flag : this.memberFlags[index] & ~flag
    this.dirtyMembers = markRange(this.dirtyMembers, index)
    this.version++
  }

  setNodeFlag(id: EntityId, flag: number, enabled: boolean) {
    const index = this.requireIndex(this.nodeIndexById, id, 'node')
    this.nodeFlags[index] = enabled ? this.nodeFlags[index] | flag : this.nodeFlags[index] & ~flag
    this.dirtyNodes = markRange(this.dirtyNodes, index)
    this.version++
  }

  toTransferableSnapshot(): { snapshot: StructuralSceneDBSnapshot; transferables: ArrayBuffer[] } {
    const profileContourOffsets = new Uint32Array(this.profileCount + 1)
    const profileContourClosed = new Uint8Array(this.profileCount)
    let coordinateCount = 0
    for (let profileIndex = 0; profileIndex < this.profileCount; profileIndex++) {
      profileContourOffsets[profileIndex] = coordinateCount
      const contour = this.profileContours.get(this.profileIds[profileIndex])
      coordinateCount += contour?.coordinates.length ?? 0
      profileContourClosed[profileIndex] = contour?.closed ? 1 : 0
    }
    profileContourOffsets[this.profileCount] = coordinateCount
    const profileContourCoordinates = new Float32Array(coordinateCount)
    let contourCursor = 0
    for (let profileIndex = 0; profileIndex < this.profileCount; profileIndex++) {
      const contour = this.profileContours.get(this.profileIds[profileIndex])
      if (contour) {
        profileContourCoordinates.set(contour.coordinates, contourCursor)
        contourCursor += contour.coordinates.length
      }
    }
    const snapshot: StructuralSceneDBSnapshot = {
      version: 2,
      counts: { nodes: this.nodeCount, profiles: this.profileCount, members: this.memberCount },
      nodeIds: this.nodeIds.slice(0, this.nodeCount),
      nodePositions: this.nodePositions.slice(0, this.nodeCount * 3),
      nodeFlags: this.nodeFlags.slice(0, this.nodeCount),
      profileIds: this.profileIds.slice(0, this.profileCount),
      profileFamilies: this.profileFamilies.slice(0, this.profileCount),
      profileParameters: this.profileParameters.slice(0, this.profileCount * PROFILE_PARAMETER_STRIDE),
      profileMaterialIds: this.profileMaterialIds.slice(0, this.profileCount),
      memberIds: this.memberIds.slice(0, this.memberCount),
      memberStartNodeIndices: this.memberStartNodeIndices.slice(0, this.memberCount),
      memberEndNodeIndices: this.memberEndNodeIndices.slice(0, this.memberCount),
      memberProfileIndices: this.memberProfileIndices.slice(0, this.memberCount),
      memberEndpoints: this.memberEndpoints.slice(0, this.memberCount * MEMBER_ENDPOINT_STRIDE),
      memberReferenceAxes: this.memberReferenceAxes.slice(0, this.memberCount * MEMBER_REFERENCE_AXIS_STRIDE),
      memberGammaRadians: this.memberGammaRadians.slice(0, this.memberCount),
      memberFlags: this.memberFlags.slice(0, this.memberCount),
      memberOrientationFlags: this.memberOrientationFlags.slice(0, this.memberCount),
      profileContourOffsets,
      profileContourCoordinates,
      profileContourClosed,
    }
    const views: ArrayBufferView[] = [
      snapshot.nodeIds, snapshot.nodePositions, snapshot.nodeFlags,
      snapshot.profileIds, snapshot.profileFamilies, snapshot.profileParameters,
      snapshot.profileMaterialIds, snapshot.memberIds, snapshot.memberStartNodeIndices,
      snapshot.memberEndNodeIndices, snapshot.memberProfileIndices, snapshot.memberEndpoints,
      snapshot.memberReferenceAxes, snapshot.memberGammaRadians, snapshot.memberFlags,
      snapshot.memberOrientationFlags, snapshot.profileContourOffsets,
      snapshot.profileContourCoordinates, snapshot.profileContourClosed,
    ]
    const transferables = views.map(value => value.buffer as ArrayBuffer)
    return { snapshot, transferables }
  }

  private requireIndex(map: Map<EntityId, RenderIndex>, id: EntityId, label: string) {
    const index = map.get(id)
    if (index === undefined) throw new Error(`Unknown ${label} id ${id}`)
    return index
  }

  private writeProfileContour(
    id: EntityId,
    contour: readonly (readonly [number, number])[] | undefined,
    closed = false,
  ) {
    if (contour === undefined) return
    if (contour.length < 2) throw new Error(`Custom profile ${id} contour requires at least two points`)
    const coordinates = new Float32Array(contour.length * 2)
    contour.forEach((point, index) => {
      if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
        throw new Error(`Custom profile ${id} contour contains a non-finite coordinate`)
      }
      coordinates[index * 2] = point[0]
      coordinates[index * 2 + 1] = point[1]
    })
    this.profileContours.set(id, { coordinates, closed })
  }

  private writeMemberEndpoints(index: number) {
    const start = this.memberStartNodeIndices[index] * 3
    const end = this.memberEndNodeIndices[index] * 3
    this.memberEndpoints.set(this.nodePositions.subarray(start, start + 3), index * 6)
    this.memberEndpoints.set(this.nodePositions.subarray(end, end + 3), index * 6 + 3)
  }

  private detachMember(index: number, id: EntityId) {
    this.memberIdsByNodeId.get(this.nodeIds[this.memberStartNodeIndices[index]])?.delete(id)
    this.memberIdsByNodeId.get(this.nodeIds[this.memberEndNodeIndices[index]])?.delete(id)
  }

  private ensureNodeCapacity(required: number) {
    if (this.nodeIds.length >= required) return
    const capacity = nextCapacity(required, this.nodeIds.length)
    this.nodeIds = resized(this.nodeIds, capacity, length => new Uint32Array(length))
    this.nodePositions = resized(this.nodePositions, capacity * 3, length => new Float64Array(length))
    this.nodeFlags = resized(this.nodeFlags, capacity, length => new Uint8Array(length))
  }

  private ensureProfileCapacity(required: number) {
    if (this.profileIds.length >= required) return
    const capacity = nextCapacity(required, this.profileIds.length)
    this.profileIds = resized(this.profileIds, capacity, length => new Uint32Array(length))
    this.profileFamilies = resized(this.profileFamilies, capacity, length => new Uint8Array(length))
    this.profileParameters = resized(this.profileParameters, capacity * PROFILE_PARAMETER_STRIDE, length => new Float32Array(length))
    this.profileMaterialIds = resized(this.profileMaterialIds, capacity, length => new Uint32Array(length))
  }

  private ensureMemberCapacity(required: number) {
    if (this.memberIds.length >= required) return
    const capacity = nextCapacity(required, this.memberIds.length)
    this.memberIds = resized(this.memberIds, capacity, length => new Uint32Array(length))
    this.memberStartNodeIndices = resized(this.memberStartNodeIndices, capacity, length => new Uint32Array(length))
    this.memberEndNodeIndices = resized(this.memberEndNodeIndices, capacity, length => new Uint32Array(length))
    this.memberProfileIndices = resized(this.memberProfileIndices, capacity, length => new Uint32Array(length))
    this.memberEndpoints = resized(this.memberEndpoints, capacity * MEMBER_ENDPOINT_STRIDE, length => new Float32Array(length))
    this.memberReferenceAxes = resized(this.memberReferenceAxes, capacity * MEMBER_REFERENCE_AXIS_STRIDE, length => new Float32Array(length))
    this.memberGammaRadians = resized(this.memberGammaRadians, capacity, length => new Float32Array(length))
    this.memberFlags = resized(this.memberFlags, capacity, length => new Uint8Array(length))
    this.memberOrientationFlags = resized(this.memberOrientationFlags, capacity, length => new Uint8Array(length))
  }
}
