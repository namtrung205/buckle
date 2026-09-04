/**
 * The workspace's own inputs, produced by the real chain — computed once per FILE.
 *
 * ── Why this exists ────────────────────────────────────────────────
 *
 * Everything that is about the 3-D workspace's COST, and everything that is about which family
 * a bar belongs to, has to be asserted against a real building. A three-bar literal cannot tell
 * you that 11 340 slab bars stopped being counted as columns, and it cannot tell you that a
 * toggle stopped rebuilding 20 917 tubes.
 *
 * But the chain is expensive — load, solve, design, detail, floor-design, project — and the
 * suites that need it need the SAME starting point. So it is memoised per module: Vitest
 * isolates modules per test file, so each file gets its own instance and no test can observe
 * another file's state. Within a file the result is READ-ONLY by contract.
 *
 * Nothing here computes anything the callers are about. It runs the production entry points
 * with production arguments and hands back what the panel itself would hold: the document, the
 * projected scene, and the design outcomes the status join needs.
 */

import { expect } from 'vitest';
import { modelStore } from '../../../../store/model.svelte';
import { resultsStore } from '../../../../store/results.svelte';
import { detailingStore } from '../../../../store/detailing.svelte';
import { designRunStore } from '../../../../store/design-run.svelte';
import { verificationStore } from '../../../../store/verification.svelte';
import { isSolverReady } from '../../../wasm-solver';
import { buildSceneModel, type SceneModel } from '../../scene-model';
import { membersFromModel } from '../../member-geometry';
import type { DocumentModel } from '../../document-model';
import type { DesignOutcomeSummary } from '../../element-status';
import '../../../design/adapters/cirsoc201-adapter';
import '../../../design/adapters/unsupported-adapter';

export interface WorkspaceScene {
  doc: DocumentModel;
  /** The UNFILTERED scene, which is what the viewport builds geometry from. */
  scene: SceneModel;
  /** The design outcomes, keyed by member, exactly as `RebarWorkspace` derives them. */
  outcomes: Map<number, DesignOutcomeSummary>;
}

async function compute(example: string): Promise<WorkspaceScene> {
  modelStore.clear();
  resultsStore.clear();
  detailingStore.clear();
  designRunStore.resetMarks();
  verificationStore.clear();

  await modelStore.loadExample(example);
  expect(isSolverReady(), 'real WASM solver, not the Vite stub').toBe(true);

  const solved = await modelStore.solveCombinations3DParallel(true, false, true);
  expect(typeof solved, 'the solver returned results rather than an error string')
    .not.toBe('string');
  const r = solved as { perCase: never; perCombo: never; envelope: never };
  resultsStore.setCombinationResults3D(r.perCase, r.perCombo, r.envelope);

  designRunStore.computeDemands();
  designRunStore.runCodeCheck();
  designRunStore.designAll();
  detailingStore.generate({ verifierId: 'cirsoc201.provided.v2.2025' });
  detailingStore.generateFloors({ verifierId: 'cirsoc201.provided.v2.2025' });

  const doc = detailingStore.buildDocument({ author: 'bench', at: '2026-08-09T00:00:00Z' });
  expect(doc, 'the chain produced a document').toBeTruthy();

  const { members } = membersFromModel({
    elementIds: [...modelStore.model.elements.keys()],
    nodes: [...modelStore.model.nodes.values()],
    elements: [...modelStore.model.elements.values()],
    sections: [...modelStore.model.sections.values()],
  });

  const outcomes = new Map<number, DesignOutcomeSummary>();
  for (const id of modelStore.model.elements.keys()) {
    const o = verificationStore.outcomeFor(id);
    const v = verificationStore.providedFor(id);
    if (!o && !v) continue;
    outcomes.set(id, {
      outcome: o?.outcome,
      verificationStatus: v?.overallStatus,
      // Threaded exactly as `RebarWorkspace` threads it. Omitting it here made the helper's
      // join easier than the app's and hid a real difference: a proposal's steel FAILS the
      // authoritative verifier, so a test that never supplied the verification status could
      // not see the app reporting FAILED where the screen shows PROVISIONAL.
      verificationLimiting: (v?.checks ?? [])
        .filter((c) => c.status === 'fail')
        .flatMap((c) => (c.limiting ? [String(c.limiting)] : [])),
      limiting: o?.limiting ?? [],
      reasonKey: o?.reasons?.[0]?.key,
      secondaryRatio: o?.axes?.secondaryRatio,
    });
  }

  return { doc: doc!, scene: buildSceneModel(doc!, { members }), outcomes };
}

const cache = new Map<string, Promise<WorkspaceScene>>();

/**
 * The workspace's inputs for one committed example, once per file.
 *
 * Keyed by example name so a file may ask for both the small control and the 7-storey building
 * without paying for either twice. The promise itself is cached, so two concurrent callers
 * share one run rather than racing two.
 */
export function workspaceScene(example: string): Promise<WorkspaceScene> {
  const hit = cache.get(example);
  if (hit) return hit;
  const run = compute(example);
  cache.set(example, run);
  return run;
}
