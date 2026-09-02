// Per-axis release condensation in the StepWizard detailed 3D solver (Task D2).
//
// solveDetailed3D previously applied ONE generic hinge boolean
// `(elem.releaseMyStart || elem.releaseMzStart)` to BOTH bending blocks in
// frameLocalStiffness3D/adjustFEFForHinges, and never touched torsion at all.
// That means releasing My alone also released Mz (over-release), and
// releaseTStart/releaseTEnd were silently ignored.
//
// The WASM engine (engine/src/element/frame.rs) is the parity oracle: each
// bending block is condensed independently by its own axis flag, and torsion
// (GJ/L) is zeroed only when a T-release flag is set on either end. This test
// builds a fixed-free-fixed 3-node beam along X, releases ONE axis at a time
// at the start of element 1, and asserts the detailed pedagogical pipeline
// agrees with the WASM solver's nodal displacements at the loaded free node.

import { describe, expect, it } from 'vitest';
import { solve3D } from '../wasm-solver';
import { solveDetailed3D } from '../solver-detailed-3d';
import type {
  SolverInput3D, SolverElement3D, SolverSupport3D, AnalysisResults3D,
} from '../types-3d';
import type { SolverMaterial } from '../types';

const steelMat: SolverMaterial = { id: 1, e: 200_000, nu: 0.3 };
const stdSection = { id: 1, a: 0.01, iy: 1e-4, iz: 2e-4, j: 1.5e-4 };

function fixedSupport(nodeId: number): SolverSupport3D {
  return { nodeId, rx: true, ry: true, rz: true, rrx: true, rry: true, rrz: true };
}

function buildInput(
  nodes: Array<{ id: number; x: number; y: number; z: number }>,
  elements: SolverElement3D[],
  supports: SolverSupport3D[],
  loads: SolverInput3D['loads'] = [],
): SolverInput3D {
  return {
    nodes: new Map(nodes.map(n => [n.id, n])),
    materials: new Map([[1, steelMat]]),
    sections: new Map([[1, stdSection]]),
    elements: new Map(elements.map(e => [e.id, e])),
    supports: new Map(supports.map((s, i) => [i, s])),
    loads,
  };
}

function assertSuccess(result: AnalysisResults3D | string): asserts result is AnalysisResults3D {
  if (typeof result === 'string') {
    throw new Error(`Solver returned error: ${result}`);
  }
}

const CASES = [
  { name: 'release My only at start', rel: { my: true, mz: false, t: false } },
  { name: 'release Mz only at start', rel: { my: false, mz: true, t: false } },
  { name: 'release T only at start', rel: { my: false, mz: false, t: true } },
] as const;

describe('solver-detailed-3d honors per-axis releases (parity vs WASM)', () => {
  for (const c of CASES) {
    it(c.name, () => {
      // Fixed - free - fixed beam along X (node 2 is the only free node).
      // Element 1 (node 1 -> node 2) carries the per-axis release under test
      // at its START (node 1) end; element 2 (node 2 -> node 3) stays fully
      // rigid, so node 2's DOFs always have a stiffness path even when
      // element 1's matching block is fully condensed — torsion in
      // particular zeroes the ENTIRE GJ/L block when released at either
      // end, so a single free-tip cantilever released at the wall would be
      // a genuine mechanism (singular in BOTH solvers); this topology keeps
      // the system well-posed for all three release axes.
      const nodes = [
        { id: 1, x: 0, y: 0, z: 0 },
        { id: 2, x: 3, y: 0, z: 0 },
        { id: 3, x: 6, y: 0, z: 0 },
      ];
      const elements: SolverElement3D[] = [
        {
          id: 1, type: 'frame', nodeI: 1, nodeJ: 2, materialId: 1, sectionId: 1,
          releaseMyStart: c.rel.my, releaseMyEnd: false,
          releaseMzStart: c.rel.mz, releaseMzEnd: false,
          releaseTStart: c.rel.t, releaseTEnd: false,
        },
        {
          id: 2, type: 'frame', nodeI: 2, nodeJ: 3, materialId: 1, sectionId: 1,
          releaseMyStart: false, releaseMyEnd: false,
          releaseMzStart: false, releaseMzEnd: false,
          releaseTStart: false, releaseTEnd: false,
        },
      ];
      const supports = [fixedSupport(1), fixedSupport(3)];
      // A point load on element 1 (both local y AND z) exercises the FEF
      // adjustment path (adjustFEFForHinges) for both bending planes; the
      // nodal torque at node 2 exercises the torsion stiffness term. Every
      // release axis under test changes at least one of these responses.
      const loads: SolverInput3D['loads'] = [
        { type: 'pointOnElement', data: { elementId: 1, a: 1.0, py: 2.0, pz: -1.5 } },
        { type: 'nodal', data: { nodeId: 2, fx: 0, fy: 0, fz: 0, mx: 1.7, my: 0, mz: 0 } },
      ];

      const input = buildInput(nodes, elements, supports, loads);

      // Oracle: WASM engine, which handles typed releases correctly.
      const wasmResult = solve3D(input);
      assertSuccess(wasmResult);
      const wasmNode2 = wasmResult.displacements.find(d => d.nodeId === 2);
      expect(wasmNode2).toBeDefined();

      // Under test: the pedagogical StepWizard pipeline.
      const detailed = solveDetailed3D(input);
      const detailedNode2 = [0, 1, 2, 3, 4, 5].map((ld) => {
        const dof = detailed.dofNumbering.dofs.find(d => d.nodeId === 2 && d.localDof === ld);
        expect(dof).toBeDefined();
        return detailed.uAll[dof!.globalIndex];
      });

      const wasmVec = [
        wasmNode2!.ux, wasmNode2!.uy, wasmNode2!.uz,
        wasmNode2!.rx, wasmNode2!.ry, wasmNode2!.rz,
      ];
      const labels = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'];

      for (let i = 0; i < 6; i++) {
        const a = wasmVec[i];
        const b = detailedNode2[i];
        const scale = Math.max(Math.abs(a), Math.abs(b), 1e-12);
        const relErr = Math.abs(a - b) / scale;
        expect(relErr, `${labels[i]}: wasm=${a}, detailed=${b}`).toBeLessThan(1e-8);
      }
    });
  }
});
