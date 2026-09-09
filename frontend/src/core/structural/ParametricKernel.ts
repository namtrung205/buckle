import { canonicalStringify } from './canonical.ts'
import type { CommandTransactionOperation, StructuralCommand } from './commands.ts'
import type { StructuralDocument } from './StructuralDocument.ts'
import type {
  BoundaryConditionRecord,
  EntityCollection,
  EntityId,
  EntityReference,
  GridRecord,
  LevelRecord,
  LoadRecord,
  Member1DRecord,
  NodeRecord,
  ParametricObjectRecord,
  Shell2DRecord,
} from './types.ts'

export type ParametricNode = Readonly<{ role: string; record: Omit<NodeRecord, 'id'> }>
export type ParametricMember = Readonly<{
  role: string
  nodeIRole: string
  nodeJRole: string
  sectionId: EntityId
  record?: Omit<Member1DRecord, 'id' | 'nodeI' | 'nodeJ' | 'sectionId'>
}>
export type ParametricShell = Readonly<{
  role: string
  nodeRoles: readonly [string, string, string, string]
  materialId: EntityId
  record: Omit<Shell2DRecord, 'id' | 'nodeIds' | 'materialId'>
}>
export type ParametricLoad = Readonly<{
  role: string
  targetRoles: readonly string[]
  record: Omit<LoadRecord, 'id' | 'targetIds'>
}>
export type ParametricBoundaryCondition = Readonly<{
  role: string
  targetNodeRoles: readonly string[]
  record: Omit<BoundaryConditionRecord, 'id' | 'targetNodeIds'>
}>
export type ParametricGrid = Readonly<{ role: string; record: Omit<GridRecord, 'id'> }>
export type ParametricLevel = Readonly<{ role: string; record: Omit<LevelRecord, 'id'> }>

export type ParametricEntityGraph = Readonly<{
  nodes?: readonly ParametricNode[]
  members?: readonly ParametricMember[]
  shells?: readonly ParametricShell[]
  loads?: readonly ParametricLoad[]
  boundaryConditions?: readonly ParametricBoundaryCondition[]
  grids?: readonly ParametricGrid[]
  levels?: readonly ParametricLevel[]
}>

export type ParametricGenerator<TParameters extends Record<string, unknown>> =
  (parameters: Readonly<TParameters>) => ParametricEntityGraph

export type ParametricDiffCount = Readonly<{ created: number; updated: number; deleted: number }>
export type ParametricRegenerationPlan = Readonly<{
  object: ParametricObjectRecord
  graph: ParametricEntityGraph
  command: Extract<StructuralCommand, { type: 'Transaction' }>
  diff: Readonly<Record<EntityCollection, ParametricDiffCount>>
  total: ParametricDiffCount
}>

export type PrepareParametricRegeneration<TParameters extends Record<string, unknown>> = Readonly<{
  objectId?: EntityId
  kind: string
  version: number
  parameters: Readonly<TParameters>
  generatorVersion: string
  generator: ParametricGenerator<TParameters>
  constraints?: readonly Readonly<Record<string, unknown>>[]
  provenance?: ParametricObjectRecord['provenance']
}>

const supportedCollections = [
  'nodes', 'members', 'shells', 'loads', 'boundaryConditions', 'grids', 'levels',
] as const
type SupportedCollection = (typeof supportedCollections)[number]
type ConcreteRecord = NodeRecord | Member1DRecord | Shell2DRecord | LoadRecord |
  BoundaryConditionRecord | GridRecord | LevelRecord

const emptyCount = (): ParametricDiffCount => ({ created: 0, updated: 0, deleted: 0 })
const refKey = (ref: EntityReference) => `${ref.collection}:${ref.id}`
const clone = <T>(value: T): T => structuredClone(value)
const allocate = (used: Set<EntityId>) => {
  let id = 1
  while (used.has(id)) id++
  used.add(id)
  return id
}

const assertRole = (role: string, roles: Set<string>) => {
  if (!role.trim()) throw new Error('Parametric semantic role is required')
  if (roles.has(role)) throw new Error(`Duplicate parametric semantic role ${role}`)
  roles.add(role)
}

export const validateParametricGraph = (document: StructuralDocument, graph: ParametricEntityGraph, tolerance = 1e-6) => {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error('Parametric geometry tolerance must be greater than zero')
  const roles = new Set<string>()
  for (const collection of supportedCollections) {
    for (const entity of graph[collection] ?? []) assertRole(entity.role, roles)
  }
  const nodeRoles = new Set((graph.nodes ?? []).map(node => node.role))
  const positions = new Map((graph.nodes ?? []).map(node => [node.role, node.record.position] as const))
  const buckets = new Map<string, Array<{ role: string; position: readonly [number, number, number] }>>()
  for (const node of graph.nodes ?? []) {
    if (node.record.position.length !== 3 || node.record.position.some(value => !Number.isFinite(value))) {
      throw new Error(`Node role ${node.role} must contain three finite coordinates`)
    }
    const [x, y, z] = node.record.position
    const cell = [Math.floor(x / tolerance), Math.floor(y / tolerance), Math.floor(z / tolerance)] as const
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const other of buckets.get(`${cell[0] + dx}:${cell[1] + dy}:${cell[2] + dz}`) ?? []) {
        if (Math.hypot(x - other.position[0], y - other.position[1], z - other.position[2]) <= tolerance) {
          throw new Error(`Node roles ${other.role} and ${node.role} are coincident within tolerance ${tolerance}`)
        }
      }
    }
    const key = `${cell[0]}:${cell[1]}:${cell[2]}`
    buckets.set(key, [...(buckets.get(key) ?? []), { role: node.role, position: node.record.position }])
  }
  const adjacency = new Map([...nodeRoles].map(role => [role, new Set<string>()]))
  for (const member of graph.members ?? []) {
    if (!nodeRoles.has(member.nodeIRole) || !nodeRoles.has(member.nodeJRole)) {
      throw new Error(`Member role ${member.role} references an unknown node role`)
    }
    if (member.nodeIRole === member.nodeJRole) throw new Error(`Member role ${member.role} is degenerate`)
    if (!document.sections.has(member.sectionId)) throw new Error(`Member role ${member.role} references unsupported section ${member.sectionId}`)
    const a = positions.get(member.nodeIRole)!; const b = positions.get(member.nodeJRole)!
    if (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) <= tolerance) throw new Error(`Member role ${member.role} has zero length within tolerance ${tolerance}`)
    adjacency.get(member.nodeIRole)!.add(member.nodeJRole); adjacency.get(member.nodeJRole)!.add(member.nodeIRole)
  }
  for (const shell of graph.shells ?? []) {
    if (new Set(shell.nodeRoles).size !== 4 || shell.nodeRoles.some(role => !nodeRoles.has(role))) {
      throw new Error(`Shell role ${shell.role} requires four unique node roles`)
    }
    if (!document.materials.has(shell.materialId)) throw new Error(`Shell role ${shell.role} references unsupported material ${shell.materialId}`)
    for (let index = 0; index < shell.nodeRoles.length; index++) {
      const a = shell.nodeRoles[index]; const b = shell.nodeRoles[(index + 1) % shell.nodeRoles.length]
      adjacency.get(a)!.add(b); adjacency.get(b)!.add(a)
    }
  }
  const memberRoles = new Set((graph.members ?? []).map(member => member.role))
  const shellRoles = new Set((graph.shells ?? []).map(shell => shell.role))
  for (const load of graph.loads ?? []) {
    const targets = load.record.type === 'nodal' ? nodeRoles : load.record.type === 'linear' ? memberRoles : shellRoles
    if (!load.targetRoles.length || load.targetRoles.some(role => !targets.has(role))) {
      throw new Error(`Load role ${load.role} references an unknown ${load.record.type} target role`)
    }
  }
  for (const support of graph.boundaryConditions ?? []) {
    if (!support.targetNodeRoles.length || support.targetNodeRoles.some(role => !nodeRoles.has(role))) {
      throw new Error(`Boundary condition role ${support.role} references an unknown node role`)
    }
  }
  if (nodeRoles.size) {
    const start = nodeRoles.values().next().value as string
    const visited = new Set([start]); const queue = [start]
    while (queue.length) for (const next of adjacency.get(queue.shift()!) ?? []) if (!visited.has(next)) { visited.add(next); queue.push(next) }
    if (visited.size !== nodeRoles.size) {
      const disconnected = [...nodeRoles].filter(role => !visited.has(role)).slice(0, 5)
      throw new Error(`Parametric topology is disconnected at ${disconnected.join(', ')}`)
    }
  }
}

/**
 * Resolve a pure semantic graph into stable document IDs and one atomic command.
 * This function has no side effects; execute plan.command through CommandGateway.
 */
export const prepareParametricRegeneration = <TParameters extends Record<string, unknown>>(
  document: StructuralDocument,
  request: PrepareParametricRegeneration<TParameters>,
): ParametricRegenerationPlan => {
  if (!request.kind.trim()) throw new Error('Parametric kind is required')
  if (!Number.isSafeInteger(request.version) || request.version < 1) throw new Error('Parametric version must be a positive integer')

  const graph = clone(request.generator(clone(request.parameters)))
  const repeated = request.generator(clone(request.parameters))
  if (canonicalStringify(graph) !== canonicalStringify(repeated)) {
    throw new Error(`Generator ${request.kind}@${request.generatorVersion} is not deterministic`)
  }
  validateParametricGraph(document, graph)

  const existing = request.objectId === undefined ? undefined : document.parametricObjects.get(request.objectId)
  if (request.objectId !== undefined && !existing) throw new Error(`Unknown parametric object id ${request.objectId}`)
  if (existing && existing.kind !== request.kind) throw new Error(`Cannot change parametric kind ${existing.kind} to ${request.kind}`)

  const usedByCollection = new Map<SupportedCollection, Set<EntityId>>(
    supportedCollections.map(collection => [collection, new Set(document[collection].keys())]),
  )
  const usedObjectIds = new Set(document.parametricObjects.keys())
  const objectId = existing?.id ?? request.objectId ?? allocate(usedObjectIds)
  const oldBindings = existing?.roleBindings ?? {}
  const bindings: Record<string, EntityReference> = {}
  const resolved = new Map<string, EntityReference>()

  const bind = (role: string, collection: SupportedCollection) => {
    const previous = oldBindings[role]
    const id = previous?.collection === collection && document[collection].has(previous.id)
      ? previous.id
      : allocate(usedByCollection.get(collection)!)
    const ref = { collection, id } as const
    bindings[role] = ref
    resolved.set(role, ref)
    return id
  }
  for (const collection of supportedCollections) {
    for (const entity of [...(graph[collection] ?? [])].sort((a, b) => a.role.localeCompare(b.role))) bind(entity.role, collection)
  }
  const idFor = (role: string, collection: SupportedCollection) => {
    const ref = resolved.get(role)
    if (!ref || ref.collection !== collection) throw new Error(`Role ${role} is not a ${collection} role`)
    return ref.id
  }

  const records: Record<SupportedCollection, ConcreteRecord[]> = {
    nodes: (graph.nodes ?? []).map(item => ({ ...clone(item.record), id: idFor(item.role, 'nodes') })),
    members: (graph.members ?? []).map(item => ({
      ...clone(item.record ?? {}), id: idFor(item.role, 'members'),
      nodeI: idFor(item.nodeIRole, 'nodes'), nodeJ: idFor(item.nodeJRole, 'nodes'), sectionId: item.sectionId,
    })),
    shells: (graph.shells ?? []).map(item => ({
      ...clone(item.record), id: idFor(item.role, 'shells'),
      nodeIds: item.nodeRoles.map(role => idFor(role, 'nodes')) as [number, number, number, number], materialId: item.materialId,
    })),
    loads: (graph.loads ?? []).map(item => {
      const targetCollection = item.record.type === 'nodal' ? 'nodes' : item.record.type === 'linear' ? 'members' : 'shells'
      return { ...clone(item.record), id: idFor(item.role, 'loads'), targetIds: item.targetRoles.map(role => idFor(role, targetCollection)) }
    }),
    boundaryConditions: (graph.boundaryConditions ?? []).map(item => ({
      ...clone(item.record), id: idFor(item.role, 'boundaryConditions'),
      targetNodeIds: item.targetNodeRoles.map(role => idFor(role, 'nodes')),
    })),
    grids: (graph.grids ?? []).map(item => ({ ...clone(item.record), id: idFor(item.role, 'grids') })),
    levels: (graph.levels ?? []).map(item => ({ ...clone(item.record), id: idFor(item.role, 'levels') })),
  }

  const diff = Object.fromEntries([
    ...(['materials', 'sections', 'groups', 'parametricObjects'] as const).map(collection => [collection, emptyCount()]),
    ...supportedCollections.map(collection => [collection, { created: 0, updated: 0, deleted: 0 }]),
  ]) as Record<EntityCollection, { created: number; updated: number; deleted: number }>
  const operations: CommandTransactionOperation[] = []
  const created = <T extends ConcreteRecord>(collection: SupportedCollection, values: T[]) =>
    values.filter(value => !document[collection].has(value.id))
  const changed = <T extends ConcreteRecord>(collection: SupportedCollection, values: T[]) =>
    values.filter(value => {
      const current = document[collection].get(value.id)
      return current !== undefined && canonicalStringify(current) !== canonicalStringify(value)
    })
  for (const collection of supportedCollections) {
    diff[collection].created = created(collection, records[collection]).length
    diff[collection].updated = changed(collection, records[collection]).length
  }

  const newNodes = created('nodes', records.nodes as NodeRecord[]) as NodeRecord[]
  const movedNodes = changed('nodes', records.nodes as NodeRecord[]) as NodeRecord[]
  if (newNodes.length) operations.push({ type: 'CreateNodes', payload: { nodes: newNodes } })
  if (movedNodes.length) operations.push({ type: 'MoveNodes', payload: { nodes: movedNodes } })
  const newMembers = created('members', records.members as Member1DRecord[]) as Member1DRecord[]
  const updatedMembers = changed('members', records.members as Member1DRecord[]) as Member1DRecord[]
  if (newMembers.length) operations.push({ type: 'CreateMembers', payload: { members: newMembers } })
  if (updatedMembers.length) operations.push({ type: 'UpdateMembers', payload: { members: updatedMembers.map(({ id, ...patch }) => ({ id, patch })) } })

  const changedOrCreated = <T extends ConcreteRecord>(collection: SupportedCollection, values: T[]) =>
    [...created(collection, values), ...changed(collection, values)]
  const shells = changedOrCreated('shells', records.shells as Shell2DRecord[])
  const loads = changedOrCreated('loads', records.loads as LoadRecord[])
  const boundaryConditions = changedOrCreated('boundaryConditions', records.boundaryConditions as BoundaryConditionRecord[])
  const grids = changedOrCreated('grids', records.grids as GridRecord[])
  const levels = changedOrCreated('levels', records.levels as LevelRecord[])
  if (shells.length) operations.push({ type: 'CreateOrUpdateShells', payload: { shells } })
  if (loads.length) operations.push({ type: 'CreateOrUpdateLoads', payload: { loads } })
  if (boundaryConditions.length) operations.push({ type: 'CreateOrUpdateBoundaryConditions', payload: { boundaryConditions } })
  if (grids.length) operations.push({ type: 'CreateOrUpdateGrids', payload: { grids } })
  if (levels.length) operations.push({ type: 'CreateOrUpdateLevels', payload: { levels } })

  const ownedEntityRefs = Object.values(bindings).sort((a, b) => a.collection.localeCompare(b.collection) || a.id - b.id)
  const object: ParametricObjectRecord = {
    id: objectId,
    kind: request.kind,
    version: request.version,
    parameters: clone(request.parameters),
    ownedEntityRefs,
    roleBindings: bindings,
    constraints: clone(request.constraints ?? []),
    generatorVersion: request.generatorVersion,
    ...(request.provenance ? { provenance: clone(request.provenance) } : {}),
  }
  const objectChanged = canonicalStringify(existing) !== canonicalStringify(object)
  if (objectChanged) {
    operations.push({ type: 'CreateOrUpdateParametricObjects', payload: { parametricObjects: [object] } })
    diff.parametricObjects[existing ? 'updated' : 'created']++
  }

  const nextRefs = new Set(ownedEntityRefs.map(refKey))
  const obsolete = (existing?.ownedEntityRefs ?? []).filter(ref =>
    supportedCollections.includes(ref.collection as SupportedCollection) && !nextRefs.has(refKey(ref)),
  )
  const deleteOrder: readonly SupportedCollection[] = ['loads', 'boundaryConditions', 'shells', 'members', 'grids', 'levels', 'nodes']
  const deleteTypes: Record<SupportedCollection, CommandTransactionOperation['type']> = {
    loads: 'DeleteLoads', boundaryConditions: 'DeleteBoundaryConditions', shells: 'DeleteShells', members: 'DeleteMembers',
    grids: 'DeleteGrids', levels: 'DeleteLevels', nodes: 'DeleteNodes',
  }
  for (const collection of deleteOrder) {
    const ids = obsolete.filter(ref => ref.collection === collection).map(ref => ref.id)
    if (!ids.length) continue
    diff[collection].deleted += ids.length
    operations.push({ type: deleteTypes[collection], payload: collection === 'nodes' ? { ids, cascade: false } : { ids } } as CommandTransactionOperation)
  }

  const total = Object.values(diff).reduce((sum, count) => ({
    created: sum.created + count.created,
    updated: sum.updated + count.updated,
    deleted: sum.deleted + count.deleted,
  }), emptyCount())
  return Object.freeze({ object, graph, command: { type: 'Transaction', payload: { operations } }, diff, total })
}
