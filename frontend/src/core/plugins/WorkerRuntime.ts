import { RpcBudget } from './rpc.ts'
import type { RpcMethod } from './rpc.ts'
import { SandboxDispatcher } from './sandbox.ts'
import type { SandboxHandler } from './sandbox.ts'
import { RPC_VERSION } from '../../../packages/plugin-sdk/src/contract.ts'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Host-side Worker runtime (Goal 4). Binds a dedicated worker transport to the
 *  shared `SandboxDispatcher` so the sandboxed plugin code only ever sees
 *  structured result envelopes — never host objects (design rule 4). The
 *  worker surface is injected, so the runtime stays node-testable; the app
 *  supplies its isolated browser Worker transport. */

/** Minimal worker surface the runtime needs (DedicatedWorker compatible). */
export type WorkerLike = Readonly<{
  postMessage: (message: unknown) => void
  terminate: () => void
  addEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void
  removeEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void
  /** Browser error/messageerror subscription; optional for protocol fixtures. */
  onError?: (listener: (reason: string) => void) => () => void
}>

export type WorkerRuntimeOptions = Readonly<{
  /** Creates the worker transport (app: opaque-origin sandbox). */
  spawn: () => WorkerLike
  /** Handler per whitelisted RPC method (bound to the plugin's broker session). */
  handlers: Partial<Record<RpcMethod, SandboxHandler>>
  budget?: RpcBudget
  callTimeoutMs?: number
  /** Terminate the worker after this many fail-closed protocol violations
   *  (malformed/oversized/unknown traffic). 0 or undefined disables the cap. */
  maxViolations?: number
  /** Crash feed for the host's `PluginManager.reportCrash`. */
  onCrash?: (reason: string) => void
  onViolation?: (code: string, message: string) => void
}>

export class WorkerRuntime {
  private readonly worker: WorkerLike
  private readonly dispatcher: SandboxDispatcher
  private readonly options: WorkerRuntimeOptions
  private readonly listener: (event: { data: unknown }) => void
  private removeErrorListener: () => void = () => {}
  private violations = 0
  private terminated = false
  private readyCommands: readonly string[] | null = null
  private readyResolve: ((commands: readonly string[]) => void) | null = null
  private readyReject: ((error: Error) => void) | null = null
  private readonly pending = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private nextInvocation = 0

  constructor(options: WorkerRuntimeOptions) {
    this.options = options
    this.worker = options.spawn()
    this.dispatcher = new SandboxDispatcher({
      handlers: options.handlers,
      ...(options.budget !== undefined ? { budget: options.budget } : {}),
      ...(options.callTimeoutMs !== undefined ? { callTimeoutMs: options.callTimeoutMs } : {}),
      onViolation: (code, message) => this.handleViolation(code, message),
    })
    this.listener = (event: { data: unknown }) => {
      if (this.terminated) return
      if (this.handleControlMessage(event.data)) return
      const result = this.dispatcher.handle(event.data)
      if (result === null) return
      void Promise.resolve(result).then(envelope => {
        if (!this.terminated) this.worker.postMessage(envelope)
      })
    }
    this.worker.addEventListener('message', this.listener)
    this.removeErrorListener = this.worker.onError?.(reason => this.terminate(reason)) ?? (() => {})
  }

  private handleControlMessage(value: unknown): boolean {
    if (!isRecord(value) || typeof value.kind !== 'string') return false
    if (value.kind === 'plugin.ready') {
      if (value.v !== RPC_VERSION || !Array.isArray(value.commands) ||
        !value.commands.every(command => typeof command === 'string') ||
        new Set(value.commands).size !== value.commands.length || this.readyCommands !== null) {
        this.options.onViolation?.('INVALID_READY', 'Invalid Worker readiness message')
        return true
      }
      this.readyCommands = [...value.commands]
      this.readyResolve?.(this.readyCommands)
      this.readyResolve = null
      this.readyReject = null
      return true
    }
    if (value.kind === 'command.result') {
      if (value.v !== RPC_VERSION || typeof value.id !== 'string') return true
      const entry = this.pending.get(value.id)
      if (!entry) return true
      clearTimeout(entry.timer)
      this.pending.delete(value.id)
      if (value.ok === true) entry.resolve()
      else if (value.ok === false && isRecord(value.error) && typeof value.error.message === 'string') {
        entry.reject(new Error(value.error.message))
      } else entry.reject(new Error('Malformed command result'))
      return true
    }
    return false
  }

  /** Wait for the Worker to register its command handlers before exposing UI. */
  waitReady(timeoutMs = 5_000): Promise<readonly string[]> {
    if (this.terminated) return Promise.reject(new Error('Plugin Worker stopped'))
    if (this.readyCommands) return Promise.resolve(this.readyCommands)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.readyResolve = null
        this.readyReject = null
        reject(new Error('Plugin Worker did not become ready'))
      }, timeoutMs)
      this.readyResolve = commands => { clearTimeout(timer); resolve(commands) }
      this.readyReject = error => { clearTimeout(timer); reject(error) }
    })
  }

  async invokeCommand(commandId: string, timeoutMs = 5_000): Promise<void> {
    if (this.terminated) throw new Error('Plugin Worker stopped')
    if (!this.readyCommands?.includes(commandId)) throw new Error(`Plugin did not register ${commandId}`)
    const id = `invoke-${++this.nextInvocation}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Plugin command ${commandId} timed out`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.worker.postMessage({ v: RPC_VERSION, kind: 'command.invoke', id, commandId })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private handleViolation(code: string, message: string) {
    this.options.onViolation?.(code, message)
    const cap = this.options.maxViolations ?? 0
    if (cap <= 0 || this.terminated) return
    this.violations += 1
    if (this.violations >= cap) {
      this.terminate(`violation budget exhausted (${code}: ${message})`)
    }
  }

  /** Tear the worker down and stop answering its messages. Idempotent. */
  terminate(reason = 'terminated') {
    if (this.terminated) return
    this.terminated = true
    this.readyReject?.(new Error(`Plugin Worker ${reason}`))
    this.readyResolve = null
    this.readyReject = null
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error(`Plugin Worker ${reason}`))
    }
    this.pending.clear()
    this.worker.removeEventListener('message', this.listener)
    this.removeErrorListener()
    this.worker.terminate()
    this.options.onCrash?.(reason)
  }

  get isTerminated(): boolean {
    return this.terminated
  }
}
