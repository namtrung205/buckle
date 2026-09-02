/**
 * 2D kinematic boundary normalization — regression tests.
 *
 * Two student-facing defects:
 *
 * 1. AXIS VOCABULARY. The engine reports 2D DOFs in the pre-WASM Y-up
 *    vocabulary (`uy` vertical, `rz` bending rotation), while every table and
 *    diagram in the app is Z-up (`uz`, `ry`). A mechanism diagnosis therefore
 *    told a student "the Y displacement is unrestrained" and sent them looking
 *    for a column that does not exist. The declared TypeScript type already
 *    said `'ux' | 'uz' | 'ry'` — the runtime simply did not match it.
 *
 * 2. FALLBACK SOLVABILITY. When the rank analysis was unavailable the fallback
 *    returned `isSolvable: degree >= 0`. The counting degree cannot see WHERE
 *    restraints are, so all-roller supports, collinear restraints and hidden
 *    mechanisms all reach `degree >= 0` while `Kff` is singular — they passed
 *    the solve gate as if verified.
 *
 * The kinematic mathematics itself is untouched; these tests also pin that.
 */

import { describe, it, expect, vi } from 'vitest';
import type { SolverInput } from '../types';
import * as wasmSolver from '../wasm-solver';
import {
  analyzeKinematics,
  computeStaticDegree,
  normalizeKinematicResult,
  normalizeDiagnosisAxes,
} from '../kinematic-2d';

// ─── Fixtures ──────────────────────────────────────────────────────

function build(
  nodes: Array<[number, number, number]>,
  elements: Array<[number, number, number]>,
  supports: Array<[number, number, string]>,
  loads: unknown[] = [],
): SolverInput {
  return {
    nodes: new Map(nodes.map(([id, x, z]) => [id, { id, x, z }])),
    materials: new Map([[1, { id: 1, e: 210000, nu: 0.3 }]]),
    sections: new Map([[1, { id: 1, a: 0.08, iz: 1.0667e-3 }]]),
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

const beam = (supports: Array<[number, number, string]>) =>
  build([[1, 0, 0], [2, 8, 0]], [[1, 1, 2]], supports, [
    { type: 'distributed', data: { elementId: 1, qI: -5, qJ: -5 } },
  ]);

// ─── DOF code normalization ────────────────────────────────────────

const rawResult = (dofs: Array<{ nodeId: number; dof: string }>, diagnosis = '') => ({
  degree: -1,
  classification: 'hypostatic' as const,
  mechanismModes: dofs.length,
  mechanismNodes: dofs.map((d) => d.nodeId),
  unconstrainedDofs: dofs,
  diagnosis,
  isSolvable: false,
});

describe('DOF code normalization', () => {
  it('maps the engine vertical `uy` to the application `uz`', () => {
    const out = normalizeKinematicResult(rawResult([{ nodeId: 2, dof: 'uy' }]));
    expect(out.unconstrainedDofs).toEqual([{ nodeId: 2, dof: 'uz' }]);
  });

  it('maps the engine bending rotation `rz` to the application `ry`', () => {
    const out = normalizeKinematicResult(rawResult([{ nodeId: 3, dof: 'rz' }]));
    expect(out.unconstrainedDofs).toEqual([{ nodeId: 3, dof: 'ry' }]);
  });

  it('leaves `ux` alone and is idempotent on already-normalized codes', () => {
    const out = normalizeKinematicResult(
      rawResult([
        { nodeId: 1, dof: 'ux' },
        { nodeId: 1, dof: 'uz' },
        { nodeId: 1, dof: 'ry' },
      ]),
    );
    expect(out.unconstrainedDofs).toEqual([
      { nodeId: 1, dof: 'ux' },
      { nodeId: 1, dof: 'uz' },
      { nodeId: 1, dof: 'ry' },
    ]);
    expect(out.unmappedDofs).toEqual([]);
  });

  it('surfaces unrecognised DOF codes instead of silently dropping them', () => {
    const out = normalizeKinematicResult(
      rawResult([
        { nodeId: 1, dof: 'uy' },
        { nodeId: 1, dof: 'wobble' },
      ]),
    );
    expect(out.unconstrainedDofs).toEqual([{ nodeId: 1, dof: 'uz' }]);
    expect(out.unmappedDofs).toEqual(['wobble']);
  });

  it('tolerates a missing unconstrainedDofs array', () => {
    const out = normalizeKinematicResult({
      ...rawResult([]),
      unconstrainedDofs: undefined as never,
    });
    expect(out.unconstrainedDofs).toEqual([]);
    expect(out.unmappedDofs).toEqual([]);
  });
});

// ─── Diagnosis text ────────────────────────────────────────────────

describe('localized diagnosis axis names', () => {
  it('rewrites the Spanish axis phrases to match the UI', () => {
    const raw =
      'Mecanismo en nodo 2 (2 modos de mecanismo). GDL sin restringir: ' +
      'nodo 2 (desplazamiento en Y); nodo 2 (rotación en Z). Revisá las articulaciones.';
    const out = normalizeDiagnosisAxes(raw);
    expect(out).toContain('desplazamiento en Z');
    expect(out).toContain('rotación en Y');
    expect(out).not.toContain('desplazamiento en Y');
    expect(out).not.toContain('rotación en Z');
  });

  it('does not chain the two substitutions into each other', () => {
    // A naive sequential replace would turn "en Y"→"en Z"→"en Y" again.
    const out = normalizeDiagnosisAxes('desplazamiento en Y y rotación en Z');
    expect(out).toBe('desplazamiento en Z y rotación en Y');
  });

  it('leaves horizontal and unrelated text untouched', () => {
    const raw = 'GDL sin restringir: nodo 4 (desplazamiento en X).';
    expect(normalizeDiagnosisAxes(raw)).toBe(raw);
    expect(normalizeDiagnosisAxes('')).toBe('');
  });
});

// ─── Fallback when rank analysis is unavailable ────────────────────

describe('WASM-unavailable fallback', () => {
  /**
   * Three collinear rollerX supports on a two-span beam.
   *
   * Counting: r = 3, m_frame = 2, n = 3 → g = 3·2 + 3 − 3·3 = 0, "isostatic".
   * Reality: every support restrains only the vertical, so the whole beam is
   * free to slide horizontally — a mechanism the counting formula structurally
   * cannot see, because it counts restraints without asking where they point.
   * Exactly the case the old `isSolvable: degree >= 0` fallback waved through.
   */
  const collinearRollers = build(
    [[1, 0, 0], [2, 4, 0], [3, 8, 0]],
    [[1, 1, 2], [2, 2, 3]],
    [[1, 1, 'rollerX'], [2, 2, 'rollerX'], [3, 3, 'rollerX']],
    [{ type: 'distributed', data: { elementId: 1, qI: -5, qJ: -5 } }],
  );

  it('the engine confirms this g >= 0 model is really a mechanism', () => {
    const truth = analyzeKinematics(collinearRollers);
    expect(truth.degree).toBeGreaterThanOrEqual(0);
    expect(truth.mechanismModes).toBeGreaterThan(0);
    expect(truth.isSolvable).toBe(false);
  });

  it('does not declare a degree >= 0 model safely solvable', () => {
    const { degree } = computeStaticDegree(collinearRollers);
    expect(degree).toBeGreaterThanOrEqual(0);

    vi.spyOn(wasmSolver, 'isWasmReady').mockReturnValue(false);
    try {
      const result = analyzeKinematics(collinearRollers);
      expect(result.degree).toBe(degree); // static degree preserved
      expect(result.rankAnalysis).toBe('unavailable');
      expect(result.isSolvable).toBe(false); // must NOT pass the solve gate
      expect(result.diagnosis).toMatch(/unavailable/i);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('is unsolvable even for an unambiguously stable model', () => {
    vi.spyOn(wasmSolver, 'isWasmReady').mockReturnValue(false);
    try {
      const result = analyzeKinematics(beam([[1, 1, 'fixed'], [2, 2, 'fixed']]));
      expect(result.degree).toBe(3); // the validated counting result survives
      expect(result.classification).toBe('hyperstatic');
      expect(result.isSolvable).toBe(false);
      expect(result.rankAnalysis).toBe('unavailable');
    } finally {
      vi.restoreAllMocks();
    }
  });
});

// ─── Canonical classifications, with the engine available ──────────

describe('canonical classifications are unchanged', () => {
  const cases: Array<[string, SolverInput, number, string, boolean]> = [
    ['simply supported', beam([[1, 1, 'pinned'], [2, 2, 'rollerX']]), 0, 'isostatic', true],
    ['cantilever', beam([[1, 1, 'fixed']]), 0, 'isostatic', true],
    ['fixed-fixed', beam([[1, 1, 'fixed'], [2, 2, 'fixed']]), 3, 'hyperstatic', true],
    ['propped cantilever', beam([[1, 1, 'fixed'], [2, 2, 'rollerX']]), 1, 'hyperstatic', true],
    ['two rollerX (mechanism)', beam([[1, 1, 'rollerX'], [2, 2, 'rollerX']]), -1, 'hypostatic', false],
  ];

  for (const [name, model, degree, classification, solvable] of cases) {
    it(`${name}: g=${degree} ${classification}`, () => {
      const r = analyzeKinematics(model);
      expect(r.degree).toBe(degree);
      expect(r.classification).toBe(classification);
      expect(r.isSolvable).toBe(solvable);
      expect(r.rankAnalysis).toBe('available');
    });
  }

  it('reports free DOFs in application vocabulary, never uy/rz', () => {
    const r = analyzeKinematics(beam([[1, 1, 'rollerZ'], [2, 2, 'rollerZ']]));
    expect(r.mechanismModes).toBeGreaterThan(0);
    expect(r.unconstrainedDofs.length).toBeGreaterThan(0);
    for (const d of r.unconstrainedDofs) {
      expect(['ux', 'uz', 'ry']).toContain(d.dof);
    }
    expect(r.unmappedDofs).toEqual([]);
    expect(r.diagnosis).not.toContain('desplazamiento en Y');
    expect(r.diagnosis).not.toContain('rotación en Z');
  });
});
