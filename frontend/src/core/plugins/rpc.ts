import { PLUGIN_API_VERSION } from './manifest.ts'

/** Schema-validated MessageChannel RPC wire protocol (Goal 4). Every message
 *  crossing the sandbox boundary is parsed and validated here — malformed
 *  envelopes, unknown methods and oversized/over-budget traffic fail closed. */

export const RPC_VERSION = PLUGIN_API_VERSION
export const MAX_RPC_MESSAGE_BYTES = 256 * 1024
export const MAX_RPC_CALLS_PER_WINDOW = 60
export const RPC_RATE_WINDOW_MS = 1_000
export const MAX_RPC_CALL_MS = 5_000

export type RpcRequest = Readonly<{ v: number; id: string; method: RpcMethod; params?: unknown }>
export type RpcError = Readonly<{ code: string; message: string }>
export type RpcResult =
  | Readonly<{ v: number; id: string; ok: true; value: unknown }>
  | Readonly<{ v: number; id: string; ok: false; error: RpcError }>

export class RpcProtocolError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'RpcProtocolError'
    this.code = code
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Per-host-API surface parameter validators. Params are untrusted: anything
 *  beyond the declared shape is rejected before the handler sees it. */
export type RpcParamSpec =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'object'; optional?: boolean; maxBytes?: number }>

/** The closed host API surface a sandbox may call (exit gate: no DOM, storage,
 *  token or raw-model accessors exist on this table). */
export const RPC_METHODS = {
  'model.query': { params: { kind: 'none' } },
  'model.execute': { params: { kind: 'object', optional: false, maxBytes: MAX_RPC_MESSAGE_BYTES } },
  'ui.notify': { params: { kind: 'object', optional: false, maxBytes: 4096 } },
  'ui.openPanel': { params: { kind: 'object', optional: false, maxBytes: 1024 } },
} as const

export type RpcMethod = keyof typeof RPC_METHODS

const byteLength = (value: unknown): number => {
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export const isRpcMethod = (value: string): value is RpcMethod =>
  Object.prototype.hasOwnProperty.call(RPC_METHODS, value)

/** Validate params against the method's declared spec. */
export const validateRpcParams = (method: RpcMethod, params: unknown) => {
  const spec = RPC_METHODS[method].params
  if (spec.kind === 'none') {
    if (params !== undefined) throw new RpcProtocolError('INVALID_PARAMS', `${method} takes no params`)
    return
  }
  if (params === undefined) {
    if (!spec.optional) throw new RpcProtocolError('INVALID_PARAMS', `${method} requires a params object`)
    return
  }
  if (!isRecord(params)) throw new RpcProtocolError('INVALID_PARAMS', `${method} params must be an object`)
  if (spec.maxBytes !== undefined && byteLength(params) > spec.maxBytes) {
    throw new RpcProtocolError('MESSAGE_TOO_LARGE', `${method} params exceed ${spec.maxBytes} bytes`)
  }
}

/**
 * Parse an untrusted wire message into a validated request. Every failure
 * mode is a structured, fail-closed rejection (Goal 4 exit gate).
 */
export function parseRpcRequest(raw: unknown, sizeLimit = MAX_RPC_MESSAGE_BYTES): RpcRequest {
  if (!isRecord(raw)) throw new RpcProtocolError('MALFORMED_ENVELOPE', 'RPC message must be an object')
  const unknownKeys = Object.keys(raw).filter(key => !['v', 'id', 'method', 'params'].includes(key))
  if (unknownKeys.length) throw new RpcProtocolError('MALFORMED_ENVELOPE', `Unknown RPC key(s): ${unknownKeys.join(', ')}`)
  if (raw.v !== RPC_VERSION) throw new RpcProtocolError('MALFORMED_ENVELOPE', `RPC version must be ${RPC_VERSION}`)
  if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 128) {
    throw new RpcProtocolError('MALFORMED_ENVELOPE', 'RPC id must be a non-empty string of at most 128 characters')
  }
  if (typeof raw.method !== 'string' || !isRpcMethod(raw.method)) {
    throw new RpcProtocolError('UNKNOWN_METHOD', `Unknown RPC method "${String(raw.method)}"`)
  }
  if (byteLength(raw) > sizeLimit) throw new RpcProtocolError('MESSAGE_TOO_LARGE', `RPC message exceeds ${sizeLimit} bytes`)
  const request = raw.params === undefined
    ? { v: raw.v as number, id: raw.id, method: raw.method }
    : { v: raw.v as number, id: raw.id, method: raw.method, params: raw.params }
  validateRpcParams(request.method, request.params)
  return request
}

/** Build a result envelope (never throws — errors become structured rejections). */
export const rpcSuccess = (id: string, value: unknown): RpcResult => ({ v: RPC_VERSION, id, ok: true, value })
export const rpcFailure = (id: string, code: string, message: string): RpcResult =>
  ({ v: RPC_VERSION, id, ok: false, error: { code, message } })
export const rpcErrorResult = (id: string, error: unknown): RpcResult =>
  error instanceof RpcProtocolError
    ? rpcFailure(id, error.code, error.message)
    : rpcFailure(id, 'REJECTED', error instanceof Error ? error.message : String(error))

/**
 * Rate + message budget guard shared by every sandbox channel. Time budgets use
 * an injected clock so the guard stays node-testable.
 */
export class RpcBudget {
  private windowStart: number
  private windowCount = 0
  private readonly options: Readonly<{
    maxCalls?: number
    windowMs?: number
    sizeLimit?: number
    now?: () => number
  }>
  constructor(options: Readonly<{
    maxCalls?: number
    windowMs?: number
    sizeLimit?: number
    now?: () => number
  }> = {}) {
    this.options = options
    this.windowStart = this.now()
  }
  private get now() {
    return this.options.now ?? Date.now
  }
  /** Count one inbound message; throws before a malformed message reaches handlers. */
  countMessage(bytes: number) {
    const limit = this.options.sizeLimit ?? MAX_RPC_MESSAGE_BYTES
    if (bytes > limit) throw new RpcProtocolError('MESSAGE_TOO_LARGE', `Message of ${bytes} bytes exceeds ${limit}`)
    const now = this.now()
    if (now - this.windowStart >= (this.options.windowMs ?? RPC_RATE_WINDOW_MS)) {
      this.windowStart = now
      this.windowCount = 0
    }
    this.windowCount += 1
    if (this.windowCount > (this.options.maxCalls ?? MAX_RPC_CALLS_PER_WINDOW)) {
      throw new RpcProtocolError('RATE_EXCEEDED', `More than ${this.options.maxCalls ?? MAX_RPC_CALLS_PER_WINDOW} calls in a rate window`)
    }
  }
}
