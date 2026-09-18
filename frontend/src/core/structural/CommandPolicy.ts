import { assertCommandEnvelope } from './CommandBoundary.ts'
import type { CommandEnvelope, StructuralCommandOperation } from './commands.ts'
import { PLUGIN_PERMISSIONS } from '../../../packages/plugin-sdk/src/contract.ts'
import type { PluginPermission } from '../../../packages/plugin-sdk/src/contract.ts'

export { PLUGIN_PERMISSIONS }
export type { PluginPermission }
export type CommandRisk = 'low' | 'medium' | 'high' | 'critical'

export type CommandPolicyContext = Readonly<{
  modelLocked?: boolean
  pluginPermissions?: ReadonlySet<PluginPermission> | readonly PluginPermission[]
  allowPluginDestructive?: boolean
  maxOperations?: number
  maxEntitiesPerOperation?: number
  maxPayloadBytes?: number
}>

export class CommandPolicyError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CommandPolicyError'
    this.code = code
  }
}

const permissionByOperation: Readonly<Record<StructuralCommandOperation['type'], PluginPermission | null>> = {
  CreateNodes: 'model.write.nodes', MoveNodes: 'model.write.nodes', DeleteNodes: 'model.delete.nodes',
  CreateMembers: 'model.write.members', UpdateMembers: 'model.write.members', DeleteMembers: 'model.delete.members',
  CreateOrUpdateShells: 'model.write.shells', DeleteShells: 'model.delete.shells',
  CreateOrUpdateLoads: 'model.write.loads', DeleteLoads: 'model.delete.loads',
  CreateOrUpdateBoundaryConditions: 'model.write.supports', DeleteBoundaryConditions: 'model.delete.supports',
  CreateOrUpdateMaterials: 'model.write.materials', DeleteMaterials: 'model.delete.materials',
  CreateOrUpdateSections: 'model.write.sections', DeleteSections: 'model.delete.sections',
  CreateOrUpdateGrids: 'model.write.grids', DeleteGrids: 'model.delete.grids',
  CreateOrUpdateLevels: 'model.write.levels', DeleteLevels: 'model.delete.levels',
  CreateOrUpdateGroups: 'model.write.groups', DeleteGroups: 'model.delete.groups',
  CreateOrUpdateSelectionSets: 'model.write.selectionSets', DeleteSelectionSets: 'model.delete.selectionSets',
  CreateOrUpdateParametricObjects: 'model.write.parametric', DeleteParametricObjects: 'model.delete.parametric',
  DetachFromParametricObject: 'model.write.parametric',
  SetSelection: 'workspace.writeSelection', HideEntities: 'workspace.visibility', ShowEntities: 'workspace.visibility',
  ImportModel: null, ClearModel: null,
}

const workspaceTypes = new Set<StructuralCommandOperation['type']>(['SetSelection', 'HideEntities', 'ShowEntities'])
const destructiveTypes = new Set<StructuralCommandOperation['type']>([
  'DeleteNodes', 'DeleteMembers', 'DeleteShells', 'DeleteSections', 'DeleteMaterials',
  'DeleteLoads', 'DeleteBoundaryConditions', 'DeleteGrids', 'DeleteLevels',
  'DeleteGroups', 'DeleteSelectionSets', 'DeleteParametricObjects', 'DetachFromParametricObject',
  'ImportModel', 'ClearModel',
])

const operationsOf = (command: CommandEnvelope): readonly StructuralCommandOperation[] => command.type === 'Transaction'
  ? (command.payload as { operations: readonly StructuralCommandOperation[] }).operations
  : [{ type: command.type, payload: command.payload } as StructuralCommandOperation]

const operationEntityCount = (operation: StructuralCommandOperation) => {
  const payload = operation.payload as unknown as Record<string, unknown>
  for (const key of [
    'nodes', 'members', 'shells', 'sections', 'materials', 'loads', 'boundaryConditions',
    'grids', 'levels', 'groups', 'selectionSets', 'parametricObjects', 'ids', 'entities',
  ]) {
    const candidate = payload[key]
    if (Array.isArray(candidate)) return candidate.length
  }
  return operation.type === 'ImportModel' || operation.type === 'ClearModel' ? 1 : 0
}

export const classifyCommandRisk = (command: CommandEnvelope): CommandRisk => {
  const operations = operationsOf(command)
  if (operations.some(operation => operation.type === 'ImportModel' || operation.type === 'ClearModel')) return 'critical'
  if (operations.some(operation => destructiveTypes.has(operation.type))) return 'high'
  const count = operations.reduce((total, operation) => total + operationEntityCount(operation), 0)
  if (count > 1_000) return 'medium'
  return 'low'
}

/** Authorize one already host-attributed command without mutating any state. */
export const assertCommandAuthorized = (command: CommandEnvelope, context: CommandPolicyContext = {}) => {
  assertCommandEnvelope(command)
  const operations = operationsOf(command)
  const maxOperations = command.source === 'ai' ? Infinity : context.maxOperations ?? 1_000
  const maxEntities = command.source === 'ai' ? Infinity : context.maxEntitiesPerOperation ?? 10_000
  const maxPayloadBytes = command.source === 'ai' ? Infinity : context.maxPayloadBytes ?? 5 * 1024 * 1024

  if (operations.length > maxOperations) {
    throw new CommandPolicyError('OPERATION_LIMIT', `Command has ${operations.length} operations; limit is ${maxOperations}`)
  }
  for (const operation of operations) {
    const count = operationEntityCount(operation)
    if (count > maxEntities) {
      throw new CommandPolicyError('ENTITY_LIMIT', `${operation.type} affects ${count} entities; limit is ${maxEntities}`)
    }
  }
  const payloadBytes = new TextEncoder().encode(JSON.stringify(command.payload)).byteLength
  if (payloadBytes > maxPayloadBytes) {
    throw new CommandPolicyError('PAYLOAD_LIMIT', `Command payload is ${payloadBytes} bytes; limit is ${maxPayloadBytes}`)
  }

  if (context.modelLocked && operations.some(operation => !workspaceTypes.has(operation.type))) {
    throw new CommandPolicyError('MODEL_LOCKED', 'Engineering mutations are disabled while analysis results are locked')
  }

  if (command.source !== 'plugin') return Object.freeze({ risk: classifyCommandRisk(command), operations: operations.length })

  const permissions = new Set(context.pluginPermissions ?? [])
  for (const operation of operations) {
    if (operation.type === 'ImportModel' || operation.type === 'ClearModel') {
      throw new CommandPolicyError('PLUGIN_OPERATION_DENIED', `${operation.type} is unavailable to third-party plugins`)
    }
    const required = permissionByOperation[operation.type]
    if (!required || !permissions.has(required)) {
      throw new CommandPolicyError('PLUGIN_PERMISSION_DENIED', `${operation.type} requires plugin permission ${required ?? 'unavailable'}`)
    }
  }
  if (!context.allowPluginDestructive && operations.some(operation => destructiveTypes.has(operation.type))) {
    throw new CommandPolicyError('PLUGIN_APPROVAL_REQUIRED', 'Destructive plugin commands require an explicit host approval')
  }
  return Object.freeze({ risk: classifyCommandRisk(command), operations: operations.length })
}
