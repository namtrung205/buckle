import {
  DEFAULT_CALL_TIMEOUT_MS,
  RPC_VERSION,
} from './index.ts';
import type { RpcMethod } from './index.ts';

/**
 * Typed client a sandboxed plugin panel uses to talk to the host over the
 * validated MessageChannel RPC protocol (Goal 5). Wire format is identical to
 * the host's `rpc.ts` envelopes but this module is dependency-free so plugin
 * packages build without importing Buckle internals (Goal 5 exit gate).
 */
export type PanelTransport = Readonly<{
  /** Deliver one raw message to the host (e.g. `window.parent.postMessage`). */
  post: (message: unknown) => void
  /** Subscribe to raw host messages; return an idempotent unsubscribe. */
  subscribe: (listener: (message: unknown) => void) => () => void
}>

export class RpcCallError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'RpcCallError'
    this.code = code
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export class PluginPanelClient {
  private readonly transport: PanelTransport
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private nextId = 0
  private readonly timeoutMs: number
  private disposed = false

  constructor(options: Readonly<{ transport: PanelTransport; callTimeoutMs?: number }>) {
    this.transport = options.transport
    this.timeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
    this.transport.subscribe(message => this.onMessage(message))
  }

  /** Standard panel transport: `window.parent` + the window message event. */
  static forParentWindow(timeoutMs?: number): PluginPanelClient {
    return new PluginPanelClient({
      transport: {
        post: message => window.parent.postMessage(message, '*'),
        subscribe: listener => {
          const handler = (event: MessageEvent) => listener(event.data)
          window.addEventListener('message', handler)
          return () => window.removeEventListener('message', handler)
        },
      },
      ...(timeoutMs !== undefined ? { callTimeoutMs: timeoutMs } : {}),
    })
  }

  /** Call one host method; rejects with `RpcCallError` on structured failure,
   *  timeout or protocol garbage. Unknown methods fail closed client-side. */
  call(method: RpcMethod, params?: Record<string, unknown>): Promise<unknown> {
    if (this.disposed) return Promise.reject(new RpcCallError('DISPOSED', 'Client was disposed'))
    const id = `call-${++this.nextId}`
    const envelope = params === undefined
      ? { v: RPC_VERSION, id, method }
      : { v: RPC_VERSION, id, method, params }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new RpcCallError('TIMEOUT', `${method} timed out`))
      }, this.timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.transport.post(envelope)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new RpcCallError('REJECTED', String(error)))
      }
    })
  }

  query(): Promise<unknown> {
    return this.call('model.query')
  }

  execute(command: unknown, expectedModelRevision?: number): Promise<unknown> {
    return this.call('model.execute', expectedModelRevision === undefined
      ? { command }
      : { command, expectedModelRevision })
  }

  notify(message: string, kind: 'info' | 'success' | 'error' = 'info'): Promise<void> {
    return this.call('ui.notify', { message, kind }).then(() => undefined)
  }

  openPanel(panelId: string): Promise<void> {
    return this.call('ui.openPanel', { panelId }).then(() => undefined)
  }

  storageGet(scope: 'project' | 'local', key: string): Promise<unknown> {
    return this.call('storage.get', { scope, key })
  }

  storageSet(scope: 'project' | 'local', key: string, value: unknown): Promise<void> {
    return this.call('storage.set', { scope, key, value }).then(() => undefined)
  }

  storageDelete(scope: 'project' | 'local', key: string): Promise<void> {
    return this.call('storage.delete', { scope, key }).then(() => undefined)
  }

  storageKeys(scope: 'project' | 'local'): Promise<readonly string[]> {
    return this.call('storage.keys', { scope }).then(value => (Array.isArray(value) ? value : []))
  }

  /** Reject all pending calls and detach the listener (panel unmount). */
  dispose() {
    this.disposed = true
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new RpcCallError('DISPOSED', 'Client was disposed'))
      this.pending.delete(id)
    }
  }

  private onMessage(message: unknown) {
    if (!isRecord(message) || message.v !== RPC_VERSION || typeof message.id !== 'string') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.ok === true) pending.resolve(message.value)
    else if (isRecord(message.error) && typeof message.error.code === 'string') {
      pending.reject(new RpcCallError(String(message.error.code), String(message.error.message ?? 'Rejected')))
    } else pending.reject(new RpcCallError('REJECTED', 'Malformed result envelope'))
  }
}
