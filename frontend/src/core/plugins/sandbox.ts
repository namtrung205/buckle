import {
  MAX_RPC_CALL_MS,
  RpcBudget,
  parseRpcRequest,
  rpcErrorResult,
  rpcFailure,
} from './rpc.ts'
import type { RpcMethod, RpcRequest, RpcResult } from './rpc.ts'

/** Host-side sandbox plumbing (Goal 4): the pure dispatch core shared by the
 *  Worker runtime and the sandboxed iframe runtime, plus crash-loop tracking.
 *  All decisions (parse, budget, timeout) run host-side; the sandbox only ever
 *  sees structured results, never host objects (design rule 4). */

export type SandboxCallContext = Readonly<{ method: RpcMethod; params: unknown }>
export type SandboxHandler = (context: SandboxCallContext) => unknown | Promise<unknown>

export type SandboxDispatcherOptions = Readonly<{
  /** Handler per whitelisted method — missing handlers answer UNAVAILABLE. */
  handlers: Partial<Record<RpcMethod, SandboxHandler>>
  /** Shared inbound budget (size + rate). */
  budget?: RpcBudget
  /** Per-call execution budget; a hung handler answers TIMEOUT. */
  callTimeoutMs?: number
  /** Injected timer factory for deterministic tests (default setTimeout). */
  scheduleTimeout?: (ms: number, fn: () => void) => () => void
  /** Called on every fail-closed violation (host may terminate the sandbox). */
  onViolation?: (code: string, message: string) => void
}>

/**
 * Validates and dispatches untrusted sandbox requests against the closed
 * method table. Malformed or over-budget input never reaches a handler
 * (Goal 4 exit gate: malformed and unknown RPC requests fail closed).
 */
export class SandboxDispatcher {
  private readonly handlers: Partial<Record<RpcMethod, SandboxHandler>>
  private readonly budget: RpcBudget
  private readonly callTimeoutMs: number
  private readonly scheduleTimeout: (ms: number, fn: () => void) => () => void
  private readonly onViolation: (code: string, message: string) => void

  constructor(options: SandboxDispatcherOptions) {
    this.handlers = options.handlers
    this.budget = options.budget ?? new RpcBudget()
    this.callTimeoutMs = options.callTimeoutMs ?? MAX_RPC_CALL_MS
    this.scheduleTimeout = options.scheduleTimeout ?? ((ms, fn) => {
      const timer = setTimeout(fn, ms)
      return () => clearTimeout(timer)
    })
    this.onViolation = options.onViolation ?? (() => {})
  }

  /** Process one inbound message. Returns the result envelope to post back, or
   *  null when the message is undeliverable (no id to route a reply to). */
  handle(raw: unknown): RpcResult | Promise<RpcResult> | null {
    let bytes = 0
    try {
      bytes = JSON.stringify(raw)?.length ?? 0
      this.budget.countMessage(bytes)
    } catch (error) {
      // Budget rejections are still answerable when the envelope carries an id.
      this.violate(error)
      const id = (typeof (raw as { id?: unknown })?.id === 'string') ? (raw as { id: string }).id : null
      return id ? rpcErrorResult(id, error) : null
    }
    let request: RpcRequest
    try {
      request = parseRpcRequest(raw)
    } catch (error) {
      this.violate(error)
      const id = (typeof (raw as { id?: unknown })?.id === 'string') ? (raw as { id: string }).id : null
      return id ? rpcErrorResult(id, error) : null
    }
    const handler = this.handlers[request.method]
    if (!handler) {
      const message = `No handler for "${request.method}"`
      this.onViolation('UNAVAILABLE', message)
      return rpcFailure(request.id, 'UNAVAILABLE', message)
    }
    try {
      const value = handler({ method: request.method, params: request.params })
      return this.settle(request.id, value)
    } catch (error) {
      return rpcErrorResult(request.id, error)
    }
  }

  /** Wrap a (possibly async) handler value under the per-call time budget. */
  private settle(id: string, value: unknown): RpcResult | Promise<RpcResult> {
    if (value === null || value === undefined || typeof (value as { then?: unknown }).then !== 'function') {
      return { v: 1, id, ok: true, value }
    }
    return new Promise<RpcResult>(resolve => {
      let settled = false
      const done = (result: RpcResult) => {
        if (settled) return
        settled = true
        cancel()
        resolve(result)
      }
      const cancel = this.scheduleTimeout(this.callTimeoutMs, () =>
        done({ v: 1, id, ok: false, error: { code: 'TIMEOUT', message: `Call exceeded ${this.callTimeoutMs}ms` } }))
      Promise.resolve(value).then(
        resolved => done({ v: 1, id, ok: true, value: resolved }),
        error => done(rpcErrorResult(id, error)),
      )
    })
  }

  private violate(error: unknown) {
    const code = error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : 'REJECTED'
    const message = error instanceof Error ? error.message : String(error)
    this.onViolation(code, message)
  }
}

/**
 * Crash-loop detection (Goal 4): a plugin that crashes repeatedly inside the
 * window is quarantined so a faulty plugin can never wedge the host.
 */
export class CrashLoopTracker {
  private readonly crashes = new Map<string, number[]>()
  private readonly quarantined = new Set<string>()
  private readonly options: Readonly<{
    maxCrashes?: number
    windowMs?: number
    now?: () => number
  }>
  constructor(options: Readonly<{
    maxCrashes?: number
    windowMs?: number
    now?: () => number
  }> = {}) {
    this.options = options
  }
  private get now() {
    return this.options.now ?? Date.now
  }
  /** Record one crash; returns true when the plugin just became quarantined. */
  reportCrash(pluginId: string): boolean {
    if (this.quarantined.has(pluginId)) return false
    const now = this.now()
    const window = this.options.windowMs ?? 30_000
    const recent = (this.crashes.get(pluginId) ?? []).filter(at => now - at < window)
    recent.push(now)
    this.crashes.set(pluginId, recent)
    if (recent.length >= (this.options.maxCrashes ?? 3)) {
      this.quarantined.add(pluginId)
      return true
    }
    return false
  }
  isQuarantined(pluginId: string): boolean {
    return this.quarantined.has(pluginId)
  }
  /** Manual release (e.g. the user re-enables the plugin from safe mode UI). */
  release(pluginId: string) {
    this.quarantined.delete(pluginId)
    this.crashes.delete(pluginId)
  }
}

/** Panel trust check (iframe runtime): a sandboxed iframe's origin is opaque
 *  ("null"), so the host authenticates the *source window* instead. */
export const isTrustedPanelSource = (eventSource: unknown, panelWindow: unknown): boolean =>
  eventSource !== null && eventSource !== undefined && eventSource === panelWindow
