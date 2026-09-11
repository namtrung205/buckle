import { RpcBudget } from './rpc.ts'
import type { RpcMethod } from './rpc.ts'
import { SandboxDispatcher } from './sandbox.ts'
import type { SandboxHandler } from './sandbox.ts'

/** Host-side Worker runtime (Goal 4). Binds a dedicated worker transport to the
 *  shared `SandboxDispatcher` so the sandboxed plugin code only ever sees
 *  structured result envelopes — never host objects (design rule 4). The
 *  worker surface is injected, so the runtime stays node-testable; the app
 *  spawns a real `new Worker(url, { type: 'module' })`. */

/** Minimal worker surface the runtime needs (DedicatedWorker compatible). */
export type WorkerLike = Readonly<{
  postMessage: (message: unknown) => void
  terminate: () => void
  addEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void
  removeEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void
}>

export type WorkerRuntimeOptions = Readonly<{
  /** Creates the worker transport (app: `new Worker(url, { type: 'module' })`). */
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
  private violations = 0
  private terminated = false

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
      const result = this.dispatcher.handle(event.data)
      if (result === null) return
      void Promise.resolve(result).then(envelope => {
        if (!this.terminated) this.worker.postMessage(envelope)
      })
    }
    this.worker.addEventListener('message', this.listener)
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
    this.worker.removeEventListener('message', this.listener)
    this.worker.terminate()
    this.options.onCrash?.(reason)
  }

  get isTerminated(): boolean {
    return this.terminated
  }
}
