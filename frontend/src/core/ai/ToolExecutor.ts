import {
  COMMAND_SCHEMA_VERSION,
  canonicalStringify,
  prepareParametricRegeneration,
  type CommandEnvelope,
  type CommandGateway,
  type CommandResult,
  type CommandTransactionOperation,
  type EntityCollection,
  type EntityReference,
  type StructuralCommand,
  type StructuralDocument,
} from '../structural/index.ts'
import { StructuralQueryService } from './StructuralQueryService.ts'
import { AiToolRegistry } from './ToolRegistry.ts'
import { assertSelectionScope, classifyOperations, isToolAllowed } from './ToolPolicy.ts'
import type { AgentBudget, AiMode, AiToolCall, AiToolResponse, AiToolRuntime, JsonSchema, ToolPreview } from './types.ts'

type Replay = { signature: string; response: AiToolResponse }
type Approval = { signature: string; revision: number }
type LastMutation = { token: string; commandId: string; revision: number }

const clone = <T>(value: T): T => structuredClone(value)
const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}
const asArray = <T = unknown>(value: unknown, label: string): T[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value as T[]
}
const asIds = (value: unknown, label: string) => asArray<number>(value, label).map(id => {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`${label} contains an invalid id`)
  return id
})
const asRefs = (value: unknown, label: string) => asArray<EntityReference>(value, label).map(ref => {
  if (!ref || typeof ref !== 'object' || typeof ref.collection !== 'string' || !Number.isSafeInteger(ref.id)) throw new Error(`${label} contains an invalid entity reference`)
  return clone(ref)
})

const validateSchema = (value: unknown, schema: JsonSchema, path = 'arguments') => {
  const type = schema.type
  if (type === 'object') {
    const record = asRecord(value, path)
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>
    for (const required of (schema.required ?? []) as string[]) if (record[required] === undefined) throw new Error(`${path}.${required} is required`)
    if (schema.additionalProperties === false) for (const key of Object.keys(record)) if (!(key in properties)) throw new Error(`${path}.${key} is not allowed`)
    for (const [key, child] of Object.entries(properties)) if (record[key] !== undefined && child.type) validateSchema(record[key], child, `${path}.${key}`)
  } else if (type === 'array') {
    const values = asArray(value, path)
    if (typeof schema.minItems === 'number' && values.length < schema.minItems) throw new Error(`${path} has too few items`)
    if (typeof schema.maxItems === 'number' && values.length > schema.maxItems) throw new Error(`${path} has too many items`)
    const item = schema.items as JsonSchema | undefined
    if (item?.type) values.forEach((child, index) => validateSchema(child, item, `${path}[${index}]`))
  } else if (type === 'string' && typeof value !== 'string') throw new Error(`${path} must be a string`)
  else if (type === 'integer' && !Number.isSafeInteger(value)) throw new Error(`${path} must be an integer`)
  else if (type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`${path} must be a finite number`)
  else if (type === 'boolean' && typeof value !== 'boolean') throw new Error(`${path} must be a boolean`)
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) throw new Error(`${path} is not an allowed value`)
  if (typeof value === 'number' && typeof schema.minimum === 'number' && value < schema.minimum) throw new Error(`${path} is below minimum`)
  if (typeof value === 'number' && typeof schema.maximum === 'number' && value > schema.maximum) throw new Error(`${path} is above maximum`)
}

const targetsFor = (tool: string, args: Record<string, unknown>): EntityReference[] => {
  if (tool === 'move_nodes') return asArray<{ id: number }>(args.nodes, 'nodes').map(node => ({ collection: 'nodes', id: node.id }))
  if (tool === 'update_members') return asArray<{ id: number }>(args.members, 'members').map(member => ({ collection: 'members', id: member.id }))
  if (tool === 'change_section') return asIds(args.memberIds, 'memberIds').map(id => ({ collection: 'members', id }))
  if (tool === 'delete_entities') return asRefs(args.entities, 'entities')
  return []
}

export class AiToolExecutor {
  readonly registry = new AiToolRegistry()
  readonly queries: StructuralQueryService
  private readonly replay = new Map<string, Replay>()
  private readonly approvals = new Map<string, Approval>()
  private lastMutation?: LastMutation
  private agentSteps = 0
  private agentCommands = 0
  private readonly startedAt: number
  readonly document: StructuralDocument
  readonly gateway: CommandGateway
  readonly runtime: AiToolRuntime
  readonly agentBudget: AgentBudget

  constructor(
    document: StructuralDocument,
    gateway: CommandGateway,
    runtime: AiToolRuntime,
    agentBudget: AgentBudget = {},
  ) {
    this.document = document
    this.gateway = gateway
    this.runtime = runtime
    this.agentBudget = agentBudget
    this.queries = new StructuralQueryService(document, runtime.getWorkspaceState)
    this.startedAt = (runtime.now ?? Date.now)()
  }

  execute(call: AiToolCall, mode: AiMode): AiToolResponse {
    const signature = canonicalStringify({ name: call.name, arguments: call.arguments, mode })
    const replay = this.replay.get(call.id)
    if (replay) {
      if (replay.signature !== signature) return this.error(call, 'IDEMPOTENCY_CONFLICT', `Tool call id ${call.id} was reused with different content`)
      return replay.response
    }
    let response: AiToolResponse
    try {
      if (!call.id.trim()) throw new Error('Tool call id is required')
      const tool = this.registry.get(call.name)
      if (!tool) throw new Error(`Unknown tool ${call.name}`)
      validateSchema(call.arguments, tool.inputSchema)
      if (!isToolAllowed(mode, tool)) return this.remember(call, signature, this.error(call, 'MODE_DENIED', `${call.name} is not allowed in ${mode} mode`))
      this.consumeBudget(mode, tool.kind === 'mutation')
      assertSelectionScope(mode, call.name, targetsFor(call.name, call.arguments as Record<string, unknown>), this.runtime.getWorkspaceState().selection)
      response = tool.kind === 'query' ? this.executeQuery(call) : this.executeMutation(call, mode)
    } catch (error) {
      response = this.error(call, 'VALIDATION_ERROR', error instanceof Error ? error.message : String(error))
    }
    return this.remember(call, signature, response)
  }

  private executeQuery(call: AiToolCall): AiToolResponse {
    const args = call.arguments as Record<string, unknown>
    let data: unknown
    switch (call.name) {
      case 'get_model_summary': data = this.queries.getModelSummary(); break
      case 'get_selection': data = this.queries.getSelection(); break
      case 'get_entities': data = this.queries.getEntities(args.collection as EntityCollection, args.ids as number[] | undefined); break
      case 'query_entities': data = this.queries.queryEntities(args.collection as EntityCollection, (args.filter ?? {}) as never, (args.limit as number | undefined) ?? 1000); break
      case 'get_connected_entities': data = this.queries.getConnectedEntities(asRefs(args.entities, 'entities')); break
      case 'get_nearby_nodes': data = this.queries.getNearbyNodes(args.point as [number, number, number], args.radius as number, (args.limit as number | undefined) ?? 100); break
      case 'get_sections': data = this.queries.getEntities('sections', args.ids as number[] | undefined); break
      case 'get_materials': data = this.queries.getEntities('materials', args.ids as number[] | undefined); break
      case 'validate_model': data = this.queries.validateModel(); break
      default: throw new Error(`No query handler for ${call.name}`)
    }
    return { toolCallId: call.id, tool: call.name, ok: true, revision: this.document.revision, data }
  }

  private executeMutation(call: AiToolCall, mode: AiMode): AiToolResponse {
    const args = call.arguments as Record<string, unknown>
    if (call.name === 'undo_last_ai_change') return this.undo(call, args.undoToken as string)
    if (call.name === 'generate_parametric') return this.generate(call, args)
    const operations = this.operationsFor(call.name, args)
    if (mode === 'Modeling' && operations.some(operation => operation.type.includes('ParametricObject'))) throw new Error('Modeling mode cannot execute parametric operations')
    const previewOnly = call.name === 'preview_transaction'
    return this.runOperations(call, operations, previewOnly, args.approvalToken as string | undefined)
  }

  private operationsFor(name: string, args: Record<string, unknown>): CommandTransactionOperation[] {
    switch (name) {
      case 'create_nodes': return [{ type: 'CreateNodes', payload: { nodes: args.nodes as never[] } }]
      case 'create_members': return [{ type: 'CreateMembers', payload: { members: args.members as never[] } }]
      case 'move_nodes': return [{ type: 'MoveNodes', payload: { nodes: args.nodes as never[] } }]
      case 'update_members': return [{ type: 'UpdateMembers', payload: { members: args.members as never[] } }]
      case 'change_section': return [{ type: 'UpdateMembers', payload: { members: asIds(args.memberIds, 'memberIds').map(id => ({ id, patch: { sectionId: args.sectionId as number } })) } }]
      case 'delete_entities': return this.deleteOperations(asRefs(args.entities, 'entities'), args.cascade === true)
      case 'set_selection': return [{ type: 'SetSelection', payload: { entities: asRefs(args.entities, 'entities') } }]
      case 'hide_entities': return [{ type: 'HideEntities', payload: { entities: asRefs(args.entities, 'entities') } }]
      case 'show_entities': return [{ type: 'ShowEntities', payload: { entities: asRefs(args.entities, 'entities') } }]
      case 'execute_transaction':
      case 'preview_transaction': return clone(asArray<CommandTransactionOperation>(args.operations, 'operations'))
      default: throw new Error(`No mutation handler for ${name}`)
    }
  }

  private deleteOperations(refs: readonly EntityReference[], cascade: boolean): CommandTransactionOperation[] {
    const byCollection = new Map<EntityCollection, number[]>()
    for (const ref of refs) byCollection.set(ref.collection, [...(byCollection.get(ref.collection) ?? []), ref.id])
    const operations: CommandTransactionOperation[] = []
    const push = (collection: EntityCollection, type: CommandTransactionOperation['type'], extra: Record<string, unknown> = {}) => {
      const values = byCollection.get(collection)
      if (values?.length) operations.push({ type, payload: { ids: values, ...extra } } as CommandTransactionOperation)
    }
    push('loads', 'DeleteLoads'); push('boundaryConditions', 'DeleteBoundaryConditions'); push('shells', 'DeleteShells')
    push('members', 'DeleteMembers'); push('nodes', 'DeleteNodes', { cascade }); push('sections', 'DeleteSections', { cascade })
    push('materials', 'DeleteMaterials'); push('grids', 'DeleteGrids'); push('levels', 'DeleteLevels'); push('parametricObjects', 'DeleteParametricObjects')
    const unsupported = [...byCollection.keys()].filter(collection => collection === 'groups')
    if (unsupported.length) throw new Error(`Deletion is not supported for ${unsupported.join(', ')}`)
    return operations
  }

  private runOperations(call: AiToolCall, operations: readonly CommandTransactionOperation[], previewOnly: boolean, approvalToken?: string): AiToolResponse {
    if (!operations.length) throw new Error('Transaction requires at least one operation')
    const preview = classifyOperations(operations)
    const operationSignature = canonicalStringify({ operations, revision: this.document.revision })
    const approved = approvalToken ? this.consumeApproval(approvalToken, operationSignature) : false
    const mustPreview = previewOnly || (preview.requiresApproval && !approved)
    const result = this.dispatch(this.envelope(call.id, { type: 'Transaction', payload: { operations } }, mustPreview))
    if (mustPreview) {
      const token = preview.requiresApproval ? this.issueApproval(operationSignature) : undefined
      return {
        toolCallId: call.id, tool: call.name, ok: true, revision: this.document.revision,
        preview: { ...preview, ...(token ? { approvalToken: token } : {}) },
        warnings: preview.requiresApproval && !previewOnly ? ['Destructive change was previewed and requires approval'] : undefined,
        data: { snapshotHash: result.snapshotHash },
      }
    }
    return this.committed(call, result, preview)
  }

  private generate(call: AiToolCall, args: Record<string, unknown>): AiToolResponse {
    const binding = this.runtime.parametricGenerators?.[args.kind as string]
    if (!binding) throw new Error(`Unknown or unavailable parametric kind ${String(args.kind)}`)
    const plan = prepareParametricRegeneration(this.document, {
      objectId: args.objectId as number | undefined,
      kind: args.kind as string,
      version: binding.version,
      parameters: clone(asRecord(args.parameters, 'parameters')),
      generatorVersion: binding.generatorVersion,
      generator: binding.generator,
      constraints: binding.constraints,
      provenance: { source: 'AI Tool Registry' },
    })
    const preview = { ...classifyOperations(plan.command.payload.operations), created: plan.total.created, updated: plan.total.updated, deleted: plan.total.deleted, affected: plan.total.created + plan.total.updated + plan.total.deleted }
    const signature = canonicalStringify({ operations: plan.command.payload.operations, revision: this.document.revision })
    const approved = typeof args.approvalToken === 'string' && this.consumeApproval(args.approvalToken, signature)
    const previewOnly = args.preview === true || (preview.requiresApproval && !approved)
    const result = this.dispatch(this.envelope(call.id, plan.command, previewOnly))
    if (previewOnly) {
      const token = preview.requiresApproval ? this.issueApproval(signature) : undefined
      return { toolCallId: call.id, tool: call.name, ok: true, revision: this.document.revision, data: { objectId: plan.object.id }, preview: { ...preview, ...(token ? { approvalToken: token } : {}) } }
    }
    return this.committed(call, result, preview, { objectId: plan.object.id })
  }

  private committed(call: AiToolCall, result: CommandResult, preview: ToolPreview, data?: unknown): AiToolResponse {
    const token = crypto.randomUUID()
    this.lastMutation = { token, commandId: `ai:${call.id}`, revision: result.revision }
    const ids = result.changes ? Object.fromEntries(Object.entries(result.changes.changes).map(([collection, delta]) => [collection, [...delta.created, ...delta.updated, ...delta.deleted]]).filter(([, values]) => (values as number[]).length)) : undefined
    return { toolCallId: call.id, tool: call.name, ok: true, revision: result.revision, data, ids, preview, undoToken: token }
  }

  private undo(call: AiToolCall, token: string): AiToolResponse {
    const lastAudit = this.gateway.auditLog[this.gateway.auditLog.length - 1]
    if (!this.lastMutation || token !== this.lastMutation.token || this.document.revision !== this.lastMutation.revision || lastAudit?.commandId !== this.lastMutation.commandId) {
      throw new Error('Undo token is stale or does not refer to the latest AI change')
    }
    const result = this.runtime.undoCommand?.() ?? this.gateway.undo(this.context())
    if (!result) throw new Error('Nothing to undo')
    this.lastMutation = undefined
    return { toolCallId: call.id, tool: call.name, ok: true, revision: result.revision, data: { undone: true } }
  }

  private envelope(id: string, command: StructuralCommand, dryRun: boolean): CommandEnvelope {
    return { commandId: `ai:${id}${dryRun ? ':preview' : ''}`, type: command.type, schemaVersion: COMMAND_SCHEMA_VERSION, modelRevision: this.document.revision, payload: command.payload, source: 'ai', ...(dryRun ? { dryRun: true } : {}) } as CommandEnvelope
  }

  private context() {
    return { getWorkspaceState: this.runtime.getWorkspaceState, applyWorkspaceState: this.runtime.applyWorkspaceState }
  }

  private dispatch(command: CommandEnvelope) {
    return this.runtime.executeCommand?.(command) ?? this.gateway.execute(command, this.context())
  }

  private issueApproval(signature: string) {
    const token = crypto.randomUUID()
    this.approvals.set(token, { signature, revision: this.document.revision })
    return token
  }

  private consumeApproval(token: string, signature: string) {
    const approval = this.approvals.get(token)
    this.approvals.delete(token)
    if (!approval || approval.signature !== signature || approval.revision !== this.document.revision) throw new Error('Approval token is invalid or stale')
    return true
  }

  private consumeBudget(mode: AiMode, mutation: boolean) {
    if (mode !== 'Agent') return
    this.agentSteps++
    if (mutation) this.agentCommands++
    const now = (this.runtime.now ?? Date.now)()
    if (this.agentSteps > (this.agentBudget.maxSteps ?? 20)) throw new Error('Agent step budget exceeded')
    if (this.agentCommands > (this.agentBudget.maxCommands ?? 10)) throw new Error('Agent command budget exceeded')
    if (now - this.startedAt > (this.agentBudget.maxTimeMs ?? 60_000)) throw new Error('Agent time budget exceeded')
  }

  private remember(call: AiToolCall, signature: string, response: AiToolResponse) {
    this.replay.set(call.id, { signature, response })
    return response
  }

  private error(call: AiToolCall, code: string, message: string): AiToolResponse {
    const ambiguous = /required|unknown|section|unit|target|coordinate/i.test(message)
    return {
      toolCallId: call.id, tool: call.name, ok: false, revision: this.document.revision,
      error: { code, message, ...(ambiguous ? { clarification: 'Clarify the target IDs, section, units or coordinates and try again.' } : {}) },
    }
  }
}
