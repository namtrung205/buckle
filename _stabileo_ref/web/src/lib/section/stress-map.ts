/**
 * stress-map.ts — where the normal-stress colour ramp points.
 *
 * # Why this is a module and not four lines of markup
 *
 * The stress map is a linear gradient across the section, and a linear gradient
 * is described by two endpoints. Getting those endpoints from the stress plane
 * means one coordinate change — section axes (y right, z UP, metres) to SVG
 * (x right, y DOWN, scaled) — and that change has a sign in it.
 *
 * It was wrong. The map painted the compressed flange red and the tension
 * flange blue: the exact opposite of the sigma diagram drawn beside it, from
 * the same three numbers. Two views of one field disagreeing is worse than
 * either being absent, because a reader has no way to tell which one to
 * believe, and the colours are the part that gets read at a glance.
 *
 * The arithmetic is four lines. What was missing was somewhere to write the
 * test that says "compression is blue and it is at the top" — which is the real
 * subject here, and cannot be asserted about inline template expressions.
 *
 * # The convention, stated once
 *
 * `sigma(y, z) = axial + kz·z − ky·y`, the same expression the engine
 * integrates. SVG maps `x = y·sc` and `y = −z·sc`. Substituting:
 *
 *     sigma(x, y) = axial − (ky/sc)·x − (kz/sc)·y
 *
 * so the gradient in SVG units is `(−ky/sc, −kz/sc)` — BOTH components carry a
 * minus, one from the section convention and one from the flip. Writing only
 * one of them is the defect described above.
 */

/** The stress plane, MPa, with y and z in metres from the centroid. */
export interface StressField {
  axial: number;
  ky: number;
  kz: number;
}

/** `[yMin, zMin, yMax, zMax]`, metres, centroid-relative. */
export type SectionBBox = [number, number, number, number];

export interface StressRamp {
  /** Gradient endpoints in SVG user units. */
  x1: number; y1: number; x2: number; y2: number;
  /** Stress at each endpoint, MPa. */
  sigmaAt1: number; sigmaAt2: number;
  /** Extremes over the section, for scaling the colour ramp. */
  sLo: number; sHi: number; sMax: number;
  /**
   * True when the field is constant — pure axial. There is no direction to span
   * then, and asking for one divides by zero.
   */
  uniform: boolean;
  /** Distance from the section centre to the neutral axis, along the gradient. */
  neutralOffset: number;
  /**
   * Whether the neutral axis actually crosses the section — tested against the
   * section's own polygon points when they are supplied, against the bounding
   * box only as a fallback. The distinction matters for a shape that does not
   * fill its bbox: an L's missing corner can carry the only sign change, and
   * the box would draw a neutral line through material that never changes sign.
   */
  neutralInside: boolean;
}

/** Stress at a point of the section, MPa. */
export function sigmaAt(f: StressField, y: number, z: number): number {
  return f.axial + f.kz * z - f.ky * y;
}

/**
 * Everything the stress map needs, in SVG user units.
 *
 * `sc` is the same scale the outline is drawn at (SVG units per metre).
 *
 * `points` is the section's real outline (centroid-relative `[y, z]` metres,
 * solids and holes alike) — the same polygon the map rasterizes. When given,
 * the stress extremes and the neutral-axis test are taken over THOSE points
 * rather than over the bounding-box corners: a linear field over a polygonal
 * region attains its extremes at vertices, so this is exact, not a sampling.
 * Without it the bbox corners stand in, which is correct only for shapes that
 * fill their box.
 */
export function stressMapRamp(
  f: StressField,
  bbox: SectionBBox,
  sc: number,
  points?: ReadonlyArray<readonly [number, number]>,
): StressRamp {
  const [yMin, zMin, yMax, zMax] = bbox;

  const probes: ReadonlyArray<readonly [number, number]> =
    points && points.length > 0
      ? points
      : [[yMin, zMin], [yMin, zMax], [yMax, zMin], [yMax, zMax]];
  let sLo = Infinity;
  let sHi = -Infinity;
  for (const [py, pz] of probes) {
    const s = sigmaAt(f, py, pz);
    if (s < sLo) sLo = s;
    if (s > sHi) sHi = s;
  }
  const sMax = Math.max(Math.abs(sLo), Math.abs(sHi), 1e-9);

  // See the header: both components are negative.
  const gx = -f.ky / sc;
  const gy = -f.kz / sc;
  const gLen = Math.hypot(gx, gy);

  const cx = ((yMin + yMax) / 2) * sc;
  const cy = -((zMin + zMax) / 2) * sc;
  const sCentre = sigmaAt(f, (yMin + yMax) / 2, (zMin + zMax) / 2);

  if (gLen <= 1e-12) {
    return {
      x1: cx, y1: cy, x2: cx, y2: cy,
      sigmaAt1: sCentre, sigmaAt2: sCentre,
      sLo, sHi, sMax, uniform: true,
      neutralOffset: 0, neutralInside: false,
    };
  }

  // Span the gradient across the section along its own direction, far enough
  // that the whole outline falls inside it.
  const half = Math.hypot((yMax - yMin) * sc, (zMax - zMin) * sc) / 2;
  const ux = gx / gLen;
  const uy = gy / gLen;

  return {
    x1: cx - ux * half, y1: cy - uy * half,
    x2: cx + ux * half, y2: cy + uy * half,
    sigmaAt1: sCentre - gLen * half,
    sigmaAt2: sCentre + gLen * half,
    sLo, sHi, sMax, uniform: false,
    neutralOffset: -sCentre / gLen,
    neutralInside: sLo < 0 && sHi > 0,
  };
}

/** Unit vector along the ramp, for drawing the neutral axis across it. */
export function rampDirection(r: StressRamp): { ux: number; uy: number } {
  const dx = r.x2 - r.x1;
  const dy = r.y2 - r.y1;
  const len = Math.hypot(dx, dy);
  return len < 1e-12 ? { ux: 0, uy: 0 } : { ux: dx / len, uy: dy / len };
}
