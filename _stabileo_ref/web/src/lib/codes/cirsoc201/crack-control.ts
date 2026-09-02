/**
 * Maximum bar spacing for crack control — CIRSOC 201-2025 §24.3.
 *
 * ── Why this is its own module ─────────────────────────────────
 *
 * `slab-design.ts` already implements §7.7.2.3 (the lesser of 3h and 300 mm) and calls it
 * "the maximum spacing". It is only ONE of the two maxima the code imposes. §7.7.2.2 sends
 * the spacing of the bonded reinforcement closest to the tension face to §24.3 as well, and
 * that limit shrinks as the cover grows — so on a member with the thick cover a foundation
 * has, §24.3 governs and the 300 mm limit alone is unconservative.
 *
 * ── The rule, verbatim ─────────────────────────────────────────
 *
 * §24.3.2 — the spacing of bonded reinforcement closest to the tension face shall not
 *   exceed the values in Table 24.3.2, where `cc` is the least distance from the surface of
 *   the deformed or prestressed reinforcement to the tension face.
 *
 * Table 24.3.2, deformed bars or wires — s is the LESSER of:
 *
 *     380 (280 / f_s) − 2,5 c_c
 *     300 (280 / f_s)
 *
 * §24.3.2.1 — f_s, the calculated stress in the deformed reinforcement closest to the
 *   tension face at service loads, shall be obtained from the unfactored moment, or it is
 *   PERMITTED to take f_s as (2/3) f_y.
 *
 * Only the deformed-bar row is implemented. The prestressed and mixed rows of Table 24.3.2
 * carry their own (2/3) and (5/6) effectiveness factors on Δf_ps, and this project models no
 * prestressing anywhere — a caller that reached those rows would be designing a member the
 * rest of the app cannot analyse.
 *
 * The 2005 edition put the same intent in §10.6.4 with a different expression. It is NOT
 * folded in here: applying the 2025 table to a project the user asked to be designed to 2005
 * would be applying the wrong edition, which is the mistake `spacing.ts` documents at length.
 *
 * Lengths in metres unless the name says `Mm`. Pure: no store, no runes.
 */

import { clause, type ClauseRef, type RegulationEdition } from '../regulation';

/** §24.3.2's reference stress, MPa — the 280 in both terms of Table 24.3.2. */
const REFERENCE_FS_MPA = 280;

export interface CrackControlSpacingInputs {
  /**
   * Steel yield strength, MPa. Used only through the §24.3.2.1 permission below.
   */
  fy: number;
  /**
   * Least distance from the bar SURFACE to the tension face, m — Table 24.3.2's `c_c`.
   *
   * This is the clear cover to the layer being checked, not the member's nominal cover: for
   * the upper of two bottom layers it is the cover PLUS the diameter of the layer underneath.
   * Getting it wrong in that direction over-states the permitted spacing, so the caller is
   * required to state it rather than have it inferred from a nominal cover here.
   */
  clearCoverToTensionFace: number;
  /**
   * Service stress in the reinforcement, MPa, when the caller computed it from the
   * unfactored moment.
   *
   * Omitted, §24.3.2.1's explicit permission applies and f_s = (2/3) f_y. That permission is
   * part of the clause, not a shortcut around it — but which of the two was used changes the
   * answer, so the result says so.
   */
  fs?: number;
}

export interface CrackControlSpacing {
  /** Governing maximum centre-to-centre spacing, m. */
  maxSpacing: number;
  /** The two terms of Table 24.3.2, in mm, before the lesser is taken. */
  terms: { coverTermMm: number; capTermMm: number };
  /** Which term governed. */
  governedBy: 'coverTerm' | 'cap';
  /** Stress used, MPa, and whether it came from the caller or from §24.3.2.1's permission. */
  fs: number;
  fsSource: 'computed' | 'permittedTwoThirdsFy';
  refs: ClauseRef[];
}

/**
 * Table 24.3.2, deformed-bar row.
 *
 * Both terms are evaluated and the lesser governs, because which one governs depends on the
 * cover: at f_s = 280 MPa the cap is 300 mm and the cover term passes it only below
 * c_c = 32 mm, so on a member with foundation-scale cover the cover term is the real limit.
 *
 * The cover term can go to zero or negative at absurd covers. It is floored at zero and the
 * caller sees a zero maximum, which no layout can satisfy — a design failure, which is the
 * honest outcome for a section that cannot be crack-controlled at that cover.
 */
export function crackControlMaxSpacing(
  edition: RegulationEdition,
  inputs: CrackControlSpacingInputs,
): CrackControlSpacing {
  const permitted = inputs.fs === undefined || !(inputs.fs > 0);
  // §24.3.2.1: f_s from the unfactored moment, or (2/3) f_y by explicit permission.
  const fs = permitted ? (2 / 3) * inputs.fy : (inputs.fs as number);
  const ratio = REFERENCE_FS_MPA / fs;
  const ccMm = inputs.clearCoverToTensionFace * 1000;

  const coverTermMm = Math.max(0, 380 * ratio - 2.5 * ccMm);
  const capTermMm = 300 * ratio;
  const governedBy = coverTermMm <= capTermMm ? 'coverTerm' : 'cap';

  return {
    maxSpacing: Math.min(coverTermMm, capTermMm) / 1000,
    terms: { coverTermMm, capTermMm },
    governedBy,
    fs,
    fsSource: permitted ? 'permittedTwoThirdsFy' : 'computed',
    refs: [
      clause('cirsoc-201', edition, '24.3.2',
        'separación máxima de la armadura con adherencia, Tabla 24.3.2'),
      ...(permitted
        ? [clause('cirsoc-201', edition, '24.3.2.1',
          'se permite tomar fs igual a dos tercios de fy')]
        : []),
    ],
  };
}
