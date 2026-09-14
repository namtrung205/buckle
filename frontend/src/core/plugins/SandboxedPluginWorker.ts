import type { WorkerLike } from './WorkerRuntime.ts'

/** Plugin code runs in a data: module Worker created by an opaque-origin
 * sandboxed iframe. The iframe's CSP is inherited by that Worker, so it cannot
 * fetch app resources or make outbound connections. The iframe only proxies
 * structured messages; it never evaluates the plugin source itself. */
const ISOLATED_CSP = [
  "connect-src 'none'",
  "script-src 'unsafe-inline' data: blob:",
  'worker-src data:',
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "img-src 'none'",
  "media-src 'none'",
  "font-src 'none'",
  "style-src 'none'",
].join('; ')

const bootstrapHtml = (token: string): string => `<!doctype html>
<meta http-equiv="Content-Security-Policy" content="${ISOLATED_CSP}">
<script>
const token = ${JSON.stringify(token)};
let worker = null;
const send = (kind, fields = {}) => parent.postMessage({ token, kind, ...fields }, '*');
addEventListener('message', event => {
  const message = event.data;
  if (event.source !== parent || !message || message.token !== token) return;
  if (message.kind === 'worker.start' && !worker) {
    try {
      const bytes = new Uint8Array(message.bytes);
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 32768) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      }
      worker = new Worker('data:text/javascript;base64,' + btoa(binary), {
        type: 'module', credentials: 'omit',
      });
      worker.addEventListener('message', result => send('worker.message', { data: result.data }));
      worker.addEventListener('error', () => send('worker.error', { reason: 'error' }));
      worker.addEventListener('messageerror', () => send('worker.error', { reason: 'messageerror' }));
      send('worker.started');
    } catch (error) { send('worker.error', { reason: String(error) }); }
  } else if (message.kind === 'worker.message' && worker) {
    try { worker.postMessage(message.data); }
    catch (error) { send('worker.error', { reason: String(error) }); }
  } else if (message.kind === 'worker.stop') {
    worker?.terminate();
    worker = null;
  }
});
send('frame.ready');
</script>`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Browser implementation of the WorkerLike transport used by WorkerRuntime. */
export function spawnSandboxedPluginWorker(bytes: Uint8Array): WorkerLike {
  const token = [...crypto.getRandomValues(new Uint32Array(4))].map(value => value.toString(16)).join('-')
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.display = 'none'
  frame.srcdoc = bootstrapHtml(token)
  const messageListeners = new Set<(event: { data: unknown }) => void>()
  const errorListeners = new Set<(reason: string) => void>()
  const queued: unknown[] = []
  let stopped = false
  let started = false
  const timeout = setTimeout(() => fail('Plugin sandbox did not start'), 5_000)
  const send = (kind: string, fields: Record<string, unknown> = {}) =>
    frame.contentWindow?.postMessage({ token, kind, ...fields }, '*')
  const fail = (reason: string) => {
    if (stopped) return
    clearTimeout(timeout)
    for (const listener of errorListeners) listener(reason)
  }
  const onWindowMessage = (event: MessageEvent) => {
    if (stopped || event.source !== frame.contentWindow || !isRecord(event.data) ||
      event.data.token !== token) return
    const message = event.data
    if (message.kind === 'frame.ready') {
      send('worker.start', { bytes: new Uint8Array(bytes) })
    } else if (message.kind === 'worker.started') {
      clearTimeout(timeout)
      started = true
      for (const data of queued.splice(0)) send('worker.message', { data })
    } else if (message.kind === 'worker.message') {
      for (const listener of messageListeners) listener({ data: message.data })
    } else if (message.kind === 'worker.error') {
      fail(typeof message.reason === 'string' ? message.reason : 'Plugin Worker error')
    }
  }
  window.addEventListener('message', onWindowMessage)
  document.body.appendChild(frame)
  return {
    postMessage: data => {
      if (stopped) throw new Error('Plugin sandbox stopped')
      if (started) send('worker.message', { data })
      else queued.push(data)
    },
    terminate: () => {
      if (stopped) return
      stopped = true
      clearTimeout(timeout)
      send('worker.stop')
      window.removeEventListener('message', onWindowMessage)
      frame.remove()
      queued.length = 0
      messageListeners.clear()
      errorListeners.clear()
    },
    addEventListener: (_type, listener) => { messageListeners.add(listener) },
    removeEventListener: (_type, listener) => { messageListeners.delete(listener) },
    onError: listener => {
      errorListeners.add(listener)
      return () => { errorListeners.delete(listener) }
    },
  }
}
