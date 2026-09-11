import { InteractionError, InteractionSession } from './InteractionSession.ts'
import type {
  InteractionBudgets,
  InteractionEntityCollection,
  InteractionOwner,
  InteractionResult,
  InteractionSpec,
  PickPointSpec,
  DrawPolylineSpec,
  PolylineVertex,
} from './InteractionSession.ts'
import type { ViewportPoint } from './ViewportPointResolution.ts'
import type { EntityReference, Vector3Record } from '../structural/types.ts'

/** Pointer position delivered by the host event loop (NDC-style x/y). */
export type ViewportPointerEvent = Readonly<{ x: number; y: number }>

/** Host viewport binding; dropped via `disconnect` on every session end. */
export type ViewportConnection = Readonly<{
  disconnect: () => void
}>

export type ViewportDriverHandlers = Readonly<{
  pointerMove: (pointer: ViewportPointerEvent) => void
  click: (pointer: ViewportPointerEvent) => void
  rightClick: (pointer: ViewportPointerEvent) => void
  keyDown: (key: string) => void
}>

/** Host viewport capabilities the driver drives (Goal 3 slice 3.2). The app
 *  injects these exactly like `PluginCommandServices` so the gesture state
 *  machines stay pure and testable without React, the canvas or THREE. */
export type ViewportDriverHost = Readonly<{
  /** Return false to block the session from taking the viewport. */
  canTakeViewport: () => boolean
  /** Status/prompt line while the session is active. */
  onPrompt: (message: string | null) => void
  /** Apply/restore the gesture cursor. */
  setCursor?: (cursor: string | null) => void
  /** Resolve a pointer to a world point with snap provenance (or null when
   *  nothing may be accepted — e.g. 3D without a node snap). */
  resolvePoint: (pointer: ViewportPointerEvent, spec: PickPointSpec | DrawPolylineSpec) => ViewportPoint | null
  /** Entity hits at a pointer for the requested collections (click mode). */
  pickEntities: (pointer: ViewportPointerEvent, collections: readonly InteractionEntityCollection[]) => readonly EntityReference[]
  /** Entity hits inside the [from, to] screen rectangle (window mode). */
  pickWindow: (from: ViewportPointerEvent, to: ViewportPointerEvent, collections: readonly InteractionEntityCollection[]) => readonly EntityReference[]
  /** Bind the gesture handlers to the real viewport. Return the connection. */
  connect: (handlers: ViewportDriverHandlers) => ViewportConnection
  /** Budget tick driven by the host event loop. */
  checkBudget?: () => void
  /** Injectable clock forwarded to the session. */
  now?: () => number
}>

/** Build an `InteractionSession` whose host callbacks map onto a driver host —
 *  the single wiring point for the app (and for tests). */
export const createDriverSession = (
  owner: InteractionOwner,
  spec: InteractionSpec,
  host: ViewportDriverHost,
  budgets?: Partial<InteractionBudgets>,
): InteractionSession => new InteractionSession({
  owner,
  spec,
  budgets,
  host: {
    canTakeViewport: host.canTakeViewport,
    now: host.now,
    onPrompt: host.onPrompt,
    onGestureStart: (_spec, cursor) => { host.setCursor?.(cursor) },
    onGestureEnd: cursor => { host.setCursor?.(null) },
  },
})

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
/**
 * Generic viewport gesture driver (Goal 3 slice 3.2). It assembles one
 * `InteractionSession` with the host viewport: binds the gesture handlers for
 * the lifetime of the session, accumulates picks/vertices, resolves the
 * `InteractionResult` on completion and rejects with a structured
 * `InteractionError` on cancellation (Escape / right-click / timeout / owner
 * release). The session's single-owner gate guarantees only one driver can own
 * the viewport at a time.
 */
export class ViewportDriver {
  private readonly session: InteractionSession
  private readonly host: ViewportDriverHost
  private readonly spec: InteractionSpec
  private readonly deferred = createDeferred<InteractionResult>()
  private finished = false
  private entities: EntityReference[] = []
  private vertices: PolylineVertex[] = []
  private windowStart: ViewportPointerEvent | null = null

  constructor(session: InteractionSession, host: ViewportDriverHost) {
    this.session = session
    this.host = host
    this.spec = session.spec
  }

  /** Run the gesture to completion. Rejects on any cancellation. */
  async run(): Promise<InteractionResult> {
    if (this.session.currentPhase !== 'idle') {
      throw new InteractionError('ALREADY_STARTED', `Interaction ${this.session.owner.id} already started`)
    }
    this.session.begin()
    const connection = this.host.connect({
      pointerMove: () => this.onPointerMove(),
      click: pointer => this.onClick(pointer),
      rightClick: () => this.onRightClick(),
      keyDown: key => this.onKey(key),
    })
    // Guaranteed teardown no matter how the session ends (roadmap exit gate:
    // no dangling listener / cursor after completion, cancellation, timeout or
    // crash) — and the reject path observes an external cancel/timeout/owner
    // release that `finish()` never triggered.
    this.session.addCleanup(() => {
      connection.disconnect()
      this.host.setCursor?.(null)
      if (!this.finished) {
        this.finished = true
        this.deferred.reject(
          new InteractionError('CANCELLED', `Interaction ${this.session.owner.id} ended without a result`),
        )
      }
    })
    return this.deferred.promise
  }
private onPointerMove() {
    this.host.checkBudget?.()
  }

  private onClick(pointer: ViewportPointerEvent) {
    if (this.finished) return
    switch (this.spec.kind) {
      case 'pickEntities': {
        if (this.spec.mode === 'window') {
          if (this.windowStart === null) {
            this.windowStart = pointer
            this.host.onPrompt('Pick the opposite window corner — Esc to cancel')
            return
          }
          const hits = this.host.pickWindow(this.windowStart, pointer, this.spec.collections)
          this.finish({ kind: 'pickEntities', entities: hits })
          return
        }
        const hits = this.host.pickEntities(pointer, this.spec.collections)
        for (const hit of hits) {
          if (!this.entities.some(existing => existing.collection === hit.collection && existing.id === hit.id)) {
            this.entities.push(hit)
          }
        }
        const max = this.spec.max ?? Number.POSITIVE_INFINITY
        if (this.entities.length >= max) {
          this.finish({ kind: 'pickEntities', entities: this.entities })
          return
        }
        this.host.onPrompt(`Picked ${this.entities.length} — click more or right-click to finish (Esc to cancel)`)
        return
      }
      case 'pickPoint': {
        const point = this.host.resolvePoint(pointer, this.spec)
        if (!point) {
          this.host.onPrompt('Nothing to snap here — Esc to cancel')
          return
        }
        this.finish(this.pointResult(point))
        return
      }
      case 'drawPolyline': {
        const point = this.host.resolvePoint(pointer, this.spec)
        if (!point) return
        // Keep the snap provenance on the vertex: the Draw Member plan reuses
        // the existing node instead of creating a duplicate at the same spot.
        this.vertices.push(
          point.snappedNodeId === undefined
            ? { position: point.position }
            : { position: point.position, snappedNodeId: point.snappedNodeId },
        )
        const min = this.spec.minVertices ?? 2
        const remaining = Math.max(0, min - this.vertices.length)
        this.host.onPrompt(
          remaining > 0
            ? `Vertex ${this.vertices.length} — need ${remaining} more (right-click to cancel)`
            : `Vertex ${this.vertices.length} — right-click to finish (Esc to cancel)`,
        )
        return
      }
    }
  }

  private onRightClick() {
    if (this.finished) return
    switch (this.spec.kind) {
      case 'pickEntities': {
        if (this.spec.mode === 'click' && this.entities.length > 0) {
          this.finish({ kind: 'pickEntities', entities: this.entities })
          return
        }
        this.session.cancel('user')
        return
      }
      case 'pickPoint':
        this.session.cancel('user')
        return
      case 'drawPolyline': {
        if (this.vertices.length >= (this.spec.minVertices ?? 2)) {
          this.finish({ kind: 'drawPolyline', vertices: this.vertices })
          return
        }
        this.session.cancel('user')
        return
      }
    }
  }

  private onKey(key: string) {
    if (this.finished) return
    if (key === 'Enter') {
      if (this.canFinish()) this.finish(this.currentResult())
      return
    }
    this.session.handleKey(key)
  }

  private canFinish(): boolean {
    switch (this.spec.kind) {
      case 'pickEntities':
        return this.spec.mode === 'click' && this.entities.length > 0
      case 'pickPoint':
        return false
      case 'drawPolyline':
        return this.vertices.length >= (this.spec.minVertices ?? 2)
    }
  }

  private currentResult(): InteractionResult {
    switch (this.spec.kind) {
      case 'pickEntities': return { kind: 'pickEntities', entities: this.entities }
      case 'pickPoint': throw new InteractionError('REJECTED', 'pickPoint has no Enter result')
      case 'drawPolyline': return { kind: 'drawPolyline', vertices: this.vertices }
    }
  }

  private pointResult(point: ViewportPoint): InteractionResult {
    return {
      kind: 'pickPoint',
      position: point.position,
      ...(point.snappedNodeId !== undefined ? { snappedNodeId: point.snappedNodeId } : {}),
      ...(point.memberId !== undefined ? { memberId: point.memberId } : {}),
      ...(point.memberRatio !== undefined ? { memberRatio: point.memberRatio } : {}),
    } as Extract<InteractionResult, { kind: 'pickPoint' }>
  }

  private finish(result: InteractionResult) {
    if (this.finished) return
    this.finished = true
    this.session.complete(result)
    this.deferred.resolve(result)
  }
}