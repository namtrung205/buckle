/**
 * The cross-check that would have caught the circular-tube bug.
 *
 * A hand-derived shear formula can be wrong while the diagram it draws still
 * looks like a plausible distribution — right shape, right peak location, wrong
 * by a factor. That is not hypothetical: it is what the CHS formula did, for as
 * long as it existed, until an audit compared it against theory by hand.
 *
 * These tests exist to prove the automated version of that comparison actually
 * discriminates. A check that passes everything is worse than none, because it
 * looks like assurance.
 */

import { describe, it, expect } from 'vitest';
import { crossCheckShearPeak } from '../shear-crosscheck';
import { computeShearFlowPaths } from '../../engine/section-stress';
import { resolveSectionState } from '../state';
import type { Section } from '../../store/model.svelte';
import type { ResolvedSection } from '../../engine/section-stress';

function sec(over: Partial<Section>): Section {
  const s = { id: 1, name: '', a: 0.01, iy: 1e-5, iz: 1e-5, ...over } as Section;
  s.canonical = resolveSectionState(s, { torsion: true });
  return s;
}

function rsOf(over: Partial<ResolvedSection>): ResolvedSection {
  return {
    shape: 'rect', a: 0, iy: 0, iz: 0, j: 0,
    h: 0, b: 0, tw: 0, tf: 0, t: 0, tl: 0,
    yMin: 0, yMax: 0, zMin: 0, zMax: 0, ...over,
  } as ResolvedSection;
}

const geometryOf = (s: Section) => {
  const st = s.canonical;
  if (!st || st.kind !== 'geometry-backed') throw new Error('no geometry');
  return st.geometry;
};

const peakOf = (rs: ResolvedSection, v: number) =>
  Math.max(...computeShearFlowPaths(v, rs).flatMap((g) => g.points.map((p) => Math.abs(p.tau))), 0);

describe('the closed form and the solver agree on shapes that are right', () => {
  it('a solid rectangle: Jourawski is exact there, so they should match closely', () => {
    const S = sec({ shape: 'rect', b: 0.2, h: 0.4, a: 0.08, iy: 1.0667e-3 });
    const rs = rsOf({ shape: 'rect', b: 0.2, h: 0.4, a: 0.08, iy: 1.0667e-3 });
    const r = crossCheckShearPeak(geometryOf(S), peakOf(rs, 120), 0, 120);
    if (!r) throw new Error('no cross-check — solver unavailable');
    expect(r.agrees).toBe(true);
    expect(r.relativeError).toBeLessThan(0.2);
  });

  it('a circular tube: the case that was wrong, now agreeing', () => {
    // With the /2t bug this comparison would have failed at ~50% error, which
    // is the entire point of the test.
    const S = sec({ shape: 'CHS', h: 0.2, b: 0.2, t: 0.005, a: 3.06e-3, iy: 1.47e-5 });
    const rs = rsOf({ shape: 'CHS', h: 0.2, b: 0.2, t: 0.005, a: 3.06e-3, iy: 1.47e-5 });
    const r = crossCheckShearPeak(geometryOf(S), peakOf(rs, 100), 0, 100);
    if (!r) throw new Error('no cross-check');
    expect(r.agrees).toBe(true);
  });
});

describe('it actually discriminates', () => {
  it('flags a peak that is half what it should be — the exact bug that shipped', () => {
    const S = sec({ shape: 'CHS', h: 0.2, b: 0.2, t: 0.005, a: 3.06e-3, iy: 1.47e-5 });
    const rs = rsOf({ shape: 'CHS', h: 0.2, b: 0.2, t: 0.005, a: 3.06e-3, iy: 1.47e-5 });
    const halved = peakOf(rs, 100) / 2;
    const r = crossCheckShearPeak(geometryOf(S), halved, 0, 100);
    if (!r) throw new Error('no cross-check');
    expect(r.agrees).toBe(false);
    expect(r.relativeError).toBeGreaterThan(0.4);
  });

  it('flags a doubled peak too — it is not one-sided', () => {
    const S = sec({ shape: 'rect', b: 0.2, h: 0.4, a: 0.08, iy: 1.0667e-3 });
    const rs = rsOf({ shape: 'rect', b: 0.2, h: 0.4, a: 0.08, iy: 1.0667e-3 });
    const r = crossCheckShearPeak(geometryOf(S), peakOf(rs, 120) * 2, 0, 120);
    expect(r!.agrees).toBe(false);
  });

  it('scales with the applied force, so it holds at any load level', () => {
    const S = sec({ shape: 'rect', b: 0.2, h: 0.4, a: 0.08, iy: 1.0667e-3 });
    const rs = rsOf({ shape: 'rect', b: 0.2, h: 0.4, a: 0.08, iy: 1.0667e-3 });
    for (const v of [20, 120, 600]) {
      const r = crossCheckShearPeak(geometryOf(S), peakOf(rs, v), 0, v);
      expect(r!.agrees, `V = ${v}`).toBe(true);
    }
  });
});

describe('it declines rather than guesses', () => {
  it('returns null for a zero peak instead of dividing by it', () => {
    const S = sec({ shape: 'rect', b: 0.2, h: 0.4, a: 0.08, iy: 1.0667e-3 });
    expect(crossCheckShearPeak(geometryOf(S), 0, 0, 100)).toBeNull();
  });

  it('declines under biaxial shear — the two components peak at different points', () => {
    // hypot(tauMax_y·vy, tauMax_z·vz) combines maxima that occur at DIFFERENT
    // places on the outline, so it is not the stress at any point and there is
    // nothing meaningful to compare the drawn peak against. Null, not a number.
    const S = sec({ shape: 'rect', b: 0.2, h: 0.4, a: 0.08, iy: 1.0667e-3 });
    const rs = rsOf({ shape: 'rect', b: 0.2, h: 0.4, a: 0.08, iy: 1.0667e-3 });
    expect(crossCheckShearPeak(geometryOf(S), peakOf(rs, 120), 60, 120)).toBeNull();
    // Either component alone stays comparable.
    expect(crossCheckShearPeak(geometryOf(S), peakOf(rs, 120), 0, 120)).not.toBeNull();
  });

  it('reports both numbers, so a disagreement can be judged rather than trusted', () => {
    const S = sec({ shape: 'rect', b: 0.2, h: 0.4, a: 0.08, iy: 1.0667e-3 });
    const rs = rsOf({ shape: 'rect', b: 0.2, h: 0.4, a: 0.08, iy: 1.0667e-3 });
    const r = crossCheckShearPeak(geometryOf(S), peakOf(rs, 120), 0, 120)!;
    expect(r.closedForm).toBeGreaterThan(0);
    expect(r.solved).toBeGreaterThan(0);
  });
});
