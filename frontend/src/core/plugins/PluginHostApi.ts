import { deterministicHash } from '../structural/canonical.ts'
import { COMMAND_SCHEMA_VERSION } from '../structural/commands.ts'
import type {
  CommandEnvelope,
  CommandResult,
  StructuralCommand,
} from '../structural/commands.ts'
import { CommandConflictError, CommandValidationError } from '../structural/CommandGateway.ts'
import type { CommandWorkspaceState } from '../structural/CommandGateway.ts'
import { CommandPolicyError, PLUGIN_PERMISSIONS } from '../structural/CommandPolicy.ts'
import type { PluginPermission } from '../structural/CommandPolicy.ts'
import { PLUGIN_SURFACE_PERMISSIONS } from '../../../packages/plugin-sdk/src/contract.ts'
import type { PluginSurfacePermission, PluginSessionPermission } from '../../../packages/plugin-sdk/src/contract.ts'
import type { EntityReference, Vector3Record } from '../structural/types.ts'
import type { ContributionOwner } from './types.ts'
import type { PluginEventBus, PluginEventFilter, PluginHostEvent } from './PluginEventBus.ts'
import { InteractionError, InteractionBusyError, InteractionLockedError, validateInteractionSpec } from '../interaction/index.ts'
import type {
  DrawPolylineSpec,
  InteractionResult,
  PickEntitiesSpec,
  PickPointSpec,
} from '../interaction/index.ts'

const pluginIdPattern = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/** Read/UI permissions enforced by the broker itself — the operation policy only
 * maps mutations, so queries and UI surfaces are gated here per the roadmap
 * permission families. */
export { PLUGIN_SURFACE_PERMISSIONS }
export type { PluginSurfacePermission, PluginSessionPermission }

export class PluginHostError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PluginHostError'
    this.code = code
  }
}

/** Model-backed services a plugin session binds to. The app injects these, so
 * the broker stays pure TypeScript and testable without React or the renderer. */
export type PluginCommandServices = Readonly<{
  getRevision: () => number
  /** Frozen canonical document snapshot; the plugin treats it as read-only. */
  querySnapshot: () => unknown
  getWorkspaceState: () => CommandWorkspaceState
  execute: (command: CommandEnvelope, options: {
    allowDestructive?: boolean
    pluginPermissions?: readonly PluginPermission[]
  }) => CommandResult
  hasPanel?: (panelId: string) => boolean
  openPanel?: (panelId: string) => void
  notify?: (message: string, kind: 'info' | 'success' | 'error') => void
  /** Host event bus for filtered/coalesced document and workspace events. */
  events?: PluginEventBus
  /** Host-side approval prompt for destructive commits. Called once when the
   * policy demands approval; returning true re-dispatches with approval. */
  approver?: (info: { code: string; message: string }) => boolean
  /** Host viewport interaction backs (Goal 3 slice 3.2). */
  interactions?: PluginViewportInteractions
}>

/** A plugin mutation request. The plugin never supplies an envelope: the broker
 * stamps command id, schema version, revision, source and actor provenance
 * (design rule 2) and never lets the request override them. */
export type PluginMutationRequest = Readonly<{
  command: StructuralCommand
  /** Reject with a deterministic conflict when the revision has moved on. */
  expectedModelRevision?: number
  /** Explicit approval — required to commit destructive (high-risk) commands. */
  approval?: boolean
}>

export type PluginCommandOutcome = Readonly<
  | { ok: true; result: CommandResult }
  | {
    ok: false
    /** Structured, stable error code for plugin-side handling. */
    code: string
    message: string
    expectedRevision?: number
    actualRevision?: number
  }
>

/** Target of a host-owned zoom (roadmap `viewport.zoomTo`). */
export type ViewportZoomTarget = Readonly<
  | { kind: 'selection' }
  | { kind: 'entities'; entities: readonly EntityReference[] }
  | { kind: 'point'; position: Vector3Record }
>

/** Outcome of one host-owned viewport interaction (Goal 3). */
export type ViewportInteractionOutcome = Readonly<
  | { ok: true; result: InteractionResult }
  | { ok: false; code: string; message: string }
>

/** Host viewport interaction backs (Goal 3). Each function runs exactly one
 *  interaction session. It resolves with the pick/point/polyline result, with
 *  null/throw meaning the interaction ended without a result (Escape, timeout,
 *  owner release). Session ownership, permissions and revocation stay host-side
 *  (roadmap design rule 4). */
export type PluginViewportInteractions = Readonly<{
  pickEntities?: (sessionOwner: ContributionOwner, spec: PickEntitiesSpec) => Promise<InteractionResult | null> | InteractionResult | null
  pickPoint?: (sessionOwner: ContributionOwner, spec: PickPointSpec) => Promise<InteractionResult | null> | InteractionResult | null
  drawPolyline?: (sessionOwner: ContributionOwner, spec: DrawPolylineSpec) => Promise<InteractionResult | null> | InteractionResult | null
  zoomTo?: (target: ViewportZoomTarget) => void
}>

/**
 * One plugin's authorized view of the host (Goal 2). Identity and permission
 * grants are fixed per session. Previews run dry-run and may inspect destructive
 * changes; commits of destructive commands require an explicit `approval`, and
 * stale revisions return a deterministic conflict without partial mutation.
 * Host-owned undo is intentionally not exposed to plugins (v1).
 */
export class PluginCommandBroker {
  private readonly services: PluginCommandServices
  private readonly owner: ContributionOwner
  private readonly permissions: readonly PluginSessionPermission[]
  private readonly sentEnvelopes = new Map<string, CommandEnvelope>()
  private lastNotice: { message: string; at: number } | null = null

  constructor(
    services: PluginCommandServices,
    owner: ContributionOwner,
    permissions: readonly PluginSessionPermission[],
  ) {
    this.services = services
    this.owner = owner
    this.permissions = permissions
    if (owner.kind !== 'plugin') {
      throw new PluginHostError('PLUGIN_IDENTITY', 'Plugin sessions require a plugin-kind contribution owner')
    }
    // CommandBoundary requires lowercase plugin actor ids; fail fast at session
    // creation instead of at every dispatch.
    if (!pluginIdPattern.test(owner.id)) {
      throw new PluginHostError('PLUGIN_IDENTITY', `Invalid plugin id ${owner.id}`)
    }
    if (!semverPattern.test(owner.version)) {
      throw new PluginHostError('PLUGIN_IDENTITY', `Invalid plugin version ${owner.version}`)
    }
  }

  get pluginId() { return this.owner.id }
  get grants() { return [...this.permissions] }

  getRevision() { return this.services.getRevision() }

  query(): unknown {
    this.assertSurface('model.read', 'model.query')
    return this.services.querySnapshot()
  }

  getSelection(): readonly EntityReference[] {
    this.assertSurface('workspace.readSelection', 'workspace.getSelection')
    return this.services.getWorkspaceState().selection
  }

  setSelection(entities: readonly EntityReference[]): PluginCommandOutcome {
    this.assertSurface('workspace.writeSelection', 'workspace.setSelection')
    return this.dispatch(
      { command: { type: 'SetSelection', payload: { entities } } },
      { dryRun: false, allowDestructive: false },
    )
  }

  /** Dry-run any request — including destructive ones — without committing. */
  preview(request: PluginMutationRequest): PluginCommandOutcome {
    return this.dispatch(request, { dryRun: true, allowDestructive: true })
  }

  /** Commit a request. Destructive commands require `approval: true`. */
  execute(request: PluginMutationRequest): PluginCommandOutcome {
    return this.dispatch(request, { dryRun: false, allowDestructive: request.approval === true })
  }

  openPanel(panelId: string) {
    this.assertSurface('ui.panel', 'ui.openPanel')
    if (!panelId.startsWith(`${this.owner.id}.`)) {
      throw new PluginHostError('REJECTED', `Panel id ${panelId} is outside the ${this.owner.id}.* namespace`)
    }
    if (!this.services.hasPanel?.(panelId)) {
      throw new PluginHostError('UNKNOWN_PANEL', `Unknown contribution panel ${panelId}`)
    }
    this.services.openPanel?.(panelId)
  }

  /** Identity of the plugin that owns this session — used by RPC bridges for
   *  namespacing (storage keys) and audit provenance. */
  get ownerId(): string {
    return this.owner.id
  }

  notify(message: string, kind: 'info' | 'success' | 'error' = 'info') {
    this.assertSurface('ui.notify', 'ui.notify')
    const now = Date.now()
    if (this.lastNotice && this.lastNotice.message === message && now - this.lastNotice.at < 500) return
    this.lastNotice = { message, at: now }
    this.services.notify?.(message, kind)
  }

  /** Subscribe to filtered/coalesced host events. Returns an idempotent
   * unsubscribe function; events stop when the session is discarded. */
  subscribe(
    listener: (event: PluginHostEvent) => void,
    filter: PluginEventFilter = {},
  ): () => boolean {
    if (!this.services.events) {
      throw new PluginHostError('UNAVAILABLE', 'This session has no host event bus wired in')
    }
    return this.services.events.subscribe(listener, filter)
  }

  /** Run one host-owned entity pick session (Goal 3). Permission-gated with
   * `viewport.pick`; the spec is validated fail-closed before it reaches the
   * host driver. */
  pickEntities(spec: PickEntitiesSpec): Promise<ViewportInteractionOutcome> {
    const outcome = this.gateSurface('viewport.pick', 'viewport.pickEntities', spec)
    if (outcome) return Promise.resolve(outcome)
    const run = this.services.interactions?.pickEntities
    if (!run) return Promise.resolve({ ok: false, code: 'UNAVAILABLE', message: 'This session has no viewport picking backing' })
    return this.runViewportInteraction(() => run(this.owner, spec))
  }

  /** Run one host-owned point pick session (Goal 3). */
  pickPoint(spec: PickPointSpec): Promise<ViewportInteractionOutcome> {
    const outcome = this.gateSurface('viewport.pick', 'viewport.pickPoint', spec)
    if (outcome) return Promise.resolve(outcome)
    const run = this.services.interactions?.pickPoint
    if (!run) return Promise.resolve({ ok: false, code: 'UNAVAILABLE', message: 'This session has no viewport point picking backing' })
    return this.runViewportInteraction(() => run(this.owner, spec))
  }

  /** Run one host-owned polyline drawing session (Goal 3). */
  drawPolyline(spec: DrawPolylineSpec): Promise<ViewportInteractionOutcome> {
    const outcome = this.gateSurface('viewport.draw', 'viewport.drawPolyline', spec)
    if (outcome) return Promise.resolve(outcome)
    const run = this.services.interactions?.drawPolyline
    if (!run) return Promise.resolve({ ok: false, code: 'UNAVAILABLE', message: 'This session has no viewport drawing backing' })
    return this.runViewportInteraction(() => run(this.owner, spec))
  }

  /** Zoom the host viewport (Goal 3). Throws `PERMISSION_DENIED` /
   * `UNAVAILABLE` exactly like the ui surfaces. */
  zoomTo(target: ViewportZoomTarget) {
    this.assertSurface('viewport.zoomTo', 'viewport.zoomTo')
    const zoom = this.services.interactions?.zoomTo
    if (!zoom) throw new PluginHostError('UNAVAILABLE', 'This session has no viewport zoom backing')
    zoom(target)
  }

  private gateSurface(
    permission: PluginSessionPermission,
    action: string,
    spec: unknown,
  ): ViewportInteractionOutcome | null {
    try {
      this.assertSurface(permission, action)
    } catch (error) {
      return { ok: false, code: error instanceof PluginHostError ? error.code : 'PERMISSION_DENIED', message: error instanceof Error ? error.message : String(error) }
    }
    try {
      validateInteractionSpec(spec)
    } catch (error) {
      return { ok: false, code: error instanceof InteractionError ? error.code : 'INVALID_SPEC', message: error instanceof Error ? error.message : String(error) }
    }
    return null
  }

  /** Await one host interaction and map every failure to a structured outcome. */
  private async runViewportInteraction(
    run: () => Promise<InteractionResult | null> | InteractionResult | null,
  ): Promise<ViewportInteractionOutcome> {
    try {
      const result = await run()
      if (result === null) return { ok: false, code: 'CANCELLED', message: 'Interaction was cancelled' }
      return { ok: true, result }
    } catch (error) {
      if (error instanceof InteractionBusyError || error instanceof InteractionLockedError || error instanceof InteractionError) {
        return { ok: false, code: error.code, message: error.message }
      }
      return { ok: false, code: 'REJECTED', message: error instanceof Error ? error.message : String(error) }
    }
  }

  private assertSurface(permission: PluginSessionPermission, action: string) {
    if (!this.permissions.includes(permission)) {
      throw new PluginHostError('PERMISSION_DENIED', `${action} requires the ${permission} permission`)
    }
  }

  /** Only mutation grants go into the operation policy; surface permissions are
   * broker-local and unknown to CommandPolicy. */
  private writeGrants(): readonly PluginPermission[] {
    return this.permissions.filter((permission): permission is PluginPermission =>
      (PLUGIN_PERMISSIONS as readonly string[]).includes(permission))
  }

  /** Host-only stamping: the request never carries source/actor/revision. The
   * command id is content-addressed (type + payload + expected revision) and the
   * exact stamped envelope is cached per content so an identical retry resends
   * the same envelope and the gateway replays it idempotently instead of
   * double-applying or reporting an id-reuse validation error. */
  private stampOrReuse(request: PluginMutationRequest, dryRun: boolean): CommandEnvelope {
    const { type } = request.command
    const key = `${type}:${dryRun ? 'preview' : 'commit'}:${deterministicHash([request.command.payload, request.expectedModelRevision ?? null])}`
    const cached = this.sentEnvelopes.get(key)
    if (cached) return cached
    const envelope = Object.freeze({
      commandId: `plugin:${this.owner.id}:${type}:${deterministicHash([request.command.payload, request.expectedModelRevision ?? null])}${dryRun ? ':preview' : ''}`,
      type,
      schemaVersion: COMMAND_SCHEMA_VERSION,
      modelRevision: this.services.getRevision(),
      ...(request.expectedModelRevision !== undefined
        ? { expectedModelRevision: request.expectedModelRevision }
        : {}),
      payload: request.command.payload,
      source: 'plugin' as const,
      actor: Object.freeze({
        kind: 'plugin',
        pluginId: this.owner.id,
        pluginVersion: this.owner.version,
      }),
      ...(dryRun ? { dryRun: true } : {}),
    }) as CommandEnvelope
    if (this.sentEnvelopes.size >= 64) {
      this.sentEnvelopes.delete(this.sentEnvelopes.keys().next().value as string)
    }
    this.sentEnvelopes.set(key, envelope)
    return envelope
  }

  private dispatch(
    request: PluginMutationRequest,
    mode: { dryRun: boolean; allowDestructive: boolean; approvalRequested?: boolean },
  ): PluginCommandOutcome {
    const key = `${request.command.type}:${mode.dryRun ? 'preview' : 'commit'}:${deterministicHash([request.command.payload, request.expectedModelRevision ?? null])}`
    const envelope = this.stampOrReuse(request, mode.dryRun)
    try {
      const result = this.services.execute(envelope, {
        allowDestructive: mode.allowDestructive,
        pluginPermissions: this.writeGrants(),
      })
      return { ok: true, result }
    } catch (error) {
      // A rejected envelope was never applied — drop the cache entry so a later
      // retry after the host state changed stamps a fresh envelope.
      this.sentEnvelopes.delete(key)
      if (error instanceof CommandPolicyError
        && error.code === 'PLUGIN_APPROVAL_REQUIRED'
        && !mode.dryRun
        && !mode.approvalRequested
        && this.services.approver?.({ code: error.code, message: error.message }) === true) {
        // The user approved through the host prompt — re-dispatch once with the
        // approval flag. The cached envelope is reused, so a replayed commit
        // stays idempotent.
        return this.dispatch(request, { ...mode, allowDestructive: true, approvalRequested: true })
      }
      if (error instanceof CommandConflictError) {
        return {
          ok: false,
          code: 'REVISION_CONFLICT',
          message: error.message,
          expectedRevision: error.expectedRevision,
          actualRevision: error.actualRevision,
        }
      }
      if (error instanceof CommandPolicyError) {
        return { ok: false, code: error.code, message: error.message }
      }
      if (error instanceof CommandValidationError) {
        return { ok: false, code: 'VALIDATION', message: error.message }
      }
      return { ok: false, code: 'REJECTED', message: error instanceof Error ? error.message : String(error) }
    }
  }
}

export const createPluginCommandBroker = (
  services: PluginCommandServices,
  owner: ContributionOwner,
  permissions: readonly PluginSessionPermission[],
) => new PluginCommandBroker(services, owner, permissions)

