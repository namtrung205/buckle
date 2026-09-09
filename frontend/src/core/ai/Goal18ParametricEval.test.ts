import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createParametricGeneratorCatalogue, PARAMETRIC_TEMPLATE_CATALOGUE, parseEngineeringAngle, parseEngineeringLength } from '../../model/Generators/ParametricCatalogue.ts'
import { CommandGateway, StructuralDocument, validateParametricGraph, type CommandWorkspaceState, type ParametricEntityGraph } from '../structural/index.ts'
import { AiToolExecutor, AiToolRegistry, isToolAllowed, type AiToolCall } from './index.ts'

const documentFixture = () => new StructuralDocument({
  materials: [{ id: 1, name: 'Steel', category: 'steel', E: 210e9, nu: 0.3, rho: 7850 }],
  sections: [
    { id: 1, name: 'I500', type: 'I', materialId: 1, properties: { A: 0.014 } },
    { id: 2, name: 'I600', type: 'I', materialId: 1, properties: { A: 0.018 } },
  ],
})

const harness = () => {
  const document = documentFixture()
  let workspace: CommandWorkspaceState = { selection: [], hidden: [] }
  const executor = new AiToolExecutor(document, new CommandGateway(document), {
    getWorkspaceState: () => workspace,
    applyWorkspaceState: value => { workspace = value },
    parametricGenerators: createParametricGeneratorCatalogue(document),
  })
  return { document, executor }
}

const invoke = (executor: AiToolExecutor, id: string, name: string, args: Record<string, unknown>) =>
  executor.execute({ id, name, arguments: args } as AiToolCall, 'Generate')

const golden = JSON.parse(readFileSync(new URL('./evals/goal18-parametric.v1.json', import.meta.url), 'utf8')) as {
  schemaVersion: string
  cases: Array<{ id: string; prompt: string; tool: string; arguments: Record<string, unknown>; kind: string; setup?: Array<{ tool: string; arguments: Record<string, unknown> }> }>
}

test('Goal 18 parses explicit engineering units and Vietnamese angle notation', () => {
  assert.equal(parseEngineeringLength('6000 mm', 'length'), 6)
  assert.equal(parseEngineeringLength('30 mét', 'length'), 30)
  assert.equal(parseEngineeringLength('20 ft', 'length'), 6.096)
  assert.equal(parseEngineeringAngle('15 độ', 'pitch'), 15)
  assert.ok(Math.abs(parseEngineeringAngle(`${Math.PI / 12} rad`, 'pitch') - 15) < 1e-9)
  assert.throws(() => parseEngineeringLength('10 px', 'length'), /unsupported unit/)
})

test('Goal 18 versioned bilingual golden prompts produce deterministic parameter graphs', () => {
  assert.equal(golden.schemaVersion, '1.0')
  assert.equal(new Set(golden.cases.map(item => item.kind)).size, 6)
  assert.ok(golden.cases.some(item => /[ăâđêôơư]/i.test(item.prompt)))
  for (const scenario of golden.cases) {
    const firstHarness = harness(); const secondHarness = harness()
    for (const [index, setup] of (scenario.setup ?? []).entries()) {
      assert.equal(invoke(firstHarness.executor, `${scenario.id}:setup:a:${index}`, setup.tool, setup.arguments).ok, true)
      assert.equal(invoke(secondHarness.executor, `${scenario.id}:setup:b:${index}`, setup.tool, setup.arguments).ok, true)
    }
    const first = invoke(firstHarness.executor, `${scenario.id}:a`, scenario.tool, scenario.arguments)
    const second = invoke(secondHarness.executor, `${scenario.id}:b`, scenario.tool, scenario.arguments)
    assert.equal(first.ok, true, `${scenario.id}: ${first.error?.message}`)
    assert.equal(second.ok, true, `${scenario.id}: ${second.error?.message}`)
    assert.equal(first.preview?.parametric?.kind, scenario.kind)
    assert.deepEqual(first.preview?.parametric, second.preview?.parametric)
    assert.deepEqual(
      { created: first.preview?.created, updated: first.preview?.updated, deleted: first.preview?.deleted },
      { created: second.preview?.created, updated: second.preview?.updated, deleted: second.preview?.deleted },
    )
  }
})

test('Goal 18 registry exposes dedicated high-level tools only in Generate-capable modes', () => {
  const registry = new AiToolRegistry()
  const names = ['create_grid', 'create_portal_frame', 'create_frame_array', 'create_truss', 'create_warehouse', 'create_tower', 'update_parametric_object']
  for (const name of names) {
    const tool = registry.get(name)!
    assert.ok(tool, name)
    assert.equal(isToolAllowed('Generate', tool), true)
    assert.equal(isToolAllowed('Inspect', tool), false)
    assert.equal(isToolAllowed('Modeling', tool), false)
  }
})

test('Goal 18 exposes versioned defaults and bilingual vocabulary through a query tool', () => {
  const state = harness()
  const result = state.executor.execute({ id: 'catalogue', name: 'get_parametric_templates', arguments: { kind: 'Warehouse' } }, 'Inspect')
  assert.equal(result.ok, true)
  const template = (result.data as { templates: Array<{ templateId: string; defaults: Record<string, unknown>; vocabulary: Record<string, string[]> }> }).templates[0]
  assert.equal(template.templateId, PARAMETRIC_TEMPLATE_CATALOGUE.Warehouse.id)
  assert.equal(template.defaults.baySpacing, 6)
  assert.ok(template.vocabulary.baySpacing.includes('bước khung'))
})

test('Goal 18 warehouse preview and apply use one transaction with published defaults', () => {
  const state = harness()
  const args = { width: '30 m', length: '60 m', height: '8 m', baySpacing: '6000 mm', sectionId: 1, preview: true }
  const preview = invoke(state.executor, 'warehouse-preview', 'create_warehouse', args)
  assert.equal(preview.ok, true)
  assert.equal(state.document.revision, 0)
  assert.deepEqual(preview.preview?.parametric?.footprint?.size.slice(0, 2), [30, 60])
  assert.equal(preview.preview?.parametric?.supportCount, 22)
  assert.ok(preview.preview?.parametric?.defaultsApplied.includes('pitch'))
  assert.equal(preview.preview?.parametric?.templateId, PARAMETRIC_TEMPLATE_CATALOGUE.Warehouse.id)

  const applied = invoke(state.executor, 'warehouse-apply', 'create_warehouse', { ...args, preview: false })
  assert.equal(applied.ok, true)
  assert.equal(state.document.revision, 1)
  assert.equal(state.executor.gateway.auditLog.length, 1)
  assert.equal(state.executor.gateway.auditLog[0].type, 'Transaction')
  const object = [...state.document.parametricObjects.values()][0]
  assert.equal(object.parameters.numBays, 10)
  assert.equal(object.provenance?.templateId, PARAMETRIC_TEMPLATE_CATALOGUE.Warehouse.id)
  assert.equal(object.provenance?.transactionId, 'ai:warehouse-apply')
})

test('Goal 18 update regenerates 60 m warehouse to 72 m and preserves stable semantic IDs', () => {
  const state = harness()
  const created = invoke(state.executor, 'create', 'create_warehouse', { width: 30, length: 60, height: 8, baySpacing: 6, sectionId: 1, preview: false })
  const objectId = (created.data as { objectId: number }).objectId
  const before = state.document.parametricObjects.get(objectId)!
  const baseNodeId = before.roleBindings!['frame-line:0:left:base-node'].id
  const preview = invoke(state.executor, 'update-preview', 'update_parametric_object', { objectId, parameters: { length: '72 m' }, preview: true })
  assert.equal(preview.ok, true)
  assert.equal(preview.preview?.deleted, 0)
  assert.equal(state.document.revision, 1)

  const updated = invoke(state.executor, 'update-apply', 'update_parametric_object', { objectId, parameters: { length: '72 m' }, preview: false })
  assert.equal(updated.ok, true)
  assert.equal(state.document.revision, 2)
  const after = state.document.parametricObjects.get(objectId)!
  assert.equal(after.parameters.length, 72)
  assert.equal(after.parameters.numBays, 12)
  assert.equal(after.roleBindings!['frame-line:0:left:base-node'].id, baseNodeId)
  assert.equal(state.document.nodes.get(baseNodeId)?.position[1], 0)
})

test('Goal 18 updates warehouse column sections without changing other semantic roles and survives reload', () => {
  const state = harness()
  const created = invoke(state.executor, 'section-create', 'create_warehouse', { width: 30, length: 60, height: 8, baySpacing: 6, sectionId: 1, preview: false })
  const objectId = (created.data as { objectId: number }).objectId
  const before = state.document.parametricObjects.get(objectId)!
  const columnId = before.roleBindings!['frame-line:0:left:column'].id
  const rafterId = before.roleBindings!['frame-line:0:left:rafter:0'].id
  const updated = invoke(state.executor, 'section-update', 'update_parametric_object', { objectId, parameters: { columnSectionId: 2 }, preview: false })
  assert.equal(updated.ok, true)
  assert.equal(state.document.members.get(columnId)?.sectionId, 2)
  assert.equal(state.document.members.get(rafterId)?.sectionId, 1)
  assert.equal(state.document.parametricObjects.get(objectId)?.roleBindings?.['frame-line:0:left:column'].id, columnId)

  const restored = StructuralDocument.fromSnapshot(state.document.getSnapshot())
  assert.equal(restored.parametricObjects.get(objectId)?.parameters.columnSectionId, 2)
  assert.equal(restored.parametricObjects.get(objectId)?.roleBindings?.['frame-line:0:left:column'].id, columnId)
  assert.equal(restored.createAnalysisSnapshot().model.members.length, state.document.members.size)
})

test('Goal 18 every registered generator returns a valid deterministic preview', () => {
  for (const [index, tool] of ['create_grid', 'create_portal_frame', 'create_frame_array', 'create_truss', 'create_warehouse', 'create_tower'].entries()) {
    const state = harness()
    const result = invoke(state.executor, `preview-${index}`, tool, { preview: true })
    assert.equal(result.ok, true, `${tool}: ${result.error?.message}`)
    assert.ok(result.preview?.parametric)
    assert.equal(state.document.revision, 0)
  }
})

test('Goal 18 kernel rejects coincident nodes, unsupported sections and disconnected topology', () => {
  const document = documentFixture()
  const node = (role: string, position: readonly [number, number, number]) => ({ role, record: { position } })
  assert.throws(() => validateParametricGraph(document, { nodes: [node('a', [0, 0, 0]), node('b', [0, 0, 0])] }), /coincident/)
  assert.throws(() => validateParametricGraph(document, {
    nodes: [node('a', [0, 0, 0]), node('b', [1, 0, 0])],
    members: [{ role: 'm', nodeIRole: 'a', nodeJRole: 'b', sectionId: 999 }],
  }), /unsupported section/)
  const disconnected: ParametricEntityGraph = {
    nodes: [node('a', [0, 0, 0]), node('b', [1, 0, 0]), node('c', [3, 0, 0]), node('d', [4, 0, 0])],
    members: [
      { role: 'ab', nodeIRole: 'a', nodeJRole: 'b', sectionId: 1 },
      { role: 'cd', nodeIRole: 'c', nodeJRole: 'd', sectionId: 1 },
    ],
  }
  assert.throws(() => validateParametricGraph(document, disconnected), /disconnected/)
})
