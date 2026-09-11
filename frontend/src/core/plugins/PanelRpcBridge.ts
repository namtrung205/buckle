import { RpcProtocolError } from './rpc.ts'
import type { RpcMethod } from './rpc.ts'
import { SandboxDispatcher, isTrustedPanelSource } from './sandbox.ts'
import type { SandboxHandler } from './sandbox.ts'
import type { PluginCommandBroker, PluginMutationRequest } from './PluginHostApi.ts'
import type { StructuralCommand } from '../structural/commands.ts'

/** Host-side sandboxed-iframe runtime (Goal 4). One bridge per open panel:
 *  it listens for postMessage traffic, authenticates the *source window*
 *  (a sandboxed iframe's origin is opaque/"null"), routes validated calls
 *  through the shared `SandboxDispatcher` and posts structured envelopes
 *  back. Replies use `'*'` because the iframe's origin is unknowable — the
 *  trust anchor is the source-window identity, not the origin string. */

/** Minimal reply surface (the sandboxed iframe's contentWindow). */
export type PanelWindowLike = Readonly<{
  postMessage: (message: unknown, targetOrigin: string) => void
}>

/** Minimal inbound message surface (`MessageEvent` compatible subset). */
export type PanelMessageLike = Readonly<{ source: unknown; data: unknown }>

export type PanelRpcBridgeOptions = Readonly<{
  /** The panel's contentWindow — both the trust anchor and the reply target. */
  panel: PanelWindowLike
  /** Handler per whitelisted RPC method (bound to the plugin's broker session). */
  handlers: Partial<Record<RpcMethod, SandboxHandler>>
  budget?: import('./rpc.ts').RpcBudget
  callTimeoutMs?: number
  /** Sandboxed iframes have opaque origins; replies use '*' by default. */
  targetOrigin?: string
  /** Injected subscription seam (app: window.addEventListener('message')). */
  subscribe: (listener: (event: PanelMessageLike) => void) => () => void
  onViolation?: (code: string, message: string) => void
}>

export class PanelRpcBridge {
  private readonly options: PanelRpcBridgeOptions
  private readonly dispatcher: SandboxDispatcher
  private readonly unsubscribe: () => void
  private closed = false

  constructor(options: PanelRpcBridgeOptions) {
    this.options = options
    this.dispatcher = new SandboxDispatcher({
      handlers: options.handlers,
      ...(options.budget !== undefined ? { budget: options.budget } : {}),
      ...(options.callTimeoutMs !== undefined ? { callTimeoutMs: options.callTimeoutMs } : {}),
      onViolation: options.onViolation ?? (() => {}),
    })
    this.unsubscribe = options.subscribe(event => this.handle(event))
  }

  private handle(event: PanelMessageLike) {
    if (this.closed) return
    // Fail closed on anything not originating from exactly this panel window.
    if (!isTrustedPanelSource(event.source, this.options.panel)) return
    const reply = this.dispatcher.handle(event.data)
    if (reply === null) return
    void Promise.resolve(reply).then(envelope => {
      if (this.closed) return
      this.options.panel.postMessage(envelope, this.options.targetOrigin ?? '*')
    })
  }

  /** Detach the listener; later messages are ignored. Idempotent. */
  close() {
    if (this.closed) return
    this.closed = true
    this.unsubscribe()
  }

  get isClosed(): boolean {
    return this.closed
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const NOTIFICATION_KINDS = ['info', 'success', 'error'] as const

/**
 * Bind a plugin's broker session to the closed RPC method table. Every method
 * goes through the broker's own permission gate, so a sandbox panel can never
 * reach anything its manifest does not grant (fail closed at both layers).
 */
export const brokerRpcHandlers = (session: PluginCommandBroker): Partial<Record<RpcMethod, SandboxHandler>> => ({
  'model.query': () => session.query(),
  'model.execute': ({ params }) => {
    if (!isRecord(params) || !isRecord(params.command) || typeof params.command.type !== 'string') {
      throw new RpcProtocolError('INVALID_PARAMS', 'model.execute requires { command: { type, payload? } }')
    }
    const request: PluginMutationRequest = {
      command: params.command as unknown as StructuralCommand,
      ...(params.expectedModelRevision === undefined ? {} : { expectedModelRevision: params.expectedModelRevision as number }),
      ...(params.approval === true ? { approval: true } : {}),
    }
    return session.execute(request)
  },
  'ui.notify': ({ params }) => {
    if (!isRecord(params) || typeof params.message !== 'string') {
      throw new RpcProtocolError('INVALID_PARAMS', 'ui.notify requires { message, kind? }')
    }
    const kind = (NOTIFICATION_KINDS as readonly string[]).includes(params.kind as string)
      ? params.kind as (typeof NOTIFICATION_KINDS)[number]
      : 'info'
    session.notify(params.message, kind)
    return undefined
  },
  'ui.openPanel': ({ params }) => {
    if (!isRecord(params) || typeof params.panelId !== 'string') {
      throw new RpcProtocolError('INVALID_PARAMS', 'ui.openPanel requires { panelId }')
    }
    session.openPanel(params.panelId)
    return undefined
  },
})
