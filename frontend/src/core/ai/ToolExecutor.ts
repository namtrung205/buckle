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
  type ParametricEntityGraph,
  type StructuralCommand,
  type StructuralDocument,
} from '../structural/index.ts'
import { StructuralQueryService } from './StructuralQueryService.ts'
import { AiToolRegistry } from './ToolRegistry.ts'
import { assertSelectionScope, classifyOperations, isToolAllowed } from './ToolPolicy.ts'
import type { AgentBudget, AiMode, AiToolCall, AiToolResponse, AiToolRuntime, JsonSchema, ParametricPreview, ToolPreview } from './types.ts'

type Replay = { signature: string; response: AiToolResponse }
type Approval = { signature: string; revision: number }
type LastMutation = { token: string; commandId: string; revision: number }
type ResolvedTargetSource = 'selection' | 'hidden' | 'last_created' | 'last_updated' | 'last_affected' | 'alias'

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

const PARAMETRIC_KIND_BY_TOOL: Readonly<Record<string, string>> = {
  create_grid: 'Grid', create_portal_frame: 'PortalFrame', create_frame_array: 'FrameArray',
  create_truss: 'Truss', create_warehouse: 'Warehouse', create_tower: 'Tower',
}
const generationControlKeys = new Set(['preview', 'approvalToken', 'objectId', 'kind', 'parameters'])

const validateSchema = (value: unknown, schema: JsonSchema, path = 'arguments') => {
  const alternatives = (schema.oneOf ?? schema.anyOf) as JsonSchema[] | undefined
  if (alternatives?.length) {
    for (const alternative of alternatives) {
      try { validateSchema(value, alternative, path); return } catch { /* try the next declared shape */ }
    }
    throw new Error(`${path} does not match an allowed value shape`)
  }
  const type = schema.type
  if (type === 'object') {
    const record = asRecord(value, path)
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>
    for (const required of (schema.required ?? []) as string[]) if (record[required] === undefined) throw new Error(`${path}.${required} is required`)
    if (schema.additionalProperties === false) for (const key of Object.keys(record)) if (!(key in properties)) throw new Error(`${path}.${key} is not allowed`)
    for (const [key, child] of Object.entries(properties)) if (record[key] !== undefined && (child.type || child.oneOf || child.anyOf)) validateSchema(record[key], child, `${path}.${key}`)
  } else if (type === 'array') {
    const values = asArray(value, path)
    if (typeof schema.minItems === 'number' && values.length < schema.minItems) throw new Error(`${path} has too few items`)
    if (typeof schema.maxItems === 'number' && values.length > schema.maxItems) throw new Error(`${path} has too many items`)
    const item = schema.items as JsonSchema | undefined
    if (item && (item.type || item.oneOf || item.anyOf)) values.forEach((child, index) => validateSchema(child, item, `${path}[${index}]`))
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
  if (tool === 'change_material') return asIds(args.memberIds, 'memberIds').map(id => ({ collection: 'members', id }))
  if (tool === 'transform_entities') return asRefs(args.entities, 'entities')
  if (tool === 'update_entity_properties') return asIds(args.ids, 'ids').map(id => ({ collection: args.collection as EntityCollection, id }))
  if (tool === 'delete_entities') return asRefs(args.entities, 'entities')
  return []
}

export class AiToolExecutor {
  readonly registry = new AiToolRegistry()
  readonly queries: StructuralQueryService
  private readonly replay = new Map<string, Replay>()
  private readonly approvals = new Map<string, Approval>()
  private lastMutation?: LastMutation
  private readonly recentTargets: Record<'last_created' | 'last_updated' | 'last_affected', EntityReference[]> = {
    last_created: [], last_updated: [], last_affected: [],
  }
  private readonly namedTargets = new Map<string, EntityReference[]>()
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
      case 'resolve_targets': data = this.resolveTargets(args); break
      case 'remember_targets': data = this.rememberTargets(args); break
      case 'get_entities': data = this.queries.getEntities(args.collection as EntityCollection, args.ids as number[] | undefined); break
      case 'query_entities': data = this.queries.queryEntities(args.collection as EntityCollection, (args.filter ?? {}) as never, (args.limit as number | undefined) ?? 1000); break
      case 'get_connected_entities': data = this.queries.getConnectedEntities(asRefs(args.entities, 'entities')); break
      case 'get_nearby_nodes': data = this.queries.getNearbyNodes(args.point as [number, number, number], args.radius as number, (args.limit as number | undefined) ?? 100); break
      case 'get_sections': data = this.queries.getEntities('sections', args.ids as number[] | undefined); break
      case 'get_materials': data = this.queries.getEntities('materials', args.ids as number[] | undefined); break
      case 'get_parametric_templates': data = this.parametricTemplates(args.kind as string | undefined); break
      case 'validate_model': data = this.queries.validateModel(); break
      default: throw new Error(`No query handler for ${call.name}`)
    }
    return { toolCallId: call.id, tool: call.name, ok: true, revision: this.document.revision, data }
  }

  private parametricTemplates(kind?: string) {
    const entries = Object.entries(this.runtime.parametricGenerators ?? {})
      .filter(([candidate]) => !kind || candidate === kind)
      .map(([candidate, binding]) => ({
        kind: candidate, templateId: binding.templateId ?? candidate, templateVersion: binding.templateVersion ?? binding.version,
        generatorVersion: binding.generatorVersion, defaults: clone(binding.parameterDefaults ?? {}), vocabulary: clone(binding.vocabulary ?? {}),
      }))
      .sort((a, b) => a.kind.localeCompare(b.kind))
    if (kind && !entries.length) throw new Error(`Unknown or unavailable parametric kind ${kind}`)
    return { templates: entries }
  }

  private executeMutation(call: AiToolCall, mode: AiMode): AiToolResponse {
    const args = call.arguments as Record<string, unknown>
    if (call.name === 'undo_last_ai_change') return this.undo(call, args.undoToken as string)
    if (call.name === 'generate_parametric' || call.name === 'update_parametric_object' || PARAMETRIC_KIND_BY_TOOL[call.name]) return this.generate(call, args)
    const operations = this.operationsFor(call.name, args)
    if (mode === 'Modeling' && operations.some(operation => operation.type.includes('ParametricObject'))) throw new Error('Modeling mode cannot execute parametric operations')
    const previewOnly = call.name === 'preview_transaction' || args.preview === true
    return this.runOperations(call, operations, previewOnly, args.approvalToken as string | undefined)
  }

  private operationsFor(name: string, args: Record<string, unknown>): CommandTransactionOperation[] {
    switch (name) {
      case 'create_nodes': return [{ type: 'CreateNodes', payload: { nodes: args.nodes as never[] } }]
      case 'create_members': return [{ type: 'CreateMembers', payload: { members: args.members as never[] } }]
      case 'move_nodes': return [{ type: 'MoveNodes', payload: { nodes: args.nodes as never[] } }]
      case 'update_members': return [{ type: 'UpdateMembers', payload: { members: args.members as never[] } }]
      case 'change_section': return [{ type: 'UpdateMembers', payload: { members: asIds(args.memberIds, 'memberIds').map(id => ({ id, patch: { sectionId: args.sectionId as number } })) } }]
      case 'change_material': return this.changeMaterialOperations(asIds(args.memberIds, 'memberIds'), args.materialId as number)
      case 'transform_entities': return this.transformOperations(asRefs(args.entities, 'entities'), args)
      case 'update_entity_properties': return this.updatePropertyOperations(args.collection as EntityCollection, asIds(args.ids, 'ids'), asRecord(args.patch, 'patch'))
      case 'delete_entities': return this.deleteOperations(asRefs(args.entities, 'entities'), args.cascade === true)
      case 'set_selection': return [{ type: 'SetSelection', payload: { entities: asRefs(args.entities, 'entities') } }]
      case 'hide_entities': return [{ type: 'HideEntities', payload: { entities: asRefs(args.entities, 'entities') } }]
      case 'show_entities': return [{ type: 'ShowEntities', payload: { entities: asRefs(args.entities, 'entities') } }]
      case 'execute_transaction':
      case 'preview_transaction': return clone(asArray<CommandTransactionOperation>(args.operations, 'operations'))
      default: throw new Error(`No mutation handler for ${name}`)
    }
  }

  private changeMaterialOperations(memberIds: readonly number[], materialId: number): CommandTransactionOperation[] {
    const material = this.document.materials.get(materialId)
    if (!material) throw new Error(`Unknown materials id ${materialId}`)
    const sectionCreates = new Map<number, ReturnType<typeof clone>>()
    const targetBySource = new Map<number, number>()
    let nextSectionId = Math.max(0, ...this.document.sections.keys()) + 1
    const sectionShape = (section: { id: number; name: string; materialId: number; [key: string]: unknown }) => {
      const shape = clone(section) as Record<string, unknown>
      delete shape.id; delete shape.name; delete shape.materialId
      return canonicalStringify(shape)
    }
    const updates = memberIds.map(id => {
      const member = this.document.members.get(id)
      if (!member) throw new Error(`Unknown members id ${id}`)
      const source = this.document.sections.get(member.sectionId)!
      let targetId = targetBySource.get(source.id)
      if (targetId === undefined) {
        const shape = sectionShape(source)
        const existing = [...this.document.sections.values()].find(section => section.materialId === materialId && sectionShape(section) === shape)
        targetId = existing?.id ?? nextSectionId++
        if (!existing) sectionCreates.set(source.id, { ...clone(source), id: targetId, name: `${source.name} · ${material.name}`, materialId })
        targetBySource.set(source.id, targetId)
      }
      return { id, patch: { sectionId: targetId } }
    })
    const operations: CommandTransactionOperation[] = []
    if (sectionCreates.size) operations.push({ type: 'CreateOrUpdateSections', payload: { sections: [...sectionCreates.values()] as never[] } })
    operations.push({ type: 'UpdateMembers', payload: { members: updates } })
    return operations
  }

  private transformOperations(refs: readonly EntityReference[], args: Record<string, unknown>): CommandTransactionOperation[] {
    const unsupported = refs.find(ref => ref.collection !== 'nodes' && ref.collection !== 'members')
    if (unsupported) throw new Error(`transform_entities does not support ${unsupported.collection}`)
    const memberIds = new Set(refs.filter(ref => ref.collection === 'members').map(ref => ref.id))
    const explicitNodeIds = new Set(refs.filter(ref => ref.collection === 'nodes').map(ref => ref.id))
    const nodeIds = new Set(explicitNodeIds)
    for (const id of memberIds) {
      const member = this.document.members.get(id)
      if (!member) throw new Error(`Unknown members id ${id}`)
      nodeIds.add(member.nodeI); nodeIds.add(member.nodeJ)
    }
    for (const id of nodeIds) if (!this.document.nodes.has(id)) throw new Error(`Unknown nodes id ${id}`)
    const operation = args.operation as string
    const translation = (args.translation ?? [0, 0, 0]) as readonly [number, number, number]
    const origin = (args.origin ?? [0, 0, 0]) as readonly [number, number, number]
    const axis = (args.axis ?? 'z') as 'x' | 'y' | 'z'
    const angle = Number(args.angleDegrees ?? 0) * Math.PI / 180
    const transform = (position: readonly [number, number, number], multiplier = 1): readonly [number, number, number] => {
      const relative = [position[0] - origin[0], position[1] - origin[1], position[2] - origin[2]]
      if (operation === 'move' || operation === 'copy' || operation === 'array') return [
        position[0] + translation[0] * multiplier, position[1] + translation[1] * multiplier, position[2] + translation[2] * multiplier,
      ]
      if (operation === 'mirror') {
        const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
        relative[index] *= -1
        return [relative[0] + origin[0], relative[1] + origin[1], relative[2] + origin[2]]
      }
      if (operation !== 'rotate') throw new Error(`Unknown transform operation ${operation}`)
      const [x, y, z] = relative; const cosine = Math.cos(angle); const sine = Math.sin(angle)
      const rotated = axis === 'x' ? [x, y * cosine - z * sine, y * sine + z * cosine]
        : axis === 'y' ? [x * cosine + z * sine, y, -x * sine + z * cosine]
          : [x * cosine - y * sine, x * sine + y * cosine, z]
      return [rotated[0] + origin[0], rotated[1] + origin[1], rotated[2] + origin[2]]
    }
    if ((operation === 'move' || operation === 'copy' || operation === 'array') && !args.translation) throw new Error(`${operation} requires translation`)
    if (operation === 'rotate' && args.angleDegrees === undefined) throw new Error('rotate requires angleDegrees')
    if (operation === 'move' || operation === 'rotate' || operation === 'mirror') {
      for (const nodeId of nodeIds) {
        if (explicitNodeIds.has(nodeId)) continue
        const outsideTargets = [...(this.document.memberIdsByNodeId.get(nodeId) ?? [])].filter(id => !memberIds.has(id))
        if (outsideTargets.length) {
          throw new Error(`Transforming targeted members would also move connected member(s) ${outsideTargets.join(', ')} through shared node ${nodeId}; include the shared node explicitly or include all connected members`)
        }
      }
      return [{ type: 'MoveNodes', payload: { nodes: [...nodeIds].sort((a, b) => a - b).map(id => ({ id, position: transform(this.document.nodes.get(id)!.position) })) } }]
    }
    const copies = operation === 'array' ? Number(args.copies ?? 0) : 1
    if (!Number.isSafeInteger(copies) || copies < 1 || copies > 1000) throw new Error('array copies must be an integer in [1, 1000]')
    const nodes: Record<string, unknown>[] = []; const members: Record<string, unknown>[] = []
    for (let copyIndex = 1; copyIndex <= copies; copyIndex++) {
      const aliasFor = (id: number) => `transform:${copyIndex}:node:${id}`
      for (const id of [...nodeIds].sort((a, b) => a - b)) {
        const node = this.document.nodes.get(id)!
        nodes.push({ alias: aliasFor(id), ...(node.name ? { name: `${node.name} copy ${copyIndex}` } : {}), position: transform(node.position, copyIndex) })
      }
      for (const id of [...memberIds].sort((a, b) => a - b)) {
        const member = this.document.members.get(id)!
        members.push({ alias: `transform:${copyIndex}:member:${id}`, ...clone(member), id: undefined,
          nodeI: { alias: aliasFor(member.nodeI) }, nodeJ: { alias: aliasFor(member.nodeJ) } })
      }
    }
    const result: CommandTransactionOperation[] = [{ type: 'CreateNodes', payload: { nodes: nodes as never[] } }]
    if (members.length) result.push({ type: 'CreateMembers', payload: { members: members as never[] } })
    return result
  }

  private updatePropertyOperations(collection: EntityCollection, ids: readonly number[], rawPatch: Record<string, unknown>): CommandTransactionOperation[] {
    const patch = clone(rawPatch)
    delete patch.id
    if (!Object.keys(patch).length) throw new Error('patch must change at least one property')
    const allowed: Partial<Record<EntityCollection, readonly string[]>> = {
      nodes: ['name', 'position', 'metadata'],
      members: ['label', 'sectionId', 'referenceAxis', 'gammaDegrees', 'release', 'metadata'],
      shells: ['name', 'thickness', 'materialId', 'metadata'],
      sections: ['name', 'type', 'materialId', 'depth', 'height', 'width', 'tw', 'tf', 'diameter', 'thickness', 'r', 'ri', 'properties', 'metadata'],
      materials: ['name', 'category', 'code', 'E', 'nu', 'rho', 'alpha', 'fy', 'fc', 'fu', 'ft', 'grade', 'preset', 'metadata'],
      loads: ['name', 'type', 'targetIds', 'value', 'magnitude', 'metadata'],
      boundaryConditions: ['name', 'type', 'targetNodeIds', 'dx', 'dy', 'dz', 'rx', 'ry', 'rz', 'rotationDegrees', 'metadata'],
      grids: ['name', 'kind', 'data', 'metadata'], levels: ['name', 'elevation', 'metadata'], groups: ['name', 'entityRefs', 'metadata'],
    }
    const allowlist = allowed[collection]
    if (!allowlist) throw new Error(`update_entity_properties does not support ${collection}`)
    const unsupported = Object.keys(patch).find(key => !allowlist.includes(key))
    if (unsupported) throw new Error(`${collection}.${unsupported} cannot be changed by update_entity_properties`)
    const records: Record<string, unknown>[] = ids.map(id => {
      const existing = this.document[collection].get(id)
      if (!existing) throw new Error(`Unknown ${collection} id ${id}`)
      return { ...clone(existing) as unknown as Record<string, unknown>, ...patch, id }
    })
    switch (collection) {
      case 'nodes': return [{ type: 'MoveNodes', payload: { nodes: records.map(record => ({
        id: Number(record.id), position: record.position as readonly [number, number, number],
        ...(record.name === undefined ? {} : { name: record.name as string }),
        ...(record.metadata === undefined ? {} : { metadata: record.metadata as Readonly<Record<string, unknown>> }),
      })) } }]
      case 'members': return [{ type: 'UpdateMembers', payload: { members: ids.map((id, index) => ({ id, patch: Object.fromEntries(Object.entries(records[index]).filter(([key]) => key !== 'id')) })) } }]
      case 'shells': return [{ type: 'CreateOrUpdateShells', payload: { shells: records as never[] } }]
      case 'sections': return [{ type: 'CreateOrUpdateSections', payload: { sections: records as never[] } }]
      case 'materials': return [{ type: 'CreateOrUpdateMaterials', payload: { materials: records as never[] } }]
      case 'loads': return [{ type: 'CreateOrUpdateLoads', payload: { loads: records as never[] } }]
      case 'boundaryConditions': return [{ type: 'CreateOrUpdateBoundaryConditions', payload: { boundaryConditions: records as never[] } }]
      case 'grids': return [{ type: 'CreateOrUpdateGrids', payload: { grids: records as never[] } }]
      case 'levels': return [{ type: 'CreateOrUpdateLevels', payload: { levels: records as never[] } }]
      case 'groups': return [{ type: 'CreateOrUpdateGroups', payload: { groups: records as never[] } }]
      default: throw new Error(`update_entity_properties does not support ${collection}`)
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
    push('materials', 'DeleteMaterials'); push('grids', 'DeleteGrids'); push('levels', 'DeleteLevels'); push('groups', 'DeleteGroups'); push('parametricObjects', 'DeleteParametricObjects')
    return operations
  }

  private runOperations(call: AiToolCall, operations: readonly CommandTransactionOperation[], previewOnly: boolean, approvalToken?: string): AiToolResponse {
    if (!operations.length) throw new Error('Transaction requires at least one operation')
    const preview = this.classifyOperations(operations)
    const operationSignature = canonicalStringify({ operations, revision: this.document.revision })
    const approved = approvalToken ? this.consumeApproval(approvalToken, operationSignature) : false
    const mustPreview = previewOnly || (preview.requiresApproval && !approved)
    const result = this.dispatch(this.envelope(call.id, { type: 'Transaction', payload: { operations } }, mustPreview))
    const exactPreview = this.exactPreview(preview, result)
    if (mustPreview) {
      const token = preview.requiresApproval ? this.issueApproval(operationSignature) : undefined
      return {
        toolCallId: call.id, tool: call.name, ok: true, revision: this.document.revision,
        preview: { ...exactPreview, ...(token ? { approvalToken: token } : {}) },
        warnings: preview.requiresApproval && !previewOnly ? ['Destructive change was previewed and requires approval'] : undefined,
        data: { snapshotHash: result.snapshotHash },
      }
    }
    return this.committed(call, result, exactPreview)
  }

  private exactPreview(preview: ToolPreview, result: CommandResult): ToolPreview {
    if (!result.changed) return { ...preview, created: 0, updated: 0, deleted: 0, affected: 0, risk: preview.requiresApproval ? 'high' : 'low' }
    if (!result.changes) return preview
    let created = 0; let updated = 0; let deleted = 0
    for (const delta of Object.values(result.changes.changes)) {
      created += delta.created.length; updated += delta.updated.length; deleted += delta.deleted.length
    }
    const affected = created + updated + deleted
    const risk = preview.requiresApproval || affected > 1000 ? 'high' : affected > 100 ? 'medium' : 'low'
    return { ...preview, created, updated, deleted, affected, risk }
  }

  private classifyOperations(operations: readonly CommandTransactionOperation[]): ToolPreview {
    const base = classifyOperations(operations)
    const upserts: Partial<Record<CommandTransactionOperation['type'], readonly [EntityCollection, string]>> = {
      CreateOrUpdateShells: ['shells', 'shells'], CreateOrUpdateSections: ['sections', 'sections'],
      CreateOrUpdateMaterials: ['materials', 'materials'], CreateOrUpdateLoads: ['loads', 'loads'],
      CreateOrUpdateBoundaryConditions: ['boundaryConditions', 'boundaryConditions'],
      CreateOrUpdateGrids: ['grids', 'grids'], CreateOrUpdateLevels: ['levels', 'levels'],
      CreateOrUpdateGroups: ['groups', 'groups'], CreateOrUpdateParametricObjects: ['parametricObjects', 'parametricObjects'],
    }
    let newlyCreated = 0
    for (const operation of operations) {
      const mapping = upserts[operation.type]
      if (!mapping) continue
      const [collection, key] = mapping
      const records = (operation.payload as unknown as Record<string, unknown>)[key]
      if (!Array.isArray(records)) continue
      newlyCreated += records.filter(record => {
        const id = (record as { id?: unknown }).id
        return !Number.isSafeInteger(id) || !this.document[collection].has(id as number)
      }).length
    }
    return { ...base, created: base.created + newlyCreated, updated: Math.max(0, base.updated - newlyCreated) }
  }

  private generate(call: AiToolCall, args: Record<string, unknown>): AiToolResponse {
    const existing = call.name === 'update_parametric_object' ? this.document.parametricObjects.get(args.objectId as number) : undefined
    if (call.name === 'update_parametric_object' && !existing) throw new Error(`Unknown parametric object id ${String(args.objectId)}`)
    const kind = PARAMETRIC_KIND_BY_TOOL[call.name] ?? existing?.kind ?? args.kind as string
    const binding = this.runtime.parametricGenerators?.[kind]
    if (!binding) throw new Error(`Unknown or unavailable parametric kind ${String(kind)}`)
    const rawParameters = call.name === 'generate_parametric'
      ? clone(asRecord(args.parameters, 'parameters'))
      : call.name === 'update_parametric_object'
        ? { ...clone(existing!.parameters), ...clone(asRecord(args.parameters, 'parameters')) }
        : Object.fromEntries(Object.entries(args).filter(([key]) => !generationControlKeys.has(key)))
    if (call.name === 'update_parametric_object') {
      const patch = asRecord(args.parameters, 'parameters')
      if ((kind === 'Warehouse' || kind === 'FrameArray') && (patch.length !== undefined || patch.baySpacing !== undefined) && patch.numBays === undefined) {
        delete rawParameters.numBays
      }
    }
    const normalized = binding.normalizeParameters?.(rawParameters) ?? { parameters: rawParameters, defaultsApplied: [], warnings: [] }
    const plan = prepareParametricRegeneration(this.document, {
      objectId: call.name === 'update_parametric_object' ? existing!.id : args.objectId as number | undefined,
      kind,
      version: binding.version,
      parameters: clone(normalized.parameters),
      generatorVersion: binding.generatorVersion,
      generator: binding.generator,
      constraints: binding.constraints,
      provenance: {
        source: 'AI Tool Registry', toolCallId: call.id, transactionId: `ai:${call.id}`,
        templateId: binding.templateId, templateVersion: binding.templateVersion,
      },
    })
    const parametric = this.parametricPreview(plan.graph, kind, plan.object.id, binding.templateId ?? kind, binding.templateVersion ?? binding.version, normalized.defaultsApplied ?? [], normalized.warnings ?? [])
    const preview = { ...classifyOperations(plan.command.payload.operations), created: plan.total.created, updated: plan.total.updated, deleted: plan.total.deleted, affected: plan.total.created + plan.total.updated + plan.total.deleted, parametric }
    const signature = canonicalStringify({ operations: plan.command.payload.operations, revision: this.document.revision })
    const approved = typeof args.approvalToken === 'string' && this.consumeApproval(args.approvalToken, signature)
    const previewOnly = args.preview === true || (preview.requiresApproval && !approved)
    const result = this.dispatch(this.envelope(call.id, plan.command, previewOnly))
    if (previewOnly) {
      const token = preview.requiresApproval ? this.issueApproval(signature) : undefined
      return { toolCallId: call.id, tool: call.name, ok: true, revision: this.document.revision, data: { objectId: plan.object.id }, warnings: parametric.warnings, preview: { ...preview, ...(token ? { approvalToken: token } : {}) } }
    }
    return this.committed(call, result, preview, { objectId: plan.object.id })
  }

  private parametricPreview(
    graph: ParametricEntityGraph,
    kind: string,
    objectId: number,
    templateId: string,
    templateVersion: number,
    defaultsApplied: readonly string[],
    warnings: readonly string[],
  ): ParametricPreview {
    const entityCounts: Partial<Record<EntityCollection, number>> = {}
    for (const collection of ['nodes', 'members', 'shells', 'loads', 'boundaryConditions', 'grids', 'levels'] as const) {
      const count = graph[collection]?.length ?? 0
      if (count) entityCounts[collection] = count
    }
    const positions = (graph.nodes ?? []).map(node => node.record.position)
    const footprint = positions.length ? (() => {
      const min = [Infinity, Infinity, Infinity] as [number, number, number]
      const max = [-Infinity, -Infinity, -Infinity] as [number, number, number]
      for (const point of positions) for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], point[axis]); max[axis] = Math.max(max[axis], point[axis]) }
      return { min, max, size: max.map((value, axis) => value - min[axis]) as [number, number, number] }
    })() : undefined
    const sectionIds = [...new Set((graph.members ?? []).map(member => member.sectionId))].sort((a, b) => a - b)
    const materialIds = [...new Set((graph.shells ?? []).map(shell => shell.materialId))].sort((a, b) => a - b)
    const complexity = (graph.nodes?.length ?? 0) + (graph.members?.length ?? 0) + (graph.shells?.length ?? 0) * 2
    const cost = complexity > 5000 ? 'high' : complexity > 500 ? 'medium' : 'low'
    const analysisComplexity = (graph.nodes?.length ?? 0) + (graph.members?.length ?? 0) * 2 + (graph.shells?.length ?? 0) * 8
    const analysis = analysisComplexity > 10_000 ? 'high' : analysisComplexity > 1000 ? 'medium' : 'low'
    return {
      kind, objectId, templateId, templateVersion, defaultsApplied: [...new Set(defaultsApplied)].sort(),
      ...(footprint ? { footprint } : {}), entityCounts, sectionIds, materialIds,
      loadCount: graph.loads?.length ?? 0, supportCount: graph.boundaryConditions?.length ?? 0,
      warnings: [...warnings], estimatedCost: { render: cost, analysis },
    }
  }

  private committed(call: AiToolCall, result: CommandResult, preview: ToolPreview, data?: unknown): AiToolResponse {
    if (!result.changed) {
      return { toolCallId: call.id, tool: call.name, ok: true, revision: result.revision, data, preview }
    }
    const token = crypto.randomUUID()
    this.lastMutation = { token, commandId: `ai:${call.id}`, revision: result.revision }
    const ids = result.changes ? Object.fromEntries(Object.entries(result.changes.changes).map(([collection, delta]) => [collection, [...delta.created, ...delta.updated, ...delta.deleted]]).filter(([, values]) => (values as number[]).length)) : undefined
    if (result.changes) {
      const created: EntityReference[] = []; const updated: EntityReference[] = []; const deleted: EntityReference[] = []
      for (const [collection, delta] of Object.entries(result.changes.changes)) {
        created.push(...delta.created.map(id => ({ collection: collection as EntityCollection, id })))
        updated.push(...delta.updated.map(id => ({ collection: collection as EntityCollection, id })))
        deleted.push(...delta.deleted.map(id => ({ collection: collection as EntityCollection, id })))
      }
      if (deleted.length) {
        const removed = new Set(deleted.map(ref => `${ref.collection}:${ref.id}`))
        for (const [alias, refs] of this.namedTargets) {
          this.namedTargets.set(alias, refs.filter(ref => !removed.has(`${ref.collection}:${ref.id}`)))
        }
        for (const source of Object.keys(this.recentTargets) as (keyof typeof this.recentTargets)[]) {
          this.recentTargets[source] = this.recentTargets[source].filter(ref => !removed.has(`${ref.collection}:${ref.id}`))
        }
      }
      if (created.length) this.recentTargets.last_created = created
      if (updated.length) this.recentTargets.last_updated = updated
      this.recentTargets.last_affected = [...created, ...updated]
    }
    return { toolCallId: call.id, tool: call.name, ok: true, revision: result.revision, data, ids, preview, undoToken: token }
  }

  private resolveTargets(args: Record<string, unknown>) {
    const source = args.source as ResolvedTargetSource
    const workspace = this.runtime.getWorkspaceState()
    const alias = typeof args.alias === 'string' ? args.alias.trim().toLocaleLowerCase() : ''
    const initial = source === 'selection' ? workspace.selection : source === 'hidden' ? workspace.hidden
      : source === 'alias' ? this.namedTargets.get(alias) : this.recentTargets[source]
    if (!initial) throw new Error(`Unknown target source ${String(args.source)}`)
    const collection = args.collection as EntityCollection | undefined
    const roles = args.semanticRoles as string[] | undefined
    const entities = initial.filter(ref => this.document[ref.collection].has(ref.id))
      .filter(ref => !collection || ref.collection === collection)
      .filter(ref => !roles?.length || roles.includes(this.queries.semanticRole(ref)))
      .sort((a, b) => a.collection.localeCompare(b.collection) || a.id - b.id)
    const expectation = (args.expect ?? 'any') as string
    if (expectation === 'one_or_more' && entities.length === 0) throw new Error(`Target source ${source} matched no entities`)
    if (expectation === 'exactly_one' && entities.length !== 1) throw new Error(`Target source ${source} matched ${entities.length} entities; expected exactly one`)
    return { source, total: entities.length, entities: clone(entities), revision: this.document.revision }
  }

  private rememberTargets(args: Record<string, unknown>) {
    const alias = typeof args.alias === 'string' ? args.alias.trim().toLocaleLowerCase() : ''
    if (!alias || !/^[a-z][a-z0-9_-]{0,63}$/.test(alias)) throw new Error('alias must start with a letter and contain only letters, numbers, _ or -')
    const entities = asRefs(args.entities, 'entities')
    for (const ref of entities) if (!this.document[ref.collection].has(ref.id)) throw new Error(`Unknown ${ref.collection} id ${ref.id}`)
    this.namedTargets.set(alias, clone(entities))
    return { alias, total: entities.length, entities: clone(entities), revision: this.document.revision }
  }

  private undo(call: AiToolCall, token: string): AiToolResponse {
    const lastAudit = [...this.gateway.auditLog].reverse().find(entry => entry.changed)
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
