/**
 * The complete stress state, assembled from one geometry.
 *
 * The defect this closes was a split brain in the section panel: it DREW a
 * canonical outline and plotted canonical bending on it, while the shear, the
 * Mohr circle and the failure criteria came from the legacy resolver, which
 * infers a section's shape from its name and invents missing thicknesses. The
 * user saw one picture and two different sections, with no way to tell.
 *
 * What is pinned here is mostly units and superposition, because those are
 * where a stress assembly goes wrong quietly — off by a thousand, or with one
 * component silently dropped, and still plausible on screen.
 */

import { describe, it, expect } from 'vitest';
import { canonicalStressState } from '../stress-state';
import { resolveSectionState } from '../state';
import {
  analyzeSectionShear,
  analyzeSectionTorsion,
  hasSectionFieldExport,
} from '../../engine/wasm-solver';
import type { Section } from '../../store/model.svelte';

function sec(over: Partial<Section>): Section {
  const s = { id: 1, name: '', a: 0.01, iz: 1e-5, ...over } as Section;
  s.canonical = resolveSectionState(s, { torsion: true });
  return s;
}

/** 200 x 400 mm rectangle: A = 0.08 m², Iy = b h³/12 = 1.0667e-3 m⁴. */
const rect = () => sec({ shape: 'rect', b: 0.2, h: 0.4 });

describe('normal stress is assembled in the right units', () => {
  it('pure axial gives N/A, in MPa', () => {
    // 800 kN over 0.08 m² is 10 000 kPa, i.e. 10 MPa.
    const r = canonicalStressState(rect(), { n: 800, my: 0, mz: 0 }, [0, 0]);
    if (!r.ok) throw new Error(r.message ?? r.reason);
    expect(r.state.sigma).toBeCloseTo(10, 6);
    expect(r.state.breakdown.axial).toBeCloseTo(10, 6);
    expect(r.state.breakdown.bending).toBeCloseTo(0, 6);
  });

  it('pure bending gives M c / I at the extreme fibre', () => {
    // 100 kN·m, c = 0.2 m, I = 1.0667e-3 → 18 750 kPa = 18.75 MPa.
    const r = canonicalStressState(rect(), { n: 0, my: 100, mz: 0 }, [0, 0.2]);
    if (!r.ok) throw new Error(r.message ?? r.reason);
    expect(Math.abs(r.state.sigma)).toBeCloseTo(18.75, 2);
    expect(r.state.breakdown.axial).toBeCloseTo(0, 9);
  });

  it('bending is antisymmetric about the neutral axis, and zero on it', () => {
    const f = { n: 0, my: 100, mz: 0 };
    const top = canonicalStressState(rect(), f, [0, 0.2]);
    const bot = canonicalStressState(rect(), f, [0, -0.2]);
    const mid = canonicalStressState(rect(), f, [0, 0]);
    if (!top.ok || !bot.ok || !mid.ok) throw new Error('expected ok');
    expect(top.state.sigma).toBeCloseTo(-bot.state.sigma, 6);
    expect(mid.state.sigma).toBeCloseTo(0, 9);
  });

  it('axial and bending superpose', () => {
    const r = canonicalStressState(rect(), { n: 800, my: 100, mz: 0 }, [0, 0.2]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.state.sigma).toBeCloseTo(r.state.breakdown.axial + r.state.breakdown.bending, 9);
    expect(Math.abs(r.state.sigma)).toBeGreaterThan(10);
  });
});

describe('shear enters the state at the right magnitude', () => {
  it('peak shear on a rectangle is 1.5 V/A', () => {
    // 160 kN over 0.08 m² averages 2 000 kPa; the peak is 1.5x that = 3 MPa.
    const r = canonicalStressState(rect(), { n: 0, my: 0, mz: 0, vz: 160 }, [0, 0]);
    if (!r.ok) throw new Error(r.message ?? r.reason);
    expect(r.state.tau).toBeGreaterThan(2.6);
    expect(r.state.tau).toBeLessThan(3.4);
  });

  it('shear vanishes at the extreme fibre where bending peaks', () => {
    const f = { n: 0, my: 0, mz: 0, vz: 160 };
    const edge = canonicalStressState(rect(), f, [0, 0.199]);
    const mid = canonicalStressState(rect(), f, [0, 0]);
    if (!edge.ok || !mid.ok) throw new Error('expected ok');
    expect(edge.state.tau).toBeLessThan(0.35 * mid.state.tau);
  });

  it('doubling the force doubles the shear — the solve is per unit force', () => {
    const one = canonicalStressState(rect(), { n: 0, my: 0, mz: 0, vz: 100 }, [0, 0]);
    const two = canonicalStressState(rect(), { n: 0, my: 0, mz: 0, vz: 200 }, [0, 0]);
    if (!one.ok || !two.ok) throw new Error('expected ok');
    expect(two.state.tau / one.state.tau).toBeCloseTo(2, 6);
  });
});

describe('torsion enters the state at the right magnitude', () => {
  it('a circular tube matches T r / J', () => {
    const tube = sec({ shape: 'CHS', h: 0.2, t: 0.01 });
    const st = tube.canonical!;
    if (st.kind !== 'geometry-backed') throw new Error('expected geometry-backed');
    const T = 50; // kN·m
    const r = canonicalStressState(tube, { n: 0, my: 0, mz: 0, t: T }, [0, 0.095]);
    if (!r.ok) throw new Error(r.message ?? r.reason);
    // tau = T r / J, in kPa, converted to MPa.
    const expected = (T * 0.095) / st.j! * 1e-3;
    expect(r.state.tau / expected).toBeGreaterThan(0.85);
    expect(r.state.tau / expected).toBeLessThan(1.15);
  });
});

describe('the state feeds Mohr and the failure criteria consistently', () => {
  it('pure axial gives a Mohr circle centred at sigma/2 with radius sigma/2', () => {
    const r = canonicalStressState(rect(), { n: 800, my: 0, mz: 0 }, [0, 0]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.state.mohr.center).toBeCloseTo(5, 6);
    expect(r.state.mohr.radius).toBeCloseTo(5, 6);
    expect(r.state.mohr.sigma1).toBeCloseTo(10, 6);
    expect(r.state.mohr.sigma2).toBeCloseTo(0, 6);
  });

  it('von Mises reduces to |sigma| under pure axial, and to sqrt(3)|tau| under pure shear', () => {
    const axial = canonicalStressState(rect(), { n: 800, my: 0, mz: 0 }, [0, 0], 250);
    if (!axial.ok) throw new Error('expected ok');
    expect(axial.state.failure.vonMises).toBeCloseTo(10, 6);
    expect(axial.state.failure.ratioVM!).toBeCloseTo(10 / 250, 6);

    const shear = canonicalStressState(rect(), { n: 0, my: 0, mz: 0, vz: 160 }, [0, 0], 250);
    if (!shear.ok) throw new Error('expected ok');
    expect(shear.state.failure.vonMises / shear.state.tau).toBeCloseTo(Math.sqrt(3), 6);
  });

  it('a section without geometry is refused rather than approximated', () => {
    const bare = sec({ name: 'Losa equivalente', a: 0.05, iy: 4e-4, iz: 1e-4 });
    const r = canonicalStressState(bare, { n: 100, my: 10, mz: 0 }, [0, 0]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('notResolved');
  });
});

describe('shapes the legacy path could not handle', () => {
  it('an angle produces a full stress state', () => {
    const ang = sec({ shape: 'L', h: 0.1, b: 0.1, t: 0.01 });
    const r = canonicalStressState(ang, { n: 50, my: 5, mz: 2, vz: 20, vy: 10 }, [0.01, 0.01], 250);
    if (!r.ok) throw new Error(r.message ?? r.reason);
    expect(Number.isFinite(r.state.sigma)).toBe(true);
    expect(r.state.tau).toBeGreaterThan(0);
    expect(r.state.failure.vonMises).toBeGreaterThan(0);
  });
});

describe('the shear centre is reported when it is not at the centroid', () => {
  it('a doubly-symmetric section reports one at the centroid', () => {
    const r = canonicalStressState(rect(), { n: 0, my: 0, mz: 0, vz: 100 }, [0, 0]);
    if (!r.ok) throw new Error(r.message ?? r.reason);
    expect(r.state.shearCentre).toBeDefined();
    // 200 x 400 mm, so a millimetre is well inside the numerical noise floor.
    expect(Math.abs(r.state.shearCentre![0])).toBeLessThan(0.02);
    expect(Math.abs(r.state.shearCentre![1])).toBeLessThan(0.02);
  });

  it('a channel reports one displaced from the centroid, which is the point', () => {
    // Loading a channel through its web twists it, and the drawing gives a user
    // no way to guess that. UPN 200: web 8.5 mm, flanges 75 mm.
    const ch = sec({ shape: 'U', h: 0.2, b: 0.075, tw: 0.0085, tf: 0.0115 });
    const r = canonicalStressState(ch, { n: 0, my: 0, mz: 0, vz: 100 }, [0, 0]);
    if (!r.ok) throw new Error(r.message ?? r.reason);
    expect(r.state.shearCentre).toBeDefined();
    // Displaced by a meaningful fraction of the flange width, not a rounding.
    expect(Math.abs(r.state.shearCentre![0])).toBeGreaterThan(0.01);
  });

  it('no shear force means no shear solve, and so no shear centre', () => {
    // It is not computed speculatively: the solve costs milliseconds and a
    // pure bending query has no use for it.
    const r = canonicalStressState(rect(), { n: 100, my: 50, mz: 0 }, [0, 0]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.state.shearCentre).toBeUndefined();
  });
});

/**
 * The stress-map overlay paints `field` over the whole section instead of
 * asking the engine for a point at a time. That is only legitimate if the
 * plane it describes IS the field the engine reports — otherwise the picture
 * and the readout disagree, which is the exact class of split-brain defect
 * this module was written to end.
 */
describe('the reported field reproduces the stress everywhere', () => {
  const evalField = (f: { axial: number; ky: number; kz: number }, y: number, z: number) =>
    f.axial + f.kz * z - f.ky * y;

  it('agrees with the point stress at arbitrary points, under biaxial bending', () => {
    const forces = { n: 500, my: 80, mz: 30 };
    // Points picked off-axis on purpose: a field that only got the symmetric
    // cases right would pass a centreline-only check.
    for (const [y, z] of [[0, 0], [0.1, 0.2], [-0.07, 0.13], [0.09, -0.18]]) {
      const r = canonicalStressState(rect(), forces, [y, z]);
      if (!r.ok) throw new Error(r.message ?? r.reason);
      // Exact to the engine's own arithmetic: both come from the same
      // curvatures, so any discrepancy is a wiring error, not a tolerance.
      expect(evalField(r.state.field, y, z)).toBeCloseTo(r.state.sigma, 10);
    }
  });

  it('is a plane: the stress at a midpoint is the mean of its endpoints', () => {
    const r = canonicalStressState(rect(), { n: 200, my: 60, mz: 25 }, [0, 0]);
    if (!r.ok) throw new Error(r.message ?? r.reason);
    const f = r.state.field;
    const a = evalField(f, -0.1, -0.2);
    const b = evalField(f, 0.1, 0.2);
    expect(evalField(f, 0, 0)).toBeCloseTo((a + b) / 2, 10);
  });

  it('carries no shear: the map describes sigma only', () => {
    // A shear field is solved on the mesh and is not a plane. Folding it into
    // these three coefficients would be silently wrong, so the axial term must
    // stay N/A even when a shear force is present.
    const r = canonicalStressState(rect(), { n: 800, my: 0, mz: 0, vz: 300 }, [0, 0]);
    if (!r.ok) throw new Error(r.message ?? r.reason);
    expect(r.state.field.axial).toBeCloseTo(10, 6);
    expect(evalField(r.state.field, 0, 0)).toBeCloseTo(r.state.sigma, 10);
    // ...and the shear really is present in the state, so this is not a
    // vacuous check on a state that happens to have no shear.
    expect(r.state.tau).toBeGreaterThan(0);
  });
});

// These pin the solve-once/locate-locally path against the per-point exports.
// They skip on a WASM build that predates the field exports — and CI fails
// the whole suite on such a build (vitest.setup.ts), so a skip here can only
// happen locally.
const describeField = hasSectionFieldExport() ? describe : describe.skip;

describeField('the cached field path agrees with the per-point solves', () => {
  // Shear and torsion are compared separately: the state combines them
  // vectorially before the magnitude, so a combined reference cannot be
  // rebuilt from magnitudes.
  const shearForces = { n: 0, my: 0, mz: 0, vy: 60, vz: 160 };
  const POINTS: Array<[number, number]> = [
    [0, 0],
    [0.05, 0.1],
    [-0.07, -0.15],
    [0.09, 0.199],
    [-0.02, 0.05],
  ];

  it('shear components match the per-point shear solve at every fibre', () => {
    const s = rect();
    const st = s.canonical!;
    if (st.kind !== 'geometry-backed') throw new Error('expected geometry-backed');
    for (const p of POINTS) {
      const sh = analyzeSectionShear({ geometry: st.geometry, at: p });
      const r = canonicalStressState(s, shearForces, p);
      if (!r.ok) throw new Error(r.message ?? r.reason);
      // Reassemble the per-point answer the same way the state does.
      const refXy = sh.vy.at![0] * shearForces.vy + sh.vz.at![0] * shearForces.vz;
      const refXz = sh.vy.at![1] * shearForces.vy + sh.vz.at![1] * shearForces.vz;
      const refTau = Math.hypot(refXy, refXz) * 1e-3;
      expect(r.state.tau).toBeCloseTo(refTau, 6);
    }
  });

  it('torsion matches the per-point torsion solve at every fibre', () => {
    const s = rect();
    const st = s.canonical!;
    if (st.kind !== 'geometry-backed') throw new Error('expected geometry-backed');
    for (const p of POINTS) {
      const to = analyzeSectionTorsion({ geometry: st.geometry, at: p });
      const r = canonicalStressState(s, { n: 0, my: 0, mz: 0, t: 20 }, p);
      if (!r.ok) throw new Error(r.message ?? r.reason);
      const refTau = (Math.hypot(to.at![0], to.at![1]) * 20) / to.j * 1e-3;
      expect(r.state.tau).toBeCloseTo(refTau, 6);
    }
  });

  it('repeated queries across many fibres stay consistent (the cache-hit path)', () => {
    // Twenty-five fibres on one section: the first call solves and caches, the
    // rest are local triangle locates. A stale or mis-keyed cache shows up as
    // a mismatch against the per-point solve — so the loop interleaves a
    // second section with a different digest: a cache keyed on nothing (or on
    // a constant) would serve the wrong geometry's field and fail here.
    const a = rect();
    const b = sec({ shape: 'rect', b: 0.1, h: 0.3 });
    for (const s of [a, b]) {
      const st = s.canonical!;
      if (st.kind !== 'geometry-backed') throw new Error('expected geometry-backed');
    }
    for (let iy = -2; iy <= 2; iy++) {
      for (let iz = -2; iz <= 2; iz++) {
        const s = (iy + iz) % 2 === 0 ? a : b;
        const st = s.canonical!;
        if (st.kind !== 'geometry-backed') throw new Error('expected geometry-backed');
        const p: [number, number] = [iy * 0.02, iz * 0.05];
        const sh = analyzeSectionShear({ geometry: st.geometry, at: p });
        const r = canonicalStressState(s, { n: 0, my: 0, mz: 0, vz: 100 }, p);
        if (!r.ok) throw new Error(r.message ?? r.reason);
        const refTau = Math.hypot(sh.vz.at![0], sh.vz.at![1]) * 100 * 1e-3;
        expect(r.state.tau).toBeCloseTo(refTau, 6);
      }
    }
  });
});
