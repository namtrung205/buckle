import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { CommandGateway, StructuralDocument, type CommandWorkspaceState } from '../src/core/structural/index.ts'
import { AiToolExecutor, isToolAllowed, type AiToolCall, type AiToolResponse } from '../src/core/ai/index.ts'
import { createParametricGeneratorCatalogue } from '../src/model/Generators/ParametricCatalogue.ts'
import { safeProviderToolArguments } from '../src/ui/Copilot/CopilotToolPolicy.ts'

type Scenario = Readonly<{
  id: string
  prompt: string
  tool: string
  arguments: Readonly<Record<string, unknown>>
  kind: string
  setup?: readonly Readonly<{ tool: string; arguments: Readonly<Record<string, unknown>> }>[]
}>
type ProviderConnection = Readonly<{ id: string; label: string; models: readonly string[] }>
type TurnResult = Readonly<{ message: string; toolCalls: readonly AiToolCall[]; contextRevision: number; finishReason: 'tool_calls' | 'stop' | 'cancelled' }>

const args = process.argv.slice(2)
const option = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
if (args.includes('--help')) {
  console.log('Usage: npm run eval:goal18:online -- [--backend http://127.0.0.1:8000] [--session-id ID] [--connection-id ID] [--model MODEL] [--report PATH]')
  process.exit(0)
}

const backend = (option('--backend') ?? 'http://127.0.0.1:8000').replace(/\/$/, '')
const sessionId = option('--session-id') ?? crypto.randomUUID()
const requestedConnectionId = option('--connection-id')
const requestedModel = option('--model')
const reportPath = option('--report')
const headers = { 'Content-Type': 'application/json', 'X-Copilot-Session': sessionId }
const corpus = JSON.parse(readFileSync(new URL('../src/core/ai/evals/goal18-parametric.v1.json', import.meta.url), 'utf8')) as { schemaVersion: string; name: string; cases: readonly Scenario[] }

const connectionsResponse = await fetch(`${backend}/api/copilot/connections`, { headers })
if (!connectionsResponse.ok) throw new Error(`Cannot list provider connections (${connectionsResponse.status})`)
const connections = await connectionsResponse.json() as ProviderConnection[]
let connection = requestedConnectionId ? connections.find(item => item.id === requestedConnectionId) : undefined
if (requestedConnectionId && !connection) throw new Error(`Connection ${requestedConnectionId} is unavailable in session ${sessionId}`)
if (!connection && connections.length === 1) connection = connections[0]
if (!connection && connections.length > 1) throw new Error(`Multiple connections are available; pass --connection-id. Choices: ${connections.map(item => `${item.id} (${item.label})`).join(', ')}`)
const model = requestedModel ?? connection?.models[0]
if (connection && (!model || !connection.models.includes(model))) throw new Error(`Pass a model allowed by ${connection.label}: ${connection.models.join(', ')}`)

const createHarness = () => {
  const document = new StructuralDocument({
    materials: [{ id: 1, name: 'Steel', category: 'steel', E: 210e9, nu: 0.3, rho: 7850 }],
    sections: [{ id: 1, name: 'I500', type: 'I', materialId: 1, properties: { A: 0.014 } }],
  })
  let workspace: CommandWorkspaceState = { selection: [], hidden: [] }
  const executor = new AiToolExecutor(document, new CommandGateway(document), {
    getWorkspaceState: () => structuredClone(workspace),
    applyWorkspaceState: value => { workspace = structuredClone(value) },
    parametricGenerators: createParametricGeneratorCatalogue(document),
  })
  return { document, executor }
}

const results: Array<Record<string, unknown>> = []
for (const scenario of corpus.cases) {
  const state = createHarness()
  for (const [index, setup] of (scenario.setup ?? []).entries()) {
    const response = state.executor.execute({ id: `${scenario.id}:setup:${index}`, name: setup.tool, arguments: setup.arguments }, 'Generate')
    if (!response.ok) throw new Error(`${scenario.id} setup failed: ${response.error?.message}`)
  }
  const allowed = state.executor.registry.list().filter(tool => isToolAllowed('Generate', tool))
  const tools = allowed.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }))
  let toolResults: Array<{ toolCallId: string; tool: string; ok: boolean; content: Record<string, unknown> }> = []
  const actualTools: string[] = []
  const responses: AiToolResponse[] = []
  let providerMessage = ''
  const conversationId = crypto.randomUUID()
  for (let round = 0; round < 6; round++) {
    const turnResponse = await fetch(`${backend}/api/copilot/turn`, {
      method: 'POST', headers,
      body: JSON.stringify({
        requestId: crypto.randomUUID(), conversationId, prompt: scenario.prompt, mode: 'Generate',
        context: {
          ...state.executor.queries.getModelSummary(), sections: state.executor.queries.getEntities('sections'),
          materials: state.executor.queries.getEntities('materials'), parametricObjects: state.executor.queries.getEntities('parametricObjects'),
          capabilities: { parametricKinds: Object.keys(state.executor.runtime.parametricGenerators ?? {}) },
        },
        history: [], tools, toolResults, ...(connection ? { connectionId: connection.id, model } : {}),
      }),
    })
    if (!turnResponse.ok) throw new Error(`${scenario.id}: provider turn failed (${turnResponse.status}): ${await turnResponse.text()}`)
    const turn = await turnResponse.json() as TurnResult
    providerMessage = turn.message
    if (turn.contextRevision !== state.document.revision) throw new Error(`${scenario.id}: provider returned stale revision ${turn.contextRevision}`)
    if (!turn.toolCalls.length || turn.finishReason !== 'tool_calls') break
    const nextResults: typeof toolResults = []
    let reachedPreview = false
    for (const [index, providerCall] of turn.toolCalls.entries()) {
      const call = { ...providerCall, id: `${scenario.id}:${round}:${index}`, arguments: safeProviderToolArguments(providerCall.name, providerCall.arguments) }
      actualTools.push(call.name)
      const response = state.executor.execute(call, 'Generate')
      responses.push(response)
      nextResults.push({ toolCallId: call.id, tool: call.name, ok: response.ok, content: response as unknown as Record<string, unknown> })
      if (response.preview?.parametric || !response.ok) reachedPreview = true
    }
    toolResults = [...toolResults, ...nextResults].slice(-24)
    if (reachedPreview) break
  }
  const expectedResponse = responses.find(response => response.tool === scenario.tool)
  const checks = {
    choseHighLevelTool: actualTools.includes(scenario.tool),
    didNotUseGenericFallback: !actualTools.includes('generate_parametric'),
    validToolCalls: responses.every(response => response.ok),
    previewedWithoutCommit: expectedResponse?.preview?.parametric?.kind === scenario.kind,
  }
  results.push({ id: scenario.id, prompt: scenario.prompt, expectedTool: scenario.tool, actualTools, checks, passed: Object.values(checks).every(Boolean), providerMessage })
}

const report = { schemaVersion: '1.0', corpus: corpus.name, corpusVersion: corpus.schemaVersion, generatedAt: new Date().toISOString(), connection: connection?.label ?? 'environment', model: model ?? 'environment', results, passed: results.every(item => item.passed === true) }
if (reportPath) { mkdirSync(dirname(reportPath), { recursive: true }); writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8') }
console.log(JSON.stringify(report, null, 2))
if (!report.passed) process.exitCode = 1
