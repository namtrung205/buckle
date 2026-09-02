/**
 * Marking a drawn diagram.
 *
 * The two verdicts are deliberately independent, and the tests keep them that
 * way: a student can draw the right picture and label a parabola "linear"
 * (a real, common mistake that must be caught), or choose every power
 * correctly and put the peak in the wrong place.
 *
 * The degree detector is the part that has to be trusted, because it is what
 * decides whether the student's "quadratic" was right. It reads the sampled
 * VALUES rather than the load that produced them, so it is tested against
 * curves built by hand at each degree, at large and small amplitudes.
 */
import { describe, it, expect } from 'vitest';
import {
  emptySketch, sketchValueAt, degreeOfSamples, degreeOfSpan, gradeSketch,
  CURVE_TOLERANCE, type Sketch,
} from '../diagram-sketch';

/** `f` sampled at `n` evenly spaced stations over 0..1. */
function samples(f: (t: number) => number, n = 41): number[] {
  return Array.from({ length: n }, (_, i) => f(i / (n - 1)));
}

describe('the degree of a sampled curve', () => {
  it('reads flat zero as nothing at all', () => {
    expect(degreeOfSamples(samples(() => 0))).toBe('zero');
  });

  it('reads a flat non-zero line as constant, at any amplitude', () => {
    expect(degreeOfSamples(samples(() => 12))).toBe('constant');
    expect(degreeOfSamples(samples(() => -0.004))).toBe('constant');
  });

  it('reads a straight line as linear — shear under a uniform load', () => {
    expect(degreeOfSamples(samples(t => 20 - 40 * t))).toBe('linear');
  });

  it('reads a parabola as quadratic — moment under a uniform load', () => {
    // M(x) = qL²/8 · 4t(1−t), the simply supported case.
    expect(degreeOfSamples(samples(t => 40 * 4 * t * (1 - t)))).toBe('quadratic');
  });

  it('reads a cubic as cubic — moment under a triangular load', () => {
    expect(degreeOfSamples(samples(t => 10 * (t - 3 * t ** 3)))).toBe('cubic');
  });

  it('classifies by shape, not by size', () => {
    const big = samples(t => 4000 * 4 * t * (1 - t));
    const small = samples(t => 0.004 * 4 * t * (1 - t));
    expect(degreeOfSamples(big)).toBe('quadratic');
    expect(degreeOfSamples(small)).toBe('quadratic');
  });
});

describe('the drawn function', () => {
  it('holds the first ordinate before the sketch starts and the last after it', () => {
    const s: Sketch = { points: [{ t: 0.25, value: 5 }, { t: 0.75, value: 9 }], powers: ['linear'] };
    expect(sketchValueAt(s, 0)).toBe(5);
    expect(sketchValueAt(s, 1)).toBe(9);
  });

  it('interpolates each span with the power that was chosen', () => {
    const s: Sketch = { points: [{ t: 0, value: 0 }, { t: 1, value: 8 }], powers: ['linear'] };
    expect(sketchValueAt(s, 0.5)).toBeCloseTo(4, 6);

    const q: Sketch = { points: [{ t: 0, value: 0 }, { t: 1, value: 8 }], powers: ['quadratic'] };
    expect(sketchValueAt(q, 0.5)).toBeCloseTo(2, 6);

    const c: Sketch = { points: [{ t: 0, value: 0 }, { t: 1, value: 8 }], powers: ['cubic'] };
    expect(sketchValueAt(c, 0.5)).toBeCloseTo(1, 6);
  });

  it('a constant span ignores the far ordinate, and a zero span is zero', () => {
    const k: Sketch = { points: [{ t: 0, value: 7 }, { t: 1, value: 99 }], powers: ['constant'] };
    expect(sketchValueAt(k, 0.5)).toBe(7);
    const z: Sketch = { points: [{ t: 0, value: 7 }, { t: 1, value: 99 }], powers: ['zero'] };
    expect(sketchValueAt(z, 0.5)).toBe(0);
  });
});

describe('marking a sketch', () => {
  // Shear on a simply supported beam under a uniform load: +qL/2 to −qL/2.
  const shear = samples(t => 20 - 40 * t);

  it('accepts a drawing that is right in shape and in value', () => {
    const s: Sketch = { points: [{ t: 0, value: 20 }, { t: 1, value: -20 }], powers: ['linear'] };
    const v = gradeSketch(s, shear);
    expect(v.curveOk).toBe(true);
    expect(v.powersOk).toBe(true);
    expect(v.curveError).toBeLessThan(1e-6);
  });

  it('separates the two mistakes: a right picture with the wrong power named', () => {
    const s: Sketch = { points: [{ t: 0, value: 20 }, { t: 1, value: -20 }], powers: ['quadratic'] };
    const v = gradeSketch(s, shear);
    // The curve a quadratic draws between those ordinates is NOT the line, so
    // this fails on both counts — which is the honest answer.
    expect(v.powersOk).toBe(false);
    expect(v.powers[0]).toMatchObject({ chose: 'quadratic', correct: 'linear', ok: false });
  });

  it('catches a diagram drawn upside down', () => {
    const s: Sketch = { points: [{ t: 0, value: -20 }, { t: 1, value: 20 }], powers: ['linear'] };
    expect(gradeSketch(s, shear).curveOk).toBe(false);
  });

  it('tolerates a small error in the ordinates', () => {
    const s: Sketch = { points: [{ t: 0, value: 21 }, { t: 1, value: -19 }], powers: ['linear'] };
    const v = gradeSketch(s, shear);
    expect(v.curveOk).toBe(true);
    expect(v.curveError).toBeLessThan(CURVE_TOLERANCE);
  });

  it('marks a parabola drawn in two spans about its peak', () => {
    const moment = samples(t => 40 * 4 * t * (1 - t));
    // The flat end of each half is midspan — where the shear crosses zero.
    const s: Sketch = {
      points: [{ t: 0, value: 0 }, { t: 0.5, value: 40 }, { t: 1, value: 0 }],
      powers: ['quadratic', 'quadratic'],
      vertices: ['end', 'start'],
    };
    const v = gradeSketch(s, moment);
    expect(v.powersOk).toBe(true);
    expect(v.curveOk).toBe(true);
  });

  it('rejects the same parabola drawn the wrong way round', () => {
    // Right ordinates, right power, flat end at the SUPPORTS instead of at
    // midspan: the picture of a fixed-end beam, not a simply supported one.
    const moment = samples(t => 40 * 4 * t * (1 - t));
    const s: Sketch = {
      points: [{ t: 0, value: 0 }, { t: 0.5, value: 40 }, { t: 1, value: 0 }],
      powers: ['quadratic', 'quadratic'],
      vertices: ['start', 'end'],
    };
    const v = gradeSketch(s, moment);
    expect(v.powersOk, 'the powers themselves are right').toBe(true);
    expect(v.curveOk, 'but it is not that diagram').toBe(false);
  });

  it('a flat-zero diagram is answered by drawing nothing, and only by that', () => {
    const zero = samples(() => 0);
    const drawn = gradeSketch(emptySketch(), zero);
    expect(drawn.trueIsZero).toBe(true);
    expect(drawn.curveOk).toBe(true);
    expect(drawn.powers[0].correct).toBe('zero');

    const invented: Sketch = { points: [{ t: 0, value: 0 }, { t: 1, value: 5 }], powers: ['linear'] };
    expect(gradeSketch(invented, zero).curveOk).toBe(false);
  });
});

describe('the degree of one span of a diagram', () => {
  it('reads each half of a two-slope shear diagram separately', () => {
    // A point load at midspan: shear is constant either side, moment linear.
    const shear = samples(t => (t < 0.5 ? 7.5 : -7.5));
    expect(degreeOfSpan(shear, 0, 0.45)).toBe('constant');
    expect(degreeOfSpan(shear, 0.55, 1)).toBe('constant');
  });

  it('a span too short to have a shape is reported as a line, not as a guess', () => {
    const anything = samples(t => t, 41);
    expect(degreeOfSpan(anything, 0.5, 0.51)).toBe('linear');
  });
});

/**
 * The sign a student is marked against.
 *
 * The engine carries moments hogging-positive: the sagging moment at the
 * middle of a simply supported beam is negative in its output, and the canvas
 * relies on that to plot it on the tension side. A student writes the same
 * moment as +40 kN·m, because that is what the subject calls it — so the edu
 * layer turns the sign once, at the only point where a diagram value meets
 * something a person wrote.
 *
 * This is the test that stops it being turned back, or turned twice.
 */
describe('the convention a diagram value is shown in', () => {
  // 8 m simply supported beam, q = 5 kN/m down: V(0) = +20, engine M is
  // hogging-positive so mid-span comes out negative.
  const beam = {
    elementId: 1,
    nStart: 0, nEnd: 0,
    vStart: 20, vEnd: -20,
    mStart: 0, mEnd: 0,
    length: 8,
    qI: -5, qJ: -5,
    pointLoads: [],
    distributedLoads: [{ qI: -5, qJ: -5, a: 0, b: 8 }],
    hingeStart: false, hingeEnd: false,
  };

  it('reports a sagging moment as positive, whatever the engine calls it', async () => {
    const { computeDiagramValueAt } = await import('../../../lib/engine/diagrams');
    const { diagramValueAsShown } = await import('../exercise-spec');

    const raw = computeDiagramValueAt('moment', 0.5, beam as never);
    const shown = diagramValueAsShown('moment', 0.5, beam as never);

    expect(raw, 'the engine is hogging-positive').toBeLessThan(0);
    expect(shown, 'the student writes it sagging-positive').toBeGreaterThan(0);
    expect(shown).toBeCloseTo(40, 6);
    expect(shown).toBeCloseTo(-raw, 9);
  });

  it('leaves shear and axial exactly as the engine reports them', async () => {
    const { computeDiagramValueAt } = await import('../../../lib/engine/diagrams');
    const { diagramValueAsShown } = await import('../exercise-spec');

    for (const force of ['shear', 'axial'] as const) {
      expect(diagramValueAsShown(force, 0.25, beam as never))
        .toBe(computeDiagramValueAt(force, 0.25, beam as never));
    }
  });
});
