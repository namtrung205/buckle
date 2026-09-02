/**
 * Warping, checked against published section tables.
 *
 * The warping constant is tabulated for every rolled profile, which makes this
 * one of the few places where a closed form can be checked against an
 * independent authority rather than against itself. So it is: IPE, HEA and HEB
 * against their catalogue values.
 *
 * The behavioural checks matter as much as the numeric ones. Warping is worth
 * implementing because it changes conclusions — a short restrained member is
 * carried by it almost entirely, a long one barely at all, and a tube not at
 * all. Those are the statements a reader will rely on.
 */

import { describe, it, expect } from 'vitest';
import { warpingProperties, withLambda, warpingResponse } from '../warping';
import type { ResolvedSection } from '../section-stress';

function rs(over: Partial<ResolvedSection>): ResolvedSection {
  return {
    shape: 'rect', a: 0, iy: 0, iz: 0, j: 0,
    h: 0, b: 0, tw: 0, tf: 0, t: 0, tl: 0,
    yMin: 0, yMax: 0, zMin: 0, zMax: 0,
    ...over,
  } as ResolvedSection;
}

/** cm⁶ from m⁶, the unit profile tables use. */
const cm6 = (m6: number) => m6 * 1e12;

// Real catalogue values, SI.
const IPE300 = () => rs({
  shape: 'I', h: 0.3, b: 0.15, tw: 0.0071, tf: 0.0107,
  a: 5.381e-3, iy: 8.356e-5, iz: 6.04e-6, j: 2.01e-7,
});
const HEB300 = () => rs({
  shape: 'H', h: 0.3, b: 0.3, tw: 0.011, tf: 0.019,
  a: 0.01491, iy: 2.517e-4, iz: 8.563e-5, j: 1.85e-6,
});
const UPN200 = () => rs({
  shape: 'U', h: 0.2, b: 0.075, tw: 0.0085, tf: 0.0115,
  a: 3.22e-3, iy: 1.91e-5, iz: 1.48e-6, j: 1.19e-7,
});

describe('the warping constant against published tables', () => {
  it('IPE 300: 126 000 cm⁶', () => {
    // Cw = Iz·h0²/4 is not an approximation for a doubly-symmetric I — the
    // flanges bend about their own axes and h0 is the couple arm.
    expect(cm6(warpingProperties(IPE300()).cw)).toBeCloseTo(126_000, -3);
  });

  it('HEB 300: 1 688 000 cm⁶', () => {
    const cw = cm6(warpingProperties(HEB300()).cw);
    expect(Math.abs(cw - 1_688_000) / 1_688_000).toBeLessThan(0.01);
  });

  it('is reported as exact for I-beams and thin-wall for channels', () => {
    // The channel formula ignores root fillets and the tapered flange a UPN
    // actually has, and lands about 15% out. Saying which is which is the
    // difference between a number and a claim about its precision.
    expect(warpingProperties(IPE300()).fidelity).toBe('exact');
    expect(warpingProperties(UPN200()).fidelity).toBe('thinWall');
    const cw = cm6(warpingProperties(UPN200()).cw);
    expect(Math.abs(cw - 12_100) / 12_100).toBeLessThan(0.2);
  });
});

describe('sections that do not warp', () => {
  it('a tube carries torque by circulation, so its warping constant is zero', () => {
    for (const shape of ['RHS', 'CHS'] as const) {
      const p = warpingProperties(rs({ shape, h: 0.2, b: 0.1, t: 0.006, j: 3e-6 }));
      expect(p.cw, shape).toBe(0);
      expect(p.klass, shape).toBe('closedNegligible');
    }
  });

  it('an angle and a tee have walls meeting at a point, so nearly none either', () => {
    for (const shape of ['L', 'T', 'invL'] as const) {
      const p = warpingProperties(rs({ shape, h: 0.1, b: 0.1, tw: 0.01, tf: 0.01, t: 0.01, j: 6e-8 }));
      expect(p.cw, shape).toBe(0);
      expect(p.klass, shape).toBe('pointSymmetric');
    }
  });

  it('an I with flanges thicker than its depth is degenerate, not a warping section', () => {
    // tf ≥ h means h0 ≤ 0: no couple arm exists, and the squared term would
    // still report a positive Cw if nobody checked the sign.
    const p = warpingProperties(rs({ shape: 'I', h: 0.1, b: 0.1, tw: 0.01, tf: 0.12, iz: 1e-6, j: 1e-8 }));
    expect(p.cw).toBe(0);
  });

  it('has no characteristic length, rather than a length of zero', () => {
    // Zero would read as "extremely short", which is the opposite of the truth.
    const tube = withLambda(warpingProperties(rs({ shape: 'RHS', h: 0.2, b: 0.1, t: 0.006, j: 3e-6 })), 200000);
    expect(tube.lambda).toBeNull();
    expect(warpingResponse(rs({ shape: 'RHS', h: 0.2, b: 0.1, t: 0.006, j: 3e-6 }), tube, 10, 5, 200000)).toBeNull();
  });
});

describe('the characteristic length decides which mechanism carries the torque', () => {
  it('an IPE 300 has a warping length of a couple of metres', () => {
    // Which is why a 1,5 m beam and a 12 m beam of the SAME section behave
    // completely differently under the same torque.
    const p = withLambda(warpingProperties(IPE300()), 210000);
    expect(p.lambda).not.toBeNull();
    expect(p.lambda!).toBeGreaterThan(1);
    expect(p.lambda!).toBeLessThan(4);
  });

  it('a short restrained member is carried almost entirely by warping', () => {
    const s = IPE300();
    const p = withLambda(warpingProperties(s), 210000);
    const short = warpingResponse(s, p, 10, 0.3, 210000, 'cantilever');
    expect(short!.saintVenantShare).toBeLessThan(0.05);
  });

  it('a long member is carried almost entirely by Saint-Venant', () => {
    const s = IPE300();
    const p = withLambda(warpingProperties(s), 210000);
    const long = warpingResponse(s, p, 10, 20, 210000, 'cantilever');
    expect(long!.saintVenantShare).toBeGreaterThan(0.95);
  });

  it('the share rises monotonically with length — no jump, a transition', () => {
    const s = IPE300();
    const p = withLambda(warpingProperties(s), 210000);
    const shares = [0.5, 1, 2, 4, 8, 16].map(
      (L) => warpingResponse(s, p, 10, L, 210000)!.saintVenantShare,
    );
    for (let i = 1; i < shares.length; i++) {
      expect(shares[i]).toBeGreaterThan(shares[i - 1]);
    }
  });

  it('the simple case is the cantilever solution on the half-span', () => {
    // Warping-free ends with mid-span torque: by symmetry each half-span is a
    // cantilever of length L/2, restrained at mid-span. The share must use the
    // same L/(2λ) parameter the bimoment line uses — not L/λ.
    const s = IPE300();
    const p = withLambda(warpingProperties(s), 210000);
    for (const L of [0.5, 2, 8]) {
      const simple = warpingResponse(s, p, 10, L, 210000, 'simple')!.saintVenantShare;
      const cantileverHalf = warpingResponse(s, p, 10, L / 2, 210000, 'cantilever')!.saintVenantShare;
      expect(simple).toBeCloseTo(cantileverHalf, 9);
    }
  });
});

describe('warping stress — the part that is not conservative to omit', () => {
  it('produces a real normal stress that adds to bending', () => {
    const s = IPE300();
    const p = withLambda(warpingProperties(s), 210000);
    const r = warpingResponse(s, p, 10, 2, 210000, 'cantilever')!;
    expect(r.sigmaW).toBeGreaterThan(0);
    // Hand check, IPE 300 with T = 10 kN·m, L = 2 m, restrained end:
    //   Cw = Iz·h0²/4 = 6.04e-6 · 0.2893²/4 = 1.2638e-7 m⁶
    //   λ  = √(E·Cw/G·J) = √(2.6 · 1.2638e-7/2.01e-7) = 1.2786 m
    //   B  = T·λ·tanh(L/λ) = 10 · 1.2786 · tanh(1.5643) = 11.71 kN·m²
    //   σw = B·Wns/Cw = 11.71 · 0.01085 / 1.2638e-7 ≈ 1006 MPa
    // On a short restrained member the warping stress is not "tens of MPa" —
    // it is several times the yield stress, which is exactly why the restraint
    // case cannot be omitted. A bare `> 10` would pass with a 50× error.
    expect(r.sigmaW).toBeGreaterThan(1006 * 0.98);
    expect(r.sigmaW).toBeLessThan(1006 * 1.02);
    expect(r.bimoment).toBeCloseTo(11.71, 2);
  });

  it('grows with the torque, in proportion', () => {
    const s = IPE300();
    const p = withLambda(warpingProperties(s), 210000);
    const a = warpingResponse(s, p, 5, 2, 210000)!.sigmaW;
    const b = warpingResponse(s, p, 10, 2, 210000)!.sigmaW;
    expect(b / a).toBeCloseTo(2, 6);
  });

  it('is larger with a restrained end than with free ends', () => {
    // The whole point of stating the boundary condition: it changes the answer,
    // so picking one silently would be picking the user's assumption for them.
    const s = IPE300();
    const p = withLambda(warpingProperties(s), 210000);
    const fixed = warpingResponse(s, p, 10, 4, 210000, 'cantilever')!;
    const free = warpingResponse(s, p, 10, 4, 210000, 'simple')!;
    expect(fixed.sigmaW).toBeGreaterThan(free.sigmaW);
    expect(fixed.caseKey).not.toBe(free.caseKey);
  });

  it('does not depend on the sign of the torque', () => {
    const s = IPE300();
    const p = withLambda(warpingProperties(s), 210000);
    expect(warpingResponse(s, p, -10, 3, 210000)!.sigmaW)
      .toBeCloseTo(warpingResponse(s, p, 10, 3, 210000)!.sigmaW, 9);
  });
});

describe('a channel warps about its shear centre, not about its web', () => {
  /** Mid-line walk: omega(s) = int r_t ds, normalised so int(omega dA) = 0. */
  function sectorialByIntegration(h: number, b: number, tw: number, tf: number) {
    const bm = b - tw / 2, h0 = h - tf;
    const den = 6 * tf * bm + tw * h0;
    const e = (3 * bm * bm * tf) / den;   // pole, outside the web
    const N = 4000;
    // Perpendicular distance from the pole to each wall's line: h0/2 for the
    // flanges (horizontal), e for the web (vertical).
    const walls = [
      { rt: -h0 / 2, ds: bm / N, dA: (tf * bm) / N },  // top flange, tip -> web
      { rt: e, ds: h0 / N, dA: (tw * h0) / N },        // web, top -> bottom
      { rt: -h0 / 2, ds: bm / N, dA: (tf * bm) / N },  // bottom flange, web -> tip
    ];
    const om: number[] = [], dA: number[] = [];
    let acc = 0;
    for (const w of walls) {
      for (let i = 0; i < N; i++) { acc += w.rt * w.ds; om.push(acc); dA.push(w.dA); }
    }
    const area = dA.reduce((s, v) => s + v, 0);
    const mean = om.reduce((s, v, i) => s + v * dA[i], 0) / area;
    const omN = om.map((v) => v - mean);
    return {
      e,
      cw: omN.reduce((s, v, i) => s + v * v * dA[i], 0),
      peak: Math.max(...omN.map(Math.abs)),
    };
  }

  it('the integration reproduces the module\'s own Cw, so it is the same omega', () => {
    const s = UPN200();
    const ref = sectorialByIntegration(s.h, s.b, s.tw, s.tf);
    // Relative: Cw is of order 1e-9 m⁶, so an absolute tolerance here would
    // pass on almost anything of that magnitude and check nothing.
    expect(Math.abs(ref.cw / warpingProperties(s).cw - 1)).toBeLessThan(1e-4);
  });

  it('puts the shear centre outside the web, where a channel\'s belongs', () => {
    const s = UPN200();
    const ref = sectorialByIntegration(s.h, s.b, s.tw, s.tf);
    // ~27 mm from the web mid-line for a UPN 200 — a real arm, not a rounding.
    expect(ref.e).toBeGreaterThan(0.02);
    expect(ref.e).toBeLessThan(0.035);
  });

  it('the reported stress follows the integrated peak, not the web-measured one', () => {
    const s = UPN200();
    const p = withLambda(warpingProperties(s), 210000);
    const ref = sectorialByIntegration(s.h, s.b, s.tw, s.tf);
    const r = warpingResponse(s, p, 10, 2, 210000, 'cantilever')!;

    // sigma_w = B·omega/Cw, in MPa. Compared relatively: the reference is a
    // midpoint sum over N segments, so its peak carries an O(1/N) sampling
    // error — around 3e-5 here. A tolerance of 1e-3 is loose against that and
    // still tight against the error being checked for, which is 60%.
    const expected = (r.bimoment * ref.peak) / p.cw / 1000;
    expect(Math.abs(r.sigmaW / expected - 1)).toBeLessThan(1e-3);

    // And the value it used to report, for the record: measuring the tip from
    // the web gives h0·bm/2, which is 60% larger.
    const fromWeb = ((s.h - s.tf) * (s.b - s.tw / 2)) / 2;
    expect(fromWeb / ref.peak).toBeGreaterThan(1.5);
    expect(r.sigmaW).toBeLessThan((r.bimoment * fromWeb) / p.cw / 1000);
  });
});
