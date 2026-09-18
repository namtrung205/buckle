import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PluginManager } from './PluginManager.ts'
import { PluginTrustStore, signPackage, PluginTrustError } from './PluginTrust.ts'
import { validateManifest } from './manifest.ts'
import { pluginAudit, pluginKillSwitch } from './PluginAudit.ts'
import { PLUGIN_PERMISSION_CATALOG, summarizePermissions } from './permissions.ts'
import type { PluginCommandBroker } from './PluginHostApi.ts'

const manifestValue = {
  id: 'com.security.probe',
  name: 'Probe',
  version: '1.0.0',
  apiVersion: 1,
  entrypoints: { worker: './main.js' },
  permissions: ['model.read'],
  contributions: { commands: [{ id: 'com.security.probe.run', title: 'Run' }] },
}

const brokerStub = () => ({}) as PluginCommandBroker

test('a revoked plugin cannot be installed', () => {
  const trust = new PluginTrustStore({ trustedKeys: ['k1'] })
  trust.revoke('com.security.probe')
  const manager = new PluginManager({ sessionFactory: brokerStub, trust })
  assert.throws(() => manager.install(manifestValue, 'whatever'), (error: unknown) => error instanceof PluginTrustError && error.code === 'REVOKED')
  assert.equal(manager.list().length, 0)
  assert.equal(pluginAudit.list().some(entry => entry.pluginId === 'com.security.probe' && entry.action === 'revoked'), true)
})

test('an untrusted signature cannot be installed', () => {
  const manifest = { ...manifestValue }
  const manager = new PluginManager({ sessionFactory: brokerStub, trust: new PluginTrustStore({ trustedKeys: ['host-key'] }) })
  assert.throws(() => manager.install(manifest, signPackage(manifest as never, 'attacker-key')), PluginTrustError)
  assert.equal(manager.list().length, 0)
})

test('a signed package installs and enables', async () => {
  const manager = new PluginManager({ sessionFactory: brokerStub, trust: new PluginTrustStore({ trustedKeys: ['host-key'] }) })
  const manifest = validateManifest(manifestValue)
  manager.install(manifestValue, signPackage(manifest, 'host-key'))
  assert.equal(manager.list().length, 1)
  assert.equal(await manager.enable(manifest.id), true)
  assert.notEqual(manager.getSession(manifest.id), null)
})

test('an engaged kill switch blocks enable and bootAll, and tears down live sessions', async () => {
  pluginKillSwitch.release()
  const manager = new PluginManager({ sessionFactory: brokerStub })
  const manifest = manager.install(manifestValue)
  assert.equal(await manager.enable(manifest.id), true)
  manager.engageKillSwitch('security incident')
  assert.equal(pluginKillSwitch.snapshot.engaged, true)
  assert.equal(manager.getSession(manifest.id), null)
  assert.equal(await manager.enable(manifest.id), false)
  manager.install({ ...manifestValue, id: 'com.security.second', contributions: { commands: [{ id: 'com.security.second.run', title: 'Run' }] } })
  const boot = await manager.bootAll()
  assert.deepEqual(boot, { started: [], failed: ['com.security.probe', 'com.security.second'], quarantined: [] })
  assert.equal(pluginAudit.list().some(entry => entry.action === 'killSwitchEngaged'), true)
  manager.releaseKillSwitch()
  assert.equal(pluginKillSwitch.snapshot.engaged, false)
  assert.equal(await manager.enable(manifest.id), true)
  pluginKillSwitch.release()
})

test('permission catalog is fail-closed and unknown grants surface explicitly', () => {
  assert.equal(PLUGIN_PERMISSION_CATALOG.some(info => info.permission === 'model.write.members'), true)
  assert.equal(PLUGIN_PERMISSION_CATALOG.some(info => info.permission === 'viewport.draw'), true)
  const summary = summarizePermissions(['model.read', 'made.up.permission'])
  assert.equal(summary.length, 2)
  assert.equal(summary[0]!.family, 'model')
  assert.equal(summary[1]!.description.includes('Unrecognized'), true)
})
