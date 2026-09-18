import type { AiToolCall, AiToolResponse } from '../../core/ai/types.ts'

export type AgentResult = { toolCallId: string; tool: string; ok: boolean; content: Record<string, unknown> }
export type AgentCheckpoint = {
  id: string; prompt: string; results: AgentResult[]; queued: AiToolCall[]; round: number
  status: 'running' | 'completed' | 'stopped' | 'failed'; message?: string
}
export type AgentPlan = { message: string; toolCalls: AiToolCall[]; finishReason: string }
export const newAgentCheckpoint = (prompt: string): AgentCheckpoint => ({
  id: crypto.randomUUID(), prompt, results: [], queued: [], round: 0, status: 'running',
})

/** Keep the original result outside the provider window. Large outputs remain addressable. */
export const agentContextResults = (results: AgentResult[], detailCharacters = 32000): AgentResult[] => {
  let remaining = detailCharacters
  return [...results].reverse().map(result => {
    const text = JSON.stringify(result.content)
    if (text.length <= remaining) { remaining -= text.length; return result }
    const { revision, error, preview, ids, undoToken } = result.content
    return { ...result, content: { revision, error, preview, ids, undoToken,
      archived: true, characters: text.length, resultId: result.toolCallId,
      instruction: 'Use get_agent_tool_result with this resultId and offset to retrieve the full JSON. This result is not missing.' } }
  }).reverse()
}

export const AGENT_RESULT_TOOL = {
  name: 'get_agent_tool_result', kind: 'query' as const,
  description: 'Read complete archived tool JSON from this task by resultId. Follow nextOffset until null. Summaries never discard the original result.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['resultId'], properties: {
    resultId: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, length: { type: 'integer', minimum: 1 },
  } },
}

export const readAgentResult = (run: AgentCheckpoint, args: Readonly<Record<string, unknown>>) => {
  const result = run.results.find(item => item.toolCallId === args.resultId)
  if (!result) throw new Error('Unknown resultId in this task')
  const text = JSON.stringify(result.content)
  const offset = Number(args.offset ?? 0); const length = Number(args.length ?? 16000)
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1) throw new Error('Invalid result page')
  return { resultId: result.toolCallId, json: text.slice(offset, offset + length), totalCharacters: text.length,
    nextOffset: offset + length < text.length ? offset + length : null }
}

/** No round, step or elapsed-time cutoff. Resume executes saved calls, never replans them. */
export async function runAgent(run: AgentCheckpoint, options: {
  signal: AbortSignal
  plan: (run: AgentCheckpoint) => Promise<AgentPlan>
  execute: (call: AiToolCall) => Promise<AiToolResponse>
  checkpoint?: (run: AgentCheckpoint) => Promise<void> | void
  activity?: (response: AiToolResponse) => void
}): Promise<string> {
  const save = async () => { await options.checkpoint?.(run) }
  run.status = 'running'
  try {
    for (;;) {
      options.signal.throwIfAborted()
      if (!run.queued.length) {
        const plan = await options.plan(run)
        options.signal.throwIfAborted()
        if (plan.finishReason === 'cancelled') throw new DOMException('Stopped', 'AbortError')
        run.round++
        if (!plan.toolCalls.length) {
          run.status = 'completed'; run.message = plan.message || 'Done.'; await save(); return run.message
        }
        run.queued = plan.toolCalls.map(call => ({ ...call, id: crypto.randomUUID() }))
        await save()
      }
      while (run.queued.length) {
        options.signal.throwIfAborted()
        const call = run.queued[0]
        const response = await options.execute(call)
        // Commit evidence before checking cancellation: an already committed mutation must not be replayed.
        run.results.push({ toolCallId: call.id, tool: call.name, ok: response.ok, content: response as unknown as Record<string, unknown> })
        run.queued.shift()
        options.activity?.(response)
        await save()
        options.signal.throwIfAborted()
      }
    }
  } catch (error) {
    run.status = options.signal.aborted || (error as Error).name === 'AbortError' ? 'stopped' : 'failed'
    await save()
    throw error
  }
}
