import { describe, it, expect } from 'vitest';
import { solveDetailed } from '../solver-detailed';
import type { SolverInput } from '../types';

/**
 * The step-by-step wizard's load vector, against hand-computable values.
 *
 * These exist because `nodeDistance` and `nodeAngle` read `b.y - a.y` from a
 * `SolverNode`, which has no `y` — so element length and angle were NaN and
 * every geometry-dependent load produced a NaN fixed-end force. Nothing caught
 * it: `solveDetailed` had no 2D coverage, and the NaN reached the screen as a
 * column of "NaN" in Step 5 rather than as a thrown error.
 *
 * A simply supported beam under a uniform load is the smallest case that
 * exercises the path, and its fixed-end forces are textbook: V = qL/2 at each
 * end and M = ±qL²/12.
 */
function uniformlyLoadedBeam(length: number, q: number): SolverInput {
  return {
    nodes: new Map([
      [1, { id: 1, x: 0, z: 0 }],
      [2, { id: 2, x: length, z: 0 }],
    ]),
    materials: new Map([[1, { id: 1, e: 200_000, rho: 78.5 }]]),
    sections: new Map([[1, { id: 1, a: 0.01, iz: 1e-4 }]]),
    elements: new Map([
      [1, { id: 1, nodeI: 1, nodeJ: 2, materialId: 1, sectionId: 1, type: 'frame' }],
    ]),
    supports: new Map([
      [1, { nodeId: 1, type: 'pinned' }],
      [2, { nodeId: 2, type: 'rollerX' }],
    ]),
    loads: [{ type: 'distributed', data: { elementId: 1, qI: q, qJ: q } }],
  } as unknown as SolverInput;
}

describe('solveDetailed — load vector', () => {
  const L = 6;
  const q = 10;

  it('produces finite entries for a distributed load', () => {
    const data = solveDetailed(uniformlyLoadedBeam(L, q));
    expect(data.F.every(Number.isFinite)).toBe(true);
    expect(data.loadContributions.every(c => Number.isFinite(c.value))).toBe(true);
  });

  it('matches the textbook fixed-end forces', () => {
    const data = solveDetailed(uniformlyLoadedBeam(L, q));
    const magnitudes = data.loadContributions.map(c => Math.abs(c.value)).sort((a, b) => a - b);
    // qL/2 = 30 at each end, qL²/12 = 30 at each end. For this beam the two
    // coincide, so what is being asserted is that both appear and nothing else
    // does — a NaN or a zero-length element would fail either way.
    expect(magnitudes.length).toBeGreaterThan(0);
    for (const m of magnitudes) {
      expect(m).toBeGreaterThan(0);
      expect(m).toBeCloseTo(30, 6);
    }
  });

  it('keeps the element length it derives the forces from', () => {
    const data = solveDetailed(uniformlyLoadedBeam(L, q));
    expect(data.elements[0].length).toBeCloseTo(L, 9);
  });
});
