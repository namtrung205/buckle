import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'
import {
  createDriverSession,
  InteractionError,
  InteractionSession,
  ViewportDriver,
} from './index.ts'
import type {
  InteractionSpec,
  ViewportDriverHandlers,
  ViewportDriverHost,
  ViewportPointerEvent,
} from './index.ts'

const OWNER = { kind: 'plugin', id: 'com.buckle.samples.drawmember', version: '0.0.2' } as const

/** Every session a test creates; the afterEach drains still-active ones so the
 *  single-owner gate never leaks between tests. */
const created: InteractionSession[] = []
afterEach(() => {
  for (const session of created) session.cancel('owner')
})

const harness = (
  spec: InteractionSpec,
  options: Partial<ViewportDriverHost> & { sessionMs?: number } = {},
) => {
  const { sessionMs, ...hostOverrides } = options
  const prompts: (string | null)[] = []
  const cursors: (string | null)[] = []
  let handlers: ViewportDriverHandlers | null = null
  let disconnected = 0
  const host: ViewportDriverHost = {
    canTakeViewport: () => true,
    onPrompt: message => { prompts.push(message) },
    setCursor: cursor => { cursors.push(cursor) },
    resolvePoint: pointer => ({ position: [pointer.x, pointer.y, 0] as const }),
    pickEntities: pointer => [{ collection: 'members', id: Math.round(pointer.x) }],
    pickWindow: (_from, to) => [{ collection: 'nodes', id: Math.round(to.x) }],
    connect: next => {
      handlers = next
      return { disconnect: () => { disconnected += 1 } }
    },
    ...hostOverrides,
  }
  const session = createDriverSession(OWNER, spec, host, { sessionMs: sessionMs ?? 100 })
  created.push(session)
  const driver = new ViewportDriver(session, host)
  const fire = {
    click: (pointer: ViewportPointerEvent) => handlers!.click(pointer),
    right: () => handlers!.rightClick({ x: 0, y: 0 }),
    key: (key: string) => handlers!.keyDown(key),
    move: (pointer: ViewportPointerEvent) => handlers!.pointerMove(pointer),
  }
  return { session, driver, prompts, cursors, disconnected: () => disconnected, fire }
}

test('pickPoint resolves on the first acceptable click and tears the binding down', async () => {
  const { session, driver, fire, cursors, disconnected } = harness({ kind: 'pickPoint', plane: 'activeWorkplane' })
  const running = driver.run()
  fire.click({ x: 3, y: 4 })
  const result = await running
  assert.deepEqual(result, { kind: 'pickPoint', position: [3, 4, 0] })
  assert.equal(session.currentPhase, 'completed')
  assert.equal(disconnected(), 1)
  assert.equal(cursors[cursors.length - 1], null)
})

test('pickEntities click-mode accumulates unique hits and completes at max', async () => {
  const { driver, fire } = harness({
    kind: 'pickEntities', collections: ['members'], mode: 'click', max: 2,
  })
  const running = driver.run()
  fire.click({ x: 1, y: 0 })
  fire.click({ x: 2, y: 0 })
  fire.click({ x: 1, y: 0 })
  const result = await running
  assert.equal(result.kind, 'pickEntities')
  if (result.kind !== 'pickEntities') return
  assert.deepEqual(result.entities, [{ collection: 'members', id: 1 }, { collection: 'members', id: 2 }])
})

test('pickEntities window-mode resolves on the second corner', async () => {
  const { driver, fire } = harness({ kind: 'pickEntities', collections: ['nodes'], mode: 'window' })
  const running = driver.run()
  fire.click({ x: 0, y: 0 })
  fire.click({ x: 5, y: 2 })
  const result = await running
  assert.equal(result.kind, 'pickEntities')
  if (result.kind !== 'pickEntities') return
  assert.deepEqual(result.entities, [{ collection: 'nodes', id: 5 }])
})

test('pickEntities click-mode finishes on Enter', async () => {
  const { session, driver, fire } = harness({ kind: 'pickEntities', collections: ['nodes'], mode: 'click' })
  const running = driver.run()
  fire.click({ x: 10, y: 0 })
  assert.equal(session.currentPhase, 'active')
  fire.key('Enter')
  const result = await running
  assert.equal(result.kind, 'pickEntities')
  assert.equal(session.currentPhase, 'completed')
})
test('drawPolyline collects vertices and right-click finishes at the minimum', async () => {
  const { session, driver, fire } = harness({ kind: 'drawPolyline', plane: 'world', minVertices: 2 })
  const running = driver.run()
  fire.click({ x: 1, y: 0 })
  fire.click({ x: 2, y: 0 })
  fire.right()
  const result = await running
  assert.deepEqual(result, {
    kind: 'drawPolyline',
    vertices: [{ position: [1, 0, 0] }, { position: [2, 0, 0] }],
  })
  assert.equal(session.currentPhase, 'completed')
})

test('drawPolyline keeps node snap provenance on each vertex', async () => {
  const { driver, fire } = harness(
    { kind: 'drawPolyline', plane: 'activeWorkplane', minVertices: 2 },
    {
      resolvePoint: (pointer): ReturnType<ViewportDriverHost['resolvePoint']> =>
        pointer.x < 2
          ? { position: [1, 0, 0], snappedNodeId: 7 }
          : { position: [4, 0, 0] },
    },
  )
  const running = driver.run()
  fire.click({ x: 1, y: 0 })
  fire.click({ x: 4, y: 0 })
  fire.right()
  const result = await running
  assert.deepEqual(result, {
    kind: 'drawPolyline',
    vertices: [{ position: [1, 0, 0], snappedNodeId: 7 }, { position: [4, 0, 0] }],
  })
})

test('drawPolyline right-click before the minimum cancels', async () => {
  const { session, driver, fire } = harness({ kind: 'drawPolyline', plane: 'world', minVertices: 3 })
  const running = driver.run()
  fire.click({ x: 1, y: 0 })
  fire.click({ x: 2, y: 0 })
  fire.right()
  await assert.rejects(running, (err: unknown) => (err as InteractionError).code === 'CANCELLED')
  assert.equal(session.currentPhase, 'cancelled')
})

test('Escape cancels, rejects with CANCELLED and disconnects exactly once', async () => {
  const { session, driver, fire, disconnected } = harness({ kind: 'pickPoint', plane: 'activeWorkplane' })
  const running = driver.run()
  fire.key('Escape')
  await assert.rejects(running, (err: unknown) => (err as InteractionError).code === 'CANCELLED')
  assert.equal(session.currentPhase, 'cancelled')
  assert.equal(disconnected(), 1)
})

test('right-click cancels pickPoint immediately', async () => {
  const { session, driver, fire } = harness({ kind: 'pickPoint', plane: 'activeWorkplane' })
  const running = driver.run()
  fire.right()
  await assert.rejects(running, (err: unknown) => (err as InteractionError).code === 'CANCELLED')
  assert.equal(session.currentPhase, 'cancelled')
})

test('the single-owner gate blocks a second driver while the viewport is taken', async () => {
  const first = harness({ kind: 'pickPoint', plane: 'activeWorkplane' })
  const second = harness({ kind: 'pickPoint', plane: 'activeWorkplane' })
  const running = first.driver.run()
  await assert.rejects(second.driver.run(), (err: unknown) => (err as InteractionError).code === 'VIEWPORT_BUSY')
  first.fire.click({ x: 1, y: 0 })
  const result = await running
  assert.equal(result.kind, 'pickPoint')
})

test('budget expiry through the host tick cancels and rejects the driver', async () => {
  let external: InteractionSession | null = null
  const { session, driver, fire } = harness(
    { kind: 'pickPoint', plane: 'activeWorkplane' },
    {
      sessionMs: 0,
      checkBudget: () => { external?.checkBudget() },
    },
  )
  external = session
  const running = driver.run()
  fire.move({ x: 0, y: 0 })
  await assert.rejects(running, (err: unknown) => (err as InteractionError).code === 'CANCELLED')
  assert.equal(session.currentPhase, 'cancelled')
})

test('resolvePoint returning null keeps pickPoint active with a prompt', async () => {
  const { session, driver, fire, prompts } = harness(
    { kind: 'pickPoint', plane: 'activeWorkplane' },
    {
      resolvePoint: () => null,
    },
  )
  const running = driver.run()
  fire.click({ x: 1, y: 1 })
  assert.equal(session.currentPhase, 'active')
  assert.equal(prompts[prompts.length - 1], 'Nothing to snap here — Esc to cancel')
  fire.key('Escape')
  await assert.rejects(running, (err: unknown) => (err as InteractionError).code === 'CANCELLED')
})
