/**
 * diagram-sketch.ts — the student draws the diagram, and it gets marked.
 *
 * # Why this is not a multiple choice
 *
 * The mode already asked "what shape is the shear diagram?" and offered four
 * words. That checks recognition. Drawing it checks the thing the course is
 * actually about: where the diagram jumps, where it changes slope, which way
 * it goes, and — the part students get wrong for years — that the DEGREE of
 * each piece is set by the load on it. A point load makes shear constant and
 * moment linear; a uniform load makes shear linear and moment quadratic; a
 * triangular load pushes each up one more.
 *
 * So a sketch here is a piecewise function over the member: ordinates the
 * student places, and a POWER for the curve between each pair.
 *
 * # How it is marked
 *
 * Two separate verdicts, because they are two separate mistakes:
 *
 *   - the CURVE: the drawn function sampled against the real one, normalised
 *     by the true peak so a 200 kN·m diagram and a 2 kN·m one are marked to
 *     the same standard, with an RMS tolerance.
 *   - the POWERS: per segment, the degree the student chose against the degree
 *     the real diagram has there, found by finite differences rather than by
 *     asking the solver what kind of load it had. A student who draws the
 *     right picture with "linear" written under a parabola has made a real
 *     mistake and is told which one it is.
 *
 * Nothing here touches the solver: it consumes sampled values.
 */

/** Powers a span of a diagram can have, in the order a course meets them. */
export type SketchPower = 'zero' | 'constant' | 'linear' | 'quadratic' | 'cubic';

export const SKETCH_POWERS: SketchPower[] = ['zero', 'constant', 'linear', 'quadratic', 'cubic'];

/**
 * One ordinate the student placed: a position along the member (0..1) and the
 * value they think the diagram has there.
 */
export interface SketchPoint {
  /** Position along the member, 0 at the start node and 1 at the end. */
  t: number;
  value: number;
}

/**
 * Which end of a curved span is the flat one.
 *
 * A parabola between two ordinates can be drawn two ways round, and they are
 * different diagrams: the moment on a simply supported beam leaves the support
 * steeply and arrives flat at midspan, while the same two ordinates with the
 * flat end at the support is the picture of a cantilever. The flat end is
 * where the slope is zero — where the shear crosses zero — so choosing it is
 * the same act as reading the shear diagram, which is exactly the connection
 * the question is there to teach.
 */
export type SketchVertex = 'start' | 'end';

/** A drawn diagram: n ordinates and the n−1 spans between them. */
export interface Sketch {
  points: SketchPoint[];
  /** `powers[i]` describes the span from `points[i]` to `points[i + 1]`. */
  powers: SketchPower[];
  /** `vertices[i]` says which end of span `i` is flat. Absent means 'start',
   *  which is what a straight or constant span reduces to anyway. */
  vertices?: SketchVertex[];
}

/** An empty sketch over a member: a flat line the student then shapes. */
export function emptySketch(): Sketch {
  return { points: [{ t: 0, value: 0 }, { t: 1, value: 0 }], powers: ['constant'], vertices: ['start'] };
}

/**
 * The drawn function at `t`.
 *
 * Within a span the curve runs from one ordinate to the next with the chosen
 * power: `v0 + (v1 - v0) * u^n`. That is the shape a diagram of that degree
 * has when one end is its stationary point, which is the case a student is
 * drawing when they say "this bit is quadratic" — a parabola through a support
 * and a peak. It is not general enough to express every cubic, and it is not
 * meant to be: the question is the shape of the piece, not its coefficients.
 */
export function sketchValueAt(sketch: Sketch, t: number): number {
  const pts = sketch.points;
  if (pts.length === 0) return 0;
  if (t <= pts[0].t) return pts[0].value;
  if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].value;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (t < a.t || t > b.t) continue;
    const power = sketch.powers[i] ?? 'linear';
    if (power === 'zero') return 0;
    if (power === 'constant') return a.value;
    const span = b.t - a.t;
    const u = span > 1e-9 ? (t - a.t) / span : 0;
    const n = power === 'linear' ? 1 : power === 'quadratic' ? 2 : 3;
    if (n === 1) return a.value + (b.value - a.value) * u;
    // `start` leaves the first ordinate flat and steepens; `end` arrives flat
    // at the second. Same two ordinates, two different diagrams.
    const vertex = sketch.vertices?.[i] ?? 'start';
    const shape = vertex === 'start' ? Math.pow(u, n) : 1 - Math.pow(1 - u, n);
    return a.value + (b.value - a.value) * shape;
  }
  return pts[pts.length - 1].value;
}

/**
 * The degree of a sampled curve, by finite differences.
 *
 * A diagram that is flat at zero is `zero`; flat at anything else is
 * `constant`; one whose second difference vanishes is `linear`, and so on. The
 * threshold is relative to the curve's own amplitude, so a 400 kN·m parabola
 * and a 0.4 kN·m one are classified the same way.
 *
 * Returning a degree from the VALUES rather than from the load that produced
 * them keeps this honest for cases the load type would get wrong — a span with
 * no load between two point loads is constant in shear whatever is happening
 * elsewhere on the beam.
 */
export function degreeOfSamples(values: number[]): SketchPower {
  const amp = Math.max(...values.map(Math.abs), 0);
  if (values.length === 0 || amp < 1e-9) return 'zero';

  /* A run of numbers is "flat" when it varies little COMPARED WITH ITSELF, so
     the test means the same thing at every order of difference — the second
     difference of a 400 kN·m parabola is a few units, and judging it against
     the diagram's own amplitude would call every curve constant. */
  const flat = (v: number[]): boolean => {
    const a = Math.max(...v.map(Math.abs));
    if (a < amp * 1e-9) return true;            // identically zero
    return (Math.max(...v) - Math.min(...v)) <= a * 0.06;
  };

  const names: SketchPower[] = ['constant', 'linear', 'quadratic', 'cubic'];
  let d = values;
  for (let order = 0; order < names.length; order++) {
    if (flat(d)) return names[order];
    if (d.length < 3) break;
    const next: number[] = [];
    for (let i = 1; i < d.length; i++) next.push(d[i] - d[i - 1]);
    d = next;
  }
  return 'cubic';
}

export interface SketchVerdict {
  /** The drawn curve is close enough to the real one. */
  curveOk: boolean;
  /** Every span carries the power the real diagram has there. */
  powersOk: boolean;
  /** RMS error of the drawing, as a fraction of the true peak. */
  curveError: number;
  /** Per span: what the student chose and what it should have been. */
  powers: Array<{ chose: SketchPower; correct: SketchPower; ok: boolean }>;
  /** True when the real diagram is flat zero — nothing to draw, and saying so
   *  IS the answer. */
  trueIsZero: boolean;
  /**
   * Where the drawing is furthest from the real diagram, and on which side.
   *
   * "Wrong" on its own sends a student back to stare at the whole picture.
   * The station of the worst error and whether they drew above or below it
   * there is the difference between a verdict and a correction.
   */
  worst: { t: number; side: 'above' | 'below' } | null;
}

/** How far the drawing may sit from the real diagram, as a fraction of its peak. */
export const CURVE_TOLERANCE = 0.12;

/**
 * Mark a sketch against the real diagram, sampled at evenly spaced stations.
 *
 * `trueSamples[i]` is the diagram at `t = i / (trueSamples.length - 1)`.
 */
export function gradeSketch(sketch: Sketch, trueSamples: number[]): SketchVerdict {
  const n = trueSamples.length;
  const peak = Math.max(...trueSamples.map(Math.abs), 0);
  const trueIsZero = peak < 1e-9;

  // A flat-zero diagram is marked on the drawing alone: any power the student
  // picks over a line of zeros is defensible, and 'zero' is what they should
  // reach for, so it is the only one accepted.
  let sq = 0;
  let worst: { t: number; side: 'above' | 'below' } | null = null;
  let worstAbs = 0;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const d = sketchValueAt(sketch, t) - trueSamples[i];
    sq += d * d;
    if (Math.abs(d) > worstAbs) {
      worstAbs = Math.abs(d);
      worst = { t, side: d > 0 ? 'above' : 'below' };
    }
  }
  const rms = n > 0 ? Math.sqrt(sq / n) : 0;
  const curveError = trueIsZero ? rms : rms / peak;
  const curveOk = trueIsZero ? rms < 1e-6 : curveError <= CURVE_TOLERANCE;

  const powers = sketch.powers.map((chose, i) => {
    const a = sketch.points[i], b = sketch.points[i + 1];
    if (!a || !b) return { chose, correct: chose, ok: true };
    const correct = trueIsZero ? 'zero' as SketchPower : degreeOfSpan(trueSamples, a.t, b.t);
    return { chose, correct, ok: chose === correct };
  });

  return {
    curveOk,
    powersOk: powers.every(p => p.ok),
    curveError,
    powers,
    trueIsZero,
    worst: curveOk ? null : worst,
  };
}

/** The degree the real diagram has between two positions along the member. */
export function degreeOfSpan(trueSamples: number[], t0: number, t1: number): SketchPower {
  const n = trueSamples.length;
  if (n < 2) return 'zero';
  const lo = Math.max(0, Math.floor(Math.min(t0, t1) * (n - 1)));
  const hi = Math.min(n - 1, Math.ceil(Math.max(t0, t1) * (n - 1)));
  // A span needs at least a handful of stations before differences mean
  // anything; a two-sample window is a straight line by construction.
  const slice = trueSamples.slice(lo, hi + 1);
  if (slice.length < 4) return slice.every(v => Math.abs(v) < 1e-9) ? 'zero' : 'linear';
  return degreeOfSamples(slice);
}
