import assert from 'node:assert/strict'
import test from 'node:test'
import { CommandGateway, StructuralDocument } from '../structural/index.ts'
import type { CommandWorkspaceState } from '../structural/index.ts'
import { createPluginCommandBroker, PluginHostError, PluginEventBus } from './index.ts'
import type { PluginCommandServices, PluginMutationRequest, PluginHostEvent } from './index.ts'
import { InteractionBusyError } from '../interaction/index.ts'
import type { InteractionResult } from '../interaction/index.ts'
import type { PluginSessionPermission, PluginViewportInteractions, ViewportZoomTarget } from './index.ts'

const seed = () => new StructuralDocument({
  nodes: [
    { id: 1, position: [0, 0, 0] },
    { id: 2, position: [3, 0, 0] },
    { id: 3, position: [3, 4, 0] },
  ],
  materials: [{ id: 1, name: 'Steel', E: 210e9, nu: 0.3 }],
  sections: [{ id: 1, name: 'I200', type: 'I', materialId: 1, depth: 200, width: 100 }],
  members: [
    { id: 10, nodeI: 1, nodeJ: 2, sectionId: 1 },
    { id: 11, nodeI: 2, nodeJ: 3, sectionId: 1 },
  ],
})

const owner = { kind: 'plugin', id: 'com.buckle.samples.windload', version: '1.0.0' } as const

const harness = (options: { locked?: boolean } = {}) => {
  const document = seed()
  const gateway = new CommandGateway(document)
  let workspace: CommandWorkspaceState = { selection: [], hidden: [] }
  let locked = options.locked ?? false
  const panels = new Set([`${owner.id}.panel`])
  const opened: string[] = []
  const notices: { message: string; kind: string }[] = []
  const services: PluginCommandServices = {
    getRevision: () => document.revision,
    querySnapshot: () => document.getSnapshot(),
    getWorkspaceState: () => workspace,
    execute: (command, executeOptions) => gateway.execute(command, {
      getWorkspaceState: () => structuredClone(workspace),
      applyWorkspaceState: next => { workspace = structuredClone(next) },
      policy: {
        modelLocked: locked,
        pluginPermissions: executeOptions.pluginPermissions,
        allowPluginDestructive: executeOptions.allowDestructive === true,
      },
    }),
    hasPanel: id => panels.has(id),
    openPanel: id => { opened.push(id) },
    notify: (message, kind = 'info') => { notices.push({ message, kind }) },
  }
  const broker = createPluginCommandBroker(services, owner, [
    'model.read', 'workspace.readSelection', 'workspace.writeSelection',
    'model.write.loads', 'model.delete.members', 'ui.panel',
  ])
  return { document, gateway, broker, services, opened, notices, setLocked: (value: boolean) => { locked = value } }
}

const assignLoads = (memberIds: readonly number[]): PluginMutationRequest => ({
  command: {
    type: 'Transaction',
    payload: {
      operations: [{
        type: 'CreateOrUpdateLoads',
        payload: {
          loads: [{ type: 'linear', targetIds: memberIds, value: [0, -1, 0], magnitude: 5, name: 'Wind (sample)' }],
        },
      }],
    },
  },
})

test('ui.notify requires its own reviewed grant', () => {
  const { broker, services, notices } = harness()
  assert.throws(() => broker.notify('blocked'),
    (error: unknown) => error instanceof PluginHostError && error.code === 'PERMISSION_DENIED')
  assert.equal(notices.length, 0)
  const granted = createPluginCommandBroker(services, owner, ['ui.notify'])
  granted.notify('allowed', 'success')
  assert.deepEqual(notices, [{ message: 'allowed', kind: 'success' }])
})

test('broker stamps plugin provenance and the whole transaction undoes in one host step', () => {
  const { document, gateway, broker } = harness()
  const outcome = broker.execute(assignLoads([10, 11]))
  assert.equal(outcome.ok, true)
  if (!outcome.ok) return
  assert.equal(outcome.result.previousRevision, 0)
  assert.equal(document.revision, 1)

  const audit = gateway.auditLog[0]
  assert.equal(audit.source, 'plugin')
  assert.deepEqual(audit.actor, { kind: 'plugin', pluginId: owner.id, pluginVersion: owner.version })
  assert.match(audit.commandId, /^plugin:com\.buckle\.samples\.windload:Transaction:fnv1a64:/)

  const load = [...document.loads.values()][0]
  assert.deepEqual(load.targetIds, [10, 11])
  assert.equal(load.type, 'linear')

  // Host-owned undo removes the entire plugin transaction in one step.
  gateway.undo()
  assert.equal(document.loads.size, 0)
  assert.equal(document.revision, 2)
})

test('missing mutation grants fail closed without revision, history or audit', () => {
  const { document, gateway, broker } = harness()
  const outcome = broker.execute({ command: { type: 'CreateNodes', payload: { nodes: [{ position: [0, 0, 0] }] } } })
  assert.equal(outcome.ok, false)
  if (outcome.ok) return
  assert.equal(outcome.code, 'PLUGIN_PERMISSION_DENIED')
  assert.equal(document.revision, 0)
  assert.equal(gateway.auditLog.length, 0)
  assert.equal(gateway.canUndo, false)
})

test('destructive commands preview freely but require explicit approval to commit', () => {
  const { document, broker } = harness()
  const request: PluginMutationRequest = { command: { type: 'DeleteMembers', payload: { ids: [10] } } }

  const previewed = broker.preview(request)
  assert.equal(previewed.ok, true)
  if (!previewed.ok) return
  assert.equal(previewed.result.dryRun, true)
  assert.equal(document.revision, 0)
  assert.equal(document.members.size, 2)

  const denied = broker.execute(request)
  assert.equal(denied.ok, false)
  if (denied.ok) return
  assert.equal(denied.code, 'PLUGIN_APPROVAL_REQUIRED')
  assert.equal(document.members.size, 2)

  const applied = broker.execute({ ...request, approval: true })
  assert.equal(applied.ok, true)
  assert.equal(document.members.size, 1)
  assert.equal(document.members.has(11), true)
})

test('stale expected revisions return a deterministic conflict without partial mutation', () => {
  const { document, gateway, broker } = harness()
  assert.equal(broker.execute(assignLoads([10])).ok, true)

  const stale = broker.execute({ ...assignLoads([11]), expectedModelRevision: 0 })
  assert.equal(stale.ok, false)
  if (stale.ok) return
  assert.equal(stale.code, 'REVISION_CONFLICT')
  assert.equal(stale.expectedRevision, 0)
  assert.equal(stale.actualRevision, 1)
  assert.equal(gateway.auditLog.length, 1)
  assert.equal(document.loads.size, 1)

  const fresh = broker.execute({ ...assignLoads([11]), expectedModelRevision: 1 })
  assert.equal(fresh.ok, true)
  assert.equal(document.loads.size, 2)
})

test('locked models keep workspace APIs available and block engineering mutations', () => {
  const { document, broker } = harness({ locked: true })

  const denied = broker.execute(assignLoads([10]))
  assert.equal(denied.ok, false)
  if (denied.ok) return
  assert.equal(denied.code, 'MODEL_LOCKED')
  assert.equal(document.revision, 0)

  const selected = broker.setSelection([{ collection: 'members', id: 11 }])
  assert.equal(selected.ok, true)
  assert.equal(broker.getSelection().length, 1)
  assert.equal(document.revision, 0)
})


test('surface permissions gate queries, selection reads and panel opening', () => {
  const { document, broker, services } = harness()

  const snapshot = broker.query() as { revision: number }
  assert.equal(snapshot.revision, document.revision)
  assert.deepEqual(broker.getSelection(), [])

  const bare = createPluginCommandBroker(services, owner, [])
  assert.throws(() => bare.query(), PluginHostError)
  assert.throws(() => bare.getSelection(), PluginHostError)
  assert.throws(() => bare.openPanel(`${owner.id}.panel`), PluginHostError)
})

test('panel opening is namespaced and rejects unknown panels', () => {
  const { broker, opened } = harness()

  assert.throws(() => broker.openPanel('com.other.plugin.panel'), PluginHostError)
  assert.throws(() => broker.openPanel(`${owner.id}.missing`), PluginHostError)
  broker.openPanel(`${owner.id}.panel`)
  assert.deepEqual(opened, [`${owner.id}.panel`])
})

test('identical retries resend the same envelope and replay idempotently', () => {
  const { document, broker } = harness()
  const first = broker.execute(assignLoads([10]))
  assert.equal(first.ok, true)
  const second = broker.execute(assignLoads([10]))
  assert.equal(second.ok, true)
  if (!second.ok) return
  assert.equal(second.result.idempotentReplay, true)
  assert.equal(document.loads.size, 1)
  assert.equal(document.revision, 1)
})

test('invalid plugin identities are rejected at session creation', () => {
  const { services } = harness()
  assert.throws(
    () => createPluginCommandBroker(services, { kind: 'plugin', id: 'COM Example', version: 'latest' }, []),
    PluginHostError,
  )
  assert.throws(
    () => createPluginCommandBroker(services, { kind: 'builtin', id: 'buckle.core', version: '1.0.0' }, []),
    PluginHostError,
  )
})

const approveHarness = (mode: 'allow' | 'deny') => {
  const base = harness()
  const events = new PluginEventBus()
  const approvals: string[] = []
  const broker = createPluginCommandBroker({
    ...base.services,
    events,
    approver: info => { approvals.push(info.code); return mode === 'allow' },
  }, owner, ['model.read', 'model.write.loads', 'model.delete.members'])
  return { ...base, events, approvals, approvingBroker: broker }
}

test('host approval prompt unlocks destructive commits and is consulted once', () => {
  const { document, approvals, approvingBroker } = approveHarness('allow')
  const applied = approvingBroker.execute({ command: { type: 'DeleteMembers', payload: { ids: [10] } } })
  assert.equal(applied.ok, true)
  assert.deepEqual(approvals, ['PLUGIN_APPROVAL_REQUIRED'])
  assert.equal(document.members.size, 1)
  assert.equal(document.revision, 1)

  // Non-destructive commands never consult the approver.
  const loads = approvingBroker.execute(assignLoads([11]))
  assert.equal(loads.ok, true)
  assert.deepEqual(approvals, ['PLUGIN_APPROVAL_REQUIRED'])
  assert.equal(document.loads.size, 1)
})

test('denied approval keeps the destructive command rejected and unapplied', () => {
  const { document, approvals, approvingBroker } = approveHarness('deny')
  const denied = approvingBroker.execute({ command: { type: 'DeleteMembers', payload: { ids: [10] } } })
  assert.equal(denied.ok, false)
  if (denied.ok) return
  assert.equal(denied.code, 'PLUGIN_APPROVAL_REQUIRED')
  assert.deepEqual(approvals, ['PLUGIN_APPROVAL_REQUIRED'])
  assert.equal(document.members.size, 2)
  assert.equal(document.revision, 0)
  // A later retry after a fresh explicit approval still works.
  const later = approvingBroker.execute({
    command: { type: 'DeleteMembers', payload: { ids: [10] } }, approval: true,
  })
  assert.equal(later.ok, true)
  assert.equal(document.members.size, 1)
})

test('session event subscription coalesces bursts, filters by kind and stops on unsubscribe', () => {
  const base = harness()
  const events = new PluginEventBus()
  const broker = createPluginCommandBroker({ ...base.services, events }, owner, ['model.write.loads'])

  const seen: PluginHostEvent[] = []
  const unsubscribe = broker.subscribe(event => seen.push(event))
  events.publish({ kind: 'document', revision: 1, snapshotHash: 'fnv1a64:1' })
  events.publish({ kind: 'document', revision: 2, snapshotHash: 'fnv1a64:2' })
  events.publish({ kind: 'workspace', revision: 2 })
  assert.equal(seen.length, 0)
  events.flushNow()
  assert.equal(seen.length, 2)
  assert.deepEqual(seen[0], { kind: 'document', revision: 2, snapshotHash: 'fnv1a64:2' })
  assert.deepEqual(seen[1], { kind: 'workspace', revision: 2 })

  // Kind filtering applies per subscriber.
  const docsOnly: PluginHostEvent[] = []
  broker.subscribe(event => docsOnly.push(event), { kinds: ['document'] })
  events.publish({ kind: 'workspace', revision: 3 })
  events.publish({ kind: 'document', revision: 3, snapshotHash: 'fnv1a64:3' })
  events.flushNow()
  assert.equal(docsOnly.length, 1)
  assert.equal(docsOnly[0].revision, 3)

  unsubscribe()
  unsubscribe()
  assert.equal(events.listenerCount, 1)
  events.publish({ kind: 'document', revision: 4, snapshotHash: 'fnv1a64:4' })
  events.flushNow()
  assert.equal(docsOnly.length, 2)
  // `seen` received both pre-unsubscribe batches, then nothing more.
  assert.equal(seen.length, 4)
})

test('session event subscription fails when the host bus is not wired', () => {
  const { broker } = harness()
  assert.throws(() => broker.subscribe(() => undefined), PluginHostError)
})

const viewportHarness = (options: {
  grants?: readonly string[]
  result?: InteractionResult | null
  throws?: unknown
  zoomBacking?: boolean
} = {}) => {
  const base = harness()
  const picked: string[] = []
  const zoomed: ViewportZoomTarget[] = []
  const backing = async () => {
    if (options.throws) throw options.throws
    return options.result ?? null
  }
  const interactions: PluginViewportInteractions = {
    pickEntities: sessionOwner => { picked.push(sessionOwner.id); return backing() },
    pickPoint: sessionOwner => { picked.push(sessionOwner.id); return backing() },
    drawPolyline: sessionOwner => { picked.push(sessionOwner.id); return backing() },
    zoomTo: (options.zoomBacking ?? true) ? target => { zoomed.push(target) } : undefined,
  }
  const broker = createPluginCommandBroker(
    { ...base.services, interactions },
    owner,
    (options.grants ?? ['viewport.pick', 'viewport.draw', 'viewport.zoomTo']) as readonly PluginSessionPermission[],
  )
  return { ...base, picked, zoomed, broker }
}

test('viewport picking requires the viewport.pick grant and fails closed', async () => {
  const { broker } = viewportHarness({ grants: ['model.read'] })
  const outcome = await broker.pickEntities({ kind: 'pickEntities', collections: ['members'], mode: 'click' })
  assert.equal(outcome.ok, false)
  if (outcome.ok) return
  assert.equal(outcome.code, 'PERMISSION_DENIED')
})

test('viewport specs are validated fail-closed before reaching the host', async () => {
  const { broker, picked } = viewportHarness()
  const outcome = await broker.pickEntities({ kind: 'pickEntities', collections: [], mode: 'click' })
  assert.equal(outcome.ok, false)
  if (outcome.ok) return
  assert.equal(outcome.code, 'INVALID_SPEC')
  assert.equal(picked.length, 0)
})

test('a user-cancelled interaction maps to the CANCELLED outcome', async () => {
  const { broker, picked } = viewportHarness()
  const outcome = await broker.pickPoint({ kind: 'pickPoint', plane: 'activeWorkplane' })
  assert.equal(outcome.ok, false)
  if (outcome.ok) return
  assert.equal(outcome.code, 'CANCELLED')
  assert.deepEqual(picked, [owner.id])
})

test('host interaction errors map to structured VIEWPORT_BUSY outcomes', async () => {
  const { broker } = viewportHarness({ throws: new InteractionBusyError(owner) })
  const outcome = await broker.pickPoint({ kind: 'pickPoint', plane: 'activeWorkplane' })
  assert.equal(outcome.ok, false)
  if (outcome.ok) return
  assert.equal(outcome.code, 'VIEWPORT_BUSY')
})

test('a completed viewport interaction resolves ok with the result', async () => {
  const result: InteractionResult = { kind: 'pickEntities', entities: [{ collection: 'members', id: 10 }] }
  const { broker } = viewportHarness({ result })
  const outcome = await broker.drawPolyline({ kind: 'drawPolyline', plane: 'world', minVertices: 2 })
  assert.equal(outcome.ok, true)
  if (!outcome.ok) return
  assert.equal(outcome.result, result)
})

test('missing viewport backing fails closed with UNAVAILABLE', async () => {
  const base = harness()
  const broker = createPluginCommandBroker(base.services, owner, ['viewport.pick'])
  const outcome = await broker.pickEntities({ kind: 'pickEntities', collections: ['nodes'], mode: 'click' })
  assert.equal(outcome.ok, false)
  if (outcome.ok) return
  assert.equal(outcome.code, 'UNAVAILABLE')
})

test('viewport.zoomTo is gated, delegates and fails closed without backing', () => {
  const { broker, zoomed } = viewportHarness()
  broker.zoomTo({ kind: 'selection' })
  broker.zoomTo({ kind: 'point', position: [1, 2, 3] })
  assert.equal(zoomed.length, 2)

  const gated = viewportHarness({ grants: ['model.read'] })
  assert.throws(
    () => gated.broker.zoomTo({ kind: 'selection' }),
    (err: unknown) => err instanceof PluginHostError && err.code === 'PERMISSION_DENIED',
  )

  const noBacking = viewportHarness({ zoomBacking: false })
  assert.throws(
    () => noBacking.broker.zoomTo({ kind: 'selection' }),
    (err: unknown) => err instanceof PluginHostError && err.code === 'UNAVAILABLE',
  )
})


