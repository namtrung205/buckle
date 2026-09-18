import type { CommandEnvelope, CommandResult, CommandTransactionOperation, CommandWorkspaceState } from '../structural/index.ts'
import type { EntityCollection, EntityId, EntityReference, ParametricGenerator } from '../structural/index.ts'

export type AiMode = 'Inspect' | 'Edit' | 'Modeling' | 'Generate' | 'Agent'
export type JsonSchema = Readonly<Record<string, unknown>>

export type AiToolDefinition = Readonly<{
  name: string
  description: string
  kind: 'query' | 'mutation'
  inputSchema: JsonSchema
}>

export type AiToolCall = Readonly<{
  id: string
  name: string
  arguments: Readonly<Record<string, unknown>>
}>

export type ToolPreview = Readonly<{
  created: number
  updated: number
  deleted: number
  affected: number
  risk: 'low' | 'medium' | 'high'
  requiresApproval: boolean
  approvalToken?: string
  parametric?: ParametricPreview
}>

export type ParametricPreview = Readonly<{
  kind: string
  objectId: EntityId
  templateId: string
  templateVersion: number
  defaultsApplied: readonly string[]
  footprint?: Readonly<{
    min: readonly [number, number, number]
    max: readonly [number, number, number]
    size: readonly [number, number, number]
  }>
  entityCounts: Readonly<Partial<Record<EntityCollection, number>>>
  sectionIds: readonly EntityId[]
  materialIds: readonly EntityId[]
  loadCount: number
  supportCount: number
  warnings: readonly string[]
  estimatedCost: Readonly<{ render: 'low' | 'medium' | 'high'; analysis: 'low' | 'medium' | 'high' }>
}>

export type AiToolResponse = Readonly<{
  toolCallId: string
  tool: string
  ok: boolean
  revision: number
  data?: unknown
  ids?: Readonly<Partial<Record<EntityCollection, readonly EntityId[]>>>
  warnings?: readonly string[]
  preview?: ToolPreview
  undoToken?: string
  error?: Readonly<{ code: string; message: string; clarification?: string }>
}>

export type ParametricGeneratorBinding = Readonly<{
  version: number
  generatorVersion: string
  generator: ParametricGenerator<Record<string, unknown>>
  constraints?: readonly Readonly<Record<string, unknown>>[]
  templateId?: string
  templateVersion?: number
  parameterDefaults?: Readonly<Record<string, unknown>>
  vocabulary?: Readonly<Record<string, readonly string[]>>
  normalizeParameters?: (parameters: Readonly<Record<string, unknown>>) => Readonly<{
    parameters: Readonly<Record<string, unknown>>
    defaultsApplied?: readonly string[]
    warnings?: readonly string[]
  }>
}>

export type AiToolRuntime = Readonly<{
  getWorkspaceState: () => CommandWorkspaceState
  applyWorkspaceState: (state: CommandWorkspaceState) => void
  executeCommand?: (command: CommandEnvelope) => CommandResult
  undoCommand?: () => CommandResult | null
  parametricGenerators?: Readonly<Record<string, ParametricGeneratorBinding>>
  queryAnalysis?: (tool: string, args: Record<string, unknown>) => unknown
  runAnalysis?: (signal?: AbortSignal) => Promise<unknown>
  now?: () => number
}>

export type AgentBudget = Readonly<{
  maxSteps?: number
  maxCommands?: number
  maxTimeMs?: number
}>

export type QueryFilter = Readonly<{
  ids?: readonly EntityId[]
  names?: readonly string[]
  nameContains?: string
  types?: readonly string[]
  semanticRoles?: readonly string[]
  sectionIds?: readonly EntityId[]
  materialIds?: readonly EntityId[]
  groupIds?: readonly EntityId[]
  levelIds?: readonly EntityId[]
  gridIds?: readonly EntityId[]
  connectedTo?: readonly EntityReference[]
  inSelection?: boolean
  hidden?: boolean
  length?: Readonly<{ lt?: number; lte?: number; gt?: number; gte?: number }>
  position?: Readonly<{
    x?: Readonly<{ min?: number; max?: number }>
    y?: Readonly<{ min?: number; max?: number }>
    z?: Readonly<{ min?: number; max?: number }>
  }>
}>

export type TransactionArguments = Readonly<{
  operations: readonly CommandTransactionOperation[]
  approvalToken?: string
}>

export const entityRefKey = (ref: EntityReference) => `${ref.collection}:${ref.id}`
