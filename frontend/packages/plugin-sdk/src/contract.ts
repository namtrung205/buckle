/** Public API v1 contract. The host and the published SDK import this file. */
export const PLUGIN_API_VERSION = 1 as const
export const SUPPORTED_PLUGIN_API_VERSIONS = [1] as const
export const RPC_VERSION = PLUGIN_API_VERSION
export const DEFAULT_CALL_TIMEOUT_MS = 5_000

export const PLUGIN_PERMISSIONS = [
  'model.write.nodes', 'model.write.members', 'model.write.shells',
  'model.write.loads', 'model.write.supports', 'model.write.materials',
  'model.write.sections', 'model.write.grids', 'model.write.levels',
  'model.write.groups', 'model.write.selectionSets', 'model.write.parametric',
  'model.delete.nodes', 'model.delete.members', 'model.delete.shells',
  'model.delete.loads', 'model.delete.supports', 'model.delete.materials',
  'model.delete.sections', 'model.delete.grids', 'model.delete.levels',
  'model.delete.groups', 'model.delete.selectionSets', 'model.delete.parametric',
  'workspace.writeSelection', 'workspace.visibility',
] as const
export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number]

export const PLUGIN_SURFACE_PERMISSIONS = [
  'model.read', 'workspace.readSelection', 'workspace.writeSelection',
  'ui.panel', 'ui.notify',
  'viewport.pick', 'viewport.draw', 'viewport.zoomTo',
  'storage.project', 'storage.local',
] as const
export type PluginSurfacePermission = (typeof PLUGIN_SURFACE_PERMISSIONS)[number]
export type PluginSessionPermission = PluginPermission | PluginSurfacePermission
export const ALL_PLUGIN_PERMISSIONS: readonly PluginSessionPermission[] =
  [...new Set<PluginSessionPermission>([...PLUGIN_PERMISSIONS, ...PLUGIN_SURFACE_PERMISSIONS])]

export const MAX_RPC_MESSAGE_BYTES = 256 * 1024
export const RPC_METHODS = {
  'model.query': { params: { kind: 'none' } },
  'model.execute': { params: { kind: 'object', optional: false, maxBytes: MAX_RPC_MESSAGE_BYTES } },
  'ui.notify': { params: { kind: 'object', optional: false, maxBytes: 4096 } },
  'ui.openPanel': { params: { kind: 'object', optional: false, maxBytes: 1024 } },
  'storage.get': { params: { kind: 'object', optional: false, maxBytes: 1024 } },
  'storage.set': { params: { kind: 'object', optional: false, maxBytes: MAX_RPC_MESSAGE_BYTES } },
  'storage.delete': { params: { kind: 'object', optional: false, maxBytes: 1024 } },
  'storage.keys': { params: { kind: 'object', optional: false, maxBytes: 1024 } },
} as const
export type RpcMethod = keyof typeof RPC_METHODS

/** Stable top-level shape returned by model.query in API v1. Entity records
 * remain unknown until their public typed schemas are finalized. */
export type PluginModelSnapshot = Readonly<{
  documentVersion: number
  schemaVersion: string
  revision: number
  nodes: readonly unknown[]
  materials: readonly unknown[]
  sections: readonly unknown[]
  members: readonly unknown[]
  shells: readonly unknown[]
  loads: readonly unknown[]
  boundaryConditions: readonly unknown[]
  grids: readonly unknown[]
  levels: readonly unknown[]
  groups: readonly unknown[]
  parametricObjects: readonly unknown[]
  selectionSets: readonly unknown[]
  metadata: Readonly<Record<string, unknown>>
}>

export type ManifestContributions = Readonly<{
  commands?: readonly { id: string; title: string }[]
  ribbonTabs?: readonly { id: string; label: string; order?: number }[]
  ribbon?: readonly { id: string; tabId: string; groupId: string; groupLabel: string; commandId: string; label: string; title?: string }[]
  contextMenus?: readonly { id: string; commandId: string; label: string; order?: number }[]
  panels?: readonly { id: string; title: string; entry: string }[]
}>

export type PluginManifest = Readonly<{
  id: string
  name: string
  version: string
  apiVersion: number
  permissions: readonly PluginSessionPermission[]
  entrypoints: Readonly<{ panel?: string; worker?: string }>
  contributions?: ManifestContributions
  dev?: Readonly<{ url: string }>
}>

/** Host-to-Worker lifecycle messages are separate from Worker-to-host RPC. */
export type WorkerReady = Readonly<{ v: 1; kind: 'plugin.ready'; commands: readonly string[] }>
export type CommandInvocation = Readonly<{ v: 1; kind: 'command.invoke'; id: string; commandId: string }>
export type CommandResult =
  | Readonly<{ v: 1; kind: 'command.result'; id: string; ok: true; value?: unknown }>
  | Readonly<{ v: 1; kind: 'command.result'; id: string; ok: false; error: { code: string; message: string } }>
