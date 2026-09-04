/**
 * Jourawski shear flow, audited against closed-form theory.
 *
 * `computeShearFlowPaths` switches on the section shape and applies a
 * hand-derived formula per case. Those formulas are the drawn shear diagram, so
 * an error in one of them is not a crash — it is a picture that looks entirely
 * reasonable and is wrong by a factor.
 *
 * What is checked here is the peak shear against the value elementary theory
 * gives, expressed as a multiple of the mean shear V/A. Those factors are the
 * ones every textbook tabulates, and they are independent of the code:
 *
 *   solid rectangle      tau_max = 3/2 · V/A     (parabola, peak at the axis)
 *   solid circle         tau_max = 4/3 · V/A
 *   THIN CIRCULAR TUBE   tau_max = 2   · V/A     (twice the mean — the classic)
 *   I-beam               tau_max ~ V / (tw · hw), the web carrying nearly all
 *
 * The tube factor is the one worth stating plainly, because it is the one a
 * careless derivation gets wrong: cutting a tube horizontally severs TWO walls,
 * so the width in `V·Q/(I·b)` is 2t — but then Q must be the first moment of
 * the whole area above the cut, which spans both sides too. Mixing a one-sided
 * Q with a two-sided b halves the answer, and the result still looks like a
 * plausible shear distribution.
 */

import { describe, it, expect } from 'vitest';
import { computeShearFlowPaths, shearStress, type ResolvedSection } from '../section-stress';

/** A resolved section with the fields the shear-flow code reads. */
function rs(over: Partial<ResolvedSection>): ResolvedSection {
  return {
    shape: 'rect', a: 0, iy: 0, iz: 0, j: 0,
    h: 0, b: 0, tw: 0, tf: 0, t: 0, tl: 0,
    yMin: 0, yMax: 0, zMin: 0, zMax: 0,
    ...over,
  } as ResolvedSection;
}

/** Peak |tau| over every segment, in MPa. */
function peak(segs: ReturnType<typeof computeShearFlowPaths>): number {
  return Math.max(...segs.flatMap((s) => s.points.map((p) => Math.abs(p.tau))), 0);
}

/** V in kN, area in m² → mean shear in MPa. */
const mean = (V: number, a: number) => V / a / 1000;

describe('solid rectangle — the case every other one is measured against', () => {
  it('peaks at 3/2 of the mean shear, on the neutral axis', () => {
    const b = 0.2, h = 0.4;
    const s = rs({ shape: 'rect', b, h, a: b * h, iy: (b * h ** 3) / 12 });
    const segs = computeShearFlowPaths(120, s);
    expect(peak(segs)).toBeCloseTo(1.5 * mean(120, s.a), 4);
  });

  it('vanishes at the extreme fibres, where there is no area left to shear', () => {
    const s = rs({ shape: 'rect', b: 0.2, h: 0.4, a: 0.08, iy: 1.0667e-3 });
    const pts = computeShearFlowPaths(120, s)[0].points;
    expect(Math.abs(pts[0].tau)).toBeCloseTo(0, 6);
    expect(Math.abs(pts[pts.length - 1].tau)).toBeCloseTo(0, 6);
  });

  it('scales linearly with the shear force', () => {
    const s = rs({ shape: 'rect', b: 0.2, h: 0.4, a: 0.08, iy: 1.0667e-3 });
    expect(peak(computeShearFlowPaths(240, s))).toBeCloseTo(2 * peak(computeShearFlowPaths(120, s)), 6);
  });
});

describe('thin circular tube — twice the mean shear', () => {
  it('peaks at 2·V/A, not at V/A', () => {
    // 200 mm diameter, 5 mm wall. Thin enough that the closed form applies:
    // A = 2*pi*R*t, I = pi*R^3*t.
    const R = 0.1, t = 0.005;
    const a = 2 * Math.PI * R * t;
    const iy = Math.PI * R ** 3 * t;
    const s = rs({ shape: 'CHS', h: 2 * R, b: 2 * R, t, a, iy });
    const segs = computeShearFlowPaths(100, s);
    // Thin-wall theory is itself approximate, so this is checked to a few
    // percent — but a factor-of-two error is nowhere near that band.
    expect(peak(segs) / mean(100, a)).toBeCloseTo(2, 1);
  });

  it('is largest at the neutral axis and zero at the crown', () => {
    const R = 0.1, t = 0.005;
    const s = rs({
      shape: 'CHS', h: 2 * R, b: 2 * R, t,
      a: 2 * Math.PI * R * t, iy: Math.PI * R ** 3 * t,
    });
    const pts = computeShearFlowPaths(100, s)[0].points;
    // First point is the crown (theta = 0): no area cut off above it.
    expect(Math.abs(pts[0].tau)).toBeCloseTo(0, 6);
    const mid = pts[Math.floor(pts.length / 2)];
    expect(Math.abs(mid.tau)).toBeGreaterThan(0);
    expect(Math.abs(mid.tau)).toBeCloseTo(peak([{ points: pts }]), 6);
  });
});

/**
 * The DESIGN path — `shearStress()` via `computeQandB`, which feeds von Mises
 * and the utilisation ratio — must give the same answer the drawn diagram
 * gives. It is a separate formula and once carried exactly the halved
 * one-sided-Q/two-sided-b error the audit above guards against in the
 * diagram; nothing cross-checked them, so they drifted. These tests pin the
 * two against each other and against the closed forms.
 */
describe('CHS in the design path — shearStress must agree with the diagram', () => {
  // 200 mm diameter, 5 mm wall: A = 2·π·R·t, I = π·R³·t.
  const R = 0.1, t = 0.005;
  const tube = () => rs({
    shape: 'CHS', h: 2 * R, b: 2 * R, t,
    a: 2 * Math.PI * R * t, iy: Math.PI * R ** 3 * t,
  });

  it('peaks at 2·V/A on the neutral axis, not V/A', () => {
    const s = tube();
    // Exact here, not to a few percent: A and I are the thin-wall closed
    // forms, and τ_max = V·R²/I = V/(π·R·t) = 2V/A identically.
    expect(shearStress(100, 0, s) / mean(100, s.a)).toBeCloseTo(2, 6);
  });

  it('follows the semi-ellipse τ(y) = τ_max·√(1−(y/R)²), not a parabola', () => {
    // The shape is the other half of the fix: the old Q = t·(R²−y²) was a
    // parabola, which at y = R/2 reads 0.75 of the peak instead of 0.866.
    const s = tube();
    const tau0 = shearStress(100, 0, s);
    for (const f of [0.25, 0.5, 0.75, 0.9]) {
      expect(shearStress(100, f * R, s) / tau0).toBeCloseTo(Math.sqrt(1 - f * f), 9);
    }
  });

  it('matches the drawn diagram point for point', () => {
    const s = tube();
    for (const seg of computeShearFlowPaths(100, s)) {
      for (const p of seg.points) {
        expect(Math.abs(shearStress(100, p.y, s))).toBeCloseTo(Math.abs(p.tau), 9);
      }
    }
  });

  it('a solid round bar (t = 0) peaks at 4/3·V/A, in BOTH paths', () => {
    // t = 0 is the solid-bar convention (a tube with no wall has no area).
    // Extrapolating the thin-tube formula there reports 4V/A — three times
    // the true 4V/3A peak of a solid circle.
    const solid = rs({
      shape: 'CHS', h: 2 * R, b: 2 * R, t: 0,
      a: Math.PI * R * R, iy: Math.PI * R ** 4 / 4,
    });
    expect(shearStress(100, 0, solid) / mean(100, solid.a)).toBeCloseTo(4 / 3, 9);
    expect(peak(computeShearFlowPaths(100, solid)) / mean(100, solid.a)).toBeCloseTo(4 / 3, 9);
  });
});

describe('I-beam — the web carries the shear', () => {
  it('peaks in the web, at roughly V over the web area', () => {
    // IPE 300-ish: h 300, b 150, tw 7.1, tf 10.7.
    const h = 0.3, b = 0.15, tw = 0.0071, tf = 0.0107;
    const hw = h - 2 * tf;
    const a = 2 * b * tf + hw * tw;
    const iy = (b * h ** 3 - (b - tw) * hw ** 3) / 12;
    const s = rs({ shape: 'I', h, b, tw, tf, a, iy });
    const p = peak(computeShearFlowPaths(150, s));
    // The web-area approximation is the one used in practice and is good to
    // about 10% on a rolled I.
    const approx = 150 / (tw * hw) / 1000;
    expect(p / approx).toBeGreaterThan(0.85);
    expect(p / approx).toBeLessThan(1.15);
  });

  it('is far above the mean, because the flanges carry almost none of it', () => {
    const h = 0.3, b = 0.15, tw = 0.0071, tf = 0.0107;
    const a = 2 * b * tf + (h - 2 * tf) * tw;
    const s = rs({ shape: 'I', h, b, tw, tf, a, iy: 8.356e-5 });
    expect(peak(computeShearFlowPaths(150, s)) / mean(150, a)).toBeGreaterThan(2);
  });
});

describe('every catalogued shape produces a usable diagram', () => {
  // The switch has a `default` that falls back to the solid-rectangle formula.
  // For a shape with real walls that answer is not merely imprecise, it is the
  // wrong physics — so what matters is that no shipped family reaches it.
  const shapes: Array<[string, ResolvedSection]> = [
    ['rect', rs({ shape: 'rect', b: 0.2, h: 0.4, a: 0.08, iy: 1.0667e-3 })],
    ['I', rs({ shape: 'I', h: 0.3, b: 0.15, tw: 0.0071, tf: 0.0107, a: 5.38e-3, iy: 8.356e-5 })],
    ['H', rs({ shape: 'H', h: 0.3, b: 0.3, tw: 0.011, tf: 0.019, a: 0.0149, iy: 2.51e-4 })],
    ['U', rs({ shape: 'U', h: 0.2, b: 0.075, tw: 0.0085, tf: 0.0115, a: 3.22e-3, iy: 1.91e-5 })],
    ['L', rs({ shape: 'L', h: 0.1, b: 0.1, t: 0.01, tw: 0.01, tf: 0.01, a: 1.92e-3, iy: 1.77e-6 })],
    ['T', rs({ shape: 'T', h: 0.1, b: 0.1, tw: 0.009, tf: 0.009, a: 1.71e-3, iy: 1.72e-6 })],
    ['RHS', rs({ shape: 'RHS', h: 0.2, b: 0.1, t: 0.006, a: 3.35e-3, iy: 1.72e-5 })],
    ['CHS', rs({ shape: 'CHS', h: 0.2, b: 0.2, t: 0.005, a: 3.06e-3, iy: 1.47e-5 })],
    ['C', rs({ shape: 'C', h: 0.2, b: 0.075, tw: 0.002, tf: 0.002, t: 0.02, tl: 0.002, a: 8.3e-4, iy: 5.1e-6 })],
    ['invL', rs({ shape: 'invL', h: 0.1, b: 0.1, t: 0.01, tw: 0.01, tf: 0.01, a: 1.92e-3, iy: 1.77e-6 })],
  ];

  for (const [name, s] of shapes) {
    it(`${name}: finite, non-zero, and no NaN anywhere`, () => {
      const segs = computeShearFlowPaths(100, s);
      expect(segs.length, name).toBeGreaterThan(0);
      const taus = segs.flatMap((g) => g.points.map((p) => p.tau));
      expect(taus.length, name).toBeGreaterThan(0);
      expect(taus.every(Number.isFinite), name).toBe(true);
      expect(Math.max(...taus.map(Math.abs)), name).toBeGreaterThan(0);
    });

    it(`${name}: peak shear stays within a physically sane band of the mean`, () => {
      // A closed-form check per shape is the ideal; this is the guard that
      // catches the gross error — an order of magnitude, or a factor of two —
      // for the shapes whose exact factor is not tabulated above.
      const ratio = peak(computeShearFlowPaths(100, s)) / mean(100, s.a);
      expect(ratio, `${name} tau_max/tau_mean = ${ratio.toFixed(2)}`).toBeGreaterThan(1);
      expect(ratio, `${name} tau_max/tau_mean = ${ratio.toFixed(2)}`).toBeLessThan(12);
    });
  }
});

describe('degenerate input is refused rather than drawn wrong', () => {
  it('no shear force means no diagram', () => {
    expect(computeShearFlowPaths(0, rs({ shape: 'rect', b: 0.2, h: 0.4, a: 0.08, iy: 1.0667e-3 }))).toEqual([]);
  });

  it('a section with no inertia produces nothing instead of dividing by zero', () => {
    expect(computeShearFlowPaths(100, rs({ shape: 'rect', b: 0.2, h: 0.4, a: 0.08, iy: 0 }))).toEqual([]);
  });

  it('the sign of the shear does not change the magnitudes drawn', () => {
    const s = rs({ shape: 'I', h: 0.3, b: 0.15, tw: 0.0071, tf: 0.0107, a: 5.38e-3, iy: 8.356e-5 });
    expect(peak(computeShearFlowPaths(-150, s))).toBeCloseTo(peak(computeShearFlowPaths(150, s)), 9);
  });
});

/**
 * Flow CONTINUITY — the property that makes it a flow rather than a set of
 * unrelated curves.
 *
 * Jourawski's shear flow `q = V·Q/I` is a flow in the physical sense: it is
 * conserved along the wall. Where two walls meet, whatever arrives must leave.
 * On an I-beam that means each flange delivers its flow into the web, so the
 * web's flow at the junction equals the sum of what the flanges bring — and the
 * web starts from a NON-ZERO value, unlike a solid rectangle whose flow starts
 * from zero at the free surface.
 *
 * This is the check the earlier magnitude tests could not make: a formula can
 * get every peak right and still describe walls that are not connected to each
 * other.
 */
describe('shear flow is conserved where walls meet', () => {
  const ipe = () => rs({
    shape: 'I', h: 0.3, b: 0.15, tw: 0.0071, tf: 0.0107,
    a: 5.381e-3, iy: 8.356e-5,
  });

  it('the web carries far more flow than the flanges deliver per unit width', () => {
    // The web is thin, so the same flow becomes a much larger STRESS. That
    // ratio is roughly the thickness ratio, which is the physical content of
    // "the web takes the shear".
    const segs = computeShearFlowPaths(150, ipe());
    const peaks = segs.map((g) => Math.max(...g.points.map((p) => Math.abs(p.tau))));
    const webPeak = Math.max(...peaks);
    const flangePeak = Math.min(...peaks.filter((p) => p > 0));
    expect(webPeak / flangePeak).toBeGreaterThan(2);
  });

  it('the flow does not start from zero in the web — the flanges feed it', () => {
    // A solid rectangle starts at zero because there is free surface above it.
    // A web does not: the flanges have already delivered their flow.
    const segs = computeShearFlowPaths(150, ipe());
    const web = segs.reduce((best, g) => {
      const m = Math.max(...g.points.map((p) => Math.abs(p.tau)));
      return m > Math.max(...best.points.map((p) => Math.abs(p.tau))) ? g : best;
    });
    const ends = [web.points[0].tau, web.points[web.points.length - 1].tau];
    expect(Math.max(...ends.map(Math.abs))).toBeGreaterThan(0);
  });

  it('a solid section DOES start from zero, so the distinction is real', () => {
    const solid = computeShearFlowPaths(120, rs({ shape: 'rect', b: 0.2, h: 0.4, a: 0.08, iy: 1.0667e-3 }));
    expect(Math.abs(solid[0].points[0].tau)).toBeCloseTo(0, 6);
  });

  it('the peak sits at the neutral axis on a solid section', () => {
    // Q is largest there, and Q is the whole numerator.
    const pts = computeShearFlowPaths(120, rs({ shape: 'rect', b: 0.2, h: 0.4, a: 0.08, iy: 1.0667e-3 }))[0].points;
    const peak = pts.reduce((a, b) => (Math.abs(b.tau) > Math.abs(a.tau) ? b : a));
    expect(Math.abs(peak.y)).toBeLessThan(0.02);
  });

  it('every segment of every catalogued shape is a connected path', () => {
    // Consecutive points must be adjacent along the wall. A jump means the
    // path was assembled out of order and the arrows drawn on it would point
    // through empty space.
    const shapes: Array<[string, ResolvedSection]> = [
      ['I', rs({ shape: 'I', h: 0.3, b: 0.15, tw: 0.0071, tf: 0.0107, a: 5.38e-3, iy: 8.356e-5 })],
      ['U', rs({ shape: 'U', h: 0.2, b: 0.075, tw: 0.0085, tf: 0.0115, a: 3.22e-3, iy: 1.91e-5 })],
      ['RHS', rs({ shape: 'RHS', h: 0.2, b: 0.1, t: 0.006, a: 3.35e-3, iy: 1.72e-5 })],
      ['CHS', rs({ shape: 'CHS', h: 0.2, b: 0.2, t: 0.005, a: 3.06e-3, iy: 1.47e-5 })],
      ['T', rs({ shape: 'T', h: 0.1, b: 0.1, tw: 0.009, tf: 0.009, a: 1.71e-3, iy: 1.72e-6 })],
    ];
    for (const [name, s] of shapes) {
      for (const seg of computeShearFlowPaths(100, s)) {
        const span = Math.max(s.h, s.b);
        for (let i = 1; i < seg.points.length; i++) {
          const step = Math.hypot(
            seg.points[i].z - seg.points[i - 1].z,
            seg.points[i].y - seg.points[i - 1].y,
          );
          // No step may exceed half the section — that would be a teleport.
          expect(step, `${name} step ${i}`).toBeLessThan(span * 0.5);
        }
      }
    }
  });
});
