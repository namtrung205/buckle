export const STRUCTURAL_DOCUMENT_VERSION = 1 as const
export const STRUCTURAL_SCHEMA_VERSION = '1.0' as const

export type EntityId = number
export type Vector3Record = readonly [number, number, number]

export const ENTITY_COLLECTIONS = [
  'nodes', 'materials', 'sections', 'members', 'shells', 'loads',
  'boundaryConditions', 'grids', 'levels', 'groups', 'parametricObjects',
] as const
export type EntityCollection = (typeof ENTITY_COLLECTIONS)[number]
export type EntityReference = Readonly<{ collection: EntityCollection; id: EntityId }>

export type NodeRecord = {
  id: EntityId
  name?: string
  position: Vector3Record
}

export type MaterialRecord = {
  id: EntityId
  name: string
  category?: string
  code?: string
  E: number
  nu: number
  rho?: number
  alpha?: number
  fy?: number
  fc?: number
  fu?: number
  ft?: number
  grade?: string
  preset?: string
}

export const SECTION_TYPES = [
  'I', 'Rectangular', 'Circular', 'HollowCircular', 'RectangularHollow',
  'Channel', 'Angle', 'Tee', 'IPN', 'UPN',
] as const
export type SectionType = (typeof SECTION_TYPES)[number]

export type SectionRecord = {
  id: EntityId
  name: string
  type: SectionType
  materialId: EntityId
  depth?: number
  height?: number
  width?: number
  tw?: number
  tf?: number
  diameter?: number
  thickness?: number
  r?: number
  ri?: number
  properties?: Readonly<Record<string, number>>
}

export type Member1DRecord = {
  id: EntityId
  label?: string
  nodeI: EntityId
  nodeJ: EntityId
  sectionId: EntityId
  referenceAxis?: Vector3Record
  gammaDegrees?: number
  release?: string
}

export type Shell2DRecord = {
  id: EntityId
  name?: string
  nodeIds: readonly [EntityId, EntityId, EntityId, EntityId]
  thickness: number
  materialId: EntityId
}

export type LoadType = 'nodal' | 'linear' | 'area' | 'pressure'
export type LoadRecord = {
  id: EntityId
  name?: string
  type: LoadType
  targetIds: readonly EntityId[]
  value: Vector3Record
  magnitude?: number
}

export type BoundaryConditionType =
  | 'fixed' | 'pinned' | 'roller' | 'roller-x' | 'roller-y' | 'custom' | 'elastic'
export type BoundaryConditionRecord = {
  id: EntityId
  name?: string
  type: BoundaryConditionType
  targetNodeIds: readonly EntityId[]
  dx: number
  dy: number
  dz: number
  rx: number
  ry: number
  rz: number
  rotationDegrees?: number
}

export type GridRecord = {
  id: EntityId
  name: string
  kind?: string
  data?: Readonly<Record<string, unknown>>
}

export type LevelRecord = {
  id: EntityId
  name: string
  elevation: number
}

export type GroupRecord = {
  id: EntityId
  name: string
  entityRefs: readonly EntityReference[]
}

export type ParametricObjectRecord = {
  id: EntityId
  kind: string
  version: number
  parameters: Readonly<Record<string, unknown>>
  ownedEntityRefs: readonly EntityReference[]
  /** Stable semantic role -> concrete document entity. */
  roleBindings?: Readonly<Record<string, EntityReference>>
  constraints?: readonly Readonly<Record<string, unknown>>[]
  generatorVersion: string
  provenance?: Readonly<{
    source: string
    createdAt?: string
    updatedAt?: string
    parentObjectId?: EntityId
  }>
}

export type StructuralDocumentSeed = {
  nodes?: readonly NodeRecord[]
  materials?: readonly MaterialRecord[]
  sections?: readonly SectionRecord[]
  members?: readonly Member1DRecord[]
  shells?: readonly Shell2DRecord[]
  loads?: readonly LoadRecord[]
  boundaryConditions?: readonly BoundaryConditionRecord[]
  grids?: readonly GridRecord[]
  levels?: readonly LevelRecord[]
  groups?: readonly GroupRecord[]
  parametricObjects?: readonly ParametricObjectRecord[]
  metadata?: Readonly<Record<string, unknown>>
}

export type StructuralDocumentSnapshot = Required<Omit<StructuralDocumentSeed, 'metadata'>> & {
  documentVersion: typeof STRUCTURAL_DOCUMENT_VERSION
  schemaVersion: typeof STRUCTURAL_SCHEMA_VERSION
  revision: number
  metadata: Readonly<Record<string, unknown>>
}

export type EntityDelta = {
  created: readonly EntityId[]
  updated: readonly EntityId[]
  deleted: readonly EntityId[]
}

export type StructuralChangeSet = {
  previousRevision: number
  revision: number
  changes: Readonly<Record<EntityCollection, EntityDelta>>
}

export type AnalysisTransportModel = {
  schemaVersion: typeof STRUCTURAL_SCHEMA_VERSION
  nodes: readonly { id: number; name?: string; x: number; y: number; z: number }[]
  materials: readonly MaterialRecord[]
  sections: readonly (Omit<SectionRecord, 'materialId'> & { material: MaterialRecord })[]
  members: readonly {
    id: number
    label?: string
    nodei: { id: number; name?: string; x: number; y: number; z: number }
    nodej: { id: number; name?: string; x: number; y: number; z: number }
    section: number
    vecxz?: Vector3Record
    gamma: number
    release: string
  }[]
  loads: readonly {
    id: number
    name?: string
    type: LoadType
    targets: readonly number[]
    value: { x: number; y: number; z: number }
    magnitude?: number
  }[]
  boundary_conditions: readonly {
    id: number
    name?: string
    type: BoundaryConditionType
    targets: readonly number[]
    dx: number; dy: number; dz: number; rx: number; ry: number; rz: number
    rotation: number
  }[]
  shells: readonly {
    id: number
    name?: string
    nodes: readonly number[]
    thickness: number
    material: MaterialRecord
  }[]
  metadata: Readonly<Record<string, unknown>> & { modelRevision: number; snapshotHash: string }
}

export type AnalysisTransportInput = Omit<AnalysisTransportModel, 'metadata'> & {
  metadata?: Readonly<Record<string, unknown>>
}

export type AnalysisSnapshot = Readonly<{
  revision: number
  hash: string
  model: AnalysisTransportModel
}>
