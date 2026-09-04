/**
 * The torque gets from the solver to the stress, end to end.
 *
 * # Why this exists as its own file
 *
 * Every piece of the torsion chain had tests and every one of them passed while
 * the chain itself was broken. `stationForces3D` read a field named `txStart`;
 * every 3D result object the solver produces names it `mxStart`; the read was
 * optional, so it returned zero. Torsional shear, the warping split and the
 * warping normal stress were therefore zero everywhere in the application, for
 * every model, while the panel displayed "Mx = 8.00 kN·m" one row above the
 * words "no torque at this station".
 *
 * The unit tests could not see it because each one supplied its own input. The
 * only thing that would have caught it is a test that starts where the data
 * really starts — an `ElementForces3D` as the solver emits it — and follows it
 * all the way to a stress. That is what this is.
 *
 * The lesson generalises: a seam between two modules that agree on a shape but
 * not on a NAME is invisible to both of their test suites, and a cast at the
 * call site removes the last thing that would have objected.
 */

import { describe, it, expect } from 'vitest';
import { stationForces3D } from '../panel';
import { canonicalStressState } from '../stress-state';
import { resolveSectionState } from '../state';
import type { Section } from '../../store/model.svelte';

function sec(over: Partial<Section>): Section {
  const s = { id: 1, name: '', a: 0.01, iz: 1e-5, ...over } as Section;
  s.canonical = resolveSectionState(s, { torsion: true });
  return s;
}

/**
 * An element's forces exactly as the 3D solver emits them.
 *
 * Written out in full, with the solver's own field names, on purpose: the point
 * of this file is that the names have to match, so a helper that filled them in
 * would defeat it.
 */
function solverForces(over: Record<string, number> = {}) {
  return {
    elementId: 1, length: 3,
    nStart: 0, nEnd: 0,
    vyStart: 0, vyEnd: 0,
    vzStart: 0, vzEnd: 0,
    mxStart: 0, mxEnd: 0,
    myStart: 0, myEnd: 0,
    mzStart: 0, mzEnd: 0,
    ...over,
  };
}

describe('a twisted member produces torsional shear', () => {
  // 200 x 400 mm solid rectangle, twisted by 20 kN·m.
  const rect = () => sec({ shape: 'rect', b: 0.2, h: 0.4 });

  it('the station forces carry the torque', () => {
    const f = stationForces3D(solverForces({ mxStart: 20, mxEnd: 20 }), 0.5);
    expect(f.tx).toBeCloseTo(20, 9);
  });

  it('and the stress state turns it into a real tau', () => {
    const f = stationForces3D(solverForces({ mxStart: 20, mxEnd: 20 }), 0.5);
    const r = canonicalStressState(rect(), { n: 0, my: 0, mz: 0, t: f.tx }, [0.1, 0]);
    if (!r.ok) throw new Error(r.message ?? r.reason);
    expect(r.state.tau).toBeGreaterThan(0.1);
    expect(r.state.breakdown.torsion).toBeGreaterThan(0.1);
  });

  it('no torque means no torsional component — the zero must be earned', () => {
    const f = stationForces3D(solverForces(), 0.5);
    const r = canonicalStressState(rect(), { n: 0, my: 0, mz: 0, t: f.tx }, [0.1, 0]);
    if (!r.ok) throw new Error(r.message ?? r.reason);
    expect(r.state.breakdown.torsion).toBeCloseTo(0, 9);
  });

  it('doubling the torque doubles the shear', () => {
    const at = (mx: number) => {
      const f = stationForces3D(solverForces({ mxStart: mx, mxEnd: mx }), 0.5);
      const r = canonicalStressState(rect(), { n: 0, my: 0, mz: 0, t: f.tx }, [0.1, 0]);
      if (!r.ok) throw new Error(r.message ?? r.reason);
      return r.state.breakdown.torsion;
    };
    expect(at(40)).toBeCloseTo(2 * at(20), 6);
  });
});

describe('it survives the shapes a user actually picks', () => {
  // Each shape is probed at a point where its torsional shear is NOT zero —
  // at the centroid a solid section's torsion vanishes, so an assertion made
  // there passes vacuously. The points sit on a flange tip, on a wall and at
  // a solid rectangle's edge midpoint respectively.
  const cases: Array<[string, Section, [number, number]]> = [
    ['I', sec({ shape: 'I', h: 0.3, b: 0.15, tw: 0.0071, tf: 0.0107 }), [0.06, 0.145]],
    ['RHS', sec({ shape: 'RHS', h: 0.2, b: 0.2, t: 0.01 }), [0.095, 0]],
    ['CHS', sec({ shape: 'CHS', h: 0.2, b: 0.2, t: 0.01 }), [0.095, 0]],
    ['rect', sec({ shape: 'rect', h: 0.4, b: 0.2 }), [0.1, 0]],
  ];

  for (const [name, section, point] of cases) {
    it(`${name}: a torque reaches the stress and a zero torque does not invent one`, () => {
      const f = stationForces3D(solverForces({ mxStart: 15, mxEnd: 15 }), 0.5);
      const withT = canonicalStressState(section, { n: 0, my: 0, mz: 0, t: f.tx }, point);
      const noT = canonicalStressState(section, { n: 0, my: 0, mz: 0, t: 0 }, point);
      if (!withT.ok || !noT.ok) throw new Error('section refused');

      // At a point where torsion actually acts, the component must be real —
      // not merely "different from some other value".
      expect(withT.state.breakdown.torsion).toBeGreaterThan(0.01);
      expect(noT.state.breakdown.torsion).toBeCloseTo(0, 9);
      expect(Number.isFinite(withT.state.tau)).toBe(true);
    });
  }

  it('an I section develops torsional shear at the flange tip', () => {
    const ipe = sec({ shape: 'I', h: 0.3, b: 0.15, tw: 0.0071, tf: 0.0107 });
    const f = stationForces3D(solverForces({ mxStart: 5, mxEnd: 5 }), 0);
    // Near the top flange, off the axis of symmetry.
    const r = canonicalStressState(ipe, { n: 0, my: 0, mz: 0, t: f.tx }, [0.06, 0.145]);
    if (!r.ok) throw new Error(r.message ?? r.reason);
    expect(r.state.breakdown.torsion).toBeGreaterThan(0);
  });
});

describe('torsion superposes with the rest, it does not replace it', () => {
  const rect = () => sec({ shape: 'rect', b: 0.2, h: 0.4 });

  it('bending stress is untouched by adding a torque', () => {
    const f = stationForces3D(solverForces({ myStart: 100, myEnd: 100, mxStart: 30, mxEnd: 30 }), 0);
    const both = canonicalStressState(rect(), { n: 0, my: f.my, mz: 0, t: f.tx }, [0, 0.2]);
    const bendOnly = canonicalStressState(rect(), { n: 0, my: 100, mz: 0, t: 0 }, [0, 0.2]);
    if (!both.ok || !bendOnly.ok) throw new Error('refused');
    // Torsion is a shear; it must not change sigma at all.
    expect(both.state.sigma).toBeCloseTo(bendOnly.state.sigma, 9);
    // And it must change tau.
    expect(Math.abs(both.state.tau)).toBeGreaterThan(Math.abs(bendOnly.state.tau));
  });

  it('a torque that varies along the member is read at the station asked for', () => {
    const ef = solverForces({ mxStart: 12, mxEnd: 0 });
    expect(stationForces3D(ef, 0).tx).toBeCloseTo(12, 9);
    expect(stationForces3D(ef, 0.25).tx).toBeCloseTo(9, 9);
    expect(stationForces3D(ef, 1).tx).toBeCloseTo(0, 9);
  });
});
