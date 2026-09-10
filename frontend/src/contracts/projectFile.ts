import type {
  GroupRecord,
  GridRecord,
  LevelRecord,
  ParametricObjectRecord,
  SelectionSetRecord,
} from '../core/structural';
import type { StructuralModelDto } from './structuralModel';

export const PROJECT_FILE_KIND = 'buckle-project' as const;
export const PROJECT_FILE_VERSION = 1 as const;

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
};

export const isBuckleProjectFile = (input: unknown): input is BuckleProjectFile => {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as { kind?: unknown; version?: unknown };
  return candidate.kind === PROJECT_FILE_KIND && candidate.version === PROJECT_FILE_VERSION;
};