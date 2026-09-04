/**
 * Torsion, checked against the closed forms it claims to implement.
 *
 * Three theories apply depending on the wall's TOPOLOGY, and they differ by
 * orders of magnitude for the same section. That is the point of the module and
 * it is also its risk: an answer from the wrong theory is not obviously wrong,
 * it is just a plausible number that is a hundred times off.
 *
 * So each theory is pinned against its own textbook result, and — more
 * importantly — against EACH OTHER, because the relationships between them are
 * what a reader has to be able to trust.
 */

import { describe, it, expect } from 'vitest';
import { computeTorsionFlow, closedVersusOpen } from '../torsion-flow';
import type { ResolvedSection } from '../section-stress';

function rs(over: Partial<ResolvedSection>): ResolvedSection {
  return {
    shape: 'rect', a: 0, iy: 0, iz: 0, j: 0,
    h: 0, b: 0, tw: 0, tf: 0, t: 0, tl: 0,
    yMin: 0, yMax: 0, zMin: 0, zMax: 0,
    ...over,
  } as ResolvedSection;
}

describe('circular sections — the exact case', () => {
  it('a solid bar gives tau = T·R/J with J the polar moment', () => {
    const R = 0.05;
    const f = computeTorsionFlow(10, rs({ shape: 'CHS', h: 2 * R, b: 2 * R, t: 0 }));
    if (!f) throw new Error('no flow');
    const jExact = (Math.PI / 2) * R ** 4;
    expect(f.j).toBeCloseTo(jExact, 12);
    expect(f.tauMax).toBeCloseTo((10 * R) / jExact / 1000, 6);
    expect(f.theory).toBe('circular');
  });

  it('runs linearly from zero at the centre to the maximum at the surface', () => {
    const f = computeTorsionFlow(10, rs({ shape: 'CHS', h: 0.1, b: 0.1, t: 0 }));
    if (!f) throw new Error('no flow');
    const pts = f.segments[0].points;
    expect(pts[0].tau).toBeCloseTo(0, 9);
    expect(pts[pts.length - 1].tau).toBeCloseTo(f.tauMax, 9);
    // Linear: the midpoint is half the peak.
    expect(pts[Math.floor(pts.length / 2)].tau).toBeCloseTo(f.tauMax / 2, 3);
  });

  it('a tube subtracts the bore, so it is stiffer per unit of material', () => {
    const solid = computeTorsionFlow(10, rs({ shape: 'CHS', h: 0.1, b: 0.1, t: 0 }));
    const tube = computeTorsionFlow(10, rs({ shape: 'CHS', h: 0.1, b: 0.1, t: 0.005 }));
    if (!solid || !tube) throw new Error('no flow');
    expect(tube.j).toBeLessThan(solid.j);
    expect(tube.tauMax).toBeGreaterThan(solid.tauMax);
  });
});

describe('Bredt — closed thin wall', () => {
  it('gives tau = T/(2·Am·t) with Am bounded by the MID-LINE', () => {
    // 200 x 100 tube, 6 mm wall. Mid-line encloses 194 x 94, not 200 x 100.
    const b = 0.1, h = 0.2, t = 0.006;
    const f = computeTorsionFlow(15, rs({ shape: 'RHS', b, h, t }));
    if (!f) throw new Error('no flow');
    const am = (b - t) * (h - t);
    expect(f.tauMax).toBeCloseTo(15 / (2 * am * t) / 1000, 6);
    expect(f.theory).toBe('bredt');
  });

  it('using the outside dimensions would under-report the stress', () => {
    // Guards the specific error the mid-line rule exists to prevent.
    const b = 0.1, h = 0.2, t = 0.006;
    const f = computeTorsionFlow(15, rs({ shape: 'RHS', b, h, t }));
    if (!f) throw new Error('no flow');
    const wrong = 15 / (2 * (b * h) * t) / 1000;
    expect(f.tauMax).toBeGreaterThan(wrong);
  });

  it('circulates: the flow is a closed loop, constant along a uniform wall', () => {
    const f = computeTorsionFlow(15, rs({ shape: 'RHS', b: 0.1, h: 0.2, t: 0.006 }));
    if (!f) throw new Error('no flow');
    expect(f.segments[0].closed).toBe(true);
    const taus = f.segments[0].points.map((p) => p.tau);
    expect(Math.max(...taus) - Math.min(...taus)).toBeCloseTo(0, 12);
  });
});

describe('Saint-Venant — open thin wall', () => {
  it('J is one third of sum(b·t³), so thickness enters cubed', () => {
    const h = 0.3, b = 0.15, tw = 0.0071, tf = 0.0107;
    const f = computeTorsionFlow(5, rs({ shape: 'I', h, b, tw, tf }));
    if (!f) throw new Error('no flow');
    const jExact = (2 * b * tf ** 3 + (h - 2 * tf) * tw ** 3) / 3;
    expect(f.j).toBeCloseTo(jExact, 12);
    expect(f.theory).toBe('openThinWall');
  });

  it('doubling one wall’s thickness raises its contribution eightfold', () => {
    // The cube, stated as a behaviour rather than as a formula.
    const thin = computeTorsionFlow(5, rs({ shape: 'T', h: 0.1, b: 0.1, tw: 0.005, tf: 0.005 }));
    const thick = computeTorsionFlow(5, rs({ shape: 'T', h: 0.1, b: 0.1, tw: 0.005, tf: 0.01 }));
    if (!thin || !thick) throw new Error('no flow');
    // The flange's own term goes up 8x; the web's is unchanged, so the total
    // rises by less — but far more than the 2x a linear rule would give.
    expect(thick.j / thin.j).toBeGreaterThan(4);
  });

  it('the THICKEST element governs the peak stress, not the deepest', () => {
    // An I-beam's worst torsional shear is in the flange, which surprises
    // anyone reasoning from bending.
    const h = 0.3, b = 0.15, tw = 0.0071, tf = 0.0107;
    const f = computeTorsionFlow(5, rs({ shape: 'I', h, b, tw, tf }));
    if (!f) throw new Error('no flow');
    expect(f.tauMax).toBeCloseTo((5 * tf) / f.j / 1000, 6);
  });

  it('reverses across the thickness, passing through zero on the mid-line', () => {
    // No closed circuit means the flow must turn back on itself.
    const f = computeTorsionFlow(5, rs({ shape: 'I', h: 0.3, b: 0.15, tw: 0.0071, tf: 0.0107 }));
    if (!f) throw new Error('no flow');
    const p = f.segments[0].points;
    expect(Math.sign(p[0].tau)).toBe(-Math.sign(p[p.length - 1].tau));
    expect(p[1].tau).toBeCloseTo(0, 12);
  });
});

describe('the comparison that matters: slitting a tube', () => {
  it('a closed section is hundreds of times stiffer than the same wall opened', () => {
    // 100x100x5 SHS. This is the number that justifies the whole distinction,
    // and nothing about the two sections' appearance, area or bending inertia
    // would suggest it.
    const ratio = closedVersusOpen(rs({ shape: 'RHS', b: 0.1, h: 0.1, t: 0.005 }));
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThan(100);
  });

  it('is only offered where it means something', () => {
    expect(closedVersusOpen(rs({ shape: 'I', h: 0.3, b: 0.15, tw: 0.007, tf: 0.011 }))).toBeNull();
    expect(closedVersusOpen(rs({ shape: 'RHS', b: 0.1, h: 0.1, t: 0 }))).toBeNull();
  });

  it('an open profile really is far weaker in torsion than a tube of similar size', () => {
    const tube = computeTorsionFlow(5, rs({ shape: 'RHS', b: 0.1, h: 0.1, t: 0.005 }));
    const chan = computeTorsionFlow(5, rs({ shape: 'U', h: 0.1, b: 0.1, tw: 0.005, tf: 0.005 }));
    if (!tube || !chan) throw new Error('no flow');
    expect(chan.tauMax / tube.tauMax).toBeGreaterThan(10);
  });
});

describe('solid rectangle', () => {
  it('lands on the tabulated square, which is furthest from the thin-strip limit', () => {
    // For a square the classic coefficients are alpha = 0.208 and beta = 0.141
    // — nowhere near the 1/3 a thin strip gives. Matching them to three figures
    // is what says the approximation is the right one.
    const f = computeTorsionFlow(8, rs({ shape: 'rect', b: 0.1, h: 0.1 }));
    if (!f) throw new Error('no flow');
    expect(f.j / (0.1 * 0.1 ** 3)).toBeCloseTo(0.141, 3);
    // Within 0.5% of the tabulated alpha. Both are approximations to the same
    // series, so they agree closely rather than exactly; demanding equality
    // would be asserting that one rounding matches another.
    const tabulated = 8 / (0.208 * 0.1 ** 3) / 1000;
    expect(Math.abs(f.tauMax - tabulated) / tabulated).toBeLessThan(0.005);
  });

  it('tends to the thin-strip limit as the rectangle gets long', () => {
    // 50:1. It approaches 1/3 without reaching it, which is why this is a
    // relative check: the earlier lookup table clamped at 10:1 and sat 5% away.
    const f = computeTorsionFlow(8, rs({ shape: 'rect', b: 0.01, h: 0.5 }));
    if (!f) throw new Error('no flow');
    const beta = f.j / (0.5 * 0.01 ** 3);
    expect(beta).toBeGreaterThan(0.32);
    expect(beta).toBeLessThan(1 / 3);
  });

  it('vanishes at the corners, where two free surfaces meet', () => {
    const f = computeTorsionFlow(8, rs({ shape: 'rect', b: 0.1, h: 0.2 }));
    if (!f) throw new Error('no flow');
    const p = f.segments[0].points;
    expect(p[0].tau).toBeCloseTo(0, 9);
    expect(p[p.length - 1].tau).toBeCloseTo(0, 9);
  });
});

describe('degenerate input', () => {
  it('no torque means no diagram', () => {
    expect(computeTorsionFlow(0, rs({ shape: 'CHS', h: 0.1, b: 0.1, t: 0.005 }))).toBeNull();
  });

  it('the sign of the torque does not change the magnitudes', () => {
    const a = computeTorsionFlow(5, rs({ shape: 'I', h: 0.3, b: 0.15, tw: 0.007, tf: 0.011 }));
    const b = computeTorsionFlow(-5, rs({ shape: 'I', h: 0.3, b: 0.15, tw: 0.007, tf: 0.011 }));
    expect(a!.tauMax).toBeCloseTo(b!.tauMax, 12);
  });

  it('every catalogued shape yields a finite result under torque', () => {
    const shapes: ResolvedSection['shape'][] = ['I', 'H', 'U', 'C', 'L', 'T', 'invL', 'RHS', 'CHS', 'rect'];
    for (const shape of shapes) {
      const f = computeTorsionFlow(5, rs({
        shape, h: 0.2, b: 0.1, tw: 0.006, tf: 0.008, t: 0.006, tl: 0.004,
      }));
      expect(f, shape).not.toBeNull();
      expect(Number.isFinite(f!.tauMax), shape).toBe(true);
      expect(f!.tauMax, shape).toBeGreaterThan(0);
      expect(f!.j, shape).toBeGreaterThan(0);
    }
  });
});
