import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { parseZipBundle } from '../src/bundle.ts'
import type { PluginLaunchDeps } from '../../../src/core/plugins/PluginBundleLoader.ts'
import { InstalledBundleManager } from '../../../src/core/plugins/InstalledBundleManager.ts'
import type { InstalledBundleRecord, PluginInstallStore } from '../../../src/core/plugins/PluginInstallStore.ts'
import type { PluginCommandBroker } from '../../../src/core/plugins/PluginHostApi.ts'
import type { ContributionBundle } from '../../../src/core/plugins/types.ts'
import type { WorkerLike } from '../../../src/core/plugins/WorkerRuntime.ts'

const packageDir = fileURLToPath(new URL('..', import.meta.url))

async function npm(args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const npmCli = process.env.npm_execpath
    const child = spawn(npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm',
      npmCli ? [npmCli, ...args] : [...args], {
      cwd, shell: !npmCli && process.platform === 'win32', windowsHide: true,
      env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
    })
    let output = ''
    child.stdout.on('data', chunk => { output += String(chunk) })
    child.stderr.on('data', chunk => { output += String(chunk) })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`npm ${args[0]} failed (${code}): ${output}`)))
  })
}

/** Executes the CLI-produced, self-contained Worker with the host's real RPC
 * runtime. Only the browser transport is replaced by an in-memory message port. */
function vmWorker(bytes: Uint8Array): WorkerLike {
  const hostListeners = new Set<(event: { data: unknown }) => void>()
  const pluginListeners = new Set<(event: { data: unknown }) => void>()
  let stopped = false
  const port: Record<string, unknown> = {
    setTimeout, clearTimeout, TextEncoder, TextDecoder, crypto, console,
    postMessage: (data: unknown) => queueMicrotask(() => {
      if (!stopped) for (const listener of hostListeners) listener({ data })
    }),
    addEventListener: (_type: string, listener: (event: { data: unknown }) => void) => { pluginListeners.add(listener) },
    removeEventListener: (_type: string, listener: (event: { data: unknown }) => void) => { pluginListeners.delete(listener) },
  }
  port.self = port
  runInNewContext(new TextDecoder().decode(bytes), port, { timeout: 5_000 })
  return {
    postMessage: data => queueMicrotask(() => {
      if (!stopped) for (const listener of pluginListeners) listener({ data })
    }),
    terminate: () => { stopped = true; pluginListeners.clear(); hostListeners.clear() },
    addEventListener: (_type, listener) => { hostListeners.add(listener) },
    removeEventListener: (_type, listener) => { hostListeners.delete(listener) },
  }
}

test('packed SDK builds an installable ZIP from a clean external starter', { timeout: 180_000 }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'buckle-sdk-external-'))
  const project = join(base, 'third-party-plugin')
  try {
    await npm(['pack', '--pack-destination', base], packageDir)
    const tarballs = (await readdir(base)).filter(name => name.endsWith('.tgz'))
    assert.equal(tarballs.length, 1)
    const tarball = join(base, tarballs[0])
    await npm(['exec', '--yes', '--package', tarball, '--', 'buckle-plugin', 'init', project], base)
    await npm(['install', tarball], project)
    assert.match(await readFile(join(project, 'node_modules', '@buckle', 'plugin-sdk', 'DEVELOPER_GUIDE.vi.md'), 'utf8'), /Plugin Manager/)
    await npm(['run', 'check'], project)
    await npm(['run', 'build'], project)
    const zip = await readFile(join(project, 'dist', 'com.example.third-party-plugin-0.1.0.zip'))
    const bundle = parseZipBundle(zip, 'external starter')
    assert.equal(bundle.manifest.id, 'com.example.third-party-plugin')
    assert.deepEqual([...bundle.files.keys()].sort(), ['buckle.plugin.json', 'panel.html', 'worker.js'])
    assert.match(new TextDecoder().decode(bundle.files.get('worker.js')), /plugin\.ready/)
    assert.match(new TextDecoder().decode(bundle.files.get('panel.html')), /Read model/)

    const notices: string[] = []
    const opened: string[] = []
    let contributions: ContributionBundle | undefined
    const deps: PluginLaunchDeps = {
      createSession: () => ({
        query: () => ({ nodes: [{ id: 'n1' }], members: [] }),
        notify: (message: string) => { notices.push(message) },
        openPanel: (panelId: string) => { opened.push(panelId) },
      }) as unknown as PluginCommandBroker,
      spawnWorker: vmWorker,
      createPanelUrl: () => 'blob:external-panel',
      register: (_owner, next) => { contributions = next; return () => { contributions = undefined } },
      setSession: () => {},
    }
    const records = new Map<string, InstalledBundleRecord>()
    const store: PluginInstallStore = {
      list: async () => [...records.values()],
      put: async record => { records.set(record.id, record) },
      delete: async id => { records.delete(id) },
    }
    const manager = () => new InstalledBundleManager({
      store, deps, onChange: () => {}, onFailure: message => assert.fail(message),
    })
    const installed = manager()
    await installed.install(zip, 'external starter')
    assert.equal(installed.list()[0].enabled, true)
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.match(notices[0] ?? '', /1 nodes/)
    assert.equal(contributions?.ribbon?.length, 1)
    await contributions?.commands?.[0]?.execute()
    assert.deepEqual(opened, ['com.example.third-party-plugin.panel'])
    installed.dispose()
    const restored = manager()
    await restored.restore()
    assert.equal(restored.list()[0].enabled, true)
    for (let attempt = 0; notices.length < 2 && attempt < 50; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.equal(notices.length, 2)
    await restored.disable(bundle.manifest.id)
    assert.equal(contributions, undefined)
    await restored.uninstall(bundle.manifest.id)
    assert.equal(records.size, 0)
    restored.dispose()
  } finally { await rm(base, { recursive: true, force: true }) }
})
