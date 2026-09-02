/**
 * Members carrying torsion that no check in this application evaluates.
 *
 * ── Why this exists ────────────────────────────────────────────────
 *
 * The CIRSOC 201 adapter declares `beams.torsion: false`. That is an honest capability
 * statement and it has always been there — and it reached nothing the user could read. The
 * analysis computes T at every station, `peakTorsion` has existed unused since the axis work,
 * and a beam with 4 kN·m of torsion was detailed, drawn, scheduled and reported exactly like a
 * beam with none.
 *
 * That is the same failure the provisional-proposal work already fixed once, on the other axis:
 * `docs/audits/biaxial-beam-design.md` records that in the 7-storey population the median
 * torsion (1,33 kN·m) EXCEEDS the median secondary moment (1,00 kN·m). The secondary moment
 * gets a colour, a banner, a report section and a state name. The torsion got nothing.
 *
 * ── What this does NOT do ──────────────────────────────────────────
 *
 * It does not check torsion, size a stirrup for it, or change any member's outcome. The
 * authority over torsion is unchanged: no adapter gains a capability, no certificate changes,
 * no state is downgraded. A member with unevaluated torsion keeps its geometry, keeps its
 * reinforcement, keeps its proposal if it has one, and gains a WARNING.
 *
 * Deliberately not a refusal. Turning these members into FAILED would hide them from the
 * viewer — 3-D geometry the user could no longer inspect — which is the exact mistake the
 * unreinforced-member work was written to undo. And leaving them silent presents an unverified
 * member as a verified one. The only honest third option is to draw it and say so.
 *
 * Pure: no store, no runes, no i18n, no DOM.
 */

import { peakMy, peakMz, peakTorsion } from '../design/design-axes';
import type { ElementDesignDemands } from '../station-design-forces';

/**
 * Below this absolute torsion (kN·m) a member is not reported.
 *
 * The same floor `design-axes` applies to a moment component, and for the same reason: a
 * three-dimensional frame analysis produces a non-zero T on essentially every member, and a
 * warning that fires on 0,003 kN·m of numerical residue is a warning nobody reads. Above it,
 * the torsion is a real action the application does not check.
 *
 * Not a code threshold and never presented as one. CIRSOC 201 §11.5 has a threshold below
 * which torsion may be neglected, and computing it needs Acp, pcp and f'c — this module has
 * none of them, and a number that LOOKED like the code's would be the worst of the options.
 */
export const TORSION_NOTICE_FLOOR = 0.1;

/** What is known about one member's unevaluated torsion. */
export interface TorsionNotice {
  elementId: number;
  /** Peak |T| across the governing demands, kN·m. Copied, never derived here. */
  torsion: number;
  /**
   * The larger of the two peak bending moments, kN·m.
   *
   * Carried so the warning can state the torsion's SIZE against something. "4 kN·m of torsion"
   * means nothing on its own; "4 kN·m of torsion beside 6 kN·m of bending" is a member an
   * engineer will stop and look at, and "0,2 beside 300" is one they will not.
   */
  primaryMoment: number;
}

/** What a member has to be, for its torsion to be worth reporting. */
export interface TorsionNoticeInput {
  elementId: number;
  elementType: 'beam' | 'column' | 'wall';
  demands: ElementDesignDemands | undefined;
}

/**
 * Whether this application evaluates torsion for a member of this type.
 *
 * A single explicit argument rather than a lookup, so this module stays free of the design
 * layer and so the answer can never quietly become "true" because a capability object grew a
 * field. The caller reads it off the adapter that actually ran.
 */
export interface TorsionCapability {
  /** True when the code adapter in use verifies torsion on beams. */
  beams: boolean;
}

/**
 * The members whose torsion is real and unevaluated, ascending by id.
 *
 * Beams only, and that is a limit rather than an omission: columns in this application are
 * verified for axial force with biaxial bending and their transverse steel is detailed for
 * confinement, so a column's torsion sits inside a different unfinished story with a different
 * remedy. Naming it here would make one warning stand for two problems.
 */
export function torsionUnevaluatedMembers(
  members: Iterable<TorsionNoticeInput>,
  capability: TorsionCapability,
): TorsionNotice[] {
  if (capability.beams) return [];
  const out: TorsionNotice[] = [];
  for (const m of members) {
    if (m.elementType !== 'beam') continue;
    const torsion = peakTorsion(m.demands);
    if (torsion <= TORSION_NOTICE_FLOOR) continue;
    out.push({
      elementId: m.elementId,
      torsion,
      primaryMoment: Math.max(peakMy(m.demands), peakMz(m.demands)),
    });
  }
  return out.sort((a, b) => a.elementId - b.elementId);
}
