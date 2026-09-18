/** Planner tests — plugin-side mirror of the ParametricKernel diff contract. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateTowerGraph, validateTowerParams } from './towerGraph.ts'
import type { TowerPlanInput } from './towerGraph.ts'
import { planTowerRegeneration } from './towerPlan.ts'
import type { PlanSnapshot } from './towerPlan.ts'

const base: TowerPlanInput = {
  circuit: 'double', bodyHeight: 30, peakHeight: 6, baseWidth: 10, topWidth: 2,
  panelCount: 6, straightPanels: 2, taper: 'linear',
  armCount: 3, armLength: 5, armDrop: 1.5, armSpacing: 5,
  legSectionId: 1, braceSectionId: 2,
  autoSupports: true, supportKind: 'pinned', autoLoads: true,
  windX: 0, windY: 0, windZ: 1, windForce: 1, gravity: 9.81,
}

const emptySnapshot = (): PlanSnapshot => ({
  revision: 1, nodes: [], members: [], loads: [], boundaryConditions: [], parametricObjects: [],
})

type Entity = Record<string, unknown> & { id: number }
const snapshotWith = (
  entities: { nodes?: Entity[]; members?: Entity[]; loads?: Entity[]; boundaryConditions?: Entity[]; parametricObjects?: Entity[] },
  revision = 2,
): PlanSnapshot => ({
  revision,
  nodes: entities.nodes ?? [],
  members: entities.members ?? [],
  loads: entities.loads ?? [],
  boundaryConditions: entities.boundaryConditions ?? [],
  parametricObjects: entities.parametricObjects ?? [],
})

/** Minimal in-memory applier mirroring the gateway semantics for assertions. */
function apply(plan: ReturnType<typeof planTowerRegeneration>, snapshot: PlanSnapshot): PlanSnapshot {
  const store: Record<string, Map<number, Entity>> = {
    nodes: new Map(), members: new Map(), loads: new Map(), boundaryConditions: new Map(), parametricObjects: new Map(),
  }
  for (const collection of ['nodes', 'members', 'loads', 'boundaryConditions', 'parametricObjects'] as const) {
    for (const record of snapshot[collection] as Entity[]) store[collection].set(record.id, { ...record })
  }
  for (const op of plan.command.payload.operations) {
    const type = String(op.type)
    const payload = op.payload as Record<string, unknown>
    if (type === 'CreateNodes' || type === 'CreateMembers' || type === 'CreateOrUpdateLoads'
      || type === 'CreateOrUpdateBoundaryConditions' || type === 'CreateOrUpdateParametricObjects') {
      const key = type === 'CreateNodes' ? 'nodes' : type === 'CreateMembers' ? 'members'
        : type === 'CreateOrUpdateLoads' ? 'loads' : type === 'CreateOrUpdateBoundaryConditions'
          ? 'boundaryConditions' : 'parametricObjects'
      for (const record of payload[key === 'nodes' ? 'nodes' : key === 'members' ? 'members' : key === 'loads' ? 'loads' : key === 'boundaryConditions' ? 'boundaryConditions' : 'parametricObjects'] as Entity[]) {
        store[key].set(record.id, { ...record })
      }
    } else if (type === 'UpdateMembers') {
      for (const member of payload.members as { id: number; patch: Record<string, unknown> }[]) {
        const current = store.members.get(member.id)
        if (current) store.members.set(member.id, { ...current, ...member.patch })
      }
    } else if (type === 'MoveNodes') {
      for (const node of payload.nodes as { id: number; position: unknown; name?: string }[]) {
        const current = store.nodes.get(node.id)
        if (current) store.nodes.set(node.id, { ...current, position: node.position, ...(node.name ? { name: node.name } : {}) })
      }
    } else if (type === 'DeleteLoads' || type === 'DeleteBoundaryConditions' || type === 'DeleteMembers' || type === 'DeleteNodes') {
      const key = type === 'DeleteLoads' ? 'loads' : type === 'DeleteBoundaryConditions' ? 'boundaryConditions'
        : type === 'DeleteMembers' ? 'members' : 'nodes'
      for (const id of payload.ids as number[]) store[key].delete(id)
    } else throw new Error(`Unsupported test op ${type}`)
  }
  return {
    revision: snapshot.revision + 1,
    nodes: [...store.nodes.values()], members: [...store.members.values()],
    loads: [...store.loads.values()], boundaryConditions: [...store.boundaryConditions.values()],
    parametricObjects: [...store.parametricObjects.values()],
  }
}
test('fresh generation plans one transaction without any delete', () => {
  const graph = generateTowerGraph(base)
  const plan = planTowerRegeneration(graph, emptySnapshot(), base, 'tower-plugin@1')
  assert.equal(plan.requiresApproval, false)
  const types = plan.command.payload.operations.map(op => op.type)
  assert.ok(types.includes('CreateNodes'))
  assert.ok(types.includes('CreateMembers'))
  assert.ok(types.includes('CreateOrUpdateParametricObjects'))
  assert.ok(!types.some(type => String(type).startsWith('Delete')))
  assert.ok(graph.nodes.length >= 4 * (base.panelCount + 1))
  assert.ok(graph.members.length > graph.nodes.length)
})

test('regeneration with unchanged parameters is idempotent', () => {
  const graph = generateTowerGraph(base)
  const first = planTowerRegeneration(graph, emptySnapshot(), base, 'tower-plugin@1')
  const after = apply(first, emptySnapshot())
  const second = planTowerRegeneration(graph, after, base, 'tower-plugin@1')
  const mutating = second.command.payload.operations.filter(op =>
    !String(op.type).startsWith('CreateOrUpdateParametricObjects'))
  assert.equal(mutating.length, 0)
  assert.equal(second.requiresApproval, false)
})

test('parameter change moves nodes without deleting anything', () => {
  const graph = generateTowerGraph(base)
  const first = planTowerRegeneration(graph, emptySnapshot(), base, 'tower-plugin@1')
  const after = apply(first, emptySnapshot())
  const taller = { ...base, bodyHeight: 40 }
  const second = planTowerRegeneration(generateTowerGraph(taller), after, taller, 'tower-plugin@1')
  const types = second.command.payload.operations.map(op => op.type)
  assert.ok(types.includes('MoveNodes'))
  assert.ok(!types.some(type => String(type).startsWith('Delete')))
  assert.equal(second.requiresApproval, false)
})

test('shrinking the tower deletes obsolete entities in safe order with approval', () => {
  const graph = generateTowerGraph(base)
  const first = planTowerRegeneration(graph, emptySnapshot(), base, 'tower-plugin@1')
  const after = apply(first, emptySnapshot())
  const smaller = { ...base, panelCount: 3 }
  const second = planTowerRegeneration(generateTowerGraph(smaller), after, smaller, 'tower-plugin@1')
  assert.equal(second.requiresApproval, true)
  assert.ok(second.summary.deleted > 0)
  const types = second.command.payload.operations.map(op => op.type)
  const indexOf = (type: string) => types.findIndex(candidate => candidate === type)
  assert.ok(indexOf('DeleteMembers') < indexOf('DeleteNodes'), 'members must be deleted before nodes')
  if (types.includes('DeleteLoads')) assert.ok(indexOf('DeleteLoads') < indexOf('DeleteMembers'))
  const third = apply(second, after)
  const cleanup = planTowerRegeneration(generateTowerGraph(smaller), third, smaller, 'tower-plugin@1')
  assert.equal(cleanup.command.payload.operations
    .filter(op => !String(op.type).startsWith('CreateOrUpdateParametricObjects')).length, 0)
})

test('plugin kind never collides with the built-in Tower objects', () => {
  const graph = generateTowerGraph(base)
  const withBuiltin = snapshotWith({
    parametricObjects: [{ id: 7, kind: 'Tower', version: 1, parameters: {}, ownedEntityRefs: [], roleBindings: {}, constraints: [], generatorVersion: 'tower@1' }],
  })
  const plan = planTowerRegeneration(graph, withBuiltin, base, 'tower-plugin@1')
  const objectOp = plan.command.payload.operations.find(op => op.type === 'CreateOrUpdateParametricObjects')
  assert.ok(objectOp)
  const record = (objectOp!.payload as { parametricObjects: { kind: string }[] }).parametricObjects[0]
  assert.equal(record.kind, 'TowerPlugin')
  assert.notEqual(record.kind, 'Tower')
})

test('planning is deterministic for identical inputs', () => {
  const graph = generateTowerGraph(base)
  const snapshot = emptySnapshot()
  const a = planTowerRegeneration(graph, snapshot, base, 'tower-plugin@1')
  const b = planTowerRegeneration(graph, snapshot, base, 'tower-plugin@1')
  assert.equal(JSON.stringify(a.command), JSON.stringify(b.command))
})

test('form validation guards the classic failure modes', () => {
  assert.equal(validateTowerParams({ ...base, topWidth: 99 }), 'Độ rộng đỉnh không được vượt quá độ rộng chân')
  assert.equal(validateTowerParams({ ...base, panelCount: 0 }), 'Số tầng phải là số nguyên dương')
  assert.equal(validateTowerParams({ ...base, straightPanels: 6 }), 'Số tầng thẳng phải nằm trong [0, số tầng - 1]')
  assert.equal(validateTowerParams({ ...base, armCount: 4 }), 'Số tai đỡ phải từ 0 đến 3')
  assert.equal(validateTowerParams(base), null)
})

test('swapping the brace section updates members in place (UpdateMembers, no delete)', () => {
  const graph = generateTowerGraph(base)
  const first = planTowerRegeneration(graph, emptySnapshot(), base, 'tower-plugin@1')
  const after = apply(first, emptySnapshot())
  const otherSection = { ...base, braceSectionId: 3 }
  const second = planTowerRegeneration(generateTowerGraph(otherSection), after, otherSection, 'tower-plugin@1')
  const types = second.command.payload.operations.map(op => op.type)
  assert.ok(types.includes('UpdateMembers'), 'changed members must go through UpdateMembers')
  assert.ok(!types.includes('CreateMembers'), 'existing members must not be re-created')
  assert.equal(second.requiresApproval, false)
})
