/**
 * section-teaching.ts — the centroid and the shear centre, worked out in steps.
 *
 * # Why derive what the engine already computes
 *
 * The canonical engine integrates the section's polygon and returns both points
 * to full precision. It does not, and should not, explain them. These two are
 * the properties a student is asked to find by hand, and the working is the
 * lesson — not the answer.
 *
 * So this decomposes a section the way it is decomposed on paper: into
 * rectangles, with a table of A_i, its lever arm, and the product. That is the
 * calculation as it is taught, and the total lands on the same place the
 * numerical integration does, which is itself worth showing.
 *
 * # The two are not the same kind of property
 *
 * The centroid is where AREA balances. It follows from a first moment and
 * nothing else: `y_G = sum(A_i·y_i) / sum(A_i)`. Any section has one, and
 * finding it needs no notion of load at all.
 *
 * The shear centre is where a transverse load produces NO TWIST. It follows
 * from the shear flow, so it depends on how the material is distributed around
 * the axis rather than just how much of it there is. That difference is why a
 * channel's shear centre lies outside the section entirely — a place the
 * centroid can never be — and why loading a channel through its web twists it.
 *
 * They coincide only when symmetry forces them to, which is the useful rule:
 * two axes of symmetry, and the two points must be the same one.
 *
 * # Axes
 *
 * `ResolvedSection`'s convention throughout: **y is vertical** (the depth) and
 * **z is horizontal** (the width). This differs from the canonical geometry's
 * convention, where y is horizontal — a trap worth naming, since both appear in
 * this panel.
 */

import type { ResolvedSection } from './section-stress';

/** One rectangle the section is decomposed into, for the working. */
export interface AreaPart {
  /** i18n key naming the part — "top flange", "web". */
  labelKey: string;
  /** Width (horizontal), metres. */
  width: number;
  /** Height (vertical), metres. */
  height: number;
  /** Area, m². Negative for a subtracted void. */
  area: number;
  /** Centroid of THIS part, measured from the reference corner, metres. */
  zi: number;
  yi: number;
}

export interface CentroidWorking {
  parts: AreaPart[];
  /** Where the part coordinates are measured from. */
  originKey: string;
  totalArea: number;
  /** First moments about the reference axes, m³. */
  sumAz: number;
  sumAy: number;
  /** The centroid, from the same reference corner, metres. */
  zBar: number;
  yBar: number;
  /**
   * How far this lands from the engine's own answer, as a fraction of the
   * section's depth. A decomposition into rectangles ignores root fillets, so
   * a small disagreement on a rolled profile is expected and honest — hiding
   * it would teach that hand calculation is exact when it is not.
   */
  relativeError: number | null;
  /** True when symmetry alone fixes the answer, so no arithmetic is needed. */
  bySymmetry: { horizontal: boolean; vertical: boolean };
}

export type ShearCentreRule =
  | 'doublySymmetric'
  | 'intersectingWalls'
  | 'channelFormula'
  | 'numeric';

export interface ShearCentreWorking {
  rule: ShearCentreRule;
  /** Offset from the CENTROID, metres, in (z, y) — horizontal, vertical. */
  ez: number;
  ey: number;
  /** Whether the point falls outside the section's own outline. */
  outsideSection: boolean;
  /** Intermediate quantities the rule used, for display. */
  terms: Array<{ symbolKey: string; value: number; unit: string }>;
  labelKey: string;
}

const rectPart = (
  labelKey: string, width: number, height: number, zi: number, yi: number, sign = 1,
): AreaPart => ({ labelKey, width, height, area: sign * width * height, zi, yi });

/**
 * Decompose a section into rectangles, measured from its bottom-left corner.
 *
 * The bottom-left is chosen as the reference for the same reason it is chosen
 * on paper: every lever arm comes out positive, so a sign error cannot hide in
 * the sum.
 */
export function decompose(rs: ResolvedSection): AreaPart[] {
  const { h, b, tw, tf, t } = rs;
  switch (rs.shape) {
    case 'I': case 'H': {
      const hw = h - 2 * tf;
      return [
        rectPart('teach.part.flangeTop', b, tf, b / 2, h - tf / 2),
        rectPart('teach.part.web', tw, hw, b / 2, h / 2),
        rectPart('teach.part.flangeBot', b, tf, b / 2, tf / 2),
      ];
    }
    case 'U': {
      const hw = h - 2 * tf;
      // A channel's flanges run from the web outward, so every part shares the
      // web's left edge as its origin — which is what puts the centroid off
      // the web centreline.
      return [
        rectPart('teach.part.flangeTop', b, tf, b / 2, h - tf / 2),
        rectPart('teach.part.web', tw, hw, tw / 2, h / 2),
        rectPart('teach.part.flangeBot', b, tf, b / 2, tf / 2),
      ];
    }
    case 'T': {
      const hw = h - tf;
      return [
        rectPart('teach.part.flange', b, tf, b / 2, h - tf / 2),
        rectPart('teach.part.web', tw, hw, b / 2, hw / 2),
      ];
    }
    case 'L': case 'invL': {
      const tv = tw || t;
      const th = tf || t;
      return [
        rectPart('teach.part.legV', tv, h, tv / 2, h / 2),
        rectPart('teach.part.legH', b - tv, th, tv + (b - tv) / 2, th / 2),
      ];
    }
    case 'RHS':
      // Outer rectangle minus the bore: two parts, one negative. Subtracting a
      // void is the same first-moment arithmetic with a negative area, which is
      // worth showing rather than special-casing.
      return [
        rectPart('teach.part.outer', b, h, b / 2, h / 2),
        rectPart('teach.part.void', b - 2 * t, h - 2 * t, b / 2, h / 2, -1),
      ];
    case 'C': {
      const hw = h - 2 * tf;
      const lip = t;
      return [
        rectPart('teach.part.flangeTop', b, tf, b / 2, h - tf / 2),
        rectPart('teach.part.web', tw, hw, tw / 2, h / 2),
        rectPart('teach.part.flangeBot', b, tf, b / 2, tf / 2),
        rectPart('teach.part.lipTop', rs.tl || tf, lip, b - (rs.tl || tf) / 2, h - tf - lip / 2),
        rectPart('teach.part.lipBot', rs.tl || tf, lip, b - (rs.tl || tf) / 2, tf + lip / 2),
      ];
    }
    default:
      return [rectPart('teach.part.whole', b || h, h, (b || h) / 2, h / 2)];
  }
}

/**
 * Work the centroid out from the decomposition.
 *
 * `engineCentroid` is the numerical answer, given so the working can be
 * compared against it rather than trusted.
 */
export function centroidWorking(
  rs: ResolvedSection,
  engineCentroid?: { z: number; y: number },
): CentroidWorking {
  const parts = decompose(rs);
  const totalArea = parts.reduce((s, p) => s + p.area, 0);
  const sumAz = parts.reduce((s, p) => s + p.area * p.zi, 0);
  const sumAy = parts.reduce((s, p) => s + p.area * p.yi, 0);
  const zBar = totalArea !== 0 ? sumAz / totalArea : 0;
  const yBar = totalArea !== 0 ? sumAy / totalArea : 0;

  // Symmetry, from the shape rather than from the numbers: a section that is
  // symmetric about an axis has its centroid ON that axis, and no arithmetic
  // is needed to know it.
  const doubly = rs.shape === 'I' || rs.shape === 'H' || rs.shape === 'RHS'
    || rs.shape === 'CHS' || rs.shape === 'rect';
  const bySymmetry = {
    horizontal: doubly || rs.shape === 'U',   // symmetric about the horizontal axis
    vertical: doubly || rs.shape === 'T',     // symmetric about the vertical axis
  };

  let relativeError: number | null = null;
  if (engineCentroid && rs.h > 0) {
    const dz = Math.abs(zBar - (engineCentroid.z + (rs.b || rs.h) / 2));
    const dy = Math.abs(yBar - (engineCentroid.y + rs.h / 2));
    relativeError = Math.hypot(dz, dy) / rs.h;
  }

  return {
    parts, originKey: 'teach.originBottomLeft',
    totalArea, sumAz, sumAy, zBar, yBar,
    relativeError, bySymmetry,
  };
}

/**
 * Locate the shear centre, and say by WHICH rule.
 *
 * Three rules cover the catalogue, and each is a different argument rather than
 * a different formula:
 *
 *   * **Two axes of symmetry** — it must coincide with the centroid, because
 *     the shear flow is symmetric and its resultant can only pass through the
 *     centre. No calculation.
 *   * **Walls meeting at a point** (angle, tee) — the shear flow in a thin
 *     rectangle runs along its mid-line, so each wall's resultant passes
 *     through that line. Two resultants meet at one point, and a force through
 *     it produces no moment about it. The shear centre is the intersection,
 *     which for an angle is the corner itself.
 *   * **Channel** — the flange flows form a couple that the web flow cannot
 *     balance unless the load sits OUTSIDE the section, on the far side of the
 *     web from the flanges. `e = b²·h²·t_f / (4·I)`.
 */
export function shearCentreWorking(rs: ResolvedSection): ShearCentreWorking {
  const { h, b, tw, tf, t, iy } = rs;

  switch (rs.shape) {
    case 'I': case 'H': case 'RHS': case 'CHS': case 'rect':
      return {
        rule: 'doublySymmetric', ez: 0, ey: 0, outsideSection: false,
        terms: [], labelKey: 'teach.sc.doubly',
      };

    case 'T': {
      // A tee has ONE axis of symmetry, the vertical one, and the shear centre
      // must lie on it — so the horizontal offset is zero by symmetry, not by
      // arithmetic. Vertically it sits where the two mid-lines cross, which is
      // the middle of the flange: the web contributes no horizontal flow, so
      // the whole resultant passes through the flange's own line.
      const th = tf || t;
      const parts = centroidWorking(rs);
      return {
        rule: 'intersectingWalls', ez: 0, ey: h - th / 2 - parts.yBar,
        outsideSection: false,
        terms: [{ symbolKey: 'teach.sym.th', value: th * 1000, unit: 'mm' }],
        labelKey: 'teach.sc.walls',
      };
    }

    case 'L': case 'invL': {
      // Two thin rectangles meeting at a corner. The shear flow in each runs
      // along its own mid-line, so each leg's resultant passes through that
      // line — and two lines meet at exactly one point. A force through the
      // corner therefore produces no moment about it, which is the definition.
      const tv = tw || t;
      const th = tf || t;
      const parts = centroidWorking(rs);
      return {
        rule: 'intersectingWalls',
        ez: tv / 2 - parts.zBar,
        ey: th / 2 - parts.yBar,
        outsideSection: false,
        terms: [
          { symbolKey: 'teach.sym.tv', value: tv * 1000, unit: 'mm' },
          { symbolKey: 'teach.sym.th', value: th * 1000, unit: 'mm' },
        ],
        labelKey: 'teach.sc.walls',
      };
    }

    case 'U': case 'C': {
      // Mid-line dimensions: the flange width measured from the web's centre
      // line, and the depth between flange centre lines.
      const bm = b - tw / 2;
      const hm = h - tf;
      // e is the distance of the shear centre from the web's CENTRE LINE —
      // the formula is derived in mid-line dimensions, so that is the point
      // its lever arm refers to — on the side opposite the flanges.
      const e = iy > 1e-15 ? (bm * bm * hm * hm * tf) / (4 * iy) : 0;
      const parts = centroidWorking(rs);
      // The decomposition's origin is the web's OUTER FACE, half a web
      // thickness inboard of the centre line: the shear centre sits at
      // tw/2 − e from that face, the centroid at zBar. (UPN 200: e = 26.8 mm
      // from the centre line, i.e. 22.5 mm clear of the outer face — the
      // published value is ≈ 22.4 mm. Omitting the tw/2 shifts the point one
      // half web thickness too far out.)
      const ez = tw / 2 - e - parts.zBar;
      return {
        rule: 'channelFormula', ez, ey: 0,
        outsideSection: true,
        terms: [
          { symbolKey: 'teach.sym.bm', value: bm * 1000, unit: 'mm' },
          { symbolKey: 'teach.sym.hm', value: hm * 1000, unit: 'mm' },
          { symbolKey: 'teach.sym.tf', value: tf * 1000, unit: 'mm' },
          { symbolKey: 'teach.sym.iy', value: iy * 1e8, unit: 'cm⁴' },
          { symbolKey: 'teach.sym.e', value: e * 1000, unit: 'mm' },
        ],
        labelKey: 'teach.sc.channel',
      };
    }

    default:
      return {
        rule: 'numeric', ez: 0, ey: 0, outsideSection: false,
        terms: [], labelKey: 'teach.sc.numeric',
      };
  }
}
