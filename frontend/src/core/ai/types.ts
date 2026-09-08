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
}>

export type AiToolRuntime = Readonly<{
  getWorkspaceState: () => CommandWorkspaceState
  applyWorkspaceState: (state: CommandWorkspaceState) => void
  executeCommand?: (command: CommandEnvelope) => CommandResult
  undoCommand?: () => CommandResult | null
  parametricGenerators?: Readonly<Record<string, ParametricGeneratorBinding>>
  now?: () => number
}>

export type AgentBudget = Readonly<{
  maxSteps?: number
  maxCommands?: number
  maxTimeMs?: number
}>

export type QueryFilter = Readonly<{
  ids?: readonly EntityId[]
  nameContains?: string
  semanticRoles?: readonly string[]
  sectionIds?: readonly EntityId[]
  materialIds?: readonly EntityId[]
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
