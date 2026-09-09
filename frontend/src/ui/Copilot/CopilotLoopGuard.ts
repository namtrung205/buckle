import type { AiToolCall } from '../../core/ai'

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  )
  return value
}

export const copilotToolCallSignature = (call: Pick<AiToolCall, 'name' | 'arguments'>): string =>
  `${call.name}:${JSON.stringify(stableValue(call.arguments))}`

export const retainCopilotToolResults = <T>(previous: readonly T[], additions: readonly T[], limit = 40): T[] =>
  [...previous, ...additions].slice(-limit)

export const copilotContextConflictMessage = (plannedRevision: number, currentRevision: number, providerRevision: number): string | null => {
  if (currentRevision !== plannedRevision) return `Model changed while Copilot was planning (started at revision ${plannedRevision}, now ${currentRevision}). Review the latest model and retry.`
  if (providerRevision !== plannedRevision) return `Provider used stale model revision ${providerRevision}; current revision is ${currentRevision}. Retry with refreshed context.`
  return null
}

export const copilotPreviewConflictMessage = (previewRevision: number, currentRevision: number): string | null =>
  previewRevision === currentRevision ? null
    : `The proposed change is stale (previewed at revision ${previewRevision}, now ${currentRevision}). Review the latest model and preview again.`

/** Detect a repeated suffix such as A,A or A,B,A,B. */
export const repeatedCopilotToolCycle = (
  previousSignatures: readonly string[],
  proposedCalls: ReadonlyArray<Pick<AiToolCall, 'name' | 'arguments'>>,
  maxCycleLength = 3,
): string[] | null => {
  if (!previousSignatures.length || !proposedCalls.length) return null
  const signatures = [...previousSignatures, ...proposedCalls.map(copilotToolCallSignature)]
  const availableCycleLength = Math.min(maxCycleLength, Math.floor(signatures.length / 2))
  for (let cycleLength = 1; cycleLength <= availableCycleLength; cycleLength++) {
    const current = signatures.slice(-cycleLength)
    const previous = signatures.slice(-2 * cycleLength, -cycleLength)
    if (current.every((signature, index) => signature === previous[index])) return current
  }
  return null
}
