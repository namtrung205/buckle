import { describe, it, expect } from 'vitest';
import {
  MOMENT_ORIENTATIONS, axisPressure, columnOffsetFromCentroid, footingCentroidActions,
  momentEccentricity, planPressure,
} from '../footing-actions';

/**
 * The transformation from node actions to centroid actions.
 *
 * Every assertion here is against INDEPENDENT statics — the resultant of the pressure field
 * integrated numerically — rather than against the module's own closed form. A test that
 * recomputes the expression under test agrees with its mistakes.
 */

/**
 * Integrate the bilinear pressure field over the base, and its first moments.
 *
 * Two-point Gauss–Legendre per axis, which is exact for a polynomial of degree ≤ 3 in each
 * variable. That matters: the load integrand `q` is degree 1, but the first-moment integrand
 * `q·u` is degree 2, and the midpoint rule is exact only to degree 1 — it left a ~1e-4
 * relative truncation error that would have had to be absorbed by a loose tolerance, which is
 * how a quadrature artefact comes to hide a real sign error.
 */
function integrate(
  q0: number, B: number, L: number, uR: number, vR: number,
): { V: number; Mu: number; Mv: number; least: number } {
  const q = planPressure(q0, B, L, uR, vR);
  const g = 1 / Math.sqrt(3);
  const nodes = [-g, g];
  let V = 0; let Mu = 0; let Mv = 0; let least = Infinity;
  for (const xi of nodes) {
    for (const eta of nodes) {
      const u = xi * B / 2;
      const v = eta * L / 2;
      // Each of the four points carries a quarter of the area.
      const w = (B * L) / 4;
      const p = q(u, v) * w;
      V += p;
      Mu += p * u;
      Mv += p * v;
    }
  }
  // The extreme values of a bilinear field sit at the corners.
  for (const u of [-B / 2, B / 2]) {
    for (const v of [-L / 2, L / 2]) least = Math.min(least, q(u, v));
  }
  return { V, Mu, Mv, least };
}

describe('the convention, pinned', () => {
  it('puts the column at MINUS the eccentricity, the reading punchingPosition already uses', () => {
    // `eccentricityB` is the offset of the CENTROID from the NODE, so a positive value moves
    // the base toward +B and leaves the column on the −B side of it.
    expect(columnOffsetFromCentroid(0.3)).toBe(-0.3);
    expect(columnOffsetFromCentroid(-0.3)).toBe(0.3);
    expect(columnOffsetFromCentroid(0)).toBeCloseTo(0, 12);
  });

  it('takes the applied moment as a magnitude, because its sign is not resolvable', () => {
    expect(momentEccentricity(125, 1250)).toBeCloseTo(0.1, 12);
    expect(momentEccentricity(-125, 1250)).toBeCloseTo(0.1, 12);
  });

  it('does not divide by zero on an unloaded footing', () => {
    expect(Number.isFinite(momentEccentricity(10, 0))).toBe(true);
  });

  it('envelopes exactly the two orientations', () => {
    expect(MOMENT_ORIENTATIONS).toEqual([1, -1]);
  });
});

describe('N·e — the term that was missing', () => {
  const base = { B: 3.0, L: 2.0, axial: 900 };

  it('develops a centroid moment of exactly N·e with NO applied moment', () => {
    // This is the whole defect in one assertion. A footing offset 0,30 m under 900 kN carries
    // 270 kN·m about its own centroid, and the previous eccentricity `M/N` was zero.
    const a = footingCentroidActions({ ...base, eccentricityB: 0.3 });
    expect(a.b.momentEccentricity).toBe(0);
    expect(a.b.worstResultantOffset).toBeCloseTo(-0.3, 12);
    expect(a.b.centroidMoments[0]).toBeCloseTo(-270, 9);
    expect(a.b.centroidMoments[1]).toBeCloseTo(-270, 9);
  });

  it('is independent of the load, because the N cancels', () => {
    const light = footingCentroidActions({ ...base, axial: 100, eccentricityB: 0.3 });
    const heavy = footingCentroidActions({ ...base, axial: 5000, eccentricityB: 0.3 });
    expect(light.b.worstResultantOffset).toBeCloseTo(heavy.b.worstResultantOffset, 12);
  });

  it('mirrors under a sign flip of the offset', () => {
    const pos = footingCentroidActions({ ...base, eccentricityB: 0.3 });
    const neg = footingCentroidActions({ ...base, eccentricityB: -0.3 });
    expect(neg.b.worstResultantOffset).toBeCloseTo(-pos.b.worstResultantOffset, 12);
    // The peak pressure is a magnitude and cannot care which way the base was shifted.
    expect(neg.qMax).toBeCloseTo(pos.qMax, 9);
    expect(neg.qMin).toBeCloseTo(pos.qMin, 9);
  });

  it('reinforces N·e in one orientation and opposes it in the other', () => {
    // e_geom = −0,30 m; the applied moment contributes ±0,10 m.
    const a = footingCentroidActions({
      ...base, eccentricityB: 0.3, momentB: 90,   // 90/900 = 0,10 m
    });
    expect(a.b.momentEccentricity).toBeCloseTo(0.1, 12);
    const sorted = [...a.b.resultantOffsets].sort((x, y) => x - y);
    expect(sorted[0]).toBeCloseTo(-0.4, 9);   // moment reinforcing N·e
    expect(sorted[1]).toBeCloseTo(-0.2, 9);   // moment opposing N·e
    // The envelope keeps the REINFORCING one — the larger magnitude — and keeps its sign.
    expect(a.b.worstResultantOffset).toBeCloseTo(-0.4, 9);
  });

  it('does not collapse to the arithmetic sum of two magnitudes', () => {
    // A moment that opposes the offset does not cancel it in the envelope: the worst case is
    // still the reinforcing orientation. And with the offset zero the envelope is symmetric,
    // which is exactly the pre-existing behaviour.
    const centred = footingCentroidActions({ ...base, momentB: 90 });
    expect(centred.b.resultantOffsets[0]).toBeCloseTo(0.1, 12);
    expect(centred.b.resultantOffsets[1]).toBeCloseTo(-0.1, 12);
    expect(Math.abs(centred.b.worstResultantOffset)).toBeCloseTo(0.1, 12);
  });

  it('treats the two axes independently, offset on B and offset on L', () => {
    const both = footingCentroidActions({
      ...base, eccentricityB: 0.3, eccentricityL: 0.2,
    });
    expect(both.b.worstResultantOffset).toBeCloseTo(-0.3, 12);
    expect(both.l.worstResultantOffset).toBeCloseTo(-0.2, 12);
    // B only and L only each move their own axis and leave the other alone.
    const bOnly = footingCentroidActions({ ...base, eccentricityB: 0.3 });
    const lOnly = footingCentroidActions({ ...base, eccentricityL: 0.2 });
    expect(bOnly.l.worstResultantOffset).toBe(0);
    expect(lOnly.b.worstResultantOffset).toBe(0);
  });
});

describe('the pressure field closes independent statics', () => {
  const cases = [
    { name: 'centred', B: 3.0, L: 2.0, axial: 900, eB: 0, eL: 0, mB: 0, mL: 0 },
    { name: 'offset on B only', B: 3.0, L: 2.0, axial: 900, eB: 0.3, eL: 0, mB: 0, mL: 0 },
    { name: 'offset on L only', B: 3.0, L: 2.0, axial: 900, eB: 0, eL: 0.2, mB: 0, mL: 0 },
    { name: 'offset on both', B: 3.0, L: 2.0, axial: 900, eB: 0.25, eL: 0.15, mB: 0, mL: 0 },
    { name: 'negative offsets', B: 3.0, L: 2.0, axial: 900, eB: -0.3, eL: -0.2, mB: 0, mL: 0 },
    { name: 'offset plus moment', B: 3.0, L: 2.0, axial: 900, eB: 0.2, eL: 0, mB: 90, mL: 0 },
    { name: 'square, moment only', B: 2.5, L: 2.5, axial: 900, eB: 0, eL: 0, mB: 135, mL: 0 },
  ];

  it.each(cases)('$name: ΣV equals N and the resultant stands where the transform says',
    ({ B, L, axial, eB, eL, mB, mL }) => {
      const a = footingCentroidActions({
        B, L, axial, eccentricityB: eB, eccentricityL: eL, momentB: mB, momentL: mL,
      });
      for (const uR of a.b.resultantOffsets) {
        for (const vR of a.l.resultantOffsets) {
          const s = integrate(a.q0, B, L, uR, vR);
          // ΣV = 0: the upward soil resultant equals the downward axial force.
          expect(s.V).toBeCloseTo(axial, 6);
          // ΣM = 0 about the centroid: the upward resultant stands at the same offset the
          // transformation places the downward one at.
          expect(s.Mu / s.V).toBeCloseTo(uR, 9);
          expect(s.Mv / s.V).toBeCloseTo(vR, 9);
        }
      }
    });

  it('reports the peak and the least pressure of the whole envelope', () => {
    const a = footingCentroidActions({
      B: 3.0, L: 2.0, axial: 900, eccentricityB: 0.25, eccentricityL: 0.15, momentB: 45,
    });
    let peak = -Infinity; let least = Infinity;
    for (const uR of a.b.resultantOffsets) {
      for (const vR of a.l.resultantOffsets) {
        const q = planPressure(a.q0, 3.0, 2.0, uR, vR);
        for (const u of [-1.5, 1.5]) {
          for (const v of [-1.0, 1.0]) {
            peak = Math.max(peak, q(u, v));
            least = Math.min(least, q(u, v));
          }
        }
      }
    }
    expect(a.qMax).toBeCloseTo(peak, 9);
    expect(a.qMin).toBeCloseTo(least, 9);
  });

  it('reduces to the 1 ± 6e/S edge form the checks have always printed', () => {
    const q0 = 200; const S = 2.5; const e = 0.1;
    const q = axisPressure(q0, S, e);
    expect(q(S / 2)).toBeCloseTo(q0 * (1 + 6 * e / S), 12);
    expect(q(-S / 2)).toBeCloseTo(q0 * (1 - 6 * e / S), 12);
    expect(q(0)).toBeCloseTo(q0, 12);
  });
});

describe('full contact', () => {
  it('is the kern rhombus, not the two per-axis limits taken separately', () => {
    // e_B = e_L = B/8 on a square base: each axis is inside its own B/6 limit and the pair is
    // not. 6/8 + 6/8 = 1,5 > 1, so q_min = −q0/2 and a corner lifts.
    const a = footingCentroidActions({
      B: 2.4, L: 2.4, axial: 900, eccentricityB: 0.3, eccentricityL: 0.3,
    });
    expect(a.axisOutsideKern).toEqual({ b: false, l: false });
    expect(a.qMin).toBeLessThan(0);
    expect(a.fullContact).toBe(false);
  });

  it('refuses a superset of what the per-axis test refused', () => {
    // Anything the per-axis test caught, the rhombus catches too: |e| > S/6 on one axis alone
    // already drives q_min negative.
    const a = footingCentroidActions({ B: 2.4, L: 2.4, axial: 900, eccentricityB: 0.5 });
    expect(a.axisOutsideKern.b).toBe(true);
    expect(a.fullContact).toBe(false);
  });

  it('holds exactly at the boundary', () => {
    // e_B = B/6 exactly: q_min = 0. Contact is maintained, marginally.
    const a = footingCentroidActions({ B: 2.4, L: 2.4, axial: 900, eccentricityB: 0.4 });
    expect(a.qMin).toBeCloseTo(0, 12);
    expect(a.fullContact).toBe(true);
  });

  it('agrees with the numerically integrated least pressure', () => {
    const a = footingCentroidActions({
      B: 2.4, L: 2.4, axial: 900, eccentricityB: 0.3, eccentricityL: 0.3,
    });
    const s = integrate(a.q0, 2.4, 2.4, a.b.worstResultantOffset, a.l.worstResultantOffset);
    expect(s.least).toBeLessThan(0);
  });

  it('reports no contact for an unloaded footing rather than claiming it', () => {
    expect(footingCentroidActions({ B: 2.4, L: 2.4, axial: 0 }).fullContact).toBe(false);
  });
});

describe('determinism', () => {
  it('is a pure function of its input', () => {
    const run = () => footingCentroidActions({
      B: 3.13, L: 2.07, axial: 873.2, momentB: 41.7, momentL: -18.3,
      eccentricityB: 0.213, eccentricityL: -0.117,
    });
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
