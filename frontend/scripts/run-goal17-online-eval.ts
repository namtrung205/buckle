import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { CommandGateway, StructuralDocument, type CommandWorkspaceState } from '../src/core/structural/index.ts'
import { AiToolExecutor, isToolAllowed, type AiMode, type AiToolCall, type AiToolResponse } from '../src/core/ai/index.ts'
import { safeProviderToolArguments } from '../src/ui/Copilot/CopilotToolPolicy.ts'

process.on('uncaughtException', error => {
  console.error(`Goal 17 online eval failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

type EvalCall = Readonly<{ name: string; mode: AiMode; arguments: Record<string, unknown> }>
type EvalCase = Readonly<{
  id: string
  prompt: string
  onlineMode?: AiMode
  expectedTools?: readonly string[]
  skipOnline?: string
  setup?: readonly EvalCall[]
  expect: Readonly<{
    ok: boolean
    entityRefs?: readonly string[]
    errorIncludes?: string
    memberSections?: Readonly<Record<string, number>>
    nodePositions?: Readonly<Record<string, readonly [number, number, number]>>
    preview?: Readonly<{ updated?: number }>
    revision?: number
  }>
}>
type Corpus = Readonly<{ schemaVersion: string; name: string; cases: readonly EvalCase[] }>
type ProviderConnection = Readonly<{ id: string; label: string; models: readonly string[] }>
type TurnResult = Readonly<{
  message: string
  toolCalls: readonly AiToolCall[]
  contextRevision: number
  finishReason: 'tool_calls' | 'stop' | 'cancelled'
}>

const args = process.argv.slice(2)
const option = (name: string) => {
  const index = args.indexOf(name)
  return index < 0 ? undefined : args[index + 1]
}
if (args.includes('--help')) {
  console.log('Usage: npm run eval:goal17:online -- [--backend http://127.0.0.1:8000] [--session-id ID] [--connection-id ID] [--model MODEL] [--report PATH]')
  process.exit(0)
}

const backend = (option('--backend') ?? 'http://127.0.0.1:8000').replace(/\/$/, '')
const sessionId = option('--session-id') ?? crypto.randomUUID()
const requestedConnectionId = option('--connection-id')
const requestedModel = option('--model')
const reportPath = option('--report')
const headers = { 'Content-Type': 'application/json', 'X-Copilot-Session': sessionId }
const corpus = JSON.parse(readFileSync(new URL('../src/core/ai/evals/goal17-edit.v1.json', import.meta.url), 'utf8')) as Corpus

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

const connectionsResponse = await fetch(`${backend}/api/copilot/connections`, { headers })
if (!connectionsResponse.ok) throw new Error(`Cannot list provider connections (${connectionsResponse.status})`)
const connections = await connectionsResponse.json() as ProviderConnection[]
let connection = requestedConnectionId ? connections.find(value => value.id === requestedConnectionId) : undefined
if (requestedConnectionId && !connection) throw new Error(`Connection ${requestedConnectionId} is unavailable in session ${sessionId}`)
if (!connection && connections.length === 1) connection = connections[0]
if (!connection && connections.length > 1) {
  throw new Error(`Multiple connections are available; pass --connection-id. Choices: ${connections.map(value => `${value.id} (${value.label})`).join(', ')}`)
}
const model = requestedModel ?? connection?.models[0]
if (connection && (!model || !connection.models.includes(model))) throw new Error(`Pass a model allowed by ${connection.label}: ${connection.models.join(', ')}`)

const containsInOrder = (actual: readonly string[], expected: readonly string[]) => {
  let cursor = 0
  for (const value of actual) if (value === expected[cursor]) cursor++
  return cursor === expected.length
}
const responseRefs = (response: AiToolResponse) => {
  const data = response.data as { entities?: readonly { collection: string; id: number }[] } | undefined
  return data?.entities?.map(ref => `${ref.collection}:${ref.id}`)
}

const results: Record<string, unknown>[] = []
for (const scenario of corpus.cases) {
  if (scenario.skipOnline) {
    results.push({ id: scenario.id, skipped: true, reason: scenario.skipOnline })
    continue
  }
  if (!scenario.onlineMode) throw new Error(`${scenario.id} has no onlineMode`)
  const state = createHarness()
  let localSequence = 0
  for (const call of scenario.setup ?? []) {
    const setup = state.executor.execute({ id: `${scenario.id}:setup:${localSequence++}`, name: call.name, arguments: call.arguments }, call.mode)
    if (!setup.ok) throw new Error(`${scenario.id} setup failed: ${setup.error?.message}`)
  }
  const allowedTools = state.executor.registry.list().filter(tool => isToolAllowed(scenario.onlineMode!, tool))
  const tools = allowedTools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }))
  const toolResults: Array<{ toolCallId: string; tool: string; ok: boolean; content: Record<string, unknown> }> = []
  const responses: AiToolResponse[] = []
  const actualTools: string[] = []
  const conversationId = crypto.randomUUID()
  let providerMessage = ''
  let stopped = false
  for (let round = 0; round < 6 && !stopped; round++) {
    const context = {
      ...state.executor.queries.getModelSummary(),
      selection: state.executor.queries.getSelection().selection,
      sections: state.executor.queries.getEntities('sections'),
      materials: state.executor.queries.getEntities('materials'),
    }
    const turnResponse = await fetch(`${backend}/api/copilot/turn`, {
      method: 'POST', headers,
      body: JSON.stringify({
        requestId: crypto.randomUUID(), conversationId, prompt: scenario.prompt, mode: scenario.onlineMode,
        context, history: [], tools, toolResults,
        ...(connection ? { connectionId: connection.id, model } : {}),
      }),
    })
    if (!turnResponse.ok) {
      const body = await turnResponse.text()
      throw new Error(`${scenario.id}: provider turn failed (${turnResponse.status}): ${body}`)
    }
    const turn = await turnResponse.json() as TurnResult
    providerMessage = turn.message
    if (turn.contextRevision !== state.document.revision) throw new Error(`${scenario.id}: provider returned stale revision ${turn.contextRevision}`)
    if (turn.finishReason === 'cancelled' || !turn.toolCalls.length) break
    for (const [callIndex, providerCall] of turn.toolCalls.entries()) {
      const call = { ...providerCall, id: `${scenario.id}:${round}:${callIndex}`, arguments: safeProviderToolArguments(providerCall.name, providerCall.arguments) }
      actualTools.push(call.name)
      const response = state.executor.execute(call, scenario.onlineMode)
      responses.push(response)
      toolResults.push({ toolCallId: call.id, tool: call.name, ok: response.ok, content: response as unknown as Record<string, unknown> })
      if (response.preview || !response.ok) stopped = true
    }
  }

  const expectedTools = scenario.expectedTools ?? []
  const checks: Record<string, boolean> = {
    requiredToolsInOrder: containsInOrder(actualTools, expectedTools),
    allToolCallsKnown: actualTools.every(name => allowedTools.some(tool => tool.name === name)),
  }
  if (scenario.expect.errorIncludes) checks.expectedError = responses.some(value => value.error?.message.includes(scenario.expect.errorIncludes!))
  else checks.noUnexpectedToolError = responses.every(value => value.ok)
  if (scenario.expect.entityRefs) checks.exactTargets = responses.some(value => JSON.stringify(responseRefs(value)) === JSON.stringify(scenario.expect.entityRefs))
  if (scenario.expect.preview?.updated !== undefined) checks.previewCount = responses.some(value => value.preview?.updated === scenario.expect.preview!.updated)
  if (scenario.expect.revision !== undefined) checks.revision = state.document.revision === scenario.expect.revision
  for (const [id, sectionId] of Object.entries(scenario.expect.memberSections ?? {})) {
    checks[`memberSection:${id}`] = state.document.members.get(Number(id))?.sectionId === sectionId
  }
  for (const [id, position] of Object.entries(scenario.expect.nodePositions ?? {})) {
    checks[`nodePosition:${id}`] = JSON.stringify(state.document.nodes.get(Number(id))?.position) === JSON.stringify(position)
  }
  results.push({
    id: scenario.id,
    passed: Object.values(checks).every(Boolean),
    expectedTools,
    actualTools,
    checks,
    providerMessage,
  })
}

const executed = results.filter(value => !value.skipped)
const passed = executed.filter(value => value.passed).length
const report = {
  schemaVersion: '1.0', corpus: corpus.name, corpusVersion: corpus.schemaVersion,
  timestamp: new Date().toISOString(), backend,
  providerConnection: connection ? { id: connection.id, label: connection.label, model } : { source: 'backend environment' },
  summary: { passed, executed: executed.length, skipped: results.length - executed.length },
  results,
}
if (reportPath) {
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}
console.log(JSON.stringify(report, null, 2))
if (passed !== executed.length) process.exitCode = 1
