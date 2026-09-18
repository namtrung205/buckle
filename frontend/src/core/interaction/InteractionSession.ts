import type { EntityReference, Vector3Record } from '../structural/types.ts'

/** Identity of the component that requested an interaction. Plugins carry their
 *  id/version (which the broker later audits); built-in host drivers use
 *  `builtin`. */
export type InteractionOwner = Readonly<{
  kind: 'plugin' | 'builtin'
  id: string
  version?: string
}>

/** Why an interaction ended without producing a result. */
export type InteractionCancelReason =
  | 'user'      // Escape / right-click / explicit cancel()
  | 'owner'     // the requesting component released or unmounted
  | 'timeout'   // the session budget expired
  | 'conflict'  // another interaction claimed the viewport

export type InteractionPhase = 'idle' | 'active' | 'completed' | 'cancelled'

/** What the requested interaction is allowed to do on the viewport. */
export type InteractionGestureKind = 'pick' | 'draw'

/** Collections a pick interaction may target. */
export type InteractionEntityCollection = 'nodes' | 'members' | 'shells'
export type InteractionPickMode = 'click' | 'window'

export type InteractionSnapOption = 'grid' | 'node' | 'endpoint' | 'member'
export type InteractionPlaneOption = 'activeWorkplane' | 'world'

export type PickEntitiesSpec = Readonly<{
  kind: 'pickEntities'
  collections: readonly InteractionEntityCollection[]
  mode: InteractionPickMode
  /** Optional selection-count contract (enforced by the picking driver). */
  min?: number
  max?: number
}>

export type PickPointSpec = Readonly<{
  kind: 'pickPoint'
  plane: InteractionPlaneOption
  snap?: readonly InteractionSnapOption[]
  ortho?: boolean
}>

export type DrawPolylineSpec = Readonly<{
  kind: 'drawPolyline'
  plane: InteractionPlaneOption
  snap?: readonly InteractionSnapOption[]
  minVertices?: number
  close?: boolean
}>

export type InteractionSpec = PickEntitiesSpec | PickPointSpec | DrawPolylineSpec

/** One collected polyline vertex — a world position plus optional node snap
 *  provenance so the Draw Member plan can reuse existing nodes in 3D
 *  node-to-node mode (Goal 3). */
export type PolylineVertex = Readonly<{
  position: Vector3Record
  snappedNodeId?: number
}>

/** Result contract produced by the interaction drivers (slices 3.2/3.3). */
export type InteractionResult = Readonly<
  | { kind: 'pickEntities'; entities: readonly EntityReference[] }
  | {
    kind: 'pickPoint'
    position: Vector3Record
    snappedNodeId?: number
    memberId?: number
    memberRatio?: number
  }
  | { kind: 'drawPolyline'; vertices: readonly PolylineVertex[] }
>

export type InteractionBudgets = Readonly<{
  /** Max wall-clock budget for one interaction, in ms. */
  sessionMs: number
}>

export const DEFAULT_INTERACTION_BUDGETS: InteractionBudgets = {
  sessionMs: 120_000,
}

export class InteractionError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'InteractionError'
    this.code = code
  }
}

export class InteractionBusyError extends InteractionError {
  readonly currentOwner: InteractionOwner

  constructor(currentOwner: InteractionOwner) {
    super('VIEWPORT_BUSY', `Viewport is already owned by interaction ${currentOwner.id}`)
    this.currentOwner = currentOwner
  }
}

export class InteractionLockedError extends InteractionError {
  constructor(message = 'Viewport interaction is locked by the host') {
    super('VIEWPORT_LOCKED', message)
  }
}
/** Single active interaction anywhere in the host (roadmap design rule 4:
 *  interactive picking/snapping/pointer ownership stays host-owned — only one
 *  session can own the viewport). A module-level gate makes the rule
 *  un-bypassable by any broker, tool or plugin path. */
let activeInteraction: InteractionSession | null = null
export const getActiveInteraction = () => activeInteraction

const SNAP_OPTIONS = ['grid', 'node', 'endpoint', 'member'] as const
const PLANE_OPTIONS = ['activeWorkplane', 'world'] as const
const ENTITY_COLLECTIONS = ['nodes', 'members', 'shells'] as const

export const isInteractionSnapOption = (value: unknown): value is InteractionSnapOption =>
  typeof value === 'string' && SNAP_OPTIONS.includes(value as InteractionSnapOption)
export const isInteractionPlaneOption = (value: unknown): value is InteractionPlaneOption =>
  typeof value === 'string' && PLANE_OPTIONS.includes(value as InteractionPlaneOption)
export const isInteractionEntityCollection = (value: unknown): value is InteractionEntityCollection =>
  typeof value === 'string' && ENTITY_COLLECTIONS.includes(value as InteractionEntityCollection)

const assertPlane = (plane: unknown) => {
  if (!isInteractionPlaneOption(plane)) {
    throw new InteractionError('INVALID_SPEC', `Unknown plane ${String(plane)}`)
  }
}

const assertSnaps = (snap: unknown) => {
  if (snap === undefined) return
  if (!Array.isArray(snap)) throw new InteractionError('INVALID_SPEC', 'snap must be an array')
  for (const option of snap) {
    if (!isInteractionSnapOption(option)) {
      throw new InteractionError('INVALID_SPEC', `Unknown snap option ${String(option)}`)
    }
  }
}

/** Validate a spec coming from an untrusted plugin payload; fail closed like
 *  the command boundary (roadmap rule 3 / Goal 0). */
export function validateInteractionSpec(spec: unknown): asserts spec is InteractionSpec {
  if (!spec || typeof spec !== 'object') {
    throw new InteractionError('INVALID_SPEC', 'Interaction spec must be an object')
  }
  const kind = (spec as { kind?: unknown }).kind
  if (kind === 'pickEntities') {
    const candidate = spec as Partial<PickEntitiesSpec>
    if (!candidate.collections || !Array.isArray(candidate.collections) || candidate.collections.length === 0) {
      throw new InteractionError('INVALID_SPEC', 'pickEntities requires at least one collection')
    }
    for (const collection of candidate.collections) {
      if (!isInteractionEntityCollection(collection)) {
        throw new InteractionError('INVALID_SPEC', `Unknown pick collection ${String(collection)}`)
      }
    }
    if (candidate.mode !== 'click' && candidate.mode !== 'window') {
      throw new InteractionError('INVALID_SPEC', `Unknown pick mode ${String(candidate.mode)}`)
    }
    if (candidate.min !== undefined && candidate.min < 0) {
      throw new InteractionError('INVALID_SPEC', 'pickEntities.min cannot be negative')
    }
    if (candidate.max !== undefined && candidate.max < 1) {
      throw new InteractionError('INVALID_SPEC', 'pickEntities.max must be at least 1')
    }
    if (candidate.min !== undefined && candidate.max !== undefined && candidate.min > candidate.max) {
      throw new InteractionError('INVALID_SPEC', 'pickEntities.min cannot exceed max')
    }
    return
  }
  if (kind === 'pickPoint') {
    assertPlane((spec as PickPointSpec).plane)
    assertSnaps((spec as PickPointSpec).snap)
    return
  }
  if (kind === 'drawPolyline') {
    assertPlane((spec as DrawPolylineSpec).plane)
    assertSnaps((spec as DrawPolylineSpec).snap)
    const minVertices = (spec as DrawPolylineSpec).minVertices
    if (minVertices !== undefined && minVertices < 2) {
      throw new InteractionError('INVALID_SPEC', 'drawPolyline.minVertices must be at least 2')
    }
    return
  }
  throw new InteractionError('INVALID_SPEC', `Unknown interaction kind ${String(kind)}`)
}
/** Host-side viewport services the session drives. The app injects these so the
 *  coordinator stays pure TypeScript and testable without React, the canvas or
 *  THREE (same seam pattern as `PluginCommandServices`). */
export type InteractionSessionHost = Readonly<{
  /** Return false to block the session from taking the viewport. */
  canTakeViewport?: () => boolean
  /** Host status/prompt label shown while the session is active. */
  onPrompt?: (message: string | null) => void
  /** Apply the gesture cursor/mode when the session starts. */
  onGestureStart?: (spec: InteractionSpec, cursor: string) => void
  /** Restore the previous cursor when the session ends. */
  onGestureEnd?: (cursor: string) => void
  /** Key dispatch while active; return true to consume the key. Otherwise the
   *  session treats Escape as user cancellation (Enter stays a no-op until the
   *  completable pick/draw drivers arrive in slices 3.2/3.3). */
  onKey?: (key: string) => boolean
  /** Injectable clock for budget bookkeeping (deterministic tests). */
  now?: () => number
}>

export type InteractionSessionOptions = Readonly<{
  owner: InteractionOwner
  spec: InteractionSpec
  budgets?: Partial<InteractionBudgets>
  host: InteractionSessionHost
}>

export type InteractionEnd = Readonly<
  | { phase: 'completed' }
  | { phase: 'cancelled'; reason: InteractionCancelReason }
>

export const interactionCursor = (spec: InteractionSpec): string => {
  void spec
  return 'crosshair'
}

export const interactionPrompt = (spec: InteractionSpec): string => {
  switch (spec.kind) {
    case 'pickEntities':
      return spec.mode === 'window'
        ? 'Click or drag a window to pick — Esc to cancel'
        : 'Click entities to pick — Esc to cancel'
    case 'pickPoint':
      return 'Pick a point — Esc to cancel'
    case 'drawPolyline':
      return 'Click to place vertices — right-click or Esc to stop'
  }
}
/**
 * One interaction's authorized ownership of the viewport (Goal 3). A session is
 * single-use: `begin()` cannot run twice, only one session can be active across
 * the whole host, and every terminal transition (`complete` / `cancel` with any
 * reason) runs the registered cleanups exactly once so no listener, cursor or
 * preview can dangle after completion, cancellation, timeout or conflict.
 */
export class InteractionSession {
  readonly owner: InteractionOwner
  readonly spec: InteractionSpec
  readonly sessionMs: number
  private readonly host: InteractionSessionHost
  private readonly now: () => number
  private phase: InteractionPhase = 'idle'
  private startedAt = 0
  private end: InteractionEnd | null = null
  private result: InteractionResult | null = null
  private readonly cleanups = new Set<() => void>()

  constructor(options: InteractionSessionOptions) {
    this.owner = options.owner
    this.spec = options.spec
    this.host = options.host
    this.now = options.host.now ?? (() => Date.now())
    this.sessionMs = options.budgets?.sessionMs ?? DEFAULT_INTERACTION_BUDGETS.sessionMs
    validateInteractionSpec(options.spec)
  }

  get currentPhase(): InteractionPhase { return this.phase }
  get active(): boolean { return this.phase === 'active' }
  get ended(): InteractionEnd | null { return this.end }
  get lastResult(): InteractionResult | null { return this.result }
  get remainingMs(): number {
    if (this.phase !== 'active') return 0
    return Math.max(0, this.sessionMs - (this.now() - this.startedAt))
  }

  /** Take ownership of the viewport. Throws `VIEWPORT_BUSY` when another
   *  interaction already owns it and `VIEWPORT_LOCKED` when the host forbids
   *  it (e.g. an engineering model with active results). */
  begin() {
    if (this.phase !== 'idle') {
      throw new InteractionError('ALREADY_STARTED', `Interaction ${this.owner.id} already started`)
    }
    if (activeInteraction !== null) {
      throw new InteractionBusyError(activeInteraction.owner)
    }
    if (this.host.canTakeViewport && !this.host.canTakeViewport()) {
      throw new InteractionLockedError()
    }
    activeInteraction = this
    this.phase = 'active'
    this.startedAt = this.now()
    this.host.onGestureStart?.(this.spec, interactionCursor(this.spec))
    this.host.onPrompt?.(interactionPrompt(this.spec))
  }

  /** Register a host cleanup that runs once when the session ends — via any
   *  path (complete, cancel, timeout, conflict) — so no listener, cursor or
   *  preview ever outlives the session. Returns an idempotent unregister.
   *  Registering after the session already ended runs the cleanup immediately:
   *  a late binding must never leak. */
  addCleanup(cleanup: () => void): () => boolean {
    if (this.phase !== 'active') {
      cleanup()
      return () => false
    }
    this.cleanups.add(cleanup)
    return () => this.cleanups.delete(cleanup)
  }

  /** Key dispatch from the host event loop. Returns true when consumed. */
  handleKey(key: string): boolean {
    if (this.phase !== 'active') return false
    if (this.host.onKey?.(key)) return true
    if (key === 'Escape') {
      this.cancel('user')
      return true
    }
    return false
  }

  /** Enforce the session budget from the interaction event loop (canvas
   *  mousemove / gesture tick). Cancels with the `timeout` reason and returns
   *  true once the wall-clock budget is exhausted. */
  checkBudget(): boolean {
    if (this.phase !== 'active') return false
    if (this.now() - this.startedAt >= this.sessionMs) {
      this.cancel('timeout')
      return true
    }
    return false
  }

  /** End the interaction without a result. Idempotent: a second call returns
   *  false and changes nothing. */
  cancel(reason: InteractionCancelReason = 'user'): boolean {
    if (this.phase !== 'active') return false
    this.finish({ phase: 'cancelled', reason })
    return true
  }

  /** End the interaction with a result (pickEntities / pickPoint / drawPolyline). */
  complete(result?: InteractionResult): InteractionResult | null {
    if (this.phase !== 'active') {
      throw new InteractionError('NOT_ACTIVE', `Interaction ${this.owner.id} is not active`)
    }
    this.result = result ?? this.result
    this.finish({ phase: 'completed' })
    return this.result
  }

  private finish(end: InteractionEnd) {
    this.phase = end.phase
    this.end = end
    if (activeInteraction === this) activeInteraction = null
    this.host.onPrompt?.(null)
    this.host.onGestureEnd?.(interactionCursor(this.spec))
    this.runCleanups()
  }

  /** Drain every registered cleanup. A faulty cleanup never prevents the rest
   *  from running; the first error surfaces to the caller after all ran. */
  private runCleanups() {
    let firstError: unknown = null
    for (const cleanup of [...this.cleanups]) {
      this.cleanups.delete(cleanup)
      try {
        cleanup()
      } catch (error) {
        if (firstError === null) firstError = error
      }
    }
    if (firstError !== null) throw firstError
  }
}