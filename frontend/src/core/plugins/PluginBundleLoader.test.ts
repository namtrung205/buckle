import { test } from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, strToU8, strFromU8 } from 'fflate'
import {
  parseWorkerFile,
  parseZipBundle,
  launchBundledPlugin,
  isSelfContainedHtml,
  PluginLoadError,
} from './PluginBundleLoader.ts'
import type { BundledPlugin } from './PluginBundleLoader.ts'
import type { WorkerLike } from './WorkerRuntime.ts'
import type { ContributionBundle, ContributionOwner } from './types.ts'
import type { PluginCommandBroker } from './PluginHostApi.ts'

const workerSource = `
self.onmessage = (event) => { self.postMessage(event.data); };
`.trim()

const zipOf = (files: Record<string, string>): Uint8Array => {
  const entries: Record<string, Uint8Array> = {}
  for (const [path, text] of Object.entries(files)) entries[path] = strToU8(text)
  return zipSync(entries)
}

const workerManifest = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  id: 'com.acme.loader', name: 'Loader probe', version: '1.0.0', apiVersion: 1,
  permissions: ['model.read', 'ui.notify'],
  entrypoints: { worker: './worker.js' },
  ...overrides,
})

test('parseWorkerFile wraps a compiled worker file with a worker-only manifest', () => {
  const bundled = parseWorkerFile('my-loader.js', strToU8(workerSource))
  assert.equal(bundled.manifest.id, 'com.plugins.my-loader')
  assert.equal(bundled.manifest.entrypoints?.worker, 'index.js')
  assert.deepEqual((bundled.manifest.permissions ?? []).length, 0)
  assert.deepEqual([...bundled.files.keys()], ['index.js'])
  assert.equal(strFromU8(bundled.files.get('index.js')!), workerSource)
})

test('parseWorkerFile honours explicit grants', () => {
  const bundled = parseWorkerFile('probe.js', strToU8(workerSource), ['model.read', 'ui.notify'])
  assert.deepEqual(bundled.manifest.permissions, ['model.read', 'ui.notify'])
})

test('parseZipBundle reads a valid package with manifest + worker', () => {
  const bundled = parseZipBundle(zipOf({
    'buckle.plugin.json': workerManifest(),
    'worker.js': workerSource,
  }), 'probe.zip')
  assert.equal(bundled.manifest.id, 'com.acme.loader')
  assert.equal(strFromU8(bundled.files.get('worker.js')!), workerSource)
  assert.equal(bundled.source, 'probe.zip')
})

test('parseZipBundle rebases a build-output subfolder (dist/)', () => {
  const bundled = parseZipBundle(zipOf({
    'dist/buckle.plugin.json': workerManifest(),
    'dist/worker.js': workerSource,
  }))
  assert.equal(bundled.files.has('worker.js'), true)
  assert.equal(bundled.files.has('dist/worker.js'), false)
})

test('parseZipBundle rejects unknown permissions in the manifest', () => {
  assert.throws(
    () => parseZipBundle(zipOf({
      'manifest.json': workerManifest({ permissions: ['totally.fake'] }),
      'worker.js': workerSource,
    })),
    (error: unknown) => error instanceof PluginLoadError && error.code === 'INVALID_MANIFEST',
  )
})

test('parseZipBundle rejects path traversal (zip-slip)', () => {
  assert.throws(
    () => parseZipBundle(zipOf({
      'buckle.plugin.json': workerManifest(),
      'worker.js': workerSource,
      '../evil.js': 'pwned',
    })),
    (error: unknown) => error instanceof PluginLoadError && error.code === 'ZIP_SLIP',
  )
})

test('parseZipBundle rejects forbidden file types', () => {
  assert.throws(
    () => parseZipBundle(zipOf({
      'buckle.plugin.json': workerManifest(),
      'worker.js': workerSource,
      'payload.exe': '\x00\x00\x00',
    })),
    (error: unknown) => error instanceof PluginLoadError && error.code === 'FORBIDDEN_FILE',
  )
})

test('parseZipBundle fails closed when the manifest is missing', () => {
  assert.throws(
    () => parseZipBundle(zipOf({ 'worker.js': workerSource })),
    (error: unknown) => error instanceof PluginLoadError && error.code === 'MANIFEST_NOT_FOUND',
  )
})

test('parseZipBundle rejects a manifest whose entry file is absent', () => {
  assert.throws(
    () => parseZipBundle(zipOf({ 'buckle.plugin.json': workerManifest() })),
    (error: unknown) => error instanceof PluginLoadError && error.code === 'ENTRY_MISSING',
  )
})

test('parseZipBundle rejects remote entrypoints (no dev loader yet)', () => {
  assert.throws(
    () => parseZipBundle(zipOf({
      'buckle.plugin.json': workerManifest({ entrypoints: { worker: 'https://cdn.example.test/worker.js' } }),
    })),
    (error: unknown) => error instanceof PluginLoadError && error.code === 'REMOTE_ENTRY_UNSUPPORTED',
  )
})

test('isSelfContainedHtml screens external package references', () => {
  assert.equal(isSelfContainedHtml('<html><body>inline</body></html>'), true)
  assert.equal(isSelfContainedHtml('<script>var x=1;</script>'), true)
  assert.equal(isSelfContainedHtml('<script src="./x.js"></script>'), false)
  assert.equal(isSelfContainedHtml('<link rel="stylesheet" href="style.css">'), false)
  assert.equal(isSelfContainedHtml('<img src="logo.png">'), false)
  assert.equal(isSelfContainedHtml('body{background:url("./bg.png")}'), false)
})

test('worker file text round-trips through the loader', () => {
  const text = 'export const greeting = "hello buckle"'
  const bundle = parseWorkerFile('greeter.js', strToU8(text))
  assert.equal(strFromU8(bundle.files.get('index.js')!), text)
})

const fakeDeps = () => {
  const created: string[] = []
  const registered: Array<{ owner: ContributionOwner; bundle: ContributionBundle }> = []
  const unregistered: string[] = []
  const spawned: string[] = []
  const revoked: string[] = []
  const sessions = new Map<string, PluginCommandBroker | undefined>()
  const makeWorker = (): WorkerLike => ({ postMessage: () => {}, terminate: () => {}, addEventListener: () => {}, removeEventListener: () => {} })
  return {
    created, registered, unregistered, spawned, revoked, sessions,
    deps: {
      createSession: async (manifest: { id: string }) => {
        created.push(manifest.id)
        return { pluginId: manifest.id } as unknown as PluginCommandBroker
      },
      spawnWorker: (bytes: Uint8Array, filename: string): WorkerLike => {
        spawned.push(`${filename}:${bytes.length}`)
        return makeWorker()
      },
      createPanelUrl: (_bytes: Uint8Array, filename: string): string => `blob:${filename}`,
      revokeUrl: (url: string) => { revoked.push(url) },
      register: (owner: ContributionOwner, bundle: ContributionBundle) => {
        registered.push({ owner, bundle })
        return () => { unregistered.push(owner.id) }
      },
      setSession: (id: string, session: PluginCommandBroker | null) => {
        sessions.set(id, session ?? undefined)
      },
      openPanel: () => {},
      notify: () => {},
      audit: () => {},
    },
  }
}

const panelBundleZip = () => zipOf({
  'buckle.plugin.json': workerManifest({
    contributions: {
      commands: [{ id: 'com.acme.loader.run', title: 'Run' }],
      panels: [{ id: 'com.acme.loader.panel', title: 'Loader', entry: './panel.html' }],
    },
  }),
  'worker.js': workerSource,
  'panel.html': '<html><body>hi</body></html>',
})

test('launchBundledPlugin wires session, worker and contributions; stop tears all down', async () => {
  const fakes = fakeDeps()
  const bundled: BundledPlugin = parseZipBundle(panelBundleZip())

  const handle = await launchBundledPlugin(bundled, fakes.deps)
  assert.deepEqual(fakes.created, ['com.acme.loader'])
  assert.equal(fakes.sessions.get('com.acme.loader') !== undefined, true)
  assert.equal(fakes.spawned.length, 1) // worker spawned once
  assert.equal(fakes.registered.length, 1)
  const { owner, bundle } = fakes.registered[0]
  assert.equal(owner.id, 'com.acme.loader')
  assert.equal(bundle.panels?.[0]?.entry, 'blob:panel.html')
  assert.equal(bundle.commands?.length, 1)
  assert.equal(handle.pluginId, 'com.acme.loader')
  assert.equal(handle.version, '1.0.0')

  handle.stop()
  handle.stop() // idempotent
  assert.deepEqual(fakes.unregistered, ['com.acme.loader'])
  assert.deepEqual(fakes.revoked, ['blob:panel.html'])
  assert.equal(fakes.sessions.get('com.acme.loader'), undefined)
  assert.equal(fakes.spawned.length, 1) // nothing re-spawned on stop
})

test('launchBundledPlugin rejects a panel that references sibling files', async () => {
  const fakes = fakeDeps()
  const bundled: BundledPlugin = parseZipBundle(zipOf({
    'buckle.plugin.json': workerManifest({
      entrypoints: {},
      contributions: {
        commands: [{ id: 'com.acme.loader.run', title: 'Run' }],
        panels: [{ id: 'com.acme.loader.panel', title: 'Loader', entry: './panel.html' }],
      },
    }),
    'panel.html': '<script src="./panel.js"></script>',
    'panel.js': 'console.log(1)',
  }))
  await assert.rejects(
    launchBundledPlugin(bundled, fakes.deps),
    (error: unknown) => error instanceof PluginLoadError && error.code === 'PANEL_NOT_SELF_CONTAINED',
  )
  // The launch is atomic: nothing registered, no session escaped.
  assert.equal(fakes.registered.length, 0)
  assert.equal(fakes.sessions.get('com.acme.loader'), undefined)
})

test('parseZipBundle rejects a panel contribution whose entry is absent', () => {
  assert.throws(
    () => parseZipBundle(zipOf({
      'buckle.plugin.json': workerManifest({
        contributions: {
          panels: [{ id: 'com.acme.loader.panel', title: 'Loader', entry: './panel.html' }],
        },
      }),
      'worker.js': workerSource,
    })),
    (error: unknown) => error instanceof PluginLoadError && error.code === 'ENTRY_MISSING',
  )
})