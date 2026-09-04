/**
 * Eccentric loads and the full tensor state.
 *
 * Two additions to the section analysis, and both exist because the section
 * engine already knows something the panel was not using.
 *
 * The first is that a load has a POINT of application, and the point that
 * matters is not the same for every force: axial acts about the centroid,
 * transverse shear acts about the shear centre. Confusing them is the classic
 * error of the subject — a channel loaded through its web looks fine on a
 * drawing and twists in reality.
 *
 * The second is that three stress components are not "the stress" but part of
 * a tensor, and writing it out is what makes principal directions, invariants
 * and the strain state computable.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { initSolver } from '../../engine/wasm-solver';
import { resolveEccentric, kernLimits } from '../eccentric';
import { stressTensorState, tensorRows } from '../tensors';
import { canonicalStressState } from '../stress-state';
import { resolveSectionState } from '../state';
import type { Section } from '../../store/model.svelte';

beforeAll(async () => { await initSolver(); }, 60_000);

// ─── Eccentric loads ───────────────────────────────────────────────

describe('an axial load off the centroid becomes axial plus bending', () => {
  it('through the centroid it adds nothing', () => {
    const r = resolveEccentric({ n: 100 });
    expect(r.forces).toEqual({ n: 100, my: 0, mz: 0, vy: 0, vz: 0, t: 0 });
  });

  it('offset vertically it produces N·e about the horizontal axis', () => {
    const r = resolveEccentric({ n: 100, at: [0, 0.2] });
    expect(r.forces.my).toBeCloseTo(20, 9);
    expect(r.forces.mz).toBeCloseTo(0, 9);
    expect(r.effect.myFromN).toBeCloseTo(20, 9);
  });

  it('offset horizontally it bends about the other axis, with the other sign', () => {
    // The sign matters: it has to raise the stress on the side the load moved
    // towards, and the engine's convention is sigma = N/A + kz·z − ky·y.
    const r = resolveEccentric({ n: 100, at: [0.15, 0] });
    expect(r.forces.mz).toBeCloseTo(-15, 9);
    expect(r.forces.my).toBeCloseTo(0, 9);
  });

  it('reversing the load reverses the induced moment', () => {
    const push = resolveEccentric({ n: -100, at: [0, 0.2] });
    const pull = resolveEccentric({ n: 100, at: [0, 0.2] });
    expect(push.forces.my).toBeCloseTo(-pull.forces.my, 9);
  });
});

describe('a transverse load off the SHEAR CENTRE becomes shear plus torsion', () => {
  it('through the shear centre it adds no torsion', () => {
    // Not through the centroid — through the shear centre. For a channel those
    // are different points, and this is the distinction being pinned.
    const sc: [number, number] = [-0.03, 0];
    const r = resolveEccentric({ vz: 50, at: sc }, sc);
    expect(r.forces.t).toBeCloseTo(0, 9);
  });

  it('applied at the centroid of a channel it DOES twist', () => {
    // The whole point: the web looks like "the middle" and is not the shear
    // centre, so the obvious place to load produces torsion.
    const sc: [number, number] = [-0.03, 0];
    const r = resolveEccentric({ vz: 50, at: [0, 0] }, sc);
    expect(Math.abs(r.forces.t)).toBeCloseTo(1.5, 9);
    expect(r.effect.shearArm[0]).toBeCloseTo(0.03, 9);
  });

  it('torsion grows linearly with the arm and with the force', () => {
    const sc: [number, number] = [0, 0];
    const a = resolveEccentric({ vz: 50, at: [0.1, 0] }, sc).forces.t;
    const b = resolveEccentric({ vz: 50, at: [0.2, 0] }, sc).forces.t;
    const c = resolveEccentric({ vz: 100, at: [0.1, 0] }, sc).forces.t;
    expect(b / a).toBeCloseTo(2, 9);
    expect(c / a).toBeCloseTo(2, 9);
  });

  it('the two eccentricities superpose without interfering', () => {
    const r = resolveEccentric({ n: 100, vz: 50, at: [0.1, 0.2] }, [0, 0]);
    expect(r.forces.my).toBeCloseTo(20, 9);   // from N
    expect(r.forces.mz).toBeCloseTo(-10, 9);  // from N
    expect(r.forces.t).toBeCloseTo(5, 9);     // from V
  });
});

describe('the kern', () => {
  it('is the middle third of a rectangle', () => {
    // b×h = 0.2 × 0.4: the kern half-height is h/6, the classic result.
    const a = 0.2 * 0.4;
    const iy = (0.2 * 0.4 ** 3) / 12;
    const iz = (0.4 * 0.2 ** 3) / 12;
    const k = kernLimits(a, iy, iz, 0, { zMax: 0.2, zMin: -0.2, yMax: 0.1, yMin: -0.1 })!;
    expect(Math.abs(k.z[0])).toBeCloseTo(0.4 / 6, 6);
    expect(Math.abs(k.y[0])).toBeCloseTo(0.2 / 6, 6);
  });

  it('declines when the geometric axes are not principal (iyz ≠ 0)', () => {
    // The σ = N/A(1 + e·c/r²) form assumes principal axes. An angle's product
    // of inertia is a substantial fraction of its inertias, and the formula's
    // limits are simply wrong there — null is the honest answer.
    const a = 0.2 * 0.4;
    const iy = (0.2 * 0.4 ** 3) / 12;
    const iz = (0.4 * 0.2 ** 3) / 12;
    const extremes = { zMax: 0.2, zMin: -0.2, yMax: 0.1, yMin: -0.1 };
    expect(kernLimits(a, iy, iz, 0.05 * Math.sqrt(iy * iz), extremes)).toBeNull();
    // Solver noise on a symmetric section must NOT trip the guard.
    expect(kernLimits(a, iy, iz, 1e-9 * Math.sqrt(iy * iz), extremes)).not.toBeNull();
  });

  it('refuses rather than dividing by zero on a degenerate section', () => {
    expect(kernLimits(0, 1, 1, 0, { zMax: 1, zMin: -1, yMax: 1, yMin: -1 })).toBeNull();
    expect(kernLimits(1, 1, 1, 0, { zMax: 0, zMin: 0, yMax: 0, yMin: 0 })).toBeNull();
  });
});

// ─── Tensors ───────────────────────────────────────────────────────

describe('the stress tensor', () => {
  const E = 200_000, NU = 0.3;

  it('pure tension is uniaxial: one principal value, two zeros', () => {
    const t = stressTensorState(100, 0, 0, E, NU);
    expect(t.principalStress.values[0]).toBeCloseTo(100, 6);
    expect(t.principalStress.values[1]).toBeCloseTo(0, 6);
    expect(t.principalStress.values[2]).toBeCloseTo(0, 6);
  });

  it('pure shear gives equal and opposite principals at 45°', () => {
    // The textbook case, and the one that shows why a shear failure looks like
    // a tension crack on a diagonal.
    const t = stressTensorState(0, 60, 0, E, NU);
    expect(t.principalStress.values[0]).toBeCloseTo(60, 6);
    expect(t.principalStress.values[2]).toBeCloseTo(-60, 6);
    expect(Math.abs(t.principalStress.angleDeg)).toBeCloseTo(45, 6);
  });

  it('the tensor is symmetric and carries the beam-theory zeros explicitly', () => {
    const t = stressTensorState(100, 40, 20, E, NU);
    const m = tensorRows(t.stress);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      expect(m[i][j]).toBeCloseTo(m[j][i], 12);
    }
    // The assumption, stated rather than implied.
    expect(t.stress.yy).toBe(0);
    expect(t.stress.zz).toBe(0);
    expect(t.stress.yz).toBe(0);
  });

  it('von Mises follows from J2, so the invariants and the criterion agree', () => {
    const sigma = 100, tau = 40;
    const t = stressTensorState(sigma, tau, 0, E, NU);
    expect(Math.sqrt(3 * t.invariants.j2)).toBeCloseTo(Math.sqrt(sigma ** 2 + 3 * tau ** 2), 6);
  });

  it('hydrostatic stress is a third of the trace', () => {
    const t = stressTensorState(90, 0, 0, E, NU);
    expect(t.invariants.hydrostatic).toBeCloseTo(30, 6);
  });
});

describe('the strain tensor', () => {
  const E = 200_000, NU = 0.3;

  it('axial strain is sigma/E', () => {
    const t = stressTensorState(200, 0, 0, E, NU);
    expect(t.strain.xx).toBeCloseTo(200 / E, 12);
  });

  it('a bar in tension gets THINNER — the Poisson contraction is not dropped', () => {
    // The component people forget. Without it the volumetric strain is wrong
    // and nu never appears anywhere the student can see it.
    const t = stressTensorState(200, 0, 0, E, NU);
    expect(t.strain.yy).toBeCloseTo((-NU * 200) / E, 12);
    expect(t.strain.zz).toBeCloseTo(t.strain.yy, 12);
    expect(t.strain.yy).toBeLessThan(0);
  });

  it('shear strain uses G, not E', () => {
    const t = stressTensorState(0, 60, 0, E, NU);
    const G = E / (2 * (1 + NU));
    // Tensor component is half the engineering shear strain.
    expect(t.strain.xy).toBeCloseTo(60 / G / 2, 12);
  });

  it('uniaxial tension gives principal strains {σ/E, −νσ/E, −νσ/E} — the contraction is principal too', () => {
    // The 2×2 reduction valid for stress is NOT valid for strain: the third
    // principal value is the Poisson contraction, not zero. A reduction that
    // dropped it would report a zero eigenvalue where the bar is actually
    // getting thinner, and a maxShear too small by the contraction.
    const sigma = 200;
    const t = stressTensorState(sigma, 0, 0, E, NU);
    expect(t.principalStrain.values[0]).toBeCloseTo(sigma / E, 12);
    expect(t.principalStrain.values[1]).toBeCloseTo((-NU * sigma) / E, 12);
    expect(t.principalStrain.values[2]).toBeCloseTo((-NU * sigma) / E, 12);
    expect(t.principalStrain.maxShear).toBeCloseTo(((1 + NU) * sigma) / E / 2, 12);
  });

  it('volumetric strain vanishes as nu approaches 1/2, which is incompressibility', () => {
    const compressible = stressTensorState(200, 0, 0, E, 0.3).volumetricStrain;
    const nearly = stressTensorState(200, 0, 0, E, 0.4999).volumetricStrain;
    expect(compressible).toBeGreaterThan(0);
    expect(Math.abs(nearly)).toBeLessThan(Math.abs(compressible) / 100);
  });
});

// ─── End to end ────────────────────────────────────────────────────

describe('an eccentric load through the real analysis', () => {
  function ipe300(): Section {
    const s = { id: 1, name: 'IPE 300', a: 53.8e-4, iy: 8356e-8, iz: 604e-8 } as Section;
    s.canonical = resolveSectionState(s, { torsion: true });
    return s;
  }

  it('an axial load off the centroid raises the stress on the side it moved to', () => {
    const sec = ipe300();
    const centred = resolveEccentric({ n: 500 });
    const offset = resolveEccentric({ n: 500, at: [0, 0.1] });
    const top = (f: ReturnType<typeof resolveEccentric>) =>
      canonicalStressState(sec, { n: f.forces.n, my: f.forces.my, mz: f.forces.mz }, [0, 0.15]);
    const a = top(centred), b = top(offset);
    if (!a.ok || !b.ok) throw new Error('expected ok');
    expect(b.state.sigma).toBeGreaterThan(a.state.sigma);
  });

  it('the tensors come back when elastic constants are given, and not otherwise', () => {
    const sec = ipe300();
    const without = canonicalStressState(sec, { n: 500, my: 30, mz: 0 }, [0, 0.15], 235);
    const with_ = canonicalStressState(sec, { n: 500, my: 30, mz: 0 }, [0, 0.15], 235, { elastic: { e: 200_000, nu: 0.3 } });
    if (!without.ok || !with_.ok) throw new Error('expected ok');
    expect(without.state.tensors).toBeUndefined();
    expect(with_.state.tensors).toBeDefined();
    // And they describe the same stress the panel already reports.
    expect(with_.state.tensors!.stress.xx).toBeCloseTo(with_.state.sigma, 9);
  });
});
