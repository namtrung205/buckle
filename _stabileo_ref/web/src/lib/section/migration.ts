/**
 * migration.ts — restoring canonical section state after a load.
 *
 * # Why loading needs its own pass
 *
 * `Section.canonical` serializes with the section, so a saved file carries the
 * geometry, the digest and the derived properties it had when it was written.
 * None of that is trustworthy on the way back in: the file may predate the
 * canonical layer, may have been written by a newer schema, may have been
 * hand-edited, or may simply be stale relative to the dimensions stored beside
 * it. Solver preparation is synchronous and reads the cached values directly,
 * so anything wrong here becomes wrong numbers with no further chance to
 * notice.
 *
 * The restore pass therefore *re-derives* canonical state from the section's
 * own dimensions and compares. The persisted digest is treated as a claim to
 * be checked, never as an answer to be trusted.
 *
 * # What is deliberately NOT done
 *
 * Nothing is invented to make a section canonical. A file whose section lacks
 * the dimensions its family needs comes back properties-only — the same answer
 * it would get if it had been created that way — and keeps its declared A/I/J
 * so it still solves globally.
 */

import type { Section } from '../store/model.svelte';
import { resolveSectionState, type SectionState } from './state';
import { isSolverReady } from '../engine/wasm-solver';
import { CANONICAL_STATE_VERSION } from './version';

/** Outcome of restoring one section, for auditing and tests. */
export type RestoreOutcome =
  /** Persisted state re-derived identically. */
  | { kind: 'verified'; digest: string }
  /** No canonical state was stored; it was derived now. */
  | { kind: 'derived'; digest: string }
  /** Stored digest disagreed with the geometry; the re-derived state wins. */
  | { kind: 'digestMismatch'; stored: string; recomputed: string }
  /** Stored state came from a schema this build does not understand. */
  | { kind: 'unsupportedVersion'; stored: number; supported: number }
  /** The section is properties-only, with the reason preserved. */
  | { kind: 'propertiesOnly'; reason: string }
  /** The engine is not up yet; verification is deferred, nothing published. */
  | { kind: 'deferred' };

export interface RestoredSection {
  section: Section;
  outcome: RestoreOutcome;
}

/**
 * Restore one section's canonical state.
 *
 * Idempotent: restoring an already-restored section yields the same state and
 * the same digest, which is what makes repeated save/open cycles stable.
 *
 * `opts.torsion` forwards to `resolveSectionState`: restoring WITH torsion
 * when the engine is ready costs one Saint-Venant solve per section without a
 * published constant, and saves the immediate `refreshCanonicalSections`
 * re-resolve every section would otherwise pay right after the load.
 */
export function restoreSectionState(sec: Section, opts: { torsion?: boolean } = {}): RestoredSection {
  const stored = sec.canonical;

  // ── Engine not up yet ────────────────────────────────────────
  //
  // Verification is deferred rather than resolved wrongly. Crucially the
  // stored state is DROPPED rather than kept: keeping it would let unverified
  // properties reach the synchronous solver path, which is exactly the failure
  // this pass exists to prevent. The section falls back to its declared
  // values, still solves, and is re-restored once the engine is ready.
  if (!isSolverReady()) {
    return { section: { ...sec, canonical: undefined }, outcome: { kind: 'deferred' } };
  }

  // ── Re-derive from the section's own dimensions ──────────────
  let recomputed: SectionState;
  try {
    recomputed = resolveSectionState(sec, { torsion: opts.torsion });
  } catch (err) {
    // Invalid geometry must not lose the legacy data that still lets the
    // model solve. Drop the canonical claim, keep everything else.
    return {
      section: { ...sec, canonical: undefined },
      outcome: { kind: 'propertiesOnly', reason: `invalidGeometry: ${(err as Error)?.message ?? String(err)}` },
    };
  }

  if (recomputed.kind === 'properties-only') {
    return {
      section: { ...sec, canonical: recomputed },
      outcome: { kind: 'propertiesOnly', reason: recomputed.reason.kind },
    };
  }

  const section = { ...sec, canonical: recomputed };

  if (!stored || stored.kind !== 'geometry-backed') {
    return { section, outcome: { kind: 'derived', digest: recomputed.digest } };
  }

  // A file written by a newer schema may describe geometry this build cannot
  // interpret. Re-deriving is still correct — the dimensions are the source of
  // truth — but the mismatch is reported rather than passed over.
  if (stored.version !== CANONICAL_STATE_VERSION) {
    return {
      section,
      outcome: { kind: 'unsupportedVersion', stored: stored.version, supported: CANONICAL_STATE_VERSION },
    };
  }

  if (stored.digest !== recomputed.digest) {
    // The stored properties described a different geometry than the
    // dimensions imply. The re-derived state wins; publishing the stored one
    // would be publishing stale numbers.
    return {
      section,
      outcome: { kind: 'digestMismatch', stored: stored.digest, recomputed: recomputed.digest },
    };
  }

  return { section, outcome: { kind: 'verified', digest: recomputed.digest } };
}

/**
 * Restore every section of a model.
 *
 * Returns a fresh Map so callers cannot accidentally keep a reference into the
 * loaded file's objects — the same isolation the tab machinery relies on.
 */
export function restoreSections(
  sections: Map<number, Section>,
  opts: { torsion?: boolean } = {},
): { sections: Map<number, Section>; outcomes: Map<number, RestoreOutcome> } {
  const out = new Map<number, Section>();
  const outcomes = new Map<number, RestoreOutcome>();
  for (const [id, sec] of sections) {
    const { section, outcome } = restoreSectionState(sec, opts);
    out.set(id, section);
    outcomes.set(id, outcome);
  }
  return { sections: out, outcomes };
}

/**
 * Superseded catalogue values worth keeping visible after a correction.
 *
 * Six CHS entries shipped an inertia inconsistent with their own diameter and
 * wall thickness. The corrected values are now in the catalogue, but a file
 * saved earlier carries the old number, and silently replacing it would erase
 * the evidence that anything changed. Detection is by value, not by name, so a
 * renamed section is still recognised.
 */
export const SUPERSEDED_CHS_INERTIA: ReadonlyArray<{
  profile: string;
  superseded: number;
  corrected: number;
}> = [
  { profile: 'CHS 42.4x3.2', superseded: 8.05, corrected: 7.62 },
  { profile: 'CHS 48.3x3.2', superseded: 12.3, corrected: 11.59 },
  { profile: 'CHS 60.3x3.6', superseded: 27.0, corrected: 25.87 },
  { profile: 'CHS 76.1x4', superseded: 59.9, corrected: 59.06 },
  { profile: 'CHS 88.9x4', superseded: 97.8, corrected: 96.34 },
  { profile: 'CHS 193.7x8', superseded: 2039.0, corrected: 2015.54 },
];

/**
 * Report whether a loaded section carries one of the superseded CHS inertias.
 *
 * Returns the migration delta so it can be surfaced or logged; it does not
 * mutate anything, because the correction happens naturally when the section
 * resolves to canonical geometry.
 */
export function supersededInertiaDelta(
  sec: Section,
): { profile: string; superseded: number; corrected: number } | null {
  if (sec.iz == null) return null;
  const cm4 = sec.iz * 1e8;
  for (const entry of SUPERSEDED_CHS_INERTIA) {
    // Published values carry three or four significant figures, so compare
    // with a relative tolerance rather than by exact equality.
    if (Math.abs(cm4 - entry.superseded) / entry.superseded < 1e-3) return entry;
  }
  return null;
}
