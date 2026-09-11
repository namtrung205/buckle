import { canonicalStringify } from './canonical.ts'
import { StructuralDocument } from './StructuralDocument.ts'
import {
  COMMAND_SCHEMA_VERSION,
  type CommandAuditEntry,
  type CommandEnvelope,
  type CommandResult,
  type CommandTransactionOperation,
  type LocalReference,
  type StructuralCommandOperation,
} from './commands.ts'
import {
  ENTITY_COLLECTIONS,
  type EntityCollection,
  type EntityId,
  type EntityReference,
  type Member1DRecord,
  type StructuralDocumentSeed,
  type StructuralDocumentSnapshot,
} from './types.ts'
import { assertCommandEnvelope } from './CommandBoundary.ts'
import { assertCommandAuthorized, type CommandPolicyContext } from './CommandPolicy.ts'

export type CommandWorkspaceState = {
  selection: EntityReference[]
  hidden: EntityReference[]
}

export type CommandGatewayContext = {
  getWorkspaceState?: () => CommandWorkspaceState
  applyWorkspaceState?: (state: CommandWorkspaceState) => void
  allowDestructive?: (operation: 'ImportModel' | 'ClearModel') => boolean
  onCommitted?: (result: CommandResult) => void
  /** Host policy context. Plugin commands fail closed when grants are omitted. */
  policy?: CommandPolicyContext
}

export type CommandGatewayOptions = {
  maxHistoryEntries?: number
  maxHistoryBytes?: number
}

type DocumentHistoryEntry = {
  kind: 'document'
  before: StructuralDocumentSeed
  after: StructuralDocumentSeed
  beforeWorkspace: CommandWorkspaceState
  afterWorkspace: CommandWorkspaceState
  bytes: number
}

type WorkspaceHistoryEntry = {
  kind: 'workspace'
  beforeWorkspace: CommandWorkspaceState
  afterWorkspace: CommandWorkspaceState
  bytes: number
}

type HistoryEntry = DocumentHistoryEntry | WorkspaceHistoryEntry

type Replay = { signature: string; result: CommandResult }
type WorkspaceOperation = Extract<StructuralCommandOperation, {
  type: 'SetSelection' | 'HideEntities' | 'ShowEntities'
}>

const emptyWorkspace = (): CommandWorkspaceState => ({ selection: [], hidden: [] })
const refKey = (ref: EntityReference) => `${ref.collection}:${ref.id}`
const clone = <T>(value: T): T => structuredClone(value)
const stripAlias = <T extends { alias?: string }>(value: T) => {
  const record = { ...value }
  delete record.alias
  return record
}
const snapshotToSeed = (snapshot: StructuralDocumentSnapshot): StructuralDocumentSeed => Object.fromEntries([
  ...ENTITY_COLLECTIONS.map(collection => [collection, clone(snapshot[collection])]),
  ['metadata', clone(snapshot.metadata)],
]) as StructuralDocumentSeed

const collectionArray = <T extends { id: EntityId }>(draft: StructuralDocumentSeed, collection: EntityCollection): T[] => {
  const current = draft[collection]
  if (current) return current as unknown as T[]
  const created: T[] = []
  ;(draft as Record<string, unknown>)[collection] = created
  return created
}

const validateCommandId = (id: string) => {
  if (!id.trim()) throw new CommandValidationError('commandId is required')
}

export class CommandValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'CommandValidationError' }
}

export class CommandConflictError extends Error {
  readonly expectedRevision: number
  readonly actualRevision: number
  readonly changeSummary: readonly CommandAuditEntry[]

  constructor(expectedRevision: number, actualRevision: number, changeSummary: readonly CommandAuditEntry[]) {
    super(`Model revision conflict: expected ${expectedRevision}, current ${actualRevision}`)
    this.name = 'CommandConflictError'
    this.expectedRevision = expectedRevision
    this.actualRevision = actualRevision
    this.changeSummary = changeSummary
  }
}

export class CommandGateway {
  readonly document: StructuralDocument
  readonly auditLog: CommandAuditEntry[] = []
  private readonly maxHistoryEntries: number
  private readonly maxHistoryBytes: number
  private readonly replayByCommandId = new Map<string, Replay>()
  private readonly undoStack: HistoryEntry[] = []
  private readonly redoStack: HistoryEntry[] = []
  private historyBytes = 0

  constructor(document: StructuralDocument, options: CommandGatewayOptions = {}) {
    this.document = document
    this.maxHistoryEntries = options.maxHistoryEntries ?? 100
    this.maxHistoryBytes = options.maxHistoryBytes ?? 64 * 1024 * 1024
  }

  get canUndo() { return this.undoStack.length > 0 }
  get canRedo() { return this.redoStack.length > 0 }

  execute(command: CommandEnvelope, context: CommandGatewayContext = {}): CommandResult {
    assertCommandEnvelope(command)
    assertCommandAuthorized(command, context.policy)
    validateCommandId(command.commandId)
    if (command.schemaVersion !== COMMAND_SCHEMA_VERSION) {
      throw new CommandValidationError(`Unsupported command schemaVersion ${String(command.schemaVersion)}`)
    }
    const signature = canonicalStringify(command)
    const replay = this.replayByCommandId.get(command.commandId)
    if (replay) {
      if (replay.signature !== signature) throw new CommandValidationError(`commandId ${command.commandId} was reused with different content`)
      return { ...replay.result, idempotentReplay: true }
    }

    const expected = command.expectedModelRevision ?? command.modelRevision
    if (expected !== this.document.revision) {
      throw new CommandConflictError(
        expected,
        this.document.revision,
        this.auditLog.filter(entry => entry.revision > expected),
      )
    }

    const operations = command.type === 'Transaction'
      ? (command.payload as { operations: readonly CommandTransactionOperation[] }).operations
      : [{ type: command.type, payload: command.payload } as StructuralCommandOperation]
    const workspaceOnly = operations.every(operation =>
      operation.type === 'SetSelection' || operation.type === 'HideEntities' || operation.type === 'ShowEntities',
    )
    if (workspaceOnly) return this.executeWorkspaceOnly(command, operations as readonly WorkspaceOperation[], signature, context)

    const beforeSnapshot = this.document.getSnapshot()
    const before = snapshotToSeed(beforeSnapshot)
    let draft = clone(before)
    const beforeWorkspace = clone(context.getWorkspaceState?.() ?? emptyWorkspace())
    let workspace = clone(beforeWorkspace)
    const aliases = new Map<string, EntityId>()
    const explicitWorkspaceRefs = operations.flatMap(operation =>
      operation.type === 'SetSelection' || operation.type === 'HideEntities' || operation.type === 'ShowEntities'
        ? [...operation.payload.entities]
        : [],
    )

    for (const operation of operations) {
      const applied = this.applyOperation(draft, workspace, operation, aliases, context)
      draft = applied.draft
      workspace = applied.workspace
    }

    // Constructing the candidate validates the entire transaction before any
    // document/workspace mutation or render notification can occur.
    const candidate = new StructuralDocument(draft)
    for (const ref of explicitWorkspaceRefs) {
      if (!candidate[ref.collection].has(ref.id)) {
        throw new CommandValidationError(`Unknown workspace ${ref.collection} id ${ref.id}`)
      }
    }
    const entityStillExists = (ref: EntityReference) => candidate[ref.collection].has(ref.id)
    workspace = {
      selection: workspace.selection.filter(entityStillExists),
      hidden: workspace.hidden.filter(entityStillExists),
    }
    const documentChanged = candidate.getSnapshotHash() !== this.document.getSnapshotHash()
    const workspaceChanged = canonicalStringify(workspace) !== canonicalStringify(beforeWorkspace)
    const resultBase = {
      commandId: command.commandId,
      ...(command.transactionId ? { transactionId: command.transactionId } : {}),
      previousRevision: this.document.revision,
      dryRun: command.dryRun === true,
      idempotentReplay: false,
      changed: documentChanged || workspaceChanged,
      aliases: Object.freeze(Object.fromEntries(aliases)),
    }

    if (command.dryRun) {
      return Object.freeze({
        ...resultBase,
        revision: this.document.revision,
        changes: documentChanged ? this.document.previewReconcile(draft) : null,
        snapshotHash: candidate.getSnapshotHash(),
      })
    }

    const change = documentChanged ? this.document.reconcile(draft) : null
    if (workspaceChanged) context.applyWorkspaceState?.(clone(workspace))
    const result = Object.freeze({
      ...resultBase,
      revision: this.document.revision,
      changes: change,
      snapshotHash: this.document.getSnapshotHash(),
    }) as CommandResult

    if (result.changed) {
      this.pushHistory({
        kind: 'document',
        before,
        after: snapshotToSeed(this.document.getSnapshot()),
        beforeWorkspace,
        afterWorkspace: workspace,
        bytes: canonicalStringify([before, draft, beforeWorkspace, workspace]).length * 2,
      })
      this.redoStack.length = 0
    }
    const audit = Object.freeze({
      commandId: command.commandId,
      ...(command.transactionId ? { transactionId: command.transactionId } : {}),
      type: command.type,
      source: command.source,
      ...(command.actor ? { actor: clone(command.actor) } : {}),
      previousRevision: beforeSnapshot.revision,
      revision: this.document.revision,
      timestamp: Date.now(),
      changed: result.changed,
      changes: change,
    }) as CommandAuditEntry
    this.auditLog.push(audit)
    this.replayByCommandId.set(command.commandId, { signature, result })
    context.onCommitted?.(result)
    return result
  }

  undo(context: CommandGatewayContext = {}): CommandResult | null {
    const entry = this.undoStack.pop()
    if (!entry) return null
    this.historyBytes -= entry.bytes
    const previousRevision = this.document.revision
    const change = entry.kind === 'document' ? this.document.reconcile(entry.before) : null
    context.applyWorkspaceState?.(clone(entry.beforeWorkspace))
    this.redoStack.push(entry)
    const result = this.historyResult('undo', previousRevision, change, true)
    this.auditHistory('Undo', result)
    context.onCommitted?.(result)
    return result
  }

  redo(context: CommandGatewayContext = {}): CommandResult | null {
    const entry = this.redoStack.pop()
    if (!entry) return null
    const previousRevision = this.document.revision
    const change = entry.kind === 'document' ? this.document.reconcile(entry.after) : null
    context.applyWorkspaceState?.(clone(entry.afterWorkspace))
    this.undoStack.push(entry)
    this.historyBytes += entry.bytes
    const result = this.historyResult('redo', previousRevision, change, true)
    this.auditHistory('Redo', result)
    context.onCommitted?.(result)
    return result
  }

  private historyResult(
    kind: 'undo' | 'redo',
    previousRevision: number,
    changes: ReturnType<StructuralDocument['reconcile']>,
    workspaceRestored: boolean,
  ): CommandResult {
    return Object.freeze({
      commandId: `${kind}:${this.document.revision}`,
      previousRevision,
      revision: this.document.revision,
      dryRun: false,
      idempotentReplay: false,
      changed: changes !== null || workspaceRestored,
      changes,
      aliases: {},
      snapshotHash: this.document.getSnapshotHash(),
    })
  }

  private auditHistory(type: 'Undo' | 'Redo', result: CommandResult) {
    this.auditLog.push(Object.freeze({
      commandId: result.commandId,
      type,
      source: 'system',
      previousRevision: result.previousRevision,
      revision: result.revision,
      timestamp: Date.now(),
      changed: result.changed,
      changes: result.changes,
    }))
  }

  private pushHistory(entry: HistoryEntry) {
    if (entry.bytes > this.maxHistoryBytes || this.maxHistoryEntries < 1) return
    this.undoStack.push(entry)
    this.historyBytes += entry.bytes
    while (this.undoStack.length > this.maxHistoryEntries || this.historyBytes > this.maxHistoryBytes) {
      const removed = this.undoStack.shift()
      if (removed) this.historyBytes -= removed.bytes
    }
  }

  private executeWorkspaceOnly(
    command: CommandEnvelope,
    operations: readonly WorkspaceOperation[],
    signature: string,
    context: CommandGatewayContext,
  ): CommandResult {
    const beforeWorkspace = clone(context.getWorkspaceState?.() ?? emptyWorkspace())
    let workspace = clone(beforeWorkspace)

    for (const operation of operations) {
      switch (operation.type) {
        case 'SetSelection':
          workspace = { ...workspace, selection: operation.payload.entities.map(clone) }
          break
        case 'HideEntities': {
          const hidden = new Map(workspace.hidden.map(ref => [refKey(ref), ref]))
          for (const ref of operation.payload.entities) hidden.set(refKey(ref), clone(ref))
          workspace = { ...workspace, hidden: [...hidden.values()] }
          break
        }
        case 'ShowEntities': {
          const shown = new Set(operation.payload.entities.map(refKey))
          workspace = { ...workspace, hidden: workspace.hidden.filter(ref => !shown.has(refKey(ref))) }
          break
        }
      }
    }

    const explicitRefs = operations.flatMap(operation => [...operation.payload.entities])
    for (const ref of explicitRefs) {
      if (!this.document[ref.collection].has(ref.id)) {
        throw new CommandValidationError(`Unknown workspace ${ref.collection} id ${ref.id}`)
      }
    }
    const entityStillExists = (ref: EntityReference) => this.document[ref.collection].has(ref.id)
    workspace = {
      selection: workspace.selection.filter(entityStillExists),
      hidden: workspace.hidden.filter(entityStillExists),
    }
    const workspaceChanged = canonicalStringify(workspace) !== canonicalStringify(beforeWorkspace)
    const result = Object.freeze({
      commandId: command.commandId,
      ...(command.transactionId ? { transactionId: command.transactionId } : {}),
      previousRevision: this.document.revision,
      revision: this.document.revision,
      dryRun: command.dryRun === true,
      idempotentReplay: false,
      changed: workspaceChanged,
      changes: null,
      aliases: {},
      snapshotHash: this.document.getSnapshotHash(),
    }) as CommandResult
    if (command.dryRun) return result

    if (workspaceChanged) {
      context.applyWorkspaceState?.(clone(workspace))
      this.pushHistory({
        kind: 'workspace',
        beforeWorkspace,
        afterWorkspace: workspace,
        bytes: canonicalStringify([beforeWorkspace, workspace]).length * 2,
      })
      this.redoStack.length = 0
    }
    const audit = Object.freeze({
      commandId: command.commandId,
      ...(command.transactionId ? { transactionId: command.transactionId } : {}),
      type: command.type,
      source: command.source,
      ...(command.actor ? { actor: clone(command.actor) } : {}),
      previousRevision: this.document.revision,
      revision: this.document.revision,
      timestamp: Date.now(),
      changed: workspaceChanged,
      changes: null,
    }) as CommandAuditEntry
    this.auditLog.push(audit)
    this.replayByCommandId.set(command.commandId, { signature, result })
    context.onCommitted?.(result)
    return result
  }

  private applyOperation(
    initialDraft: StructuralDocumentSeed,
    initialWorkspace: CommandWorkspaceState,
    operation: StructuralCommandOperation,
    aliases: Map<string, EntityId>,
    context: CommandGatewayContext,
  ): { draft: StructuralDocumentSeed; workspace: CommandWorkspaceState } {
    let draft = initialDraft
    let workspace = initialWorkspace
    const usedIds = new Map<EntityCollection, Set<EntityId>>()
    const nextIds = new Map<EntityCollection, EntityId>()
    const idsFor = (collection: EntityCollection) => {
      let ids = usedIds.get(collection)
      if (!ids) {
        ids = new Set(collectionArray<{ id: EntityId }>(draft, collection).map(value => value.id))
        usedIds.set(collection, ids)
      }
      return ids
    }
    const allocateId = (collection: EntityCollection) => {
      const used = idsFor(collection)
      let id = nextIds.get(collection) ?? 1
      while (used.has(id)) id++
      nextIds.set(collection, id + 1)
      return id
    }
    const resolve = (ref: LocalReference) => {
      if (typeof ref === 'number') return ref
      const id = aliases.get(ref.alias)
      if (id === undefined) throw new CommandValidationError(`Unknown local alias ${ref.alias}`)
      return id
    }
    const reserve = <T extends { id?: EntityId; alias?: string }>(collection: EntityCollection, record: T) => {
      const used = idsFor(collection)
      const id = record.id ?? allocateId(collection)
      if (used.has(id)) throw new CommandValidationError(`Duplicate ${collection} id ${id}`)
      used.add(id)
      if (record.alias) {
        if (aliases.has(record.alias)) throw new CommandValidationError(`Duplicate local alias ${record.alias}`)
        aliases.set(record.alias, id)
      }
      return id
    }
    const upsert = <T extends { id: EntityId }>(collection: EntityCollection, record: T) => {
      const values = collectionArray<T>(draft, collection)
      const index = values.findIndex(value => value.id === record.id)
      if (index < 0) values.push(record)
      else values[index] = record
    }
    const identifyUpsert = <T extends { id?: EntityId; alias?: string }>(collection: EntityCollection, record: T) => {
      const used = idsFor(collection)
      const id = record.id ?? allocateId(collection)
      used.add(id)
      if (record.alias) {
        if (aliases.has(record.alias)) throw new CommandValidationError(`Duplicate local alias ${record.alias}`)
        aliases.set(record.alias, id)
      }
      return id
    }
    switch (operation.type) {
      case 'CreateNodes':
        for (const raw of operation.payload.nodes) {
          const id = reserve('nodes', raw)
          const record = stripAlias(raw)
          collectionArray(draft, 'nodes').push({ ...record, id })
        }
        break
      case 'MoveNodes': {
        const values = collectionArray(draft, 'nodes') as { id: EntityId; position: readonly [number, number, number]; metadata?: Readonly<Record<string, unknown>> }[]
        for (const move of operation.payload.nodes) {
          const id = resolve(move.id)
          const index = values.findIndex(value => value.id === id)
          if (index < 0) throw new CommandValidationError(`Unknown nodes id ${id}`)
          values[index] = {
            ...values[index],
            position: clone(move.position),
            ...(move.name === undefined ? {} : { name: move.name }),
            ...(move.metadata === undefined ? {} : { metadata: clone(move.metadata) }),
          }
        }
        break
      }
      case 'DeleteNodes': {
        const ids = new Set(operation.payload.ids.map(resolve))
        const candidate = new StructuralDocument(draft)
        for (const id of ids) candidate.deleteNode(id, { cascade: operation.payload.cascade })
        draft = snapshotToSeed(candidate.getSnapshot())
        break
      }
      case 'CreateMembers':
        for (const raw of operation.payload.members) {
          const id = reserve('members', raw)
          const { nodeI, nodeJ, sectionId, ...record } = stripAlias(raw)
          collectionArray<Member1DRecord>(draft, 'members').push({
            ...record,
            id,
            nodeI: resolve(nodeI),
            nodeJ: resolve(nodeJ),
            sectionId: resolve(sectionId),
          })
        }
        break
      case 'UpdateMembers': {
        const values = collectionArray(draft, 'members') as { id: EntityId }[]
        for (const update of operation.payload.members) {
          const id = resolve(update.id)
          const index = values.findIndex(value => value.id === id)
          if (index < 0) throw new CommandValidationError(`Unknown members id ${id}`)
          values[index] = { ...values[index], ...clone(update.patch), id }
        }
        break
      }
      case 'DeleteMembers': {
        const candidate = new StructuralDocument(draft)
        for (const ref of operation.payload.ids) candidate.deleteMember(resolve(ref))
        draft = snapshotToSeed(candidate.getSnapshot())
        break
      }
      case 'DeleteShells': {
        const candidate = new StructuralDocument(draft)
        for (const ref of operation.payload.ids) candidate.deleteShell(resolve(ref))
        draft = snapshotToSeed(candidate.getSnapshot())
        break
      }
      case 'CreateOrUpdateShells':
        for (const raw of operation.payload.shells) {
          const id = identifyUpsert('shells', raw)
          const record = stripAlias(raw)
          upsert('shells', { ...record, id })
        }
        break
      case 'CreateOrUpdateMaterials':
        for (const raw of operation.payload.materials) {
          const id = identifyUpsert('materials', raw)
          const record = stripAlias(raw)
          upsert('materials', { ...record, id })
        }
        break
      case 'DeleteMaterials': {
        const candidate = new StructuralDocument(draft)
        for (const ref of operation.payload.ids) candidate.deleteMaterial(resolve(ref))
        draft = snapshotToSeed(candidate.getSnapshot())
        break
      }
      case 'CreateOrUpdateSections':
        for (const raw of operation.payload.sections) {
          const id = identifyUpsert('sections', raw)
          const { materialId, ...record } = stripAlias(raw)
          upsert('sections', { ...record, id, materialId: resolve(materialId) })
        }
        break
      case 'DeleteSections': {
        const candidate = new StructuralDocument(draft)
        for (const ref of operation.payload.ids) candidate.deleteSection(resolve(ref), { cascade: operation.payload.cascade })
        draft = snapshotToSeed(candidate.getSnapshot())
        break
      }
      case 'CreateOrUpdateLoads':
        for (const raw of operation.payload.loads) {
          const id = identifyUpsert('loads', raw)
          const record = stripAlias(raw)
          upsert('loads', { ...record, id })
        }
        break
      case 'DeleteLoads': {
        const candidate = new StructuralDocument(draft)
        for (const ref of operation.payload.ids) candidate.deleteLoad(resolve(ref))
        draft = snapshotToSeed(candidate.getSnapshot())
        break
      }
      case 'CreateOrUpdateBoundaryConditions':
        for (const raw of operation.payload.boundaryConditions) {
          const id = identifyUpsert('boundaryConditions', raw)
          const record = stripAlias(raw)
          upsert('boundaryConditions', { ...record, id })
        }
        break
      case 'DeleteBoundaryConditions': {
        const candidate = new StructuralDocument(draft)
        for (const ref of operation.payload.ids) candidate.deleteBoundaryCondition(resolve(ref))
        draft = snapshotToSeed(candidate.getSnapshot())
        break
      }
      case 'CreateOrUpdateGrids':
        for (const raw of operation.payload.grids) {
          const id = identifyUpsert('grids', raw)
          const record = stripAlias(raw)
          upsert('grids', { ...record, id })
        }
        break
      case 'DeleteGrids': {
        const candidate = new StructuralDocument(draft)
        for (const ref of operation.payload.ids) candidate.deleteGrid(resolve(ref))
        draft = snapshotToSeed(candidate.getSnapshot())
        break
      }
      case 'CreateOrUpdateLevels':
        for (const raw of operation.payload.levels) {
          const id = identifyUpsert('levels', raw)
          const record = stripAlias(raw)
          upsert('levels', { ...record, id })
        }
        break
      case 'DeleteLevels': {
        const candidate = new StructuralDocument(draft)
        for (const ref of operation.payload.ids) candidate.deleteLevel(resolve(ref))
        draft = snapshotToSeed(candidate.getSnapshot())
        break
      }
      case 'CreateOrUpdateGroups':
        for (const raw of operation.payload.groups) {
          const id = identifyUpsert('groups', raw)
          const record = stripAlias(raw)
          upsert('groups', { ...record, id })
        }
        break
      case 'DeleteGroups': {
        const candidate = new StructuralDocument(draft)
        for (const ref of operation.payload.ids) candidate.deleteGroup(resolve(ref))
        draft = snapshotToSeed(candidate.getSnapshot())
        break
      }
case 'CreateOrUpdateSelectionSets':
        for (const raw of operation.payload.selectionSets) {
          const id = identifyUpsert('selectionSets', raw)
          const record = stripAlias(raw)
          upsert('selectionSets', { ...record, id })
        }
        break
      case 'DeleteSelectionSets': {
        const candidate = new StructuralDocument(draft)
        for (const ref of operation.payload.ids) candidate.deleteSelectionSet(resolve(ref))
        draft = snapshotToSeed(candidate.getSnapshot())
        break
      }
      case 'CreateOrUpdateParametricObjects':
        for (const raw of operation.payload.parametricObjects) {
          const id = identifyUpsert('parametricObjects', raw)
          const record = stripAlias(raw)
          upsert('parametricObjects', { ...record, id })
        }
        break
      case 'DeleteParametricObjects': {
        const candidate = new StructuralDocument(draft)
        for (const ref of operation.payload.ids) candidate.deleteParametricObject(resolve(ref))
        draft = snapshotToSeed(candidate.getSnapshot())
        break
      }
      case 'DetachFromParametricObject': {
        const objectId = resolve(operation.payload.objectId)
        const values = collectionArray(draft, 'parametricObjects') as import('./types.ts').ParametricObjectRecord[]
        const index = values.findIndex(value => value.id === objectId)
        if (index < 0) throw new CommandValidationError(`Unknown parametricObjects id ${objectId}`)
        const detached = new Set(operation.payload.entities.map(refKey))
        const current = values[index]
        const owned = new Set(current.ownedEntityRefs.map(refKey))
        for (const ref of operation.payload.entities) {
          if (!owned.has(refKey(ref))) throw new CommandValidationError(`Entity ${refKey(ref)} is not owned by parametric object ${objectId}`)
        }
        values[index] = {
          ...current,
          ownedEntityRefs: current.ownedEntityRefs.filter(ref => !detached.has(refKey(ref))),
          ...(current.roleBindings ? {
            roleBindings: Object.fromEntries(Object.entries(current.roleBindings).filter(([, ref]) => !detached.has(refKey(ref)))),
          } : {}),
        }
        break
      }
      case 'SetSelection':
        workspace = { ...workspace, selection: operation.payload.entities.map(clone) }
        break
      case 'HideEntities': {
        const hidden = new Map(workspace.hidden.map(ref => [refKey(ref), ref]))
        for (const ref of operation.payload.entities) hidden.set(refKey(ref), clone(ref))
        workspace = { ...workspace, hidden: [...hidden.values()] }
        break
      }
      case 'ShowEntities': {
        const shown = new Set(operation.payload.entities.map(refKey))
        workspace = { ...workspace, hidden: workspace.hidden.filter(ref => !shown.has(refKey(ref))) }
        break
      }
      case 'ImportModel':
        this.assertDestructiveAllowed('ImportModel', operation.payload.confirmed, context)
        draft = operation.payload.replace === false
          ? this.mergeSeed(draft, operation.payload.document)
          : clone(operation.payload.document)
        break
      case 'ClearModel':
        this.assertDestructiveAllowed('ClearModel', operation.payload.confirmed, context)
        draft = {}
        workspace = emptyWorkspace()
        break
      default:
        throw new CommandValidationError(`Unsupported command operation ${(operation as { type: string }).type}`)
    }
    return { draft, workspace }
  }

  private assertDestructiveAllowed(operation: 'ImportModel' | 'ClearModel', confirmed: boolean | undefined, context: CommandGatewayContext) {
    if (confirmed !== true || context.allowDestructive?.(operation) !== true) {
      throw new CommandValidationError(`${operation} requires explicit confirmation and destructive policy approval`)
    }
  }

  private mergeSeed(current: StructuralDocumentSeed, incoming: StructuralDocumentSeed): StructuralDocumentSeed {
    const merged = clone(current)
    for (const collection of ENTITY_COLLECTIONS) {
      const values = [...(merged[collection] ?? [])] as { id: EntityId }[]
      const byId = new Map(values.map(value => [value.id, value]))
      for (const value of (incoming[collection] ?? []) as readonly { id: EntityId }[]) byId.set(value.id, clone(value))
      ;(merged as Record<string, unknown>)[collection] = [...byId.values()]
    }
    merged.metadata = { ...(current.metadata ?? {}), ...(incoming.metadata ?? {}) }
    return merged
  }

}
