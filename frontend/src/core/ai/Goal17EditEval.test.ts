import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { CommandGateway, StructuralDocument, type CommandWorkspaceState } from '../structural/index.ts'
import { copilotContextConflictMessage } from '../../ui/Copilot/CopilotLoopGuard.ts'
import { AiToolExecutor } from './ToolExecutor.ts'
import type { AiMode, AiToolCall, AiToolResponse } from './types.ts'

type EvalCall = Readonly<{ name: string; mode: AiMode; arguments: Record<string, unknown> }>
type EvalExpectation = Readonly<{
  ok: boolean
  entityRefs?: readonly string[]
  errorIncludes?: string
  memberSections?: Readonly<Record<string, number>>
  nodePositions?: Readonly<Record<string, readonly [number, number, number]>>
  preview?: Readonly<{ updated?: number }>
  revision?: number
}>
type EvalCase = Readonly<{
  id: string
  locale: 'vi' | 'en'
  prompt: string
  tags: readonly string[]
  setup?: readonly EvalCall[]
  calls?: readonly EvalCall[]
  contextConflict?: Readonly<{ plannedRevision: number; currentRevision: number; providerRevision: number }>
  expect: EvalExpectation
}>
type EvalCorpus = Readonly<{ schemaVersion: string; cases: readonly EvalCase[] }>

const corpus = JSON.parse(readFileSync(new URL('./evals/goal17-edit.v1.json', import.meta.url), 'utf8')) as EvalCorpus

const createHarness = () => {
  const document = new StructuralDocument({
    materials: [{ id: 1, name: 'Steel', category: 'steel', E: 210e9, nu: 0.3 }],
    sections: [{ id: 1, name: 'I300', type: 'I', materialId: 1 }, { id: 2, name: 'I500', type: 'I', materialId: 1 }],
    nodes: [
      { id: 1, name: 'A', position: [0, 0, 0] },
      { id: 2, name: 'B', position: [3, 0, 0] },
      { id: 3, name: 'C', position: [0, 0, 3] },
    ],
    members: [
      { id: 1, label: 'Edge beam', nodeI: 1, nodeJ: 2, sectionId: 1 },
      { id: 2, label: 'Column', nodeI: 1, nodeJ: 3, sectionId: 1 },
    ],
    levels: [{ id: 1, name: 'Ground', elevation: 0 }, { id: 2, name: 'Level 2', elevation: 3 }],
    groups: [{ id: 1, name: 'Boundary frame', entityRefs: [{ collection: 'members', id: 1 }] }],
  })
  let workspace: CommandWorkspaceState = { selection: [], hidden: [] }
  const executor = new AiToolExecutor(document, new CommandGateway(document), {
    getWorkspaceState: () => structuredClone(workspace),
    applyWorkspaceState: next => { workspace = structuredClone(next) },
  })
  return { document, executor }
}

const entityRefs = (response: AiToolResponse) => {
  const data = response.data as { entities?: readonly { collection: string; id: number }[] } | undefined
  return data?.entities?.map(ref => `${ref.collection}:${ref.id}`)
}

test('Goal 17 versioned bilingual edit corpus covers every required target-resolution gate', () => {
  assert.equal(corpus.schemaVersion, '1.0')
  assert.ok(corpus.cases.some(value => value.locale === 'vi'))
  assert.ok(corpus.cases.some(value => value.locale === 'en'))
  for (const tag of ['selection', 'pronoun', 'reference', 'no-match', 'multi-match', 'stale-revision']) {
    assert.ok(corpus.cases.some(value => value.tags.includes(tag)), `missing ${tag} eval coverage`)
  }
  assert.equal(new Set(corpus.cases.map(value => value.id)).size, corpus.cases.length)
})

for (const scenario of corpus.cases) {
  test(`Goal 17 offline edit eval: ${scenario.id}`, () => {
    const state = createHarness()
    let sequence = 0
    const invoke = (call: EvalCall) => state.executor.execute({
      id: `${scenario.id}:${sequence++}`,
      name: call.name,
      arguments: call.arguments,
    } as AiToolCall, call.mode)

    for (const call of scenario.setup ?? []) assert.equal(invoke(call).ok, true, `${scenario.id} setup failed`)

    let response: AiToolResponse | undefined
    const responses: AiToolResponse[] = []
    let conflict: string | null = null
    if (scenario.contextConflict) {
      const value = scenario.contextConflict
      conflict = copilotContextConflictMessage(value.plannedRevision, value.currentRevision, value.providerRevision)
    } else {
      for (const call of scenario.calls ?? []) {
        response = invoke(call)
        responses.push(response)
      }
    }

    const actualOk = scenario.contextConflict ? conflict === null : response?.ok === true
    assert.equal(actualOk, scenario.expect.ok)
    if (scenario.expect.errorIncludes) {
      const error = conflict ?? response?.error?.message ?? ''
      assert.ok(error.includes(scenario.expect.errorIncludes), `${scenario.id}: ${error}`)
    }
    if (scenario.expect.entityRefs) {
      const targetResponse = [...responses].reverse().find(value => entityRefs(value) !== undefined)
      assert.deepEqual(entityRefs(targetResponse!), scenario.expect.entityRefs)
    }
    if (scenario.expect.revision !== undefined) assert.equal(state.document.revision, scenario.expect.revision)
    if (scenario.expect.preview?.updated !== undefined) assert.equal(response?.preview?.updated, scenario.expect.preview.updated)
    for (const [id, sectionId] of Object.entries(scenario.expect.memberSections ?? {})) {
      assert.equal(state.document.members.get(Number(id))?.sectionId, sectionId)
    }
    for (const [id, position] of Object.entries(scenario.expect.nodePositions ?? {})) {
      assert.deepEqual(state.document.nodes.get(Number(id))?.position, position)
    }
  })
}
