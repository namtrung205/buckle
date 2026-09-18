import { type CommandWorkspaceState, type EntityCollection, type EntityId, type EntityReference, type StructuralDocument } from '../structural/index.ts'
import type { QueryFilter } from './types.ts'

const clone = <T>(value: T): T => structuredClone(value)
const named = (record: unknown) => {
  const value = record as { name?: string; label?: string }
  return value.name ?? value.label ?? ''
}
const inRange = (value: number, range?: Readonly<{ min?: number; max?: number }>) =>
  !range || (range.min === undefined || value >= range.min) && (range.max === undefined || value <= range.max)
const compare = (value: number, rule?: Readonly<{ lt?: number; lte?: number; gt?: number; gte?: number }>) =>
  !rule || (rule.lt === undefined || value < rule.lt) && (rule.lte === undefined || value <= rule.lte) &&
    (rule.gt === undefined || value > rule.gt) && (rule.gte === undefined || value >= rule.gte)
const refKey = (ref: EntityReference) => `${ref.collection}:${ref.id}`
const normalized = (values?: readonly string[]) => values?.map(value => value.toLowerCase())

export class StructuralQueryService {
  readonly document: StructuralDocument
  private readonly getWorkspaceState: () => CommandWorkspaceState
  private roleCacheRevision = -1
  private readonly roleByEntity = new Map<string, string>()

  constructor(
    document: StructuralDocument,
    getWorkspaceState: () => CommandWorkspaceState,
  ) {
    this.document = document
    this.getWorkspaceState = getWorkspaceState
  }

  getModelSummary() {
    return {
      revision: this.document.revision,
      snapshotHash: this.document.getSnapshotHash(),
      counts: Object.fromEntries([
        'nodes', 'materials', 'sections', 'members', 'shells', 'loads',
        'boundaryConditions', 'grids', 'levels', 'groups', 'parametricObjects', 'selectionSets',
      ].map(collection => [collection, this.document[collection as EntityCollection].size])),
      selectionCount: this.getWorkspaceState().selection.length,
      units: { length: 'm', force: 'kN', coordinateSystem: 'Z-up' },
    }
  }

  getSelection() {
    const state = this.getWorkspaceState()
    return { selection: clone(state.selection), hidden: clone(state.hidden), revision: this.document.revision }
  }

  getEntities(collection: EntityCollection, ids?: readonly EntityId[]) {
    const requested = ids ? new Set(ids) : undefined
    return [...this.document[collection].values()]
      .filter(record => !requested || requested.has(record.id))
      .sort((a, b) => a.id - b.id)
      .map(record => this.describe(collection, record.id))
  }

  queryEntities(collection: EntityCollection, filter: QueryFilter = {}, limit = Infinity) {
    if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('limit must be a positive integer')
    for (const id of filter.sectionIds ?? []) this.requireEntity('sections', id)
    for (const id of filter.materialIds ?? []) this.requireEntity('materials', id)
    const activeFilterKeys = Object.entries(filter).filter(([, value]) => value !== undefined).map(([key]) => key)
    if (collection === 'members' && filter.sectionIds?.length && activeFilterKeys.every(key => key === 'sectionIds')) {
      const ids = new Set<EntityId>()
      for (const sectionId of filter.sectionIds) for (const id of this.document.memberIdsBySectionId.get(sectionId) ?? []) ids.add(id)
      const sortedIds = [...ids].sort((a, b) => a - b)
      return { total: sortedIds.length, truncated: sortedIds.length > limit, entities: sortedIds.slice(0, limit).map(id => this.describe(collection, id)) }
    }
    if (collection === 'members' && filter.materialIds?.length && activeFilterKeys.every(key => key === 'materialIds')) {
      const materialIds = new Set(filter.materialIds)
      const sectionIds = [...this.document.sections.values()].filter(section => materialIds.has(section.materialId)).map(section => section.id)
      const sortedIds = [...this.memberIdsForSections(sectionIds)].sort((a, b) => a - b)
      return { total: sortedIds.length, truncated: sortedIds.length > limit, entities: sortedIds.slice(0, limit).map(id => this.describe(collection, id)) }
    }
    const idSet = filter.ids ? new Set(filter.ids) : undefined
    const text = filter.nameContains?.toLowerCase()
    const names = new Set(normalized(filter.names))
    const types = new Set(normalized(filter.types))
    const workspace = this.getWorkspaceState()
    const selected = new Set(workspace.selection.map(refKey))
    const hidden = new Set(workspace.hidden.map(refKey))
    const groups = this.relationRefs('groups', filter.groupIds)
    const levels = filter.levelIds?.map(id => this.requireEntity('levels', id))
    const grids = this.relationRefs('grids', filter.gridIds)
    const connected = filter.connectedTo?.length ? new Set(this.getConnectedEntities(filter.connectedTo).map(refKey)) : undefined
    const candidateSets: Set<EntityId>[] = []
    if (idSet) candidateSets.push(new Set([...idSet].filter(id => this.document[collection].has(id))))
    if (filter.inSelection === true) candidateSets.push(this.idsForCollection(selected, collection))
    if (filter.hidden === true) candidateSets.push(this.idsForCollection(hidden, collection))
    if (groups) candidateSets.push(this.idsForCollection(groups, collection))
    if (grids) candidateSets.push(this.idsForCollection(grids, collection))
    if (connected) candidateSets.push(this.idsForCollection(connected, collection))
    if (collection === 'members' && filter.sectionIds?.length) {
      candidateSets.push(this.memberIdsForSections(filter.sectionIds))
    }
    if (collection === 'members' && filter.materialIds?.length) {
      const sectionIds = [...this.document.sections.values()].filter(section => filter.materialIds!.includes(section.materialId)).map(section => section.id)
      candidateSets.push(this.memberIdsForSections(sectionIds))
    }
    const candidates = candidateSets.length
      ? [...candidateSets.reduce((smallest, current) => current.size < smallest.size ? current : smallest)].filter(id => candidateSets.every(set => set.has(id)))
      : [...this.document[collection].keys()]
    const matches = (record: { id: EntityId }) => {
        const ref = { collection, id: record.id } as EntityReference
        const key = refKey(ref)
        if (idSet && !idSet.has(record.id)) return false
        if (names.size && !names.has(named(record).toLowerCase())) return false
        if (text && !named(record).toLowerCase().includes(text)) return false
        if (types.size && !types.has(this.entityType(collection, record).toLowerCase())) return false
        if (filter.inSelection !== undefined && selected.has(key) !== filter.inSelection) return false
        if (filter.hidden !== undefined && hidden.has(key) !== filter.hidden) return false
        if (groups && !groups.has(key)) return false
        if (grids && !grids.has(key)) return false
        if (levels && !levels.some(level => this.entityIntersectsLevel(ref, (level as { elevation: number }).elevation))) return false
        if (connected && !connected.has(key)) return false
        if (filter.position) {
          const position = this.entityPosition(ref)
          if (!position) return false
          if (!inRange(position[0], filter.position.x) || !inRange(position[1], filter.position.y) || !inRange(position[2], filter.position.z)) return false
        }
        if (collection === 'members') {
          const member = this.document.members.get(record.id)!
          if (filter.sectionIds && !filter.sectionIds.includes(member.sectionId)) return false
          const materialId = this.document.sections.get(member.sectionId)?.materialId
          if (filter.materialIds && (materialId === undefined || !filter.materialIds.includes(materialId))) return false
          if (filter.length && !compare(this.memberLength(record.id), filter.length)) return false
          if (filter.semanticRoles && !filter.semanticRoles.includes(this.semanticRole({ collection: 'members', id: record.id }))) return false
        } else {
          if (collection === 'sections' && filter.materialIds && !filter.materialIds.includes(this.document.sections.get(record.id)!.materialId)) return false
          if (collection === 'shells' && filter.materialIds && !filter.materialIds.includes(this.document.shells.get(record.id)!.materialId)) return false
          if (filter.semanticRoles && !filter.semanticRoles.includes(this.semanticRole({ collection, id: record.id }))) return false
        }
        return true
    }
    let total = 0
    const resultIds: EntityId[] = []
    for (const id of candidates.sort((a, b) => a - b)) {
      const record = this.document[collection].get(id)!
      if (!matches(record)) continue
      total++
      if (resultIds.length < limit) resultIds.push(record.id)
    }
    return { total, truncated: total > limit, entities: resultIds.map(id => this.describe(collection, id)) }
  }

  getConnectedEntities(refs: readonly EntityReference[]) {
    const found = new Map<string, EntityReference>()
    const add = (ref: EntityReference) => found.set(`${ref.collection}:${ref.id}`, ref)
    for (const ref of refs) {
      if (!this.document[ref.collection].has(ref.id)) throw new Error(`Unknown ${ref.collection} id ${ref.id}`)
      add(ref)
      if (ref.collection === 'nodes') {
        for (const id of this.document.memberIdsByNodeId.get(ref.id) ?? []) add({ collection: 'members', id })
      } else if (ref.collection === 'members') {
        const member = this.document.members.get(ref.id)!
        add({ collection: 'nodes', id: member.nodeI }); add({ collection: 'nodes', id: member.nodeJ })
        add({ collection: 'sections', id: member.sectionId })
        const material = this.document.sections.get(member.sectionId)?.materialId
        if (material) add({ collection: 'materials', id: material })
      } else if (ref.collection === 'sections') {
        for (const id of this.document.memberIdsBySectionId.get(ref.id) ?? []) add({ collection: 'members', id })
        const material = this.document.sections.get(ref.id)?.materialId
        if (material) add({ collection: 'materials', id: material })
      }
    }
    return [...found.values()].sort((a, b) => a.collection.localeCompare(b.collection) || a.id - b.id)
  }

  getNearbyNodes(point: readonly [number, number, number], radius: number, limit = Infinity) {
    if (!Number.isFinite(radius) || radius < 0) throw new Error('radius must be non-negative')
    return [...this.document.nodes.values()].map(node => ({
      id: node.id,
      distance: Math.hypot(node.position[0] - point[0], node.position[1] - point[1], node.position[2] - point[2]),
      position: clone(node.position),
    })).filter(item => item.distance <= radius).sort((a, b) => a.distance - b.distance || a.id - b.id).slice(0, limit)
  }

  validateModel() {
    const warnings: string[] = []
    const connected = new Set([...this.document.members.values()].flatMap(member => [member.nodeI, member.nodeJ]))
    const orphanNodeIds = [...this.document.nodes.keys()].filter(id => !connected.has(id))
    if (orphanNodeIds.length) warnings.push(`${orphanNodeIds.length} node(s) are not connected to a member`)
    return { valid: true, revision: this.document.revision, warnings, orphanNodeIds }
  }

  memberLength(id: EntityId) {
    const member = this.document.members.get(id)
    if (!member) throw new Error(`Unknown member id ${id}`)
    const a = this.document.nodes.get(member.nodeI)!
    const b = this.document.nodes.get(member.nodeJ)!
    return Math.hypot(b.position[0] - a.position[0], b.position[1] - a.position[1], b.position[2] - a.position[2])
  }

  semanticRole(ref: EntityReference): string {
    this.refreshRoleCache()
    const boundRole = this.roleByEntity.get(refKey(ref))
    if (boundRole) return boundRole
    if (ref.collection === 'members') {
      const member = this.document.members.get(ref.id)
      if (member) {
        const a = this.document.nodes.get(member.nodeI)!.position
        const b = this.document.nodes.get(member.nodeJ)!.position
        const length = this.memberLength(ref.id)
        if (length > 0 && Math.abs(b[2] - a[2]) / length >= 0.9) return 'column'
        return 'beam'
      }
    }
    return ref.collection.slice(0, -1)
  }

  private refreshRoleCache() {
    if (this.roleCacheRevision === this.document.revision) return
    this.roleByEntity.clear()
    for (const object of this.document.parametricObjects.values()) {
      for (const [role, binding] of Object.entries(object.roleBindings ?? {})) {
        const token = ['column', 'rafter', 'purlin', 'bracing', 'brace', 'base-node', 'frame-line', 'bay'].find(value => role.includes(value))
        this.roleByEntity.set(refKey(binding), token === 'brace' ? 'bracing' : token ?? role)
      }
    }
    this.roleCacheRevision = this.document.revision
  }

  private requireEntity(collection: EntityCollection, id: EntityId) {
    const record = this.document[collection].get(id)
    if (!record) throw new Error(`Unknown ${collection} id ${id}`)
    return record
  }

  private idsForCollection(keys: ReadonlySet<string>, collection: EntityCollection) {
    const prefix = `${collection}:`
    return new Set([...keys].filter(key => key.startsWith(prefix)).map(key => Number(key.slice(prefix.length))))
  }

  private memberIdsForSections(sectionIds: readonly EntityId[]) {
    const ids = new Set<EntityId>()
    for (const sectionId of sectionIds) for (const id of this.document.memberIdsBySectionId.get(sectionId) ?? []) ids.add(id)
    return ids
  }

  private relationRefs(collection: 'groups' | 'grids', ids?: readonly EntityId[]) {
    if (!ids?.length) return undefined
    const refs = new Set<string>()
    for (const id of ids) {
      const record = this.requireEntity(collection, id)
      refs.add(`${collection}:${id}`)
      if (collection === 'groups') {
        for (const ref of (record as { entityRefs: readonly EntityReference[] }).entityRefs) refs.add(refKey(ref))
      } else {
        const rawRefs = (record as { data?: { entityRefs?: unknown } }).data?.entityRefs
        if (Array.isArray(rawRefs)) for (const value of rawRefs) {
          const ref = value as EntityReference
          if (ref && typeof ref.collection === 'string' && Number.isSafeInteger(ref.id)) refs.add(refKey(ref))
        }
        for (const object of this.document.parametricObjects.values()) {
          if (object.ownedEntityRefs.some(ref => ref.collection === 'grids' && ref.id === id)) {
            for (const ref of object.ownedEntityRefs) refs.add(refKey(ref))
          }
        }
      }
    }
    return refs
  }

  private entityType(collection: EntityCollection, record: unknown) {
    const value = record as { type?: string; kind?: string; category?: string }
    return value.type ?? value.kind ?? value.category ?? collection.replace(/s$/, '')
  }

  private entityPosition(ref: EntityReference): readonly [number, number, number] | undefined {
    if (ref.collection === 'nodes') return this.document.nodes.get(ref.id)?.position
    if (ref.collection === 'members') {
      const member = this.document.members.get(ref.id)
      if (!member) return undefined
      const a = this.document.nodes.get(member.nodeI)!.position; const b = this.document.nodes.get(member.nodeJ)!.position
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
    }
    if (ref.collection === 'shells') {
      const shell = this.document.shells.get(ref.id)
      if (!shell) return undefined
      const points = shell.nodeIds.map(id => this.document.nodes.get(id)!.position)
      return [0, 1, 2].map(axis => points.reduce((sum, point) => sum + point[axis], 0) / points.length) as unknown as readonly [number, number, number]
    }
    if (ref.collection === 'levels') return [0, 0, this.document.levels.get(ref.id)!.elevation]
    return undefined
  }

  private entityIntersectsLevel(ref: EntityReference, elevation: number) {
    const tolerance = 1e-6
    if (ref.collection === 'members') {
      const member = this.document.members.get(ref.id)!
      const za = this.document.nodes.get(member.nodeI)!.position[2]; const zb = this.document.nodes.get(member.nodeJ)!.position[2]
      return elevation >= Math.min(za, zb) - tolerance && elevation <= Math.max(za, zb) + tolerance
    }
    if (ref.collection === 'shells') {
      const values = this.document.shells.get(ref.id)!.nodeIds.map(id => this.document.nodes.get(id)!.position[2])
      return elevation >= Math.min(...values) - tolerance && elevation <= Math.max(...values) + tolerance
    }
    const position = this.entityPosition(ref)
    return !!position && Math.abs(position[2] - elevation) <= tolerance
  }

  private describe(collection: EntityCollection, id: EntityId) {
    const record = this.document[collection].get(id)
    if (!record) throw new Error(`Unknown ${collection} id ${id}`)
    const computed = collection === 'members' ? { length: this.memberLength(id), semanticRole: this.semanticRole({ collection, id }) } :
      { semanticRole: this.semanticRole({ collection, id }) }
    return { collection, ...clone(record), computed }
  }
}
