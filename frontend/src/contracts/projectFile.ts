import type {
  GroupRecord,
  GridRecord,
  LevelRecord,
  ParametricObjectRecord,
  SelectionSetRecord,
} from '../core/structural';
import type { ProjectExtensions } from '../core/plugins/storageContracts';
import type { StructuralModelDto } from './structuralModel';

export const PROJECT_FILE_KIND = 'buckle-project' as const;
export const PROJECT_FILE_VERSION = 2 as const;

/** Full Buckle project file.
 *
 *  `model` is the exact backend-compatible analysis transport (the same payload
 *  posted to `/analysis`). The backend schema forbids unknown fields
 *  (`extra="forbid"`), so the organizational document collections — selection
 *  sets, groups, parametric objects, grids, levels — that the transport
 *  deliberately omits live under a separate top-level `organizational` key.
 *  This keeps a saved file analyzable while restoring the whole workspace on
 *  open.
 */
export type BuckleProjectFile = {
  kind: typeof PROJECT_FILE_KIND;
  version: typeof PROJECT_FILE_VERSION;
  model: StructuralModelDto;
  organizational: {
    selectionSets: readonly SelectionSetRecord[];
    groups: readonly GroupRecord[];
    parametricObjects: readonly ParametricObjectRecord[];
    grids: readonly GridRecord[];
    levels: readonly LevelRecord[];
  };
  /** Namespaced plugin state (v2). Written on save; a plugin whose id is
   *  missing on open keeps the file valid and simply starts empty. */
  extensions: ProjectExtensions;
};

/** Version(s) this frontend reads. v1 files predate plugin storage. */
const READABLE_VERSIONS = [1, 2] as const;

export const isBuckleProjectFile = (input: unknown): input is BuckleProjectFile => {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as { kind?: unknown; version?: unknown };
  return candidate.kind === PROJECT_FILE_KIND
    && (READABLE_VERSIONS as readonly unknown[]).includes(candidate.version);
};

/** Normalize any readable project file to the current version: v1 files gain
 *  an empty `extensions` map, v2 files pass through unchanged. Returns null
 *  for anything unreadable — callers fail closed on it. */
export const migrateProjectFile = (input: unknown): BuckleProjectFile | null => {
  if (!isBuckleProjectFile(input)) return null;
  if (input.version === PROJECT_FILE_VERSION) return input;
  return { ...input, version: PROJECT_FILE_VERSION, extensions: {} };
};