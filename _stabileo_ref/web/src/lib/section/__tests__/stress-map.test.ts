/**
 * Which way the stress map points.
 *
 * The bug this pins: the colour map ran the opposite way to the sigma diagram
 * drawn beside it, from the same three numbers. A beam in ordinary sagging —
 * compressed on top, in tension underneath — was painted red on top.
 *
 * That is not a cosmetic defect. Red and blue ARE the reading; a user who
 * trusts the picture concludes the flange in compression is the one in tension,
 * and sizes it accordingly. So the assertions here are written the way an
 * engineer would state the expectation, in terms of what is compressed and
 * where it is on screen, rather than in terms of gradient components.
 */

import { describe, it, expect } from 'vitest';
import { stressMapRamp, sigmaAt, rampDirection, type StressField } from '../stress-map';

/** A 300 mm deep section, centroid at mid-height. */
const BBOX: [number, number, number, number] = [-0.05, -0.15, 0.05, 0.15];
const SC = 80 / 0.3; // SVG units per metre, as the drawing scales it

/** Stress at an SVG point, by walking the ramp the renderer paints. */
function sigmaAtSvg(f: StressField, x: number, y: number) {
  const r = stressMapRamp(f, BBOX, SC);
  if (r.uniform) return r.sigmaAt1;
  const { ux, uy } = rampDirection(r);
  // Project onto the ramp, then interpolate its endpoint stresses.
  const len = Math.hypot(r.x2 - r.x1, r.y2 - r.y1);
  const t = ((x - r.x1) * ux + (y - r.y1) * uy) / len;
  return r.sigmaAt1 + t * (r.sigmaAt2 - r.sigmaAt1);
}

describe('sagging: compressed on top, in tension underneath', () => {
  /*
   * Compression above the centroid means sigma < 0 at z > 0, so kz < 0. This is
   * the everyday case — a simply supported beam under gravity at midspan.
   */
  const f: StressField = { axial: 0, ky: 0, kz: -100 };

  it('the plane itself says the top is compressed', () => {
    expect(sigmaAt(f, 0, 0.15)).toBeLessThan(0);
    expect(sigmaAt(f, 0, -0.15)).toBeGreaterThan(0);
  });

  it('and so does the painted map: negative at the top of the SVG', () => {
    // SVG y grows downward, so the top of the section is NEGATIVE svg y.
    const top = sigmaAtSvg(f, 0, -0.15 * SC);
    const bottom = sigmaAtSvg(f, 0, 0.15 * SC);
    expect(top).toBeLessThan(0);
    expect(bottom).toBeGreaterThan(0);
  });

  it('agrees with the plane at both extreme fibres, not just in sign', () => {
    expect(sigmaAtSvg(f, 0, -0.15 * SC)).toBeCloseTo(sigmaAt(f, 0, 0.15), 6);
    expect(sigmaAtSvg(f, 0, 0.15 * SC)).toBeCloseTo(sigmaAt(f, 0, -0.15), 6);
  });
});

describe('hogging is the mirror image', () => {
  const f: StressField = { axial: 0, ky: 0, kz: 100 };

  it('puts tension on top', () => {
    expect(sigmaAtSvg(f, 0, -0.15 * SC)).toBeGreaterThan(0);
    expect(sigmaAtSvg(f, 0, 0.15 * SC)).toBeLessThan(0);
  });
});

describe('bending about the other axis', () => {
  // sigma = -ky·y, so ky > 0 puts compression at +y (the right-hand side).
  const f: StressField = { axial: 0, ky: 80, kz: 0 };

  it('compresses the side the plane says it does', () => {
    expect(sigmaAtSvg(f, 0.05 * SC, 0)).toBeLessThan(0);
    expect(sigmaAtSvg(f, -0.05 * SC, 0)).toBeGreaterThan(0);
    expect(sigmaAtSvg(f, 0.05 * SC, 0)).toBeCloseTo(sigmaAt(f, 0.05, 0), 6);
  });
});

describe('biaxial bending keeps both axes right at once', () => {
  const f: StressField = { axial: -20, ky: 60, kz: -90 };

  it('reproduces the plane at all four corners', () => {
    const [yMin, zMin, yMax, zMax] = BBOX;
    for (const [y, z] of [[yMin, zMin], [yMin, zMax], [yMax, zMin], [yMax, zMax]]) {
      expect(sigmaAtSvg(f, y * SC, -z * SC)).toBeCloseTo(sigmaAt(f, y, z), 6);
    }
  });
});

describe('degenerate and boundary cases', () => {
  it('pure axial has no direction and one stress everywhere', () => {
    const r = stressMapRamp({ axial: -35, ky: 0, kz: 0 }, BBOX, SC);
    expect(r.uniform).toBe(true);
    expect(r.sigmaAt1).toBeCloseTo(-35, 9);
    expect(r.neutralInside).toBe(false);
  });

  it('a fully compressed section has no neutral axis to draw', () => {
    // Big axial compression, small bending: never reaches zero.
    const r = stressMapRamp({ axial: -200, ky: 0, kz: -300 }, BBOX, SC);
    expect(r.sHi).toBeLessThan(0);
    expect(r.neutralInside).toBe(false);
  });

  it('a neutral line crossing only the bbox — not the polygon — is not drawn', () => {
    // An L-shape: material fills the bbox except the top-right quadrant. A
    // field that is negative only near that MISSING corner crosses zero inside
    // the bounding box but nowhere on the section. The bbox test says "crosses"
    // and draws a line through one-signed material; the polygon test declines.
    // σ(y,z) = 10 − 50z − 100y: positive at every vertex of the L below,
    // negative at the absent corner (0.05, 0.15) where it reads −2.5.
    const f: StressField = { axial: 10, ky: 100, kz: -50 };
    const withoutPolygon = stressMapRamp(f, BBOX, SC);
    expect(withoutPolygon.neutralInside).toBe(true); // the defect, shown

    // The L: bbox [-0.05,0.05]×[-0.15,0.15] minus the quadrant y>0, z>0.
    const lShape: Array<readonly [number, number]> = [
      [-0.05, -0.15], [0.05, -0.15], [0.05, 0], [0, 0], [0, 0.15], [-0.05, 0.15],
    ];
    const r = stressMapRamp(f, BBOX, SC, lShape);
    expect(r.sLo).toBeGreaterThan(0); // one-signed over the actual material
    expect(r.neutralInside).toBe(false);
  });

  it('a neutral line that does cross the polygon is still drawn', () => {
    const f: StressField = { axial: 0, ky: 0, kz: -100 };
    const lShape: Array<readonly [number, number]> = [
      [-0.05, -0.15], [0.05, -0.15], [0.05, 0], [0, 0], [0, 0.15], [-0.05, 0.15],
    ];
    const r = stressMapRamp(f, BBOX, SC, lShape);
    expect(r.neutralInside).toBe(true);
  });

  it('places the neutral axis where the stress is actually zero', () => {
    // `kz` is MPa per METRE, so it takes a large value to swing 150 MPa over
    // the 150 mm from the centroid to the fibre. Centroid at -50 with a ±150
    // swing crosses zero inside the section.
    const f: StressField = { axial: -50, ky: 0, kz: -1000 };
    const r = stressMapRamp(f, BBOX, SC);
    expect(r.neutralInside).toBe(true);

    const { ux, uy } = rampDirection(r);
    const cx = 0;
    const cy = 0; // centroid is the origin for this bbox
    const zeroX = cx + ux * r.neutralOffset;
    const zeroY = cy + uy * r.neutralOffset;
    expect(sigmaAtSvg(f, zeroX, zeroY)).toBeCloseTo(0, 6);
  });

  it('spans far enough to cover the whole outline', () => {
    const r = stressMapRamp({ axial: 0, ky: 0, kz: -100 }, BBOX, SC);
    const halfDiagonal = Math.hypot(0.1 * SC, 0.3 * SC) / 2;
    expect(Math.hypot(r.x2 - r.x1, r.y2 - r.y1) / 2).toBeCloseTo(halfDiagonal, 6);
  });
});
