/**
 * Stress questions over a real section.
 *
 * This is what the section work bought the teaching mode. A student can be
 * asked for a von Mises stress on an actual IPE 300 and marked by the same
 * solver the professional mode uses — which no other teaching tool does well,
 * because most of them have no section engine behind the diagrams.
 *
 * The failure that matters here is a fabricated answer: a question the app
 * cannot really evaluate must come back null so validation refuses the
 * exercise, never a plausible number a class gets marked against.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { stressContext, sectionFromProfile } from '../exercise-stress';
import { evaluateAnswer, lintExercise, type EduExerciseSpec } from '../exercise-spec';
import { getExerciseSpecs } from '../exercise-data';
import { initSolver } from '../../../lib/engine/wasm-solver';
import type { ElementForces } from '../../../lib/engine/types';

beforeAll(async () => { await initSolver(); });

/**
 * A cantilever's forces: 12 kN at the tip of a 4 m member, fixed at the start.
 *
 * The signs matter and are not free to invent. The diagram is reconstructed
 * from EQUILIBRIUM rather than interpolated between the end values, so an
 * inconsistent triple silently describes a different structure: with
 * `mStart = -48` and `vStart = +12` the moment at the tip comes out at 96 kN·m
 * instead of zero, and a test written around it would be asserting nonsense.
 * `vStart = -12` is the shear that carries -48 kN·m down to zero over 4 m.
 */
const forces = (): ElementForces[] => [{
  elementId: 1,
  nStart: 0, nEnd: 0,
  vStart: -12, vEnd: -12,
  mStart: -48, mEnd: 0,
  length: 4, qI: 0, qJ: 0,
  pointLoads: [], distributedLoads: [],
} as never];

describe('a stress question is answered over the real profile', () => {
  it('resolves a catalogue profile to geometry-backed section', () => {
    const sec = sectionFromProfile('IPE 300');
    expect(sec).not.toBeNull();
    expect(sec!.canonical?.kind).toBe('geometry-backed');
  });

  it('sigma at the fixed end matches M c / I by hand', () => {
    // IPE 300: I = 8356 cm⁴, c = 0.15 m. 48 kN·m gives 48*0.15/8.356e-5 Pa
    // = 86.2 MPa.
    const ctx = stressContext('IPE 300', 235);
    const v = evaluateAnswer({ kind: 'stress', measure: 'sigmaMax', element: 0, t: 0 }, forces(), ctx);
    expect(v).not.toBeNull();
    expect(Math.abs(v!)).toBeGreaterThan(75);
    expect(Math.abs(v!)).toBeLessThan(95);
  });

  it('sigma falls to zero at the free end, where the moment does', () => {
    const ctx = stressContext('IPE 300');
    const tip = evaluateAnswer({ kind: 'stress', measure: 'sigmaMax', element: 0, t: 1 }, forces(), ctx)!;
    expect(Math.abs(tip)).toBeLessThan(1);
  });

  it('the top and bottom fibres carry opposite signs', () => {
    const ctx = stressContext('IPE 300');
    const top = evaluateAnswer({ kind: 'stress', measure: 'sigmaMax', element: 0, t: 0 }, forces(), ctx)!;
    const bot = evaluateAnswer({ kind: 'stress', measure: 'sigmaMin', element: 0, t: 0 }, forces(), ctx)!;
    expect(Math.sign(top)).toBe(-Math.sign(bot));
    expect(Math.abs(top)).toBeCloseTo(Math.abs(bot), 3);
  });

  it('von Mises collapses to |sigma| where the shear is zero', () => {
    // At the extreme fibre of a bending member there is no shear, so von Mises
    // must equal the normal stress — a check that the two are being combined
    // rather than added blindly.
    const ctx = stressContext('IPE 300');
    const s = evaluateAnswer({ kind: 'stress', measure: 'sigmaMax', element: 0, t: 0 }, forces(), ctx)!;
    const vm = evaluateAnswer({ kind: 'stress', measure: 'vonMises', element: 0, t: 0 }, forces(), ctx)!;
    expect(vm).toBeCloseTo(Math.abs(s), 1);
  });

  it('tau at the neutral axis is real and far below the bending stress', () => {
    const ctx = stressContext('IPE 300');
    const tau = evaluateAnswer({ kind: 'stress', measure: 'tauMax', element: 0, t: 0 }, forces(), ctx)!;
    expect(tau).toBeGreaterThan(0);
    // 12 kN over an IPE 300 web is single-digit MPa; the bending stress is 86.
    expect(tau).toBeLessThan(30);
  });
});

describe('an unanswerable stress question fails loudly, never quietly', () => {
  it('no profile means no resolver, and the answer is null rather than zero', () => {
    // Zero would read as "no stress here", which is a different claim entirely.
    const v = evaluateAnswer({ kind: 'stress', measure: 'sigmaMax', element: 0, t: 0 }, forces(), stressContext(undefined));
    expect(v).toBeNull();
  });

  it('an unknown profile name yields no resolver', () => {
    const v = evaluateAnswer({ kind: 'stress', measure: 'sigmaMax', element: 0, t: 0 }, forces(), stressContext('IPE 999'));
    expect(v).toBeNull();
  });

  it('validation refuses an exercise that asks about stress with no profile', () => {
    // The authoring panel disables the option, but an imported or hand-edited
    // file can still contain it, and that must not reach a student.
    const base = getExerciseSpecs()[0];
    const bad: EduExerciseSpec = {
      ...base,
      model: { ...base.model, profile: undefined },
      characteristics: [{ label: 'σmax', unit: 'MPa', answer: { kind: 'stress', measure: 'sigmaMax', element: 0, t: 0 } }],
    };
    expect(lintExercise(bad).join(' ')).toMatch(/declares no section profile/);
  });

  it('accepts the same exercise once a profile is declared', () => {
    const base = getExerciseSpecs()[0];
    const good: EduExerciseSpec = {
      ...base,
      model: { ...base.model, profile: 'IPE 300', fy: 235 },
      characteristics: [{ label: 'σmax', unit: 'MPa', answer: { kind: 'stress', measure: 'sigmaMax', element: 0, t: 0 } }],
    };
    expect(lintExercise(good)).toEqual([]);
  });
});
