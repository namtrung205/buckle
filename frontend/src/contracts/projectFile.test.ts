import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PROJECT_FILE_VERSION,
  isBuckleProjectFile,
  migrateProjectFile,
} from './projectFile.ts'
import { PluginStorage } from '../core/plugins/PluginStorage.ts'

const v2File = {
  kind: 'buckle-project',
  version: 2,
  model: { nodes: [], frames: [] },
  organizational: { selectionSets: [], groups: [], parametricObjects: [], grids: [], levels: [] },
  extensions: { 'com.acme.plugin': { config: { bays: 4 } } },
}

test('project file gate accepts v1 and v2, rejects everything else', () => {
  assert.equal(isBuckleProjectFile(v2File), true)
  assert.equal(isBuckleProjectFile({ ...v2File, version: 1, extensions: undefined }), true)
  assert.equal(isBuckleProjectFile({ ...v2File, kind: 'other' }), false)
  assert.equal(isBuckleProjectFile({ ...v2File, version: 3 }), false)
  assert.equal(isBuckleProjectFile(null), false)
  assert.equal(isBuckleProjectFile('file'), false)
})

test('v1 files migrate to v2 with an empty extensions map', () => {
  const v1 = { ...v2File, version: 1, extensions: undefined }
  const migrated = migrateProjectFile(v1)
  assert.ok(migrated)
  assert.equal(migrated.version, PROJECT_FILE_VERSION)
  assert.deepEqual(migrated.extensions, {})
  // Organizational payload survives the migration untouched.
  assert.deepEqual(migrated.organizational, v2File.organizational)
})

test('v2 files pass through unchanged', () => {
  assert.equal(migrateProjectFile(v2File), v2File)
})

test('unreadable input migrates to null (callers fail closed)', () => {
  assert.equal(migrateProjectFile({}), null)
  assert.equal(migrateProjectFile('nope'), null)
})

test('plugin state survives a full save → migrate → open round-trip', () => {
  const saved = new PluginStorage()
  saved.set('com.acme.plugin', 'project', 'truss', { bays: 4, span: 12 })
  saved.set('com.acme.plugin', 'local', 'scratch', 'session only')
  const file = { ...v2File, extensions: saved.serializeProject() }

  const reopened = new PluginStorage()
  const migrated = migrateProjectFile(file)
  assert.ok(migrated)
  reopened.restoreProject(migrated.extensions)
  assert.deepEqual(reopened.get('com.acme.plugin', 'project', 'truss'), { bays: 4, span: 12 })
  // Local scope never entered the file.
  assert.equal(reopened.get('com.acme.plugin', 'local', 'scratch'), undefined)
})

test('a plugin missing on open keeps the file valid and starts empty', () => {
  const reopened = new PluginStorage()
  reopened.restoreProject(v2File.extensions)
  // Unknown plugin namespaces are still namespaced — nothing leaks into 'com.gone'.
  assert.deepEqual(reopened.keys('com.gone', 'project'), [])
  assert.deepEqual(reopened.get('com.acme.plugin', 'project', 'config'), { bays: 4 })
})
