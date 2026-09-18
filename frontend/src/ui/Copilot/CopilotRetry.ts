export type CopilotTurnStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export type RetryableCopilotTurn = Readonly<{
  status?: CopilotTurnStatus
  retryCount?: number
}>

export const canRetryCopilotTurn = (turn: RetryableCopilotTurn, busy: boolean): boolean =>
  !busy && turn.status === 'failed' && (turn.retryCount ?? 0) < 1

export const copilotToolCallId = (logicalTurnId: string, round: number, callIndex: number): string =>
  `${logicalTurnId}:${round}:${callIndex}`
