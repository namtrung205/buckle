import { canonicalStringify, deepFreeze, deterministicHash } from './canonical.ts'
import {
  ENTITY_COLLECTIONS,
  STRUCTURAL_DOCUMENT_VERSION,
  STRUCTURAL_SCHEMA_VERSION,
  type AnalysisSnapshot,
  type AnalysisTransportModel,
  type BoundaryConditionRecord,
  type EntityCollection,
  type EntityDelta,
  type EntityId,
  type EntityReference,
  type GroupRecord,
  type LoadRecord,
  type MaterialRecord,
  type Member1DRecord,
  type NodeRecord,
  type ParametricObjectRecord,
  type SectionRecord,
  type SelectionSetRecord,
  type Shell2DRecord,
  type StructuralChangeSet,
  type StructuralDocumentSeed,
  type StructuralDocumentSnapshot,
  type GridRecord,
  type LevelRecord,
} from './types.ts'

type EntityRecord = { id: EntityId }
type Listener = (change: StructuralChangeSet) => void

const emptyDelta = (): EntityDelta => ({ created: [], updated: [], deleted: [] })
const emptyChanges = () => Object.fromEntries(
  ENTITY_COLLECTIONS.map(collection => [collection, emptyDelta()]),
) as Record<EntityCollection, EntityDelta>
const sorted = <T extends EntityRecord>(values: Iterable<T>) => [...values].sort((a, b) => a.id - b.id)
const cloneRecord = <T>(value: T): T => structuredClone(value)
const normalizeRecord = <T extends EntityRecord>(value: T, collection: string): T => {
  const record = cloneRecord(value) as T & {
    targetIds?: readonly number[]
    targetNodeIds?: readonly number[]
    entityRefs?: readonly EntityReference[]
    ownedEntityRefs?: readonly EntityReference[]
    roleBindings?: Readonly<Record<string, EntityReference>>
  }
  const sortIds = (ids: readonly number[] | undefined) => ids ? [...new Set(ids)].sort((a, b) => a - b) : undefined
  const sortRefs = (refs: readonly EntityReference[] | undefined) => refs
    ? [...new Map(refs.map(ref => [`${ref.collection}:${ref.id}`, ref])).values()]
      .sort((a, b) => a.collection.localeCompare(b.collection) || a.id - b.id)
    : undefined
  if (collection === 'loads') record.targetIds = sortIds(record.targetIds)
  if (collection === 'boundaryConditions') record.targetNodeIds = sortIds(record.targetNodeIds)
  if (collection === 'groups') record.entityRefs = sortRefs(record.entityRefs)
  if (collection === 'selectionSets') record.entityRefs = sortRefs(record.entityRefs)
  if (collection === 'parametricObjects') record.ownedEntityRefs = sortRefs(record.ownedEntityRefs)
  if (collection === 'parametricObjects' && record.roleBindings) {
    record.roleBindings = Object.fromEntries(Object.entries(record.roleBindings).sort(([left], [right]) => left.localeCompare(right)))
  }
  return record
}

const validateId = (id: number, label: string) => {
  if (!Number.isSafeInteger(id) || id < 1 || id > 0xffffffff) {
    throw new Error(`${label} id must be an integer in [1, 4294967295]; received ${id}`)
  }
}

const mapOf = <T extends EntityRecord>(values: readonly T[], label: string) => {
  const map = new Map<EntityId, T>()
  for (const raw of values) {
    validateId(raw.id, label)
    if (map.has(raw.id)) throw new Error(`Duplicate ${label} id ${raw.id}`)
    map.set(raw.id, normalizeRecord(raw, label))
  }
  return map
}

export class StructuralDocument {
  readonly nodes = new Map<EntityId, NodeRecord>()
  readonly materials = new Map<EntityId, MaterialRecord>()
  readonly sections = new Map<EntityId, SectionRecord>()
  readonly members = new Map<EntityId, Member1DRecord>()
  readonly shells = new Map<EntityId, Shell2DRecord>()
  readonly loads = new Map<EntityId, LoadRecord>()
  readonly boundaryConditions = new Map<EntityId, BoundaryConditionRecord>()
  readonly grids = new Map<EntityId, GridRecord>()
  readonly levels = new Map<EntityId, LevelRecord>()
  readonly groups = new Map<EntityId, GroupRecord>()
  readonly selectionSets = new Map<EntityId, SelectionSetRecord>()
  readonly parametricObjects = new Map<EntityId, ParametricObjectRecord>()
  readonly memberIdsByNodeId = new Map<EntityId, Set<EntityId>>()
  readonly memberIdsBySectionId = new Map<EntityId, Set<EntityId>>()

  revision = 0
  dirty = false
  metadata: Readonly<Record<string, unknown>> = {}
  private readonly listeners = new Set<Listener>()

  constructor(seed: StructuralDocumentSeed = {}) {
    this.replaceMaps(seed)
    this.validate()
    this.rebuildIndexes()
  }

  static fromSnapshot(snapshot: StructuralDocumentSnapshot): StructuralDocument {
    if (snapshot.documentVersion !== STRUCTURAL_DOCUMENT_VERSION) {
      throw new Error(`Unsupported documentVersion ${snapshot.documentVersion}`)
    }
    if (snapshot.schemaVersion !== STRUCTURAL_SCHEMA_VERSION) {
      throw new Error(`Unsupported schemaVersion ${snapshot.schemaVersion}`)
    }
    const document = new StructuralDocument(snapshot)
    document.revision = snapshot.revision
    document.dirty = false
    return document
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  markClean() {
    this.dirty = false
  }

  clear() {
    this.reconcile({})
  }

  reconcile(seed: StructuralDocumentSeed): StructuralChangeSet | null {
    const next = new StructuralDocument(seed)
    const preview = this.diff(next)
    if (!preview) return null

    const previousRevision = this.revision
    this.replaceMaps(seed)
    this.validate()
    this.rebuildIndexes()
    this.revision++
    this.dirty = true
    const change = deepFreeze({ ...preview, previousRevision, revision: this.revision }) as StructuralChangeSet
    for (const listener of this.listeners) listener(change)
    return change
  }

  /** Validate and compute the exact next change set without mutating this document. */
  previewReconcile(seed: StructuralDocumentSeed): StructuralChangeSet | null {
    return this.diff(new StructuralDocument(seed))
  }

  private diff(next: StructuralDocument): StructuralChangeSet | null {
    const changes = emptyChanges()
    let changed = canonicalStringify(this.metadata) !== canonicalStringify(next.metadata)

    for (const collection of ENTITY_COLLECTIONS) {
      const currentMap = this[collection] as Map<EntityId, EntityRecord>
      const nextMap = next[collection] as Map<EntityId, EntityRecord>
      const created: number[] = []
      const updated: number[] = []
      const deleted: number[] = []
      for (const [id, record] of nextMap) {
        const current = currentMap.get(id)
        if (!current) created.push(id)
        else if (canonicalStringify(current) !== canonicalStringify(record)) updated.push(id)
      }
      for (const id of currentMap.keys()) if (!nextMap.has(id)) deleted.push(id)
      created.sort((a, b) => a - b)
      updated.sort((a, b) => a - b)
      deleted.sort((a, b) => a - b)
      changes[collection] = { created, updated, deleted }
      changed ||= created.length + updated.length + deleted.length > 0
    }
    if (!changed) return null
    return deepFreeze({ previousRevision: this.revision, revision: this.revision + 1, changes }) as StructuralChangeSet
  }

  addNode(record: NodeRecord) { this.mutateCollection('nodes', record, false) }
  updateNode(id: EntityId, patch: Partial<Omit<NodeRecord, 'id'>>) {
    this.patchCollection('nodes', id, patch)
  }
  addMember(record: Member1DRecord) { this.mutateCollection('members', record, false) }
  updateMember(id: EntityId, patch: Partial<Omit<Member1DRecord, 'id'>>) {
    this.patchCollection('members', id, patch)
  }
  addSection(record: SectionRecord) { this.mutateCollection('sections', record, false) }
  updateSection(id: EntityId, patch: Partial<Omit<SectionRecord, 'id'>>) {
    this.patchCollection('sections', id, patch)
  }
  addMaterial(record: MaterialRecord) { this.mutateCollection('materials', record, false) }
  updateMaterial(id: EntityId, patch: Partial<Omit<MaterialRecord, 'id'>>) {
    this.patchCollection('materials', id, patch)
  }
  addShell(record: Shell2DRecord) { this.mutateCollection('shells', record, false) }
  updateShell(id: EntityId, patch: Partial<Omit<Shell2DRecord, 'id'>>) {
    this.patchCollection('shells', id, patch)
  }
  addLoad(record: LoadRecord) { this.mutateCollection('loads', record, false) }
  updateLoad(id: EntityId, patch: Partial<Omit<LoadRecord, 'id'>>) {
    this.patchCollection('loads', id, patch)
  }
  addBoundaryCondition(record: BoundaryConditionRecord) { this.mutateCollection('boundaryConditions', record, false) }
  updateBoundaryCondition(id: EntityId, patch: Partial<Omit<BoundaryConditionRecord, 'id'>>) {
    this.patchCollection('boundaryConditions', id, patch)
  }
  addGrid(record: GridRecord) { this.mutateCollection('grids', record, false) }
  updateGrid(id: EntityId, patch: Partial<Omit<GridRecord, 'id'>>) { this.patchCollection('grids', id, patch) }
  addLevel(record: LevelRecord) { this.mutateCollection('levels', record, false) }
  updateLevel(id: EntityId, patch: Partial<Omit<LevelRecord, 'id'>>) { this.patchCollection('levels', id, patch) }
  addGroup(record: GroupRecord) { this.mutateCollection('groups', record, false) }
  updateGroup(id: EntityId, patch: Partial<Omit<GroupRecord, 'id'>>) { this.patchCollection('groups', id, patch) }
  addSelectionSet(record: SelectionSetRecord) { this.mutateCollection('selectionSets', record, false) }
  updateSelectionSet(id: EntityId, patch: Partial<Omit<SelectionSetRecord, 'id'>>) {
    this.patchCollection('selectionSets', id, patch)
  }
  addParametricObject(record: ParametricObjectRecord) { this.mutateCollection('parametricObjects', record, false) }
  updateParametricObject(id: EntityId, patch: Partial<Omit<ParametricObjectRecord, 'id'>>) {
    this.patchCollection('parametricObjects', id, patch)
  }

  deleteLoad(id: EntityId) { this.deleteFromSeed('loads', id, () => undefined) }
  deleteBoundaryCondition(id: EntityId) { this.deleteFromSeed('boundaryConditions', id, () => undefined) }
  deleteShell(id: EntityId) {
    this.deleteFromSeed('shells', id, seed => {
      seed.loads = seed.loads?.map(load => load.type === 'area' || load.type === 'pressure'
        ? { ...load, targetIds: load.targetIds.filter(target => target !== id) }
        : load).filter(load => load.targetIds.length > 0)
    })
  }
  deleteGrid(id: EntityId) { this.deleteFromSeed('grids', id, () => undefined) }
  deleteLevel(id: EntityId) { this.deleteFromSeed('levels', id, () => undefined) }
  deleteGroup(id: EntityId) { this.deleteFromSeed('groups', id, () => undefined) }
  /** Delete a selection-set node AND the whole folder subtree rooted at it
   *  (children are folded into the same single document revision). */
  deleteSelectionSet(id: EntityId) {
    this.deleteFromSeed('selectionSets', id, seed => {
      const descendants = new Set<EntityId>()
      const collect = (parentId: EntityId) => {
        for (const candidate of seed.selectionSets ?? []) {
          if (candidate.parentId === parentId && !descendants.has(candidate.id)) {
            descendants.add(candidate.id)
            collect(candidate.id)
          }
        }
      }
      collect(id)
      if (descendants.size) {
        seed.selectionSets = (seed.selectionSets ?? []).filter(candidate => !descendants.has(candidate.id))
      }
    })
  }
  deleteParametricObject(id: EntityId) { this.deleteFromSeed('parametricObjects', id, () => undefined) }

  deleteMaterial(id: EntityId) {
    const sectionIds = new Set(sorted(this.sections.values()).filter(section => section.materialId === id).map(section => section.id))
    const shellIds = new Set(sorted(this.shells.values()).filter(shell => shell.materialId === id).map(shell => shell.id))
    if (sectionIds.size || shellIds.size) throw new Error(`Material ${id} is still referenced`)
    this.deleteFromSeed('materials', id, () => undefined)
  }

  deleteMember(id: EntityId) {
    this.deleteFromSeed('members', id, seed => {
      seed.loads = seed.loads?.map(load => load.type === 'linear'
        ? { ...load, targetIds: load.targetIds.filter(target => target !== id) }
        : load).filter(load => load.targetIds.length > 0)
    })
  }

  deleteNode(id: EntityId, options: { cascade?: boolean } = {}) {
    const referencedMembers = [...(this.memberIdsByNodeId.get(id) ?? [])]
    const referencedShells = sorted(this.shells.values()).filter(shell => shell.nodeIds.includes(id))
    const referencedSupports = sorted(this.boundaryConditions.values()).filter(bc => bc.targetNodeIds.includes(id))
    const referencedLoads = sorted(this.loads.values()).filter(load => load.type === 'nodal' && load.targetIds.includes(id))
    if (!options.cascade && (referencedMembers.length || referencedShells.length || referencedSupports.length || referencedLoads.length)) {
      throw new Error(`Node ${id} is still referenced`)
    }
    this.deleteFromSeed('nodes', id, seed => {
      if (!options.cascade) return
      const memberIds = new Set(referencedMembers)
      const shellIds = new Set(referencedShells.map(shell => shell.id))
      seed.members = seed.members?.filter(member => !memberIds.has(member.id))
      seed.shells = seed.shells?.filter(shell => !shellIds.has(shell.id))
      seed.boundaryConditions = seed.boundaryConditions
        ?.map(bc => ({ ...bc, targetNodeIds: bc.targetNodeIds.filter(target => target !== id) }))
        .filter(bc => bc.targetNodeIds.length > 0)
      seed.loads = seed.loads
        ?.map(load => ({
          ...load,
          targetIds: load.type === 'nodal'
            ? load.targetIds.filter(target => target !== id)
            : load.type === 'linear'
            ? load.targetIds.filter(target => !memberIds.has(target))
            : load.targetIds.filter(target => !shellIds.has(target)),
        }))
        .filter(load => load.targetIds.length > 0)
      this.removeEntityReferences(seed, [
        { collection: 'nodes', id },
        ...[...memberIds].map(memberId => ({ collection: 'members' as const, id: memberId })),
        ...[...shellIds].map(shellId => ({ collection: 'shells' as const, id: shellId })),
      ])
    })
  }

  deleteSection(id: EntityId, options: { cascade?: boolean } = {}) {
    const memberIds = new Set(this.memberIdsBySectionId.get(id) ?? [])
    if (!options.cascade && memberIds.size) throw new Error(`Section ${id} is still referenced`)
    this.deleteFromSeed('sections', id, seed => {
      if (!options.cascade) return
      seed.members = seed.members?.filter(member => !memberIds.has(member.id))
      seed.loads = seed.loads?.map(load => load.type === 'linear'
        ? { ...load, targetIds: load.targetIds.filter(target => !memberIds.has(target)) }
        : load).filter(load => load.targetIds.length > 0)
      this.removeEntityReferences(seed, [
        { collection: 'sections', id },
        ...[...memberIds].map(memberId => ({ collection: 'members' as const, id: memberId })),
      ])
    })
  }

  getSnapshot(): StructuralDocumentSnapshot {
    const snapshot: StructuralDocumentSnapshot = {
      documentVersion: STRUCTURAL_DOCUMENT_VERSION,
      schemaVersion: STRUCTURAL_SCHEMA_VERSION,
      revision: this.revision,
      nodes: sorted(this.nodes.values()).map(cloneRecord),
      materials: sorted(this.materials.values()).map(cloneRecord),
      sections: sorted(this.sections.values()).map(cloneRecord),
      members: sorted(this.members.values()).map(cloneRecord),
      shells: sorted(this.shells.values()).map(cloneRecord),
      loads: sorted(this.loads.values()).map(cloneRecord),
      boundaryConditions: sorted(this.boundaryConditions.values()).map(cloneRecord),
      grids: sorted(this.grids.values()).map(cloneRecord),
      levels: sorted(this.levels.values()).map(cloneRecord),
      groups: sorted(this.groups.values()).map(cloneRecord),
      selectionSets: sorted(this.selectionSets.values()).map(cloneRecord),
      parametricObjects: sorted(this.parametricObjects.values()).map(cloneRecord),
      metadata: cloneRecord(this.metadata),
    }
    return deepFreeze(snapshot) as StructuralDocumentSnapshot
  }

  getSnapshotHash(): string {
    const semantic = cloneRecord(this.getSnapshot()) as Partial<StructuralDocumentSnapshot>
    delete semantic.revision
    return deterministicHash(semantic)
  }

  createAnalysisSnapshot(): AnalysisSnapshot {
    this.validate()
    const nodes = sorted(this.nodes.values())
    const nodeTransport = (id: number) => {
      const node = this.require(this.nodes, id, 'node')
      return { id: node.id, ...(node.name ? { name: node.name } : {}), x: node.position[0], y: node.position[1], z: node.position[2] }
    }
    const materials = sorted(this.materials.values()).map(cloneRecord)
    const sections = sorted(this.sections.values()).map(section => {
      const { materialId, ...rest } = cloneRecord(section)
      return { ...rest, material: cloneRecord(this.require(this.materials, materialId, 'material')) }
    })
    const modelWithoutSnapshotMetadata = {
      schemaVersion: STRUCTURAL_SCHEMA_VERSION,
      nodes: nodes.map(node => nodeTransport(node.id)),
      materials,
      sections,
      members: sorted(this.members.values()).map(member => ({
        id: member.id,
        ...(member.label ? { label: member.label } : {}),
        nodei: nodeTransport(member.nodeI),
        nodej: nodeTransport(member.nodeJ),
        section: member.sectionId,
        ...(member.referenceAxis ? { vecxz: cloneRecord(member.referenceAxis) } : {}),
        gamma: member.gammaDegrees ?? 0,
        release: member.release ?? '',
      })),
      loads: sorted(this.loads.values()).map(load => ({
        id: load.id,
        ...(load.name ? { name: load.name } : {}),
        type: load.type,
        targets: [...load.targetIds],
        value: { x: load.value[0], y: load.value[1], z: load.value[2] },
        ...(load.magnitude === undefined ? {} : { magnitude: load.magnitude }),
      })),
      boundary_conditions: sorted(this.boundaryConditions.values()).map(bc => ({
        id: bc.id,
        ...(bc.name ? { name: bc.name } : {}),
        type: bc.type,
        targets: [...bc.targetNodeIds],
        dx: bc.dx, dy: bc.dy, dz: bc.dz, rx: bc.rx, ry: bc.ry, rz: bc.rz,
        rotation: bc.rotationDegrees ?? 0,
      })),
      shells: sorted(this.shells.values()).map(shell => ({
        id: shell.id,
        ...(shell.name ? { name: shell.name } : {}),
        nodes: [...shell.nodeIds],
        thickness: shell.thickness,
        material: cloneRecord(this.require(this.materials, shell.materialId, 'material')),
      })),
    }
    const hash = deterministicHash(modelWithoutSnapshotMetadata)
    const model: AnalysisTransportModel = {
      ...modelWithoutSnapshotMetadata,
      metadata: { ...cloneRecord(this.metadata), modelRevision: this.revision, snapshotHash: hash },
    }
    return deepFreeze({ revision: this.revision, hash, model }) as AnalysisSnapshot
  }

  private mutateCollection<T extends EntityRecord>(collection: EntityCollection, record: T, replace: boolean) {
    const seed = this.toSeed()
    const values = [...(seed[collection] as unknown as readonly T[] ?? [])]
    const index = values.findIndex(item => item.id === record.id)
    if (index >= 0 && !replace) throw new Error(`Duplicate ${collection} id ${record.id}`)
    if (index >= 0) values[index] = cloneRecord(record)
    else values.push(cloneRecord(record))
    ;(seed as Record<string, unknown>)[collection] = values
    this.reconcile(seed)
  }

  private patchCollection<T extends EntityRecord>(collection: EntityCollection, id: EntityId, patch: Partial<Omit<T, 'id'>>) {
    const map = this[collection] as unknown as Map<EntityId, T>
    const current = this.require(map, id, collection)
    this.mutateCollection(collection, { ...cloneRecord(current), ...cloneRecord(patch), id }, true)
  }

  private deleteFromSeed(collection: EntityCollection, id: EntityId, cascade: (seed: StructuralDocumentSeed) => void) {
    const map = this[collection] as Map<EntityId, EntityRecord>
    this.require(map, id, collection)
    const seed = this.toSeed()
    ;(seed as Record<string, unknown>)[collection] = (seed[collection] as readonly EntityRecord[]).filter(item => item.id !== id)
    cascade(seed)
    this.removeEntityReferences(seed, [{ collection, id }])
    this.reconcile(seed)
  }

  private removeEntityReferences(seed: StructuralDocumentSeed, removed: readonly EntityReference[]) {
    const keys = new Set(removed.map(ref => `${ref.collection}:${ref.id}`))
    const keep = (ref: EntityReference) => !keys.has(`${ref.collection}:${ref.id}`)
    seed.groups = seed.groups?.map(group => ({ ...group, entityRefs: group.entityRefs.filter(keep) }))
    seed.selectionSets = seed.selectionSets?.map(set => ({ ...set, entityRefs: set.entityRefs.filter(keep) }))
    seed.parametricObjects = seed.parametricObjects?.map(object => ({
      ...object,
      ownedEntityRefs: object.ownedEntityRefs.filter(keep),
      ...(object.roleBindings ? {
        roleBindings: Object.fromEntries(Object.entries(object.roleBindings).filter(([, ref]) => keep(ref))),
      } : {}),
    }))
  }

  private toSeed(): StructuralDocumentSeed {
    const snapshot = this.getSnapshot()
    return Object.fromEntries([
      ...ENTITY_COLLECTIONS.map(collection => [collection, snapshot[collection]]),
      ['metadata', snapshot.metadata],
    ]) as StructuralDocumentSeed
  }

  private replaceMaps(seed: StructuralDocumentSeed) {
    for (const collection of ENTITY_COLLECTIONS) {
      const values = seed[collection] ?? []
      const next = mapOf(values as readonly EntityRecord[], collection)
      const target = this[collection] as Map<EntityId, EntityRecord>
      target.clear()
      for (const [id, record] of next) target.set(id, record)
    }
    this.metadata = cloneRecord(seed.metadata ?? {})
  }

  private rebuildIndexes() {
    this.memberIdsByNodeId.clear()
    this.memberIdsBySectionId.clear()
    for (const id of this.nodes.keys()) this.memberIdsByNodeId.set(id, new Set())
    for (const id of this.sections.keys()) this.memberIdsBySectionId.set(id, new Set())
    for (const member of this.members.values()) {
      this.memberIdsByNodeId.get(member.nodeI)?.add(member.id)
      this.memberIdsByNodeId.get(member.nodeJ)?.add(member.id)
      this.memberIdsBySectionId.get(member.sectionId)?.add(member.id)
    }
  }

  private validate() {
    for (const node of this.nodes.values()) {
      if (node.position.length !== 3 || node.position.some(value => !Number.isFinite(value))) {
        throw new Error(`Node ${node.id} position must contain three finite coordinates`)
      }
    }
    for (const section of this.sections.values()) this.require(this.materials, section.materialId, 'material')
    for (const member of this.members.values()) {
      if (member.nodeI === member.nodeJ) throw new Error(`Member ${member.id} must reference different nodes`)
      this.require(this.nodes, member.nodeI, 'node')
      this.require(this.nodes, member.nodeJ, 'node')
      this.require(this.sections, member.sectionId, 'section')
    }
    for (const shell of this.shells.values()) {
      if (new Set(shell.nodeIds).size !== 4) throw new Error(`Shell ${shell.id} requires four unique nodes`)
      for (const id of shell.nodeIds) this.require(this.nodes, id, 'node')
      this.require(this.materials, shell.materialId, 'material')
    }
    for (const bc of this.boundaryConditions.values()) {
      if (!bc.targetNodeIds.length) throw new Error(`Boundary condition ${bc.id} requires a target`)
      for (const id of bc.targetNodeIds) this.require(this.nodes, id, 'node')
    }
    for (const load of this.loads.values()) {
      if (!load.targetIds.length) throw new Error(`Load ${load.id} requires a target`)
      const target = (load.type === 'nodal' ? this.nodes : load.type === 'linear' ? this.members : this.shells) as Map<EntityId, unknown>
      for (const id of load.targetIds) this.require(target, id, `${load.type} target`)
    }
    for (const group of this.groups.values()) {
      for (const ref of group.entityRefs) this.validateEntityReference(ref, `Group ${group.id}`)
    }
    for (const record of this.selectionSets.values()) {
      if (!record.name.trim()) throw new Error(`Selection set ${record.id} requires a name`)
      if (record.kind === 'folder') {
        if (record.entityRefs.length) {
          throw new Error(`Selection folder ${record.id} cannot hold entity references`)
        }
      }
      if (record.parentId !== null) {
        const parent = this.selectionSets.get(record.parentId)
        if (!parent) throw new Error(`SelectionSet ${record.id} references unknown parent ${record.parentId}`)
        if (parent.kind !== 'folder') throw new Error(`SelectionSet ${record.id} parent ${record.parentId} is not a folder`)
      }
      for (const ref of record.entityRefs) {
        if (ref.collection !== 'members' && ref.collection !== 'shells') {
          throw new Error(`SelectionSet ${record.id} may only reference members or shells`)
        }
        this.validateEntityReference(ref, `SelectionSet ${record.id}`)
      }
    }
    for (const record of this.selectionSets.values()) {
      const visited = new Set<EntityId>()
      let cursor: EntityId | null = record.id
      while (cursor !== null) {
        if (visited.has(cursor)) throw new Error(`SelectionSet folder cycle detected at ${cursor}`)
        visited.add(cursor)
        cursor = this.selectionSets.get(cursor)?.parentId ?? null
      }
    }
    const ownerByEntity = new Map<string, EntityId>()
    for (const object of this.parametricObjects.values()) {
      const owned = new Set(object.ownedEntityRefs.map(ref => `${ref.collection}:${ref.id}`))
      for (const ref of object.ownedEntityRefs) this.validateEntityReference(ref, `Parametric object ${object.id}`)
      for (const ref of object.ownedEntityRefs) {
        const key = `${ref.collection}:${ref.id}`
        const owner = ownerByEntity.get(key)
        if (owner !== undefined && owner !== object.id) throw new Error(`${key} is owned by parametric objects ${owner} and ${object.id}`)
        ownerByEntity.set(key, object.id)
      }
      for (const [role, ref] of Object.entries(object.roleBindings ?? {})) {
        if (!role.trim()) throw new Error(`Parametric object ${object.id} has an empty semantic role`)
        this.validateEntityReference(ref, `Parametric object ${object.id} role ${role}`)
        if (!owned.has(`${ref.collection}:${ref.id}`)) throw new Error(`Parametric object ${object.id} role ${role} is not owned`)
      }
    }
  }

  private validateEntityReference(ref: EntityReference, owner: string) {
    if (!ENTITY_COLLECTIONS.includes(ref.collection)) {
      throw new Error(`${owner} has an unknown entity collection ${String(ref.collection)}`)
    }
    this.require(this[ref.collection] as Map<EntityId, EntityRecord>, ref.id, `${ref.collection} reference`)
  }

  private require<T>(map: Map<EntityId, T>, id: EntityId, label: string): T {
    const value = map.get(id)
    if (value === undefined) throw new Error(`Unknown ${label} id ${id}`)
    return value
  }
}
