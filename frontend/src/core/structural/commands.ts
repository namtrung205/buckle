import type {
  BoundaryConditionRecord,
  EntityId,
  EntityReference,
  LoadRecord,
  MaterialRecord,
  Member1DRecord,
  NodeRecord,
  GridRecord,
  LevelRecord,
  ParametricObjectRecord,
  SectionRecord,
  Shell2DRecord,
  StructuralChangeSet,
  StructuralDocumentSeed,
  Vector3Record,
} from './types.ts'

export const COMMAND_SCHEMA_VERSION = '1.0' as const

export type CommandSource = 'ui' | 'ai' | 'mcp' | 'script' | 'system'
export type LocalReference = EntityId | Readonly<{ alias: string }>
export type Creatable<T> = Omit<T, 'id'> & { id?: EntityId; alias?: string }

export type StructuralCommandOperation =
  | { type: 'CreateNodes'; payload: { nodes: readonly Creatable<NodeRecord>[] } }
  | { type: 'MoveNodes'; payload: { nodes: readonly { id: LocalReference; position: Vector3Record; name?: string }[] } }
  | { type: 'DeleteNodes'; payload: { ids: readonly LocalReference[]; cascade?: boolean } }
  | { type: 'CreateMembers'; payload: { members: readonly (Omit<Creatable<Member1DRecord>, 'nodeI' | 'nodeJ' | 'sectionId'> & { nodeI: LocalReference; nodeJ: LocalReference; sectionId: LocalReference })[] } }
  | { type: 'UpdateMembers'; payload: { members: readonly { id: LocalReference; patch: Partial<Omit<Member1DRecord, 'id'>> }[] } }
  | { type: 'DeleteMembers'; payload: { ids: readonly LocalReference[] } }
  | { type: 'DeleteShells'; payload: { ids: readonly LocalReference[] } }
  | { type: 'CreateOrUpdateShells'; payload: { shells: readonly Creatable<Shell2DRecord>[] } }
  | { type: 'CreateOrUpdateSections'; payload: { sections: readonly (Omit<Creatable<SectionRecord>, 'materialId'> & { materialId: LocalReference })[] } }
  | { type: 'DeleteSections'; payload: { ids: readonly LocalReference[]; cascade?: boolean } }
  | { type: 'CreateOrUpdateMaterials'; payload: { materials: readonly Creatable<MaterialRecord>[] } }
  | { type: 'DeleteMaterials'; payload: { ids: readonly LocalReference[] } }
  | { type: 'CreateOrUpdateLoads'; payload: { loads: readonly Creatable<LoadRecord>[] } }
  | { type: 'DeleteLoads'; payload: { ids: readonly LocalReference[] } }
  | { type: 'CreateOrUpdateBoundaryConditions'; payload: { boundaryConditions: readonly Creatable<BoundaryConditionRecord>[] } }
  | { type: 'DeleteBoundaryConditions'; payload: { ids: readonly LocalReference[] } }
  | { type: 'CreateOrUpdateGrids'; payload: { grids: readonly Creatable<GridRecord>[] } }
  | { type: 'DeleteGrids'; payload: { ids: readonly LocalReference[] } }
  | { type: 'CreateOrUpdateLevels'; payload: { levels: readonly Creatable<LevelRecord>[] } }
  | { type: 'DeleteLevels'; payload: { ids: readonly LocalReference[] } }
  | { type: 'CreateOrUpdateParametricObjects'; payload: { parametricObjects: readonly Creatable<ParametricObjectRecord>[] } }
  | { type: 'DeleteParametricObjects'; payload: { ids: readonly LocalReference[] } }
  | { type: 'DetachFromParametricObject'; payload: { objectId: LocalReference; entities: readonly EntityReference[] } }
  | { type: 'SetSelection'; payload: { entities: readonly EntityReference[] } }
  | { type: 'HideEntities'; payload: { entities: readonly EntityReference[] } }
  | { type: 'ShowEntities'; payload: { entities: readonly EntityReference[] } }
  | { type: 'ImportModel'; payload: { document: StructuralDocumentSeed; replace?: boolean; confirmed?: boolean } }
  | { type: 'ClearModel'; payload: { confirmed?: boolean } }

export type CommandTransactionOperation = StructuralCommandOperation & { operationId?: string }

export type StructuralCommand = StructuralCommandOperation | {
  type: 'Transaction'
  payload: { operations: readonly CommandTransactionOperation[] }
}

export type CommandEnvelope<TCommand extends StructuralCommand = StructuralCommand> = Readonly<{
  commandId: string
  type: TCommand['type']
  schemaVersion: typeof COMMAND_SCHEMA_VERSION
  modelRevision: number
  expectedModelRevision?: number
  payload: TCommand['payload']
  source: CommandSource
  dryRun?: boolean
  transactionId?: string
}>

export type CommandResult = Readonly<{
  commandId: string
  transactionId?: string
  revision: number
  previousRevision: number
  dryRun: boolean
  idempotentReplay: boolean
  changed: boolean
  changes: StructuralChangeSet | null
  aliases: Readonly<Record<string, EntityId>>
  snapshotHash: string
}>

export type CommandAuditEntry = Readonly<{
  commandId: string
  transactionId?: string
  type: StructuralCommand['type'] | 'Undo' | 'Redo'
  source: CommandSource
  previousRevision: number
  revision: number
  timestamp: number
  changes: StructuralChangeSet | null
}>
