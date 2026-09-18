import { PLUGIN_PERMISSIONS } from '../structural/CommandPolicy.ts'
import type { PluginPermission } from '../structural/CommandPolicy.ts'
import type { PluginSurfacePermission } from './PluginHostApi.ts'

/**
 * Permission review data (Goal 6): every permission family a plugin session
 * may hold, with a human label, risk tier and one-line description. The
 * security UI renders this so a user can review what a plugin is asking for
 * before enabling it.
 */

export type PermissionRisk = 'read' | 'write' | 'ui' | 'compute'

export type PermissionInfo = Readonly<{
  permission: PluginPermission | PluginSurfacePermission
  family: 'model' | 'workspace' | 'ui' | 'viewport' | 'storage'
  risk: PermissionRisk
  label: string
  description: string
}>

const mutationFamilies: readonly PluginPermission[] = PLUGIN_PERMISSIONS

/** Build the catalog from the policy's mutation list plus the broker surfaces.
 *  Unknown permissions never appear (fail closed). */
export const PLUGIN_PERMISSION_CATALOG: readonly PermissionInfo[] = [
  ...mutationFamilies.map<PermissionInfo>(permission => ({
    permission,
    family: permission.startsWith('workspace.') ? 'workspace' : 'model',
    risk: 'write',
    label: permission,
    description: `Create or modify ${permission.replace('model.write.', '').replace('workspace.', '')} data.`,
  })),
  ...(
    [
      { permission: 'model.read', family: 'model', risk: 'read', description: 'Read a frozen snapshot of the whole model.' },
      { permission: 'workspace.readSelection', family: 'workspace', risk: 'read', description: 'Read the current selection.' },
      { permission: 'workspace.writeSelection', family: 'workspace', risk: 'write', description: 'Change the current selection.' },
      { permission: 'ui.panel', family: 'ui', risk: 'ui', description: 'Open its own dock panel.' },
      { permission: 'ui.notify', family: 'ui', risk: 'ui', description: 'Show toast notifications.' },
      { permission: 'viewport.pick', family: 'viewport', risk: 'ui', description: 'Run picking interactions in the viewport.' },
      { permission: 'viewport.draw', family: 'viewport', risk: 'ui', description: 'Run drawing interactions in the viewport.' },
      { permission: 'viewport.zoomTo', family: 'viewport', risk: 'ui', description: 'Move the camera to frame targets.' },
      { permission: 'storage.project', family: 'storage', risk: 'write', description: 'Persist namespaced data inside saved project files.' },
      { permission: 'storage.local', family: 'storage', risk: 'write', description: 'Persist namespaced data for this session.' },
    ] as const satisfies readonly { permission: PluginSurfacePermission; family: PermissionInfo['family']; risk: PermissionRisk; description: string }[]
  ).map<PermissionInfo>(({ permission, family, risk, description }) => ({ permission, family, risk, label: permission, description })),
]

const catalogIndex = new Map(PLUGIN_PERMISSION_CATALOG.map(info => [info.permission, info]))

/** A grant the catalog does not recognize — always surfaced explicitly, never
 *  silently dropped (fail closed). */
export type UnknownPermissionInfo = Readonly<{
  permission: string
  family: 'unknown'
  risk: PermissionRisk
  label: string
  description: string
}>

/** Summarize one plugin's grants for a review UI; unknown permissions surface
 *  as explicit "unrecognized" rows so nothing silently hides. */
export const summarizePermissions = (
  grants: readonly string[],
): readonly (PermissionInfo | UnknownPermissionInfo)[] =>
  grants.map(grant => catalogIndex.get(grant as PluginPermission | PluginSurfacePermission) ?? {
    permission: grant,
    family: 'unknown' as const,
    risk: 'write' as const,
    label: grant,
    description: 'Unrecognized permission — review before enabling.',
  })