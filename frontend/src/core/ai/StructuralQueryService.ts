import { canonicalStringify, type CommandWorkspaceState, type EntityCollection, type EntityId, type EntityReference, type StructuralDocument } from '../structural/index.ts'
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

export class StructuralQueryService {
  readonly document: StructuralDocument
  private readonly getWorkspaceState: () => CommandWorkspaceState

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
        'boundaryConditions', 'grids', 'levels', 'groups', 'parametricObjects',
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

  queryEntities(collection: EntityCollection, filter: QueryFilter = {}, limit = 1000) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) throw new Error('limit must be an integer in [1, 10000]')
    const idSet = filter.ids ? new Set(filter.ids) : undefined
    const text = filter.nameContains?.toLocaleLowerCase()
    const results = [...this.document[collection].values()]
      .sort((a, b) => a.id - b.id)
      .filter(record => {
        if (idSet && !idSet.has(record.id)) return false
        if (text && !named(record).toLocaleLowerCase().includes(text)) return false
        if (collection === 'nodes' && filter.position) {
          const position = this.document.nodes.get(record.id)!.position
          if (!inRange(position[0], filter.position.x) || !inRange(position[1], filter.position.y) || !inRange(position[2], filter.position.z)) return false
        }
        if (collection === 'members') {
          const member = this.document.members.get(record.id)!
          if (filter.sectionIds && !filter.sectionIds.includes(member.sectionId)) return false
          const materialId = this.document.sections.get(member.sectionId)?.materialId
          if (filter.materialIds && (materialId === undefined || !filter.materialIds.includes(materialId))) return false
          if (!compare(this.memberLength(record.id), filter.length)) return false
          const role = this.semanticRole({ collection: 'members', id: record.id })
          if (filter.semanticRoles && !filter.semanticRoles.includes(role)) return false
        } else if (filter.semanticRoles && !filter.semanticRoles.includes(this.semanticRole({ collection, id: record.id }))) return false
        return true
      })
    return { total: results.length, truncated: results.length > limit, entities: results.slice(0, limit).map(record => this.describe(collection, record.id)) }
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

  getNearbyNodes(point: readonly [number, number, number], radius: number, limit = 100) {
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
    for (const object of this.document.parametricObjects.values()) {
      for (const [role, binding] of Object.entries(object.roleBindings ?? {})) {
        if (binding.collection === ref.collection && binding.id === ref.id) {
          for (const token of ['column', 'rafter', 'purlin', 'bracing', 'brace', 'base-node', 'frame-line', 'bay']) {
            if (role.includes(token)) return token === 'brace' ? 'bracing' : token
          }
          return role
        }
      }
    }
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

  private describe(collection: EntityCollection, id: EntityId) {
    const record = this.document[collection].get(id)
    if (!record) throw new Error(`Unknown ${collection} id ${id}`)
    const computed = collection === 'members' ? { length: this.memberLength(id), semanticRole: this.semanticRole({ collection, id }) } :
      { semanticRole: this.semanticRole({ collection, id }) }
    return { collection, ...clone(record), computed }
  }
}
