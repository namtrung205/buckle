import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'
import type {
  InteractionResult,
  InteractionSessionHost,
  InteractionSpec,
} from './index.ts'
import {
  getActiveInteraction,
  InteractionBusyError,
  InteractionError,
  InteractionSession,
} from './index.ts'

const OWNER = { kind: 'plugin', id: 'com.buckle.samples.drawmember', version: '0.0.1' } as const

const expectCode = (fn: () => void, code: string) => {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof InteractionError)
    return err.code === code
  })
}

/** Every session a test creates; the afterEach drains any still-active one so
 *  the module-level single-owner gate never leaks between tests. */
const createdSessions: InteractionSession[] = []
afterEach(() => {
  for (const session of createdSessions) session.cancel('owner')
})

const harness = (options: {
  locked?: boolean
  sessionMs?: number
  onKey?: (key: string) => boolean
} = {}) => {
  let ms = 0
  const prompts: (string | null)[] = []
  const gestures: { spec: InteractionSpec; cursor: string }[] = []
  const gestureEnds: string[] = []
  const keys: string[] = []
  const host: InteractionSessionHost = {
    canTakeViewport: () => !(options.locked ?? false),
    now: () => ms,
    onKey: (key: string) => {
      keys.push(key)
      return options.onKey?.(key) ?? false
    },
    onPrompt: message => { prompts.push(message) },
    onGestureStart: (spec, cursor) => { gestures.push({ spec, cursor }) },
    onGestureEnd: cursor => { gestureEnds.push(cursor) },
  }
  const session = new InteractionSession({
    owner: OWNER,
    spec: { kind: 'pickEntities', collections: ['nodes', 'members'], mode: 'click' },
    budgets: { sessionMs: options.sessionMs ?? 100 },
    host,
  })
  createdSessions.push(session)
  return { session, host, prompts, gestures, gestureEnds, keys, advance: (delta: number) => { ms += delta } }
}

test('begin activates the session and applies the host gesture cursor and prompt', () => {
  const { session, prompts, gestures } = harness()
  assert.equal(session.currentPhase, 'idle')
  session.begin()
  assert.equal(session.currentPhase, 'active')
  assert.equal(session.active, true)
  assert.equal(prompts[0], 'Click entities to pick — Esc to cancel')
  assert.equal(gestures[0]?.cursor, 'crosshair')
  assert.equal(gestures[0]?.spec.kind, 'pickEntities')
  assert.equal(getActiveInteraction(), session)
})

test('only one session can own the viewport — a second begin fails with VIEWPORT_BUSY', () => {
  const { session } = harness()
  session.begin()
  const second = new InteractionSession({
    owner: OWNER,
    spec: { kind: 'pickPoint', plane: 'activeWorkplane' },
    budgets: { sessionMs: 100 },
    host: { now: () => 0 },
  })
  expectCode(() => second.begin(), 'VIEWPORT_BUSY')
  assert.equal(second.currentPhase, 'idle')
  assert.equal(getActiveInteraction(), session)
  assert.ok(second instanceof InteractionSession)
  assert.ok(
    (() => {
      try { second.begin() } catch (err) { return err instanceof InteractionBusyError && err.currentOwner.id === OWNER.id }
      return false
    })(),
  )
})

test('begin fails closed when the host locks the viewport', () => {
  const { session } = harness({ locked: true })
  expectCode(() => session.begin(), 'VIEWPORT_LOCKED')
  assert.equal(session.currentPhase, 'idle')
  assert.equal(getActiveInteraction(), null)
})

test('begin defuses duplicate starts on the same session', () => {
  const { session } = harness()
  session.begin()
  expectCode(() => session.begin(), 'ALREADY_STARTED')
  assert.equal(session.active, true)
  session.cancel('user')
})

test('Escape cancels with the user reason and restores cursor and prompt', () => {
  const { session, prompts, gestureEnds } = harness()
  session.begin()
  assert.equal(session.handleKey('Escape'), true)
  assert.equal(session.currentPhase, 'cancelled')
  assert.deepEqual(session.ended, { phase: 'cancelled', reason: 'user' })
  assert.equal(prompts[prompts.length - 1], null)
  assert.equal(gestureEnds[gestureEnds.length - 1], 'crosshair')
  assert.equal(getActiveInteraction(), null)
  // A key after termination is never consumed.
  assert.equal(session.handleKey('Escape'), false)
})

test('cleanups run exactly once on cancel; a late registration runs immediately', () => {
  const { session } = harness()
  const ran: number[] = []
  session.begin()
  session.addCleanup(() => ran.push(1))
  session.addCleanup(() => ran.push(2))
  assert.equal(session.cancel('owner'), true)
  assert.deepEqual(ran, [1, 2])
  // Idempotent: a repeated cancel changes nothing.
  assert.equal(session.cancel('user'), false)
  assert.deepEqual(ran, [1, 2])
  // A binding registered after the session ended must never leak.
  session.addCleanup(() => ran.push(3))
  assert.deepEqual(ran, [1, 2, 3])
})

test('complete stores the result, releases the viewport and refuses to rerun', () => {
  const { session } = harness()
  session.begin()
  const result: InteractionResult = {
    kind: 'pickEntities',
    entities: [{ collection: 'nodes', id: 7 }, { collection: 'members', id: 11 }],
  }
  assert.equal(session.complete(result), result)
  assert.deepEqual(session.ended, { phase: 'completed' })
  assert.equal(session.lastResult, result)
  assert.equal(getActiveInteraction(), null)
  expectCode(() => session.complete(result), 'NOT_ACTIVE')
})
const sessionFor = (spec: unknown) => {
  const session = new InteractionSession({
    owner: OWNER,
    spec: spec as InteractionSpec,
    budgets: { sessionMs: 100 },
    host: { now: () => 0 },
  })
  createdSessions.push(session)
  return session
}

test('remainingMs shrinks deterministically and the timeout budget cancels', () => {
  const { session, advance } = harness({ sessionMs: 100 })
  session.begin()
  assert.equal(session.checkBudget(), false)
  assert.equal(session.remainingMs, 100)
  advance(50)
  assert.equal(session.checkBudget(), false)
  assert.equal(session.remainingMs, 50)
  advance(50)
  assert.equal(session.checkBudget(), true)
  assert.equal(session.currentPhase, 'cancelled')
  assert.deepEqual(session.ended, { phase: 'cancelled', reason: 'timeout' })
  assert.equal(session.remainingMs, 0)
  // Once terminated, budget checks are inert.
  assert.equal(session.checkBudget(), false)
})

test('Enter stays a no-op and the host onKey hook can consume keys', () => {
  const { session, keys } = harness()
  session.begin()
  assert.equal(session.handleKey('Enter'), false)
  assert.equal(session.currentPhase, 'active')
  assert.deepEqual(keys, ['Enter'])
  // Enter must not cancel — the session stays active.
  assert.equal(session.cancel('user'), true)

  const intercepted = harness({ onKey: key => key === 'X' })
  intercepted.session.begin()
  assert.equal(intercepted.session.handleKey('X'), true)
  assert.equal(intercepted.session.currentPhase, 'active')
  assert.equal(intercepted.session.handleKey('Escape'), true)
  assert.equal(intercepted.session.currentPhase, 'cancelled')
})

test('complete without a result still completes and stores null', () => {
  const { session } = harness()
  session.begin()
  assert.equal(session.complete(), null)
  assert.deepEqual(session.ended, { phase: 'completed' })
})

test('spec validation fails closed on malformed plugin payloads', () => {
  expectCode(() => sessionFor({ kind: 'not-a-kind' }), 'INVALID_SPEC')
  expectCode(() => sessionFor(null), 'INVALID_SPEC')
  expectCode(() => sessionFor({ kind: 'pickEntities', collections: [], mode: 'click' }), 'INVALID_SPEC')
  expectCode(() => sessionFor({ kind: 'pickEntities', collections: ['beams'], mode: 'click' }), 'INVALID_SPEC')
  expectCode(() => sessionFor({ kind: 'pickEntities', collections: ['nodes'], mode: 'rubber' }), 'INVALID_SPEC')
  expectCode(() => sessionFor({ kind: 'pickEntities', collections: ['nodes'], mode: 'click', min: 3, max: 2 }), 'INVALID_SPEC')
  expectCode(() => sessionFor({ kind: 'pickEntities', collections: ['nodes'], mode: 'click', max: 0 }), 'INVALID_SPEC')
  expectCode(() => sessionFor({ kind: 'pickPoint', plane: 'ocean-floor' }), 'INVALID_SPEC')
  expectCode(() => sessionFor({ kind: 'pickPoint', plane: 'world', snap: ['grid', 'scripts'] }), 'INVALID_SPEC')
  expectCode(() => sessionFor({ kind: 'drawPolyline', plane: 'world', minVertices: 1 }), 'INVALID_SPEC')
  // Valid specs construct cleanly (the pickEntities harness spec already did).
  assert.equal(sessionFor({ kind: 'pickPoint', plane: 'activeWorkplane', snap: ['node', 'member'] }).currentPhase, 'idle')
  assert.equal(sessionFor({ kind: 'drawPolyline', plane: 'world', minVertices: 3, close: true }).currentPhase, 'idle')
})

test('a throwing cleanup never prevents the rest and surfaces after all ran', () => {
  const { session } = harness()
  const ran: number[] = []
  session.begin()
  session.addCleanup(() => { throw new Error('boom') })
  session.addCleanup(() => ran.push(1))
  assert.throws(() => session.cancel('user'), (err: unknown) => (err as Error).message === 'boom')
  assert.deepEqual(ran, [1])
  assert.equal(session.currentPhase, 'cancelled')
  assert.equal(getActiveInteraction(), null)
})