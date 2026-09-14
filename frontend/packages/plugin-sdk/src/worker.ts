import { PluginPanelClient } from './client.ts'
import { RPC_VERSION } from './contract.ts'
import type { CommandInvocation, CommandResult, WorkerReady } from './contract.ts'

export type CommandHandler = (api: PluginPanelClient) => unknown | Promise<unknown>
export type WorkerPort = Readonly<{
  postMessage: (message: unknown) => void
  addEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void
  removeEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void
}>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Register command handlers in a dedicated Worker and announce readiness. */
export function createWorkerPlugin(
  handlers: Readonly<Record<string, CommandHandler>>,
  port: WorkerPort = globalThis as unknown as WorkerPort,
): Readonly<{ api: PluginPanelClient; dispose: () => void }> {
  const commandIds = Object.keys(handlers)
  const api = new PluginPanelClient({
    transport: {
      post: message => port.postMessage(message),
      subscribe: listener => {
        const onMessage = (event: { data: unknown }) => listener(event.data)
        port.addEventListener('message', onMessage)
        return () => port.removeEventListener('message', onMessage)
      },
    },
  })
  let disposed = false
  const onCommand = (event: { data: unknown }) => {
    const message = event.data
    if (!isRecord(message) || message.v !== RPC_VERSION || message.kind !== 'command.invoke') return
    if (typeof message.id !== 'string' || typeof message.commandId !== 'string') return
    const request = message as CommandInvocation
    const handler = Object.prototype.hasOwnProperty.call(handlers, request.commandId)
      ? handlers[request.commandId] : undefined
    if (!handler) {
      port.postMessage({ v: RPC_VERSION, kind: 'command.result', id: request.id, ok: false,
        error: { code: 'UNKNOWN_COMMAND', message: `Unknown command ${request.commandId}` } } satisfies CommandResult)
      return
    }
    void Promise.resolve().then(() => handler(api)).then(value => {
      if (!disposed) port.postMessage({ v: RPC_VERSION, kind: 'command.result', id: request.id, ok: true, value } satisfies CommandResult)
    }, error => {
      if (!disposed) port.postMessage({ v: RPC_VERSION, kind: 'command.result', id: request.id, ok: false,
        error: { code: 'COMMAND_FAILED', message: error instanceof Error ? error.message : String(error) } } satisfies CommandResult)
    })
  }
  port.addEventListener('message', onCommand)
  port.postMessage({ v: RPC_VERSION, kind: 'plugin.ready', commands: commandIds } satisfies WorkerReady)
  return {
    api,
    dispose: () => {
      if (disposed) return
      disposed = true
      port.removeEventListener('message', onCommand)
      api.dispose()
    },
  }
}
