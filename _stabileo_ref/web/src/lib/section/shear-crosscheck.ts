/**
 * shear-crosscheck.ts — the closed-form shear diagram, checked against the solve.
 *
 * # Two engines, and why both exist
 *
 * Stabileo computes transverse shear two different ways, and neither is
 * redundant:
 *
 *   * The **canonical solver** (Rust/WASM) meshes the section's real polygon
 *     and solves the equilibrium problem by finite elements. It is exact for
 *     ANY shape — angles, closed tubes, arbitrary outlines — because it assumes
 *     nothing about where the material is. What it returns is `tau` AT A POINT:
 *     ask it for one location, get one answer, having meshed and solved to get
 *     there.
 *
 *   * The **closed-form path** (`computeShearFlowPaths`) applies Jourawski's
 *     `V·Q/(I·b)` with a formula hand-derived per shape. It is instant and it
 *     returns the whole FIELD along the wall, which is what a diagram needs —
 *     you cannot draw a distribution out of a single point.
 *
 * So the diagram is drawn by the fast path and the solver is the authority. The
 * risk in that arrangement is obvious in hindsight: a hand-derived formula can
 * be wrong, the picture still looks like a plausible shear distribution, and
 * nothing complains. That is exactly what happened to the circular tube, which
 * reported half its true stress for as long as it existed — right shape, right
 * peak location, wrong by a factor of two.
 *
 * # What this does about it
 *
 * Rather than replace the diagram with sampled solver points — dozens of solves
 * to draw one picture — this asks the solver for the ONE number the diagram
 * claims most loudly: the peak. If the two disagree beyond a tolerance, the
 * panel says so instead of quietly showing the cheaper answer.
 *
 * It costs a single solve, it catches the whole class of error that produced the
 * tube bug, and it turns the weaker engine into a checked one rather than a
 * trusted one.
 */

import { analyzeSectionShear } from '../engine/wasm-solver';
import type { CanonicalGeometry } from '../engine/wasm-solver';

export interface ShearCrossCheck {
  /** Peak from the closed-form diagram, MPa. */
  closedForm: number;
  /** Peak from the canonical solve at the same station, MPa. */
  solved: number;
  /** Relative difference, `|closed - solved| / solved`. */
  relativeError: number;
  /** Whether the two agree within tolerance. */
  agrees: boolean;
}

/**
 * Compare the drawn peak against the solver's.
 *
 * `vy`/`vz` in kN. `tolerance` defaults to 20%, which sounds generous and is
 * not: Jourawski assumes a single width across the cut and the solver does not,
 * so on a flanged section they legitimately differ by a few per cent. The
 * tolerance is set to catch the errors that matter — a factor of two, a missing
 * term, a wrong divisor — without crying wolf over the approximation the
 * closed form openly is.
 *
 * Returns null when the solve is unavailable, which is not a failure: a
 * properties-only section has no geometry to mesh, and the diagram is still
 * the best answer available. It also returns null under biaxial shear (vy and
 * vz both nonzero): the two components peak at different points, so no single
 * peak exists to compare the drawn one against.
 */
export function crossCheckShearPeak(
  geometry: CanonicalGeometry,
  closedFormPeak: number,
  vy: number,
  vz: number,
  tolerance = 0.2,
): ShearCrossCheck | null {
  if (!(closedFormPeak > 0)) return null;
  // Under BIAXIAL shear there is no peak to compare: the vy- and vz-response
  // maxima occur at different points of the outline, so combining them (even
  // vectorially) describes no point that exists. Decline rather than check a
  // number against a fiction — the uniaxial case is where the cross-check
  // earns its keep.
  if (vy !== 0 && vz !== 0) return null;
  try {
    const sh = analyzeSectionShear({ geometry });
    // Unit-force response scaled by the actual force. The solve is linear, so
    // the scale-up is exact; only one of the two is nonzero here (see above).
    const peak = Math.hypot(sh.vy.tauMax * vy, sh.vz.tauMax * vz);
    // kPa to MPa: the solver works in the geometry's own units, which are SI.
    const solved = peak / 1000;
    if (!(solved > 0) || !Number.isFinite(solved)) return null;
    const relativeError = Math.abs(closedFormPeak - solved) / solved;
    return {
      closedForm: closedFormPeak,
      solved,
      relativeError,
      agrees: relativeError <= tolerance,
    };
  } catch {
    // A section that will not mesh is a real state and already reported
    // elsewhere; it is not this function's job to raise it again.
    return null;
  }
}
