/**
 * warping.ts — the OTHER half of torsion, and the one that is easy to omit.
 *
 * # Why Saint-Venant is not the whole story
 *
 * A member resists a torque by two mechanisms at once:
 *
 *   * **Saint-Venant** (uniform torsion) — shear flow circulating in the wall.
 *     This is what `torsion-flow.ts` computes, and it is all there is when the
 *     section is free to warp out of its plane.
 *   * **Warping** (non-uniform torsion) — when the ends are RESTRAINED from
 *     warping, the flanges bend in opposite directions and the member resists
 *     largely by that flexure instead.
 *
 * The second is not a refinement of the first. For an open section they differ
 * by orders of magnitude, and which dominates is decided by the member's LENGTH
 * relative to a characteristic length of its own:
 *
 * ```text
 *   lambda = sqrt(E·Cw / (G·J))
 * ```
 *
 * A member much longer than `lambda` twists in essentially uniform torsion; one
 * much shorter is carried almost entirely by warping. An IPE 300 has lambda
 * near 2 m, so a 1.5 m beam and a 12 m beam behave completely differently under
 * the same torque, with nothing in the section to say so.
 *
 * # What omitting it costs, and in which direction
 *
 * Two consequences, and they point opposite ways:
 *
 *   * **Stiffness** is UNDERESTIMATED by ignoring warping — the member twists
 *     less than Saint-Venant alone predicts. Conservative for deflection.
 *   * **Stress** is UNDERESTIMATED too, and that is not conservative: warping
 *     produces NORMAL stresses `sigma_w` in the flanges that ADD to the
 *     bending stress. On a short restrained member they can rival it.
 *
 * That asymmetry is the reason this module exists. A panel that shows only
 * Saint-Venant is not merely incomplete; it is quietly unconservative on
 * exactly the members where torsion matters most.
 *
 * # Boundary conditions are an input, not a property of the section
 *
 * Warping stress depends on how the ENDS are restrained, which is a property of
 * the structure, not of the cross-section. So this reports the two standard
 * reference cases explicitly rather than picking one silently — a number
 * derived from an unstated assumption is worse than no number.
 */

import type { ResolvedSection } from './section-stress';

export type WarpingClass =
  /** Open section: warping is significant, sometimes dominant. */
  | 'openSignificant'
  /** Walls meeting at a point: the warping constant is nearly zero. */
  | 'pointSymmetric'
  /** Closed section: torsion is carried by circulation, warping negligible. */
  | 'closedNegligible';

/** How well the closed form is expected to match a published value. */
export type WarpingFidelity = 'exact' | 'thinWall';

export interface WarpingProperties {
  klass: WarpingClass;
  /** Warping constant, m⁶. Zero where the class says it is negligible. */
  cw: number;
  /** Saint-Venant torsion constant used for the comparison, m⁴. */
  j: number;
  /**
   * Characteristic length `sqrt(E·Cw/(G·J))`, metres.
   *
   * Null when Cw is negligible: there is no warping length for a section that
   * does not warp, and reporting zero would read as "very short" rather than
   * "not applicable".
   */
  lambda: number | null;
  fidelity: WarpingFidelity;
  labelKey: string;
}

export interface WarpingResponse {
  /**
   * Fraction of the applied torque carried by Saint-Venant, 0 to 1. The rest
   * is carried by warping.
   */
  saintVenantShare: number;
  /** Peak warping normal stress, MPa. */
  sigmaW: number;
  /** Peak bimoment, kN·m². */
  bimoment: number;
  /** Which end restraint this assumes. */
  caseKey: string;
}

/**
 * The warping constant, by family.
 *
 * `Cw = Iz·h0²/4` for a doubly-symmetric I is not an approximation: the flanges
 * bend about their own axes and the couple arm is the distance between their
 * centres. Checked against published tables for IPE, HEA and HEB it lands
 * within 0.3%.
 *
 * The channel formula is thin-wall theory, and it is honestly worse — around
 * 15% against published values, because it ignores the root fillets and the
 * tapered flange a UPN actually has. Reported as `thinWall` so a caller can say
 * so rather than implying a precision it does not have.
 */
export function warpingProperties(rs: ResolvedSection): WarpingProperties {
  const { h, b, tw, tf, iz, j } = rs;

  switch (rs.shape) {
    case 'I': case 'H': {
      // Distance between flange centre lines. tf ≥ h is a plate, not an I —
      // without the guard the squared term would still report a bogus
      // positive Cw for it (the channel branch below already refuses).
      const h0 = h - tf;
      if (h0 <= 0) break;
      return {
        klass: 'openSignificant',
        cw: (iz * h0 * h0) / 4,
        j, lambda: null, fidelity: 'exact',
        labelKey: 'warp.class.iBeam',
      };
    }

    case 'U': case 'C': {
      // Flange width from the web's CENTRE line, not its face.
      const bm = b - tw / 2;
      const h0 = h - tf;
      if (bm <= 0 || h0 <= 0) break;
      const num = 3 * tf * bm + 2 * tw * h0;
      const den = 6 * tf * bm + tw * h0;
      if (den <= 0) break;
      return {
        klass: 'openSignificant',
        cw: ((tf * bm ** 3 * h0 * h0) / 12) * (num / den),
        j, lambda: null, fidelity: 'thinWall',
        labelKey: 'warp.class.channel',
      };
    }

    case 'T': case 'L': case 'invL':
      // Every wall's mid-line passes through ONE point, so the sectorial
      // coordinate is nearly zero everywhere and so is Cw. There is a residual
      // term from the walls' own thickness, but it is three or four orders of
      // magnitude below an I-beam's and carrying it would invite a reader to
      // treat it as a real warping capacity. Reported as zero, with the class
      // saying why rather than the number pretending to.
      return {
        klass: 'pointSymmetric', cw: 0, j, lambda: null,
        fidelity: 'exact', labelKey: 'warp.class.pointSymmetric',
      };

    case 'RHS': case 'CHS':
      // A closed section carries torque by circulation and barely warps at all.
      return {
        klass: 'closedNegligible', cw: 0, j, lambda: null,
        fidelity: 'exact', labelKey: 'warp.class.closed',
      };
  }

  return {
    klass: 'closedNegligible', cw: 0, j, lambda: null,
    fidelity: 'thinWall', labelKey: 'warp.class.closed',
  };
}

/** Fill in `lambda` once the elastic constants are known. `e` in MPa. */
export function withLambda(
  props: WarpingProperties, e: number, nu = 0.3,
): WarpingProperties {
  if (props.cw <= 0 || props.j <= 0 || e <= 0) return { ...props, lambda: null };
  const g = e / (2 * (1 + nu));
  return { ...props, lambda: Math.sqrt((e * props.cw) / (g * props.j)) };
}

/**
 * The sectorial coordinate at the point where warping stress peaks, m².
 *
 * For a doubly-symmetric I this is `h0·b/4` — the corner of a flange, which is
 * where the flange's own bending stress is largest too, so the two add at the
 * worst place rather than at different ones.
 *
 * A channel needs the shear centre, and this is where it was skipped: the
 * comment said "measured about the shear centre" and the arithmetic measured
 * from the WEB. Its pole sits a distance `e` outside the web, so the sectorial
 * coordinate runs from `h0·e/2` at the web-flange junction to `h0·(bm−e)/2` at
 * the flange tip, and the peak is whichever is larger. Taking the tip from the
 * web instead — `h0·bm/2` — is 60% high on a UPN 200, and `sigma_w = B·ω/Cw`
 * carries that straight into the reported stress. Conservative, but a stress
 * 60% high is not a usable number either.
 *
 * `e = 3·bm²·tf / (6·bm·tf + h0·tw)` is the thin-wall result, and its
 * denominator is the same one the channel's `Cw` above already computes —
 * which is the tell that the two belong to the same derivation.
 */
function peakSectorialCoordinate(rs: ResolvedSection): number {
  switch (rs.shape) {
    case 'I': case 'H':
      return ((rs.h - rs.tf) * rs.b) / 4;
    case 'U': case 'C': {
      const bm = rs.b - rs.tw / 2;
      const h0 = rs.h - rs.tf;
      const den = 6 * rs.tf * bm + rs.tw * h0;
      if (bm <= 0 || h0 <= 0 || den <= 0) return 0;
      const e = (3 * bm * bm * rs.tf) / den;
      return (h0 / 2) * Math.max(e, bm - e);
    }
    default:
      return 0;
  }
}

/**
 * How a member of length `L` actually responds to a torque.
 *
 * `torque` in kN·m, `length` in metres, `e` in MPa. Two reference cases, both
 * standard, and neither is guessed at:
 *
 *   * `cantilever` — one end fully restrained against warping, torque applied
 *     at the free end. The severe case, and the one a welded moment connection
 *     approaches.
 *   * `simple` — both ends free to warp, torque at mid-span. The mild case.
 *
 * Returns null when the section does not warp appreciably, which is the honest
 * answer for a tube: there is nothing to report, not a value of zero.
 */
export function warpingResponse(
  rs: ResolvedSection,
  props: WarpingProperties,
  torque: number,
  length: number,
  e: number,
  restraint: 'cantilever' | 'simple' = 'cantilever',
  nu = 0.3,
): WarpingResponse | null {
  if (props.cw <= 0 || props.j <= 0 || !(length > 0) || !(e > 0)) return null;
  const lambda = props.lambda ?? withLambda(props, e, nu).lambda;
  if (!lambda || lambda <= 0) return null;

  const absT = Math.abs(torque);
  const ratio = length / lambda;

  // Bimoment for the two classical solutions of the non-uniform torsion
  // equation. Both tend to T·lambda for a long member and to a linear
  // distribution for a short one.
  const bimoment = restraint === 'cantilever'
    ? absT * lambda * Math.tanh(ratio)
    : (absT * lambda / 2) * Math.tanh(ratio / 2);

  // sigma_w = B·Wns/Cw. Units: B in kN·m², Wns in m², Cw in m⁶ → kN/m² = kPa.
  const wns = peakSectorialCoordinate(rs);
  const sigmaW = props.cw > 0 ? (bimoment * wns) / props.cw / 1000 : 0;

  // Share of the torque carried uniformly. For the cantilever solution the
  // Saint-Venant part at the restrained end is 1 - 1/cosh(L/lambda), rising to
  // 1 for a long member and falling to 0 for a short one — which is the
  // statement that a short restrained member resists almost entirely by
  // warping. The simple case is that same solution mirrored about mid-span:
  // each half-span is a cantilever of length L/2 (warping is restrained at
  // mid-span by symmetry, where the bimoment peaks), so its parameter is the
  // half-span L/(2·lambda) — the same argument the bimoment line above uses.
  const share = restraint === 'cantilever'
    ? 1 - 1 / Math.cosh(ratio)
    : 1 - 1 / Math.cosh(ratio / 2);
  const saintVenantShare = Math.max(0, Math.min(1, share));

  return {
    saintVenantShare,
    sigmaW,
    bimoment,
    caseKey: restraint === 'cantilever' ? 'warp.case.cantilever' : 'warp.case.simple',
  };
}
