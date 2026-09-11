import {
  COMMAND_SCHEMA_VERSION,
  type CommandEnvelope,
  type CommandSource,
  type StructuralCommandOperation,
} from './commands.ts'

const sources = new Set<CommandSource>(['ui', 'ai', 'mcp', 'plugin', 'script', 'system'])

const payloadShapes = {
  CreateNodes: { required: ['nodes'], allowed: ['nodes'], array: 'nodes' },
  MoveNodes: { required: ['nodes'], allowed: ['nodes'], array: 'nodes' },
  DeleteNodes: { required: ['ids'], allowed: ['ids', 'cascade'], array: 'ids' },
  CreateMembers: { required: ['members'], allowed: ['members'], array: 'members' },
  UpdateMembers: { required: ['members'], allowed: ['members'], array: 'members' },
  DeleteMembers: { required: ['ids'], allowed: ['ids'], array: 'ids' },
  DeleteShells: { required: ['ids'], allowed: ['ids'], array: 'ids' },
  CreateOrUpdateShells: { required: ['shells'], allowed: ['shells'], array: 'shells' },
  CreateOrUpdateSections: { required: ['sections'], allowed: ['sections'], array: 'sections' },
  DeleteSections: { required: ['ids'], allowed: ['ids', 'cascade'], array: 'ids' },
  CreateOrUpdateMaterials: { required: ['materials'], allowed: ['materials'], array: 'materials' },
  DeleteMaterials: { required: ['ids'], allowed: ['ids'], array: 'ids' },
  CreateOrUpdateLoads: { required: ['loads'], allowed: ['loads'], array: 'loads' },
  DeleteLoads: { required: ['ids'], allowed: ['ids'], array: 'ids' },
  CreateOrUpdateBoundaryConditions: { required: ['boundaryConditions'], allowed: ['boundaryConditions'], array: 'boundaryConditions' },
  DeleteBoundaryConditions: { required: ['ids'], allowed: ['ids'], array: 'ids' },
  CreateOrUpdateGrids: { required: ['grids'], allowed: ['grids'], array: 'grids' },
  DeleteGrids: { required: ['ids'], allowed: ['ids'], array: 'ids' },
  CreateOrUpdateLevels: { required: ['levels'], allowed: ['levels'], array: 'levels' },
  DeleteLevels: { required: ['ids'], allowed: ['ids'], array: 'ids' },
  CreateOrUpdateGroups: { required: ['groups'], allowed: ['groups'], array: 'groups' },
  CreateOrUpdateSelectionSets: { required: ['selectionSets'], allowed: ['selectionSets'], array: 'selectionSets' },
  DeleteSelectionSets: { required: ['ids'], allowed: ['ids'], array: 'ids' },
  DeleteGroups: { required: ['ids'], allowed: ['ids'], array: 'ids' },
  CreateOrUpdateParametricObjects: { required: ['parametricObjects'], allowed: ['parametricObjects'], array: 'parametricObjects' },
  DeleteParametricObjects: { required: ['ids'], allowed: ['ids'], array: 'ids' },
  DetachFromParametricObject: { required: ['objectId', 'entities'], allowed: ['objectId', 'entities'], array: 'entities' },
  SetSelection: { required: ['entities'], allowed: ['entities'], array: 'entities' },
  HideEntities: { required: ['entities'], allowed: ['entities'], array: 'entities' },
  ShowEntities: { required: ['entities'], allowed: ['entities'], array: 'entities' },
  ImportModel: { required: ['document'], allowed: ['document', 'replace', 'confirmed'] },
  ClearModel: { required: [], allowed: ['confirmed'] },
} as const satisfies Record<StructuralCommandOperation['type'], {
  required: readonly string[]
  allowed: readonly string[]
  array?: string
}>

const commandTypes = new Set<string>([...Object.keys(payloadShapes), 'Transaction'])
const pluginIdPattern = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[], path: string) => {
  const keys = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new Error(`${path}.${key} is not allowed`)
  }
}

const nonEmpty = (value: unknown, path: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} must be a non-empty string`)
}

const nonNegativeInteger = (value: unknown, path: string) => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${path} must be a non-negative integer`)
}

const validateActor = (source: CommandSource, value: unknown) => {
  if (source === 'plugin' && value === undefined) throw new Error('command.actor is required when source=plugin')
  if (value === undefined) return
  const actor = record(value, 'command.actor')
  onlyKeys(actor, ['kind', 'pluginId', 'pluginVersion'], 'command.actor')
  if (actor.kind !== 'plugin') throw new Error('command.actor.kind must be plugin')
  if (source !== 'plugin') throw new Error('plugin command actor requires source=plugin')
  if (typeof actor.pluginId !== 'string' || !pluginIdPattern.test(actor.pluginId)) {
    throw new Error('command.actor.pluginId is invalid')
  }
  if (typeof actor.pluginVersion !== 'string' || !semverPattern.test(actor.pluginVersion)) {
    throw new Error('command.actor.pluginVersion must be semantic version text')
  }
}

const validateOperation = (value: unknown, path: string) => {
  const operation = record(value, path)
  onlyKeys(operation, ['type', 'payload', 'operationId'], path)
  if (typeof operation.type !== 'string' || !(operation.type in payloadShapes)) {
    throw new Error(`Unsupported command operation ${String(operation.type)}`)
  }
  if (operation.operationId !== undefined) nonEmpty(operation.operationId, `${path}.operationId`)
  const payload = record(operation.payload, `${path}.payload`)
  const shape = payloadShapes[operation.type as keyof typeof payloadShapes]
  onlyKeys(payload, shape.allowed, `${path}.payload`)
  for (const key of shape.required) {
    if (payload[key] === undefined) throw new Error(`${path}.payload.${key} is required`)
  }
  if ('array' in shape && shape.array && !Array.isArray(payload[shape.array])) {
    throw new Error(`${path}.payload.${shape.array} must be an array`)
  }
  if (operation.type === 'ImportModel') record(payload.document, `${path}.payload.document`)
  for (const key of ['cascade', 'replace', 'confirmed']) {
    if (payload[key] !== undefined && typeof payload[key] !== 'boolean') {
      throw new Error(`${path}.payload.${key} must be a boolean`)
    }
  }
}

/**
 * Runtime guard for data that can arrive from RPC, WebSocket, AI or scripts.
 * Domain invariants remain owned by StructuralDocument; this guard rejects
 * malformed envelopes and payload roots before the gateway touches a draft.
 */
export function assertCommandEnvelope(value: unknown): asserts value is CommandEnvelope {
  const command = record(value, 'command')
  onlyKeys(command, [
    'commandId', 'type', 'schemaVersion', 'modelRevision', 'expectedModelRevision',
    'payload', 'source', 'actor', 'dryRun', 'transactionId',
  ], 'command')
  nonEmpty(command.commandId, 'command.commandId')
  if (typeof command.type !== 'string' || !commandTypes.has(command.type)) throw new Error('command.type is unsupported')
  if (command.schemaVersion !== COMMAND_SCHEMA_VERSION) throw new Error(`Unsupported command schemaVersion ${String(command.schemaVersion)}`)
  nonNegativeInteger(command.modelRevision, 'command.modelRevision')
  if (command.expectedModelRevision !== undefined) nonNegativeInteger(command.expectedModelRevision, 'command.expectedModelRevision')
  if (typeof command.source !== 'string' || !sources.has(command.source as CommandSource)) throw new Error('command.source is unsupported')
  if (command.dryRun !== undefined && typeof command.dryRun !== 'boolean') throw new Error('command.dryRun must be a boolean')
  if (command.transactionId !== undefined) nonEmpty(command.transactionId, 'command.transactionId')
  validateActor(command.source as CommandSource, command.actor)

  const payload = record(command.payload, 'command.payload')
  if (command.type === 'Transaction') {
    onlyKeys(payload, ['operations'], 'command.payload')
    if (!Array.isArray(payload.operations)) throw new Error('command.payload.operations must be an array')
    payload.operations.forEach((operation, index) => validateOperation(operation, `command.payload.operations[${index}]`))
  } else {
    validateOperation({ type: command.type, payload }, 'command')
  }
}
