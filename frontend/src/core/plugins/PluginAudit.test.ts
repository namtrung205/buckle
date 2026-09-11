import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PluginAuditLog, PluginKillSwitch } from './PluginAudit.ts'
import type { PluginAuditEntry } from './PluginAudit.ts'

test('audit log records, notifies and caps at capacity', () => {
  let now = 100
  const log = new PluginAuditLog({ capacity: 3, now: () => now })
  const seen: number[] = []
  const unsubscribe = log.subscribe(() => seen.push(log.list().length))
  log.record('com.a', 'install', '1.0.0')
  log.record('com.a', 'enable')
  log.record('com.a', 'crash')
  log.record('com.a', 'quarantine')
  const entries = log.list()
  assert.equal(entries.length, 3)
  assert.deepEqual(entries.map(entry => entry.action), ['enable', 'crash', 'quarantine'])
  assert.deepEqual(seen, [1, 2, 3, 3])
  assert.equal(entries[0]!.at, 100)
  unsubscribe()
  now = 200
  log.record('com.b', 'disable')
  assert.deepEqual(seen, [1, 2, 3, 3])
})

test('audit snapshots are stable between mutations', () => {
  const log = new PluginAuditLog()
  log.record('com.a', 'install')
  const frozen = log.list()
  log.record('com.b', 'enable')
  assert.equal(frozen.length, 1)
  assert.equal(log.list().length, 2)
  log.clear()
  assert.equal(log.list().length, 0)
})

test('list survives detached calls (useSyncExternalStore getSnapshot reference)', () => {
  const log = new PluginAuditLog()
  log.record('com.a', 'install')
  // React extracts the reference and calls it without a receiver — `this`
  // must stay bound (regression for the PluginSecurityCenter crash).
  const { list, subscribe } = log
  const getSnapshot = list as () => readonly PluginAuditEntry[]
  assert.doesNotThrow(() => getSnapshot())
  assert.equal(getSnapshot().length, 1)
  assert.equal(typeof subscribe, 'function')
})

test('kill switch state and listeners', () => {
  const killSwitch = new PluginKillSwitch()
  const states: boolean[] = []
  const unsubscribe = killSwitch.subscribe(() => states.push(killSwitch.snapshot.engaged))
  assert.equal(killSwitch.snapshot.engaged, false)
  killSwitch.engage('incident')
  assert.equal(killSwitch.snapshot.engaged, true)
  assert.equal(killSwitch.snapshot.reason, 'incident')
  assert.equal(typeof killSwitch.snapshot.at, 'number')
  killSwitch.release()
  assert.deepEqual(killSwitch.snapshot, { engaged: false })
  assert.deepEqual(states, [true, false])
  unsubscribe()
})
