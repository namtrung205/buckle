/**
 * Semantic regeneration planner — plugin-side port of
 * `prepareParametricRegeneration` (frontend/src/core/structural/ParametricKernel.ts).
 * Reuses the existing object's roleBindings when the bound entity still exists,
 * allocates fresh ids otherwise, classifies created/updated/deleted and emits
 * ONE Transaction so a whole regeneration stays a single Undo step.
 */
import type { TowerGraph, TowerPlanInput } from './towerGraph.ts'

export type EntityRef = { collection: string; id: number }
export type PlanObject = {
  id?: number
  kind: string
  version: number
  parameters: Record<string, unknown>
  ownedEntityRefs: EntityRef[]
  roleBindings: Record<string, EntityRef>
  constraints: readonly unknown[]
  generatorVersion: string
}

export type PlanSnapshot = {
  revision: number
  nodes: readonly Record<string, unknown>[]
  members: readonly Record<string, unknown>[]
  loads: readonly Record<string, unknown>[]
  boundaryConditions: readonly Record<string, unknown>[]
  parametricObjects: readonly Record<string, unknown>[]
}

export type PlanSummary = {
  created: number; updated: number; deleted: number
}
export type TowerPlan = {
  command: { type: 'Transaction'; payload: { operations: readonly Record<string, unknown>[] } }
  object: PlanObject
  summary: PlanSummary
  requiresApproval: boolean
}

const COLLECTIONS = ['nodes', 'members', 'loads', 'boundaryConditions'] as const
type Collection = (typeof COLLECTIONS)[number]

/** Stable stringify (sorted keys) — light port of canonicalStringify. */
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

const refKey = (ref: EntityRef) => `${ref.collection}:${ref.id}`

export function planTowerRegeneration(
  graph: TowerGraph,
  snapshot: PlanSnapshot,
  params: TowerPlanInput & Record<string, unknown>,
  generatorVersion: string,
): TowerPlan {
  const existing = snapshot.parametricObjects
    .map(o => o as PlanObject)
    .find(o => o.kind === 'TowerPlugin')
  const oldBindings = existing?.roleBindings ?? {}

  // Collections indexed by id for existence checks and change detection.
  const current = new Map<Collection, Map<number, Record<string, unknown>>>()
  for (const collection of COLLECTIONS) {
    current.set(collection, new Map((snapshot[collection] as readonly Record<string, unknown>[]).map(r => [r.id as number, r])))
  }

  // Bind each role to an id: reuse the previous binding when valid, else allocate.
  const used = new Map<Collection, Set<number>>()
  const nextId = new Map<Collection, number>()
  for (const collection of COLLECTIONS) {
    const map = current.get(collection)!
    const ids = new Set(map.keys())
    used.set(collection, ids)
    let id = 1
    while (ids.has(id)) id++
    nextId.set(collection, id)
  }
  const bindings: Record<string, EntityRef> = {}
  const resolved = new Map<string, EntityRef>()
  const bind = (role: string, collection: Collection) => {
    const previous: EntityRef | undefined = oldBindings[role]
    const id = previous && previous.collection === collection && current.get(collection)!.has(previous.id)
      ? previous.id
      : (() => {
        const ids = used.get(collection)!
        let id = nextId.get(collection)!
        while (ids.has(id)) id++
        nextId.set(collection, id + 1)
        ids.add(id)
        return id
      })()
    const ref = { collection, id }
    bindings[role] = ref
    resolved.set(role, ref)
    return id
  }
  for (const collection of COLLECTIONS) {
    for (const entity of graph[collection as keyof TowerGraph] ?? []) bind(entity.role, collection)
  }
  const idFor = (role: string, collection: Collection): number => {
    const ref = resolved.get(role)
    if (!ref || ref.collection !== collection) throw new Error(`Role ${role} is not a ${collection} role`)
    return ref.id
  }

  const nodes = graph.nodes.map(n => ({ ...n.record, id: idFor(n.role, 'nodes') }))
  const members = graph.members.map(m => ({
    ...m.record, id: idFor(m.role, 'members'),
    nodeI: idFor(m.nodeIRole, 'nodes'), nodeJ: idFor(m.nodeJRole, 'nodes'), sectionId: m.sectionId,
  }))
  const bcs = graph.boundaryConditions.map(b => ({
    ...b.record, id: idFor(b.role, 'boundaryConditions'),
    targetNodeIds: b.targetNodeRoles.map(r => idFor(r, 'nodes')),
  }))
  const loads = graph.loads.map(l => ({
    ...l.record, id: idFor(l.role, 'loads'),
    targetIds: l.targetRoles.map(r => idFor(r, 'nodes')),
  }))

  const created = <T extends { id: number }>(c: Collection, values: readonly T[]) =>
    values.filter(v => !current.get(c)!.has(v.id))
  const changed = <T extends { id: number }>(c: Collection, values: readonly T[]) =>
    values.filter(v => {
      const cur = current.get(c)!.get(v.id)
      return cur !== undefined && stable(cur) !== stable(v)
    })

  const summary: PlanSummary = { created: 0, updated: 0, deleted: 0 }
  const operations: Record<string, unknown>[] = []
  const newNodes = created('nodes', nodes)
  const movedNodes = changed('nodes', nodes)
  summary.created += newNodes.length
  summary.updated += movedNodes.length
  if (newNodes.length) operations.push({ type: 'CreateNodes', payload: { nodes: newNodes } })
  if (movedNodes.length) operations.push({ type: 'MoveNodes', payload: { nodes: movedNodes } })

  const changedOrCreated = <T extends { id: number }>(c: Collection, values: readonly T[]) =>
    [...created(c, values), ...changed(c, values)]
  const newMembers = created('members', members)
  const changedMembers = changed('members', members)
  const bcOps = changedOrCreated('boundaryConditions', bcs)
  const loadOps = changedOrCreated('loads', loads)
  summary.created += newMembers.length + created('boundaryConditions', bcs).length + created('loads', loads).length
  summary.updated += changedMembers.length + changed('boundaryConditions', bcs).length + changed('loads', loads).length
  if (newMembers.length) operations.push({ type: 'CreateMembers', payload: { members: newMembers } })
  if (changedMembers.length) operations.push({ type: 'UpdateMembers', payload: { members: changedMembers.map(({ id, ...patch }) => ({ id, patch })) } })
  if (bcOps.length) operations.push({ type: 'CreateOrUpdateBoundaryConditions', payload: { boundaryConditions: bcOps } })
  if (loadOps.length) operations.push({ type: 'CreateOrUpdateLoads', payload: { loads: loadOps } })
  const ownedEntityRefs = Object.values(bindings)
    .map(ref => ({ ...ref }))
    .sort((a, b) => a.collection.localeCompare(b.collection) || a.id - b.id)
  const object: PlanObject = {
    ...(existing?.id !== undefined ? { id: existing.id } : {}),
    kind: 'TowerPlugin',
    version: 1,
    parameters: structuredClone(params),
    ownedEntityRefs,
    roleBindings: bindings,
    constraints: [],
    generatorVersion,
  }
  const objectChanged = !existing || stable(existing) !== stable(object)
  if (objectChanged) {
    operations.push({ type: 'CreateOrUpdateParametricObjects', payload: { parametricObjects: [object] } })
    summary.updated += 1 // host reports object churn under parametricObjects
  }

  const nextRefs = new Set(ownedEntityRefs.map(refKey))
  const obsolete = (existing?.ownedEntityRefs ?? []).filter(ref =>
    (COLLECTIONS as readonly string[]).includes(ref.collection) && !nextRefs.has(refKey(ref)))
  const deleteOrder: readonly Collection[] = ['loads', 'boundaryConditions', 'members', 'nodes']
  const deleteTypes: Record<Collection, string> = {
    loads: 'DeleteLoads', boundaryConditions: 'DeleteBoundaryConditions',
    members: 'DeleteMembers', nodes: 'DeleteNodes',
  }
  for (const collection of deleteOrder) {
    const ids = obsolete.filter(ref => ref.collection === collection).map(ref => ref.id)
    if (!ids.length) continue
    summary.deleted += ids.length
    operations.push({ type: deleteTypes[collection], payload: collection === 'nodes' ? { ids, cascade: false } : { ids } })
  }

  return {
    command: { type: 'Transaction', payload: { operations } },
    object,
    summary,
    requiresApproval: summary.deleted > 0,
  }
}
