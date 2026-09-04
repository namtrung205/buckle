/**
 * Which families a design run covers, and what "Design all" means by default.
 *
 * ── The workflow this replaces ─────────────────────────────────────
 *
 * "Diseñar todo" designed beams and columns. Slabs, walls and foundations came from a second
 * command, `Ejecutar diseño de pisos`, inside a different disclosure — so a user who pressed
 * the button named "all" got a building with no floors and no way to know that from the
 * button. The 3-D view then showed a frame and the user reported missing slabs.
 *
 * One selection now drives one run. This module owns what the families ARE and what is
 * selected when nobody has chosen; the store owns the running.
 *
 * Pure: no store, no runes, no i18n.
 */

/** The five families a user can include in a run, in the order the selector lists them. */
export const DESIGN_FAMILIES = ['column', 'beam', 'slab', 'wall', 'footing'] as const;

export type DesignFamily = (typeof DESIGN_FAMILIES)[number];

/** The families produced by the frame pass, as opposed to the floor pass. */
export const FRAME_FAMILIES: readonly DesignFamily[] = ['column', 'beam'];
export const FLOOR_FAMILIES: readonly DesignFamily[] = ['slab', 'wall', 'footing'];

/**
 * What "Design all" designs when the user has not chosen.
 *
 * ── Why foundations are NOT in it ──────────────────────────────────
 *
 * Everything else in this list is decided by the analysis the user has already run. A footing
 * is not: it needs a ground profile with an allowable bearing pressure, and until one is
 * supplied the run produces a record that states it could not be verified. Including it by
 * default would mean the default action reports a failure the user did not ask for and cannot
 * fix from this screen.
 *
 * Foundations are also worked separately in practice — sized against a soil report that
 * arrives on its own schedule — so the default matches how the work is actually staged.
 *
 * The selector states this: the box is there, visible and unticked, so "not designed" is a
 * choice the user can see rather than an omission they discover in the 3-D view.
 */
export const DEFAULT_DESIGN_FAMILIES: readonly DesignFamily[] = ['column', 'beam', 'slab', 'wall'];

export type DesignFamilySelection = readonly DesignFamily[];

export function isFrameFamily(f: DesignFamily): boolean {
  return FRAME_FAMILIES.includes(f);
}

/** True when the run needs the frame pass at all. */
export function needsFramePass(selection: DesignFamilySelection): boolean {
  return FRAME_FAMILIES.some((f) => selection.includes(f));
}

/** True when the run needs the floor pass at all. */
export function needsFloorPass(selection: DesignFamilySelection): boolean {
  return FLOOR_FAMILIES.some((f) => selection.includes(f));
}

/**
 * How a run went, per family.
 *
 * ── Why `noElements` is not `skipped` ──────────────────────────────
 *
 * "You did not ask for footings" and "there are no footings in this model" are different
 * facts with different remedies, and the 7-storey building makes the distinction concrete: it
 * contains no footings at all, so selecting them can only ever report the second. Collapsing
 * the two would tell a user to go and tick a box that would change nothing.
 */
export type FamilyRunState =
  /** Selected, ran, produced results. */
  | 'designed'
  /** Not selected. */
  | 'skipped'
  /** Selected, but the model contains no member of this family. */
  | 'noElements'
  /** Selected and ran, but the command reported an error. */
  | 'failed';

export interface FamilyRunResult {
  family: DesignFamily;
  state: FamilyRunState;
  /** Members the run considered. */
  processed: number;
  /** Members that reached a verified design with reinforcement. */
  designed: number;
  /** Members the design refused, for any reason. */
  refused: number;
  /** Members verified but carrying no bar geometry. */
  notModelled: number;
  /** The command's own failure reason, when `state` is `failed`. */
  errorKey?: string;
  errorParams?: Record<string, string | number>;
}

export function emptyFamilyResult(
  family: DesignFamily, state: FamilyRunState,
): FamilyRunResult {
  return { family, state, processed: 0, designed: 0, refused: 0, notModelled: 0 };
}

export interface DesignRunReport {
  selection: DesignFamilySelection;
  families: FamilyRunResult[];
  /** True when every selected family ran without a command-level error. */
  ok: boolean;
}

/** Totals across the families, for the headline line of the result panel. */
export function totalsOf(report: DesignRunReport): {
  processed: number; designed: number; refused: number; notModelled: number;
} {
  return report.families.reduce((t, f) => ({
    processed: t.processed + f.processed,
    designed: t.designed + f.designed,
    refused: t.refused + f.refused,
    notModelled: t.notModelled + f.notModelled,
  }), { processed: 0, designed: 0, refused: 0, notModelled: 0 });
}
