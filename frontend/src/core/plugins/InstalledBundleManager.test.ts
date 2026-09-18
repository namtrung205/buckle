import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, zipSync } from 'fflate'
import { InstalledBundleManager } from './InstalledBundleManager.ts'
import type { InstalledBundleRecord, PluginInstallStore } from './PluginInstallStore.ts'
import type { PluginLaunchDeps } from './PluginBundleLoader.ts'
import type { PluginCommandBroker } from './PluginHostApi.ts'
import type { WorkerLike } from './WorkerRuntime.ts'
import { sha256Hex } from './BundleIntegrity.ts'
import { generateKeyPairSync, sign as signEd25519 } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { BUNDLE_SIGNATURE_FILE, BUNDLE_SIGNATURE_FORMAT, canonicalBundleMessage, encodeBase64 } from '../../../packages/plugin-sdk/src/signature.ts'
import { PublisherRevocations } from './PublisherRevocations.ts'

const zip = (id: string, permissions: string[] = []): Uint8Array => zipSync({
  'buckle.plugin.json': strToU8(JSON.stringify({
    id, name: id, version: '1.0.0', apiVersion: 1, permissions, entrypoints: {},
  })),
})

const fixture = () => {
  const records = new Map<string, InstalledBundleRecord>()
  const live = new Set<string>()
  const failures: string[] = []
  const cleared: string[] = []
  const publishers = new PublisherRevocations()
  let crashListener: ((reason: string) => void) | null = null
  let nextPut: (() => void) | null = null
  const store: PluginInstallStore = {
    list: async () => [...records.values()],
    put: async record => {
      records.set(record.id, record)
      const callback = nextPut
      nextPut = null
      callback?.()
    },
    delete: async id => { records.delete(id) },
  }
  const deps: PluginLaunchDeps = {
    createSession: manifest => ({ pluginId: manifest.id } as PluginCommandBroker),
    spawnWorker: (): WorkerLike => ({
      postMessage: () => {}, terminate: () => {}, addEventListener: () => {}, removeEventListener: () => {},
      onError: listener => { crashListener = listener; return () => { crashListener = null } },
    }),
    createPanelUrl: () => { throw new Error('Panel not expected') },
    register: () => () => {},
    setSession: (id, session) => { if (session) live.add(id); else live.delete(id) },
    storage: { clearPlugin: id => { cleared.push(id) } } as NonNullable<PluginLaunchDeps['storage']>,
  }
  const manager = () => new InstalledBundleManager({
    store, deps, publishers, onChange: () => {}, onFailure: message => failures.push(message),
  })
  return { records, live, failures, cleared, publishers, manager,
    crash: (reason: string) => { if (!crashListener) throw new Error('No live Worker'); crashListener(reason) },
    onNextPut: (callback: () => void) => { nextPut = callback } }
}

const workerZip = (id: string): Uint8Array => zipSync({
  'buckle.plugin.json': strToU8(JSON.stringify({
    id, name: id, version: '1.0.0', apiVersion: 1,
    permissions: [], entrypoints: { worker: 'worker.js' },
  })),
  'worker.js': strToU8('/* fake Worker transport executes this test */'),
})

const signedWorkerZip = async (id: string, keyPair: { publicKey: KeyObject; privateKey: KeyObject }): Promise<Uint8Array> => {
  const files = new Map<string, Uint8Array>([
    ['buckle.plugin.json', strToU8(JSON.stringify({
      id, name: id, version: '1.0.0', apiVersion: 1,
      permissions: [], entrypoints: { worker: 'worker.js' },
    }))],
    ['worker.js', strToU8('/* signed worker */')],
  ])
  const jwk = keyPair.publicKey.export({ format: 'jwk' })
  files.set(BUNDLE_SIGNATURE_FILE, strToU8(JSON.stringify({
    format: BUNDLE_SIGNATURE_FORMAT,
    publicKey: encodeBase64(Buffer.from(jwk.x!, 'base64url')),
    signature: encodeBase64(signEd25519(null, Buffer.from(await canonicalBundleMessage(files)), keyPair.privateKey)),
  })))
  return zipSync(Object.fromEntries(files))
}

test('reviewed ZIP survives reload and can be disabled, enabled and uninstalled', async () => {
  const state = fixture()
  const first = state.manager()
  await first.install(zip('com.example.persist', ['model.read']), 'persist.zip')
  assert.deepEqual([...state.live], ['com.example.persist'])
  assert.equal(state.records.get('com.example.persist')?.enabled, true)
  first.dispose()

  const restored = state.manager()
  await restored.restore()
  assert.equal(restored.list()[0].enabled, true)
  await restored.disable('com.example.persist')
  assert.equal(state.records.get('com.example.persist')?.enabled, false)
  assert.equal(state.live.size, 0)
  await restored.enable('com.example.persist')
  assert.equal(state.live.size, 1)
  await restored.uninstall('com.example.persist')
  assert.equal(state.records.size, 0)
  assert.deepEqual(state.cleared, ['com.example.persist'])
  restored.dispose()
})

test('tampered grants are disabled without executing, while other plugins restore', async () => {
  const state = fixture()
  const badZip = zip('com.example.bad', ['model.read'])
  const goodZip = zip('com.example.good')
  state.records.set('com.example.bad', {
    id: 'com.example.bad', version: '1.0.0', source: 'bad.zip',
    zip: badZip, reviewedSha256: await sha256Hex(badZip), enabled: true, grantedPermissions: [],
  })
  state.records.set('com.example.good', {
    id: 'com.example.good', version: '1.0.0', source: 'good.zip',
    zip: goodZip, reviewedSha256: await sha256Hex(goodZip), enabled: true, grantedPermissions: [],
  })
  const manager = state.manager()
  await manager.restore()
  assert.deepEqual([...state.live], ['com.example.good'])
  assert.equal(state.records.get('com.example.bad')?.enabled, false)
  assert.match(manager.list().find(entry => entry.id === 'com.example.bad')?.failure ?? '', /does not match/)
  assert.equal(state.failures.length, 1)
  manager.dispose()
})

test('changed ZIP bytes with the same reviewed manifest are disabled before execution', async () => {
  const state = fixture()
  const first = state.manager()
  const id = 'com.example.changed'
  await first.install(workerZip(id), 'reviewed.zip')
  first.dispose()
  const record = state.records.get(id)!
  const changed = zipSync({
    'buckle.plugin.json': strToU8(JSON.stringify({
      id, name: id, version: '1.0.0', apiVersion: 1,
      permissions: [], entrypoints: { worker: 'worker.js' },
    })),
    'worker.js': strToU8('different code with the same identity and grants'),
  })
  state.records.set(id, { ...record, zip: changed })
  const restored = state.manager()
  await restored.restore()
  assert.equal(state.live.size, 0)
  assert.equal(state.records.get(id)?.enabled, false)
  assert.match(restored.list()[0].failure ?? '', /ZIP changed/)
  await assert.rejects(restored.enable(id), /ZIP changed/)
  restored.dispose()
})

test('legacy install without a reviewed ZIP fingerprint stays disabled', async () => {
  const state = fixture()
  const id = 'com.example.legacy'
  state.records.set(id, {
    id, version: '1.0.0', source: 'legacy.zip', zip: zip(id),
    enabled: true, grantedPermissions: [],
  })
  const manager = state.manager()
  await manager.restore()
  assert.equal(state.live.size, 0)
  assert.equal(state.records.get(id)?.enabled, false)
  assert.match(manager.list()[0].failure ?? '', /review fingerprint/)
  manager.dispose()
})

test('signed updates keep the reviewed publisher key and signatures are checked on restore', async () => {
  const state = fixture()
  const id = 'com.example.publisher'
  const firstKey = generateKeyPairSync('ed25519')
  const otherKey = generateKeyPairSync('ed25519')
  const manager = state.manager()
  await manager.install(await signedWorkerZip(id, firstKey), 'signed.zip')
  assert.match(state.records.get(id)?.publisherKeySha256 ?? '', /^[a-f0-9]{64}$/)
  await assert.rejects(manager.install(await signedWorkerZip(id, otherKey), 'other.zip'), /publisher key/)
  await assert.rejects(manager.install(workerZip(id), 'unsigned.zip'), /publisher key/)
  manager.dispose()

  const record = state.records.get(id)!
  const changed = zipSync({
    'buckle.plugin.json': strToU8(JSON.stringify({
      id, name: id, version: '1.0.0', apiVersion: 1,
      permissions: [], entrypoints: { worker: 'worker.js' },
    })),
    'worker.js': strToU8('/* altered after signing */'),
    [BUNDLE_SIGNATURE_FILE]: strToU8(JSON.stringify({
      format: BUNDLE_SIGNATURE_FORMAT,
      publicKey: encodeBase64(Buffer.from(firstKey.publicKey.export({ format: 'jwk' }).x!, 'base64url')),
      signature: encodeBase64(new Uint8Array(64)),
    })),
  })
  state.records.set(id, { ...record, zip: changed, reviewedSha256: await sha256Hex(changed) })
  const restored = state.manager()
  await restored.restore()
  assert.equal(state.live.size, 0)
  assert.match(restored.list()[0].failure ?? '', /signature does not match/)
  restored.dispose()
})

test('blocking a publisher stops its plugins and rejects install, restore and enable', async () => {
  const state = fixture()
  const key = generateKeyPairSync('ed25519')
  const zipBytes = await signedWorkerZip('com.example.revoked', key)
  const manager = state.manager()
  await manager.install(zipBytes, 'signed.zip')
  const fingerprint = state.records.get('com.example.revoked')!.publisherKeySha256!
  await manager.blockPublisher('com.example.revoked')
  assert.equal(state.live.size, 0)
  assert.equal(manager.list()[0].revoked, true)
  assert.equal(state.records.get('com.example.revoked')?.enabled, false)
  await assert.rejects(manager.enable('com.example.revoked'), /revoked locally/)
  await assert.rejects(manager.install(zipBytes, 'again.zip'), /revoked locally/)
  manager.dispose()
  state.records.set('com.example.revoked', { ...state.records.get('com.example.revoked')!, enabled: true })
  const restored = state.manager()
  await restored.restore()
  assert.equal(state.live.size, 0)
  assert.equal(state.records.get('com.example.revoked')?.enabled, false)
  assert.equal(state.publishers.isRevoked(fingerprint), true)
  restored.releasePublisher('com.example.revoked')
  await restored.enable('com.example.revoked')
  assert.equal(state.live.size, 1)
  restored.dispose()
})

test('unreadable publisher blocklist fails closed for signed keys', () => {
  const brokenStorage = {
    getItem: () => '{broken',
    setItem: () => {},
  }
  const publishers = new PublisherRevocations(brokenStorage, true)
  assert.equal(publishers.isRevoked('a'.repeat(64)), true)
  assert.throws(() => publishers.release('a'.repeat(64)), /unavailable/)
})

test('failed update rolls back to the previously installed ZIP', async () => {
  const state = fixture()
  const manager = state.manager()
  await manager.install(zip('com.example.update'), 'first.zip')
  const broken = zipSync({
    'buckle.plugin.json': strToU8(JSON.stringify({
      id: 'com.example.update', name: 'Update', version: '2.0.0', apiVersion: 1,
      entrypoints: {}, contributions: { panels: [{
        id: 'com.example.update.panel', title: 'Panel', entry: 'panel.html',
      }] },
    })),
    'panel.html': strToU8('<script src="panel.js"></script>'),
    'panel.js': strToU8('console.log(1)'),
  })
  await assert.rejects(manager.install(broken, 'second.zip'))
  assert.equal(manager.list()[0].version, '1.0.0')
  assert.equal(manager.list()[0].enabled, true)
  assert.equal(state.records.get('com.example.update')?.source, 'first.zip')
  assert.deepEqual([...state.live], ['com.example.update'])
  manager.dispose()
})

test('Worker crashes disable the install and quarantine after three failures', async () => {
  const state = fixture()
  const manager = state.manager()
  const id = 'com.example.crashes'
  await manager.install(workerZip(id), 'crashes.zip')
  for (let count = 1; count <= 3; count += 1) {
    state.crash('error')
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(manager.list()[0].enabled, false)
    assert.equal(state.records.get(id)?.crashCount, count)
    if (count < 3) await manager.enable(id)
  }
  assert.equal(manager.list()[0].quarantined, true)
  await assert.rejects(manager.enable(id), /quarantined/)
  await manager.release(id)
  assert.equal(manager.list()[0].quarantined, false)
  await manager.enable(id)
  assert.equal(manager.list()[0].enabled, true)
  manager.dispose()
})

test('Worker failure while saving a new install does not persist a dead enabled plugin', async () => {
  const state = fixture()
  const manager = state.manager()
  state.onNextPut(() => state.crash('error'))
  await assert.rejects(manager.install(workerZip('com.example.early'), 'early.zip'), /Worker stopped/)
  assert.equal(state.records.size, 0)
  assert.equal(state.live.size, 0)
  assert.equal(manager.list().length, 0)
  manager.dispose()
})
