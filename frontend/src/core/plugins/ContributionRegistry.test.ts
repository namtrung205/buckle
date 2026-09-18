import assert from 'node:assert/strict'
import test from 'node:test'
import { ContributionRegistry, ContributionRegistryError } from './index.ts'

const plugin = { kind: 'plugin', id: 'com.example.loads', version: '1.0.0' } as const

test('contribution registry orders entries deterministically and invokes commands', async () => {
  const registry = new ContributionRegistry()
  const calls: string[] = []
  registry.register(plugin, {
    commands: [
      { id: 'com.example.loads.second', title: 'Second', execute: () => { calls.push('second') } },
      { id: 'com.example.loads.first', title: 'First', execute: () => { calls.push('first') } },
    ],
    ribbonTabs: [{ id: 'com.example.loads.tab', label: 'Loads', order: 20 }],
    ribbon: [
      { id: 'com.example.loads.ribbon.second', tabId: 'com.example.loads.tab', groupId: 'assign', groupLabel: 'Assign', commandId: 'com.example.loads.second', label: 'Second', order: 20 },
      { id: 'com.example.loads.ribbon.first', tabId: 'com.example.loads.tab', groupId: 'assign', groupLabel: 'Assign', commandId: 'com.example.loads.first', label: 'First', order: 10 },
    ],
  })

  assert.deepEqual(registry.listRibbon().map(item => item.id), [
    'com.example.loads.ribbon.first', 'com.example.loads.ribbon.second',
  ])
  await registry.invokeCommand('com.example.loads.first')
  assert.deepEqual(calls, ['first'])
})

test('plugin contribution IDs are namespaced and duplicate registration is atomic', () => {
  const registry = new ContributionRegistry()
  assert.throws(() => registry.register(plugin, {
    commands: [{ id: 'foreign.command', title: 'Bad', execute: () => undefined }],
  }), ContributionRegistryError)
  assert.equal(registry.getSnapshot(), 0)

  registry.register(plugin, {
    commands: [{ id: 'com.example.loads.assign', title: 'Assign', execute: () => undefined }],
  })
  assert.throws(() => registry.register(plugin, {}), /already registered/)
  assert.equal(registry.getCommand('com.example.loads.assign')?.owner.id, plugin.id)
})

test('unloading an owner removes all contributions and notifies once', () => {
  const registry = new ContributionRegistry()
  let notifications = 0
  registry.subscribe(() => { notifications++ })
  const dispose = registry.register(plugin, {
    commands: [{ id: 'com.example.loads.assign', title: 'Assign', execute: () => undefined }],
    ribbonTabs: [{ id: 'com.example.loads.tab', label: 'Loads' }],
    ribbon: [{ id: 'com.example.loads.ribbon', tabId: 'com.example.loads.tab', groupId: 'assign', groupLabel: 'Assign', commandId: 'com.example.loads.assign', label: 'Assign' }],
    panels: [{ id: 'com.example.loads.panel', title: 'Loads', entry: 'panel.html' }],
  })
  dispose()
  dispose()

  assert.equal(notifications, 2)
  assert.equal(registry.listRibbonTabs().length, 0)
  assert.equal(registry.listRibbon().length, 0)
  assert.equal(registry.listPanels().length, 0)
  assert.equal(registry.getCommand('com.example.loads.assign'), undefined)
})

test('cross-owner command references are rejected so unload cannot leave dangling UI', () => {
  const registry = new ContributionRegistry()
  registry.register({ kind: 'builtin', id: 'buckle.core', version: '1.0.0' }, {
    commands: [{ id: 'builtin.save', title: 'Save', execute: () => undefined }],
  })
  assert.throws(() => registry.register(plugin, {
    ribbonTabs: [{ id: 'com.example.loads.tab', label: 'Loads' }],
    ribbon: [{ id: 'com.example.loads.ribbon', tabId: 'com.example.loads.tab', groupId: 'file', groupLabel: 'File', commandId: 'builtin.save', label: 'Save' }],
  }), /owned by another/)
  assert.equal(registry.listRibbonTabs().length, 0)
})

test('sample plugin command opens its panel and unload closes the active dock', async () => {
  const registry = new ContributionRegistry()
  registry.register({ kind: 'builtin', id: 'buckle.tabs', version: '1.0.0' }, {
    ribbonTabs: [{ id: 'model', label: 'Model' }],
  })
  const dispose = registry.register(plugin, {
    commands: [{
      id: 'com.example.loads.openPanel',
      title: 'Open load panel',
      execute: () => registry.openPanel('com.example.loads.panel'),
    }],
    ribbon: [{
      id: 'com.example.loads.ribbon', tabId: 'model', groupId: 'assign', groupLabel: 'Assign',
      commandId: 'com.example.loads.openPanel', label: 'Wind load',
    }],
    panels: [{ id: 'com.example.loads.panel', title: 'Wind load', entry: 'about:blank' }],
  })

  await registry.invokeCommand('com.example.loads.openPanel')
  assert.equal(registry.getActivePanel()?.id, 'com.example.loads.panel')
  dispose()
  assert.equal(registry.getActivePanel(), undefined)
})

test('disable then re-enable restores contributions and never resurrects a closed panel', () => {
  const registry = new ContributionRegistry()
  const bundle = {
    commands: [{ id: 'com.example.loads.assign', title: 'Assign', execute: () => undefined }],
    ribbonTabs: [{ id: 'com.example.loads.tab', label: 'Loads' }],
    ribbon: [{ id: 'com.example.loads.ribbon', tabId: 'com.example.loads.tab', groupId: 'assign', groupLabel: 'Assign', commandId: 'com.example.loads.assign', label: 'Assign' }],
    panels: [{ id: 'com.example.loads.panel', title: 'Loads', entry: 'about:blank' }],
  } as const
  const dispose = registry.register(plugin, bundle)
  registry.openPanel('com.example.loads.panel')
  assert.equal(registry.getActivePanel()?.id, 'com.example.loads.panel')

  dispose()
  assert.equal(registry.listRibbonTabs().length, 0)
  assert.equal(registry.getActivePanel(), undefined)

  registry.register(plugin, bundle)
  assert.deepEqual(registry.listRibbonTabs().map(tab => tab.id), ['com.example.loads.tab'])
  assert.equal(registry.getCommand('com.example.loads.assign')?.title, 'Assign')
  // A closed dock must not resurrect when its owner is enabled again.
  assert.equal(registry.getActivePanel(), undefined)
})

test('disabling one owner never removes another owner contributions', () => {
  const registry = new ContributionRegistry()
  registry.register({ kind: 'builtin', id: 'buckle.core', version: '1.0.0' }, {
    commands: [{ id: 'builtin.save', title: 'Save', execute: () => undefined }],
    ribbonTabs: [{ id: 'model', label: 'Model' }],
  })
  const dispose = registry.register(plugin, {
    commands: [{ id: 'com.example.loads.assign', title: 'Assign', execute: () => undefined }],
    ribbonTabs: [{ id: 'com.example.loads.tab', label: 'Loads' }],
    ribbon: [{ id: 'com.example.loads.ribbon', tabId: 'com.example.loads.tab', groupId: 'assign', groupLabel: 'Assign', commandId: 'com.example.loads.assign', label: 'Assign' }],
    panels: [{ id: 'com.example.loads.panel', title: 'Loads', entry: 'about:blank' }],
  })
  dispose()
  dispose()

  assert.deepEqual(registry.listRibbonTabs().map(tab => tab.id), ['model'])
  assert.equal(registry.getCommand('builtin.save')?.owner.id, 'buckle.core')
  assert.equal(registry.listPanels().length, 0)
})

