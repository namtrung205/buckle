import type { AiToolExecutor } from './ToolExecutor.ts'
import type { AiMode, AiToolCall, AiToolDefinition, AiToolResponse } from './types.ts'
import { isToolAllowed } from './ToolPolicy.ts'

/** Minimal provider contract used by tests, CLI/MCP adapters and chat orchestration. */
export interface AiToolProvider {
  plan(input: Readonly<{
    prompt: string
    tools: readonly AiToolDefinition[]
    context: unknown
  }>): Promise<readonly AiToolCall[]>
}

export const runToolHarness = async (
  provider: AiToolProvider,
  executor: AiToolExecutor,
  input: Readonly<{ prompt: string; context?: unknown; mode: AiMode }>,
): Promise<readonly AiToolResponse[]> => {
  const allowedTools = executor.registry.list().filter(tool => isToolAllowed(input.mode, tool))
  const calls = await provider.plan({ prompt: input.prompt, tools: allowedTools, context: input.context ?? executor.queries.getModelSummary() })
  return calls.map(call => executor.execute(call, input.mode))
}
