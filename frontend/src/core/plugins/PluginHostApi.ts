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
import type { EntityReference } from '../structural/types.ts'
import type { ContributionOwner } from './types.ts'
import type { PluginEventBus, PluginEventFilter, PluginHostEvent } from './PluginEventBus.ts'

const pluginIdPattern = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/** Read/UI permissions enforced by the broker itself — the operation policy only
 * maps mutations, so queries and UI surfaces are gated here per the roadmap
 * permission families. */
export const PLUGIN_SURFACE_PERMISSIONS = [
  'model.read', 'workspace.readSelection', 'ui.panel', 'ui.notify',
] as const
export type PluginSurfacePermission = (typeof PLUGIN_SURFACE_PERMISSIONS)[number]
export type PluginSessionPermission = PluginPermission | PluginSurfacePermission

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

  notify(message: string, kind: 'info' | 'success' | 'error' = 'info') {
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

