/**
 * @buckle/plugin-sdk — public surface for Buckle plugin authors (Goal 5).
 *
 * Everything a plugin package needs lives here; plugin code must never import
 * Buckle host internals. Runtime values are duplicated constants (so the SDK
 * builds standalone) while host types are imported type-only (erased at build).
 */
export const PLUGIN_API_VERSION = 1;
export const RPC_VERSION = 1;
export const DEFAULT_CALL_TIMEOUT_MS = 5_000;

export type {
  PluginManifest,
  ManifestContributions,
} from '../core/plugins/manifest.ts';

export type PluginPermission =
  | 'model.read' | 'model.write.nodes' | 'model.write.members'
  | 'model.write.shells' | 'model.write.materials' | 'model.write.sections'
  | 'model.write.loads' | 'model.write.boundaryConditions'
  | 'model.write.grids' | 'model.write.levels'
  | 'workspace.readSelection' | 'workspace.writeSelection'
  | 'ui.panel' | 'ui.notify'
  | 'viewport.pick' | 'viewport.draw' | 'viewport.zoomTo';

/** Closed host surface callable from a sandboxed panel (mirror of the host table). */
export const RPC_METHODS = [
  'model.query', 'model.execute', 'ui.notify', 'ui.openPanel',
  'storage.get', 'storage.set', 'storage.delete', 'storage.keys',
] as const;
export type RpcMethod = (typeof RPC_METHODS)[number];

export { PluginPanelClient } from './client.ts';
