/**
 * The worked centroid and shear centre, checked against what they claim.
 *
 * This module teaches a calculation, which makes a wrong answer worse than
 * usual: a student has no way to catch it, and the working looks like an
 * authority. So the decomposition is checked against the section's own area,
 * the centroid against symmetry, and the shear centre against the classical
 * results that make the subject worth teaching at all — above all that a
 * channel's lies OUTSIDE the section.
 */

import { describe, it, expect } from 'vitest';
import { decompose, centroidWorking, shearCentreWorking } from '../section-teaching';
import type { ResolvedSection } from '../section-stress';

function rs(over: Partial<ResolvedSection>): ResolvedSection {
  return {
    shape: 'rect', a: 0, iy: 0, iz: 0, j: 0,
    h: 0, b: 0, tw: 0, tf: 0, t: 0, tl: 0,
    yMin: 0, yMax: 0, zMin: 0, zMax: 0,
    ...over,
  } as ResolvedSection;
}

/** IPE 300. */
const ipe = () => rs({ shape: 'I', h: 0.3, b: 0.15, tw: 0.0071, tf: 0.0107, a: 5.381e-3, iy: 8.356e-5 });
/** UPN 200: web 8.5, flanges 75 wide, 11.5 thick. */
const upn = () => rs({ shape: 'U', h: 0.2, b: 0.075, tw: 0.0085, tf: 0.0115, a: 3.22e-3, iy: 1.91e-5 });

describe('the decomposition accounts for the section', () => {
  it('an I-beam splits into two flanges and a web that sum to its area', () => {
    const s = ipe();
    const parts = decompose(s);
    expect(parts).toHaveLength(3);
    const sum = parts.reduce((a, p) => a + p.area, 0);
    // Rectangles ignore the root fillets, so the decomposition is a few
    // percent light on a rolled profile. That is a property of the hand method,
    // not an error — and it is why the panel reports the discrepancy.
    expect(sum).toBeGreaterThan(s.a * 0.9);
    expect(sum).toBeLessThanOrEqual(s.a * 1.02);
  });

  it('a hollow tube subtracts its bore as a negative area', () => {
    const s = rs({ shape: 'RHS', h: 0.2, b: 0.1, t: 0.006, a: 3.35e-3 });
    const parts = decompose(s);
    expect(parts.some((p) => p.area < 0)).toBe(true);
    const sum = parts.reduce((a, p) => a + p.area, 0);
    expect(sum).toBeCloseTo(s.a, 3);
  });

  it('every part has positive dimensions and a lever arm inside the section', () => {
    // The bottom-left origin exists so that no arm is negative: a sign error
    // in the sum would otherwise hide.
    for (const s of [ipe(), upn(), rs({ shape: 'T', h: 0.1, b: 0.1, tw: 0.009, tf: 0.009 })]) {
      for (const p of decompose(s)) {
        expect(p.width, p.labelKey).toBeGreaterThan(0);
        expect(p.height, p.labelKey).toBeGreaterThan(0);
        expect(p.yi, p.labelKey).toBeGreaterThanOrEqual(0);
        expect(p.yi, p.labelKey).toBeLessThanOrEqual(s.h);
      }
    }
  });
});

describe('the centroid, from first moments', () => {
  it('a doubly-symmetric section has it at mid-depth, by symmetry', () => {
    const w = centroidWorking(ipe());
    expect(w.yBar).toBeCloseTo(0.15, 6);
    expect(w.bySymmetry.horizontal).toBe(true);
    expect(w.bySymmetry.vertical).toBe(true);
  });

  it('a channel has it on the horizontal axis but NOT on the web centreline', () => {
    // The whole reason a channel is interesting: one symmetry, not two.
    const w = centroidWorking(upn());
    expect(w.yBar).toBeCloseTo(0.1, 6);
    expect(w.bySymmetry.horizontal).toBe(true);
    expect(w.bySymmetry.vertical).toBe(false);
    // It sits between the web face and mid-flange, pulled out by the flanges.
    expect(w.zBar).toBeGreaterThan(0.0085 / 2);
    expect(w.zBar).toBeLessThan(0.075 / 2);
  });

  it('a tee has it above mid-depth, pulled up by the flange', () => {
    const w = centroidWorking(rs({ shape: 'T', h: 0.1, b: 0.1, tw: 0.009, tf: 0.009 }));
    expect(w.yBar).toBeGreaterThan(0.05);
    expect(w.bySymmetry.vertical).toBe(true);
    expect(w.bySymmetry.horizontal).toBe(false);
  });

  it('the first moment equals the total area times the lever arm — the identity it rests on', () => {
    const w = centroidWorking(upn());
    expect(w.sumAy).toBeCloseTo(w.totalArea * w.yBar, 12);
    expect(w.sumAz).toBeCloseTo(w.totalArea * w.zBar, 12);
  });

  it('an angle has it inside neither leg’s centreline, but between them', () => {
    const w = centroidWorking(rs({ shape: 'L', h: 0.1, b: 0.1, t: 0.01, tw: 0.01, tf: 0.01 }));
    expect(w.zBar).toBeGreaterThan(0);
    expect(w.zBar).toBeLessThan(0.05);
    expect(w.yBar).toBeGreaterThan(0);
    expect(w.yBar).toBeLessThan(0.05);
  });
});

describe('the shear centre, and why it is not the centroid', () => {
  it('coincides with the centroid when two axes of symmetry force it to', () => {
    const w = shearCentreWorking(ipe());
    expect(w.rule).toBe('doublySymmetric');
    expect(w.ez).toBe(0);
    expect(w.ey).toBe(0);
    // No arithmetic: symmetry settles it.
    expect(w.terms).toEqual([]);
  });

  it('a channel’s lies OUTSIDE the section, on the far side of the web', () => {
    // The result the whole subject exists to teach, and the one a drawing
    // gives no hint of.
    const w = shearCentreWorking(upn());
    expect(w.rule).toBe('channelFormula');
    expect(w.outsideSection).toBe(true);
    // Opposite side from the flanges, so negative in this convention.
    expect(w.ez).toBeLessThan(0);
    // UPN 200, in the rectangle decomposition: e = bm²·hm²·tf/(4·Iy) =
    // 26.77 mm measured from the web CENTRE LINE, and the centroid sits
    // zBar = 22.01 mm from the web's outer face — so ez = tw/2 − e − zBar =
    // −44.5 mm. The shear centre is therefore 22.5 mm clear of the web's
    // outer face; the published UPN 200 value is ≈ 22.4 mm.
    expect(w.ez).toBeCloseTo(-0.0445, 3);
    const clearOfFace = -(w.ez + centroidWorking(upn()).zBar);
    expect(clearOfFace).toBeCloseTo(0.0225, 3);
  });

  it('the channel formula scales as the flange width squared', () => {
    // e = b²h²t/(4I). Doubling the flange, with I held fixed, quadruples it —
    // which is why a wide-flange channel twists so much more readily.
    const narrow = shearCentreWorking(rs({ shape: 'U', h: 0.2, b: 0.05, tw: 0.0085, tf: 0.0115, iy: 1.91e-5 }));
    const wide = shearCentreWorking(rs({ shape: 'U', h: 0.2, b: 0.1, tw: 0.0085, tf: 0.0115, iy: 1.91e-5 }));
    const eN = narrow.terms.find((t) => t.symbolKey === 'teach.sym.e')!.value;
    const eW = wide.terms.find((t) => t.symbolKey === 'teach.sym.e')!.value;
    expect(eW / eN).toBeGreaterThan(3);
  });

  it('uses mid-line dimensions, not outside ones', () => {
    const w = shearCentreWorking(upn());
    const bm = w.terms.find((t) => t.symbolKey === 'teach.sym.bm')!.value;
    const hm = w.terms.find((t) => t.symbolKey === 'teach.sym.hm')!.value;
    // b measured from the web CENTRE, h between flange CENTRES: both smaller
    // than the outside dimensions they are taken from.
    expect(bm).toBeLessThan(75);
    expect(hm).toBeLessThan(200);
    expect(hm).toBeCloseTo(200 - 11.5, 6);
  });

  it('for an angle it is the corner, where the two wall mid-lines cross', () => {
    // A thin rectangle's shear flow runs along its mid-line, so each leg's
    // resultant passes through that line; they meet at the corner.
    const w = shearCentreWorking(rs({ shape: 'L', h: 0.1, b: 0.1, t: 0.01, tw: 0.01, tf: 0.01 }));
    expect(w.rule).toBe('intersectingWalls');
    const c = centroidWorking(rs({ shape: 'L', h: 0.1, b: 0.1, t: 0.01, tw: 0.01, tf: 0.01 }));
    // Offsets are from the centroid, so they must point back toward the corner.
    expect(w.ez).toBeCloseTo(0.005 - c.zBar, 9);
    expect(w.ey).toBeCloseTo(0.005 - c.yBar, 9);
  });

  it('a tee’s sits at the flange–web junction, not at its centroid', () => {
    const w = shearCentreWorking(rs({ shape: 'T', h: 0.1, b: 0.1, tw: 0.009, tf: 0.009 }));
    expect(w.rule).toBe('intersectingWalls');
    expect(w.ez).toBeCloseTo(0, 6);   // on the axis of symmetry
    expect(w.ey).not.toBeCloseTo(0, 3); // but above the centroid
  });

  it('names a rule for every catalogued shape, and never returns NaN', () => {
    const shapes: ResolvedSection['shape'][] = ['I', 'H', 'U', 'C', 'L', 'T', 'invL', 'RHS', 'CHS', 'rect'];
    for (const shape of shapes) {
      const w = shearCentreWorking(rs({
        shape, h: 0.2, b: 0.1, tw: 0.006, tf: 0.008, t: 0.006, tl: 0.004, iy: 1.5e-5,
      }));
      expect(Number.isFinite(w.ez), shape).toBe(true);
      expect(Number.isFinite(w.ey), shape).toBe(true);
      expect(w.labelKey, shape).toBeTruthy();
    }
  });
});
