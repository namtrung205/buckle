/**
 * Education reaction grading — regression tests.
 *
 * These cover the defect where Education read `Reaction.ry` / `Reaction.mz`,
 * fields the WASM engine never serialises, and matched supports to reactions
 * by array position instead of node id.
 *
 * Expected values are produced by the real engine, then compared against the
 * analytical solution AND against the convention `ResultsTable` displays:
 *
 *   horizontal : reaction.rx
 *   vertical   : get2DDisplayReactionVertical(r)   — positive upward
 *   moment     : -get2DDisplayMoment(r)            — note the sign flip
 */

import { describe, it, expect } from 'vitest';
import { solve } from '../../../lib/engine/wasm-solver';
import type { SolverInput, AnalysisResults } from '../../../lib/engine/types';
import {
  readDisplayedReaction,
  readSupportReaction,
  resolveSupportNodeId,
} from '../edu-reactions';

// ─── Fixtures ──────────────────────────────────────────────────────

const MATERIAL = { id: 1, e: 210000, nu: 0.3 };
const SECTION = { id: 1, a: 0.08, iz: (0.2 * 0.4 ** 3) / 12 };

function build(
  nodes: Array<[number, number, number]>,
  elements: Array<[number, number, number]>,
  supports: Array<[number, number, string]>,
  loads: unknown[],
): SolverInput {
  return {
    nodes: new Map(nodes.map(([id, x, z]) => [id, { id, x, z }])),
    materials: new Map([[1, MATERIAL]]),
    sections: new Map([[1, SECTION]]),
    elements: new Map(
      elements.map(([id, i, j]) => [
        id,
        { id, type: 'frame', nodeI: i, nodeJ: j, materialId: 1, sectionId: 1 },
      ]),
    ),
    supports: new Map(supports.map(([id, nodeId, type]) => [id, { id, nodeId, type }])),
    loads,
  } as unknown as SolverInput;
}

const nodal = (nodeId: number, fx: number, fz: number, my = 0) => ({
  type: 'nodal',
  data: { nodeId, fx, fz, my },
});
const udl = (elementId: number, q: number) => ({
  type: 'distributed',
  data: { elementId, qI: q, qJ: q },
});

/** Cantilever, fixed at node 11, tip load P downward at node 12, span L. */
function cantilever(P = 10, L = 4): AnalysisResults {
  // Deliberately NOT 1..n: node ids must never be assumed to be array indices.
  return solve(
    build([[11, 0, 0], [12, L, 0]], [[1, 11, 12]], [[1, 11, 'fixed']], [nodal(12, 0, -P)]),
  );
}

/** Simply supported beam under UDL. Pinned at node 7, roller at node 3. */
function simplySupported(w = 5, L = 8): AnalysisResults {
  return solve(
    build(
      [[7, 0, 0], [3, L, 0]],
      [[1, 7, 3]],
      [[1, 7, 'pinned'], [2, 3, 'rollerX']],
      [udl(1, -w)],
    ),
  );
}

/** Portal frame, both bases fixed, horizontal load at the top-left node. */
function portalFrame(H = 8): AnalysisResults {
  return solve(
    build(
      [[1, 0, 0], [2, 0, 3], [3, 4, 3], [4, 4, 0]],
      [[1, 1, 2], [2, 2, 3], [3, 3, 4]],
      [[1, 1, 'fixed'], [2, 4, 'fixed']],
      [nodal(2, H, 0)],
    ),
  );
}

// ─── Node-id resolution ────────────────────────────────────────────

describe('resolveSupportNodeId', () => {
  it('maps an exercise nodeIndex through the built model ids', () => {
    expect(resolveSupportNodeId(0, [11, 12])).toBe(11);
    expect(resolveSupportNodeId(1, [11, 12])).toBe(12);
  });

  it('returns null for out-of-range or invalid indices', () => {
    expect(resolveSupportNodeId(2, [11, 12])).toBeNull();
    expect(resolveSupportNodeId(-1, [11, 12])).toBeNull();
    expect(resolveSupportNodeId(0.5, [11, 12])).toBeNull();
    expect(resolveSupportNodeId(0, [])).toBeNull();
  });
});

// ─── The migrated fields ───────────────────────────────────────────

describe('reaction field migration (regression)', () => {
  it('the engine emits rx/rz/my and NOT ry/mz for 2D reactions', () => {
    const r = cantilever().reactions[0] as unknown as Record<string, unknown>;
    expect(Object.keys(r).sort()).toEqual(['my', 'nodeId', 'rx', 'rz']);
    // The exact defect: these reads returned undefined on every solve.
    expect(r.ry).toBeUndefined();
    expect(r.mz).toBeUndefined();
  });

  it('the Education reader never depends on ry/mz', () => {
    const results = cantilever();
    // Strip the legacy names explicitly: reading them must change nothing.
    const stripped = {
      reactions: results.reactions.map((r) => ({
        nodeId: r.nodeId,
        rx: r.rx,
        rz: r.rz,
        my: r.my,
      })),
    } as unknown as AnalysisResults;

    for (const dof of ['Rx', 'Ry', 'M'] as const) {
      expect(readDisplayedReaction(stripped, 11, dof)).toBe(
        readDisplayedReaction(results, 11, dof),
      );
    }
  });
});

// ─── Grading values match the analytical answer and the displayed one ──

describe('readDisplayedReaction — values', () => {
  it('vertical reaction of a cantilever is +P (positive upward)', () => {
    const results = cantilever(10, 4);
    expect(readDisplayedReaction(results, 11, 'Ry')).toBeCloseTo(10, 6);
  });

  it('support moment matches the ResultsTable sign convention (-my)', () => {
    const results = cantilever(10, 4);
    const raw = results.reactions.find((r) => r.nodeId === 11)!;
    const displayed = readDisplayedReaction(results, 11, 'M')!;

    expect(Math.abs(displayed)).toBeCloseTo(40, 6); // |M| = P·L
    expect(displayed).toBeCloseTo(-raw.my, 12); // the flip ResultsTable applies
    expect(displayed).toBeCloseTo(-40, 6); // and its actual sign
  });

  it('horizontal reaction is read straight from rx', () => {
    const results = portalFrame(8);
    const sumRx = results.reactions.reduce((a, r) => a + r.rx, 0);
    expect(sumRx).toBeCloseTo(-8, 6); // equilibrium with the applied +8 kN

    expect(readDisplayedReaction(results, 1, 'Rx')).toBeCloseTo(
      results.reactions.find((r) => r.nodeId === 1)!.rx,
      12,
    );
  });

  it('simply supported beam under UDL gives wL/2 at both supports', () => {
    const results = simplySupported(5, 8);
    expect(readDisplayedReaction(results, 7, 'Ry')).toBeCloseTo(20, 6);
    expect(readDisplayedReaction(results, 3, 'Ry')).toBeCloseTo(20, 6);
  });

  it('returns null rather than a fabricated value when it cannot read', () => {
    const results = cantilever();
    expect(readDisplayedReaction(results, 999, 'Ry')).toBeNull(); // no such node
    expect(readDisplayedReaction(null, 11, 'Ry')).toBeNull();
    expect(readDisplayedReaction(results, null, 'Ry')).toBeNull();
    expect(readDisplayedReaction(results, 11, 'Nope' as never)).toBeNull();
  });
});

// ─── Support ordering ──────────────────────────────────────────────

describe('supports declared in a non-trivial order', () => {
  it('grades each support against its own node, not its array position', () => {
    const results = portalFrame(8);
    // Exercise declares the RIGHT base first; the engine returns node 1 first.
    const nodeIdsByIndex = [1, 2, 3, 4];
    const supports = [
      { label: 'B (right)', nodeIndex: 3 },
      { label: 'A (left)', nodeIndex: 0 },
    ];

    const right = readSupportReaction(results, supports[0].nodeIndex, nodeIdsByIndex, 'Ry')!;
    const left = readSupportReaction(results, supports[1].nodeIndex, nodeIdsByIndex, 'Ry')!;

    expect(left).toBeCloseTo(results.reactions.find((r) => r.nodeId === 1)!.rz, 12);
    expect(right).toBeCloseTo(results.reactions.find((r) => r.nodeId === 4)!.rz, 12);

    // The frame is antisymmetric under this load: swapping them would be
    // silently plausible, which is exactly why positional matching was unsafe.
    expect(left).toBeCloseTo(-right, 6);
    expect(left).not.toBeCloseTo(right, 3);
  });

  it('resolves ids that do not coincide with array positions', () => {
    const results = simplySupported(5, 8);
    const nodeIdsByIndex = [7, 3]; // exercise order: node 7 first, then node 3
    expect(readSupportReaction(results, 0, nodeIdsByIndex, 'Ry')).toBeCloseTo(20, 6);
    expect(readSupportReaction(results, 1, nodeIdsByIndex, 'Ry')).toBeCloseTo(20, 6);
  });
});

// ─── Grading + reveal behaviour ────────────────────────────────────

/** The tolerance rule `EduExerciseView` applies (unchanged by this checkpoint). */
const TOLERANCE = 0.05;
function grades(student: number, correct: number): boolean {
  const abs = Math.abs(correct);
  const tol = abs > 0.01 ? abs * TOLERANCE : 0.1;
  return Math.abs(student - correct) <= tol;
}

describe('grading outcomes', () => {
  it('accepts the correct vertical reaction and moment', () => {
    const results = cantilever(10, 4);
    expect(grades(10, readDisplayedReaction(results, 11, 'Ry')!)).toBe(true);
    expect(grades(-40, readDisplayedReaction(results, 11, 'M')!)).toBe(true);
  });

  it('rejects a sign error', () => {
    const results = cantilever(10, 4);
    expect(grades(-10, readDisplayedReaction(results, 11, 'Ry')!)).toBe(false);
    expect(grades(+40, readDisplayedReaction(results, 11, 'M')!)).toBe(false);
  });

  it('rejects a magnitude error', () => {
    const results = cantilever(10, 4);
    expect(grades(12, readDisplayedReaction(results, 11, 'Ry')!)).toBe(false);
    expect(grades(-30, readDisplayedReaction(results, 11, 'M')!)).toBe(false);
  });

  it('reveal produces a finite value the grader then accepts', () => {
    const results = cantilever(10, 4);
    for (const dof of ['Rx', 'Ry', 'M'] as const) {
      const value = readDisplayedReaction(results, 11, dof);
      expect(value).not.toBeNull();
      expect(Number.isFinite(value!)).toBe(true);
      // The reveal path formats with toFixed(2) — it must not throw, and the
      // value it writes back must grade as correct.
      const shown = value!.toFixed(2);
      expect(() => value!.toFixed(2)).not.toThrow();
      expect(grades(parseFloat(shown), value!)).toBe(true);
    }
  });
});
