/**
 * The whole chain, ending in a picture — on real data, not a fixture literal.
 *
 *   committed .ded project
 *     -> real WASM solver
 *     -> demands, code check, design            production commands
 *     -> detailing + floor detailing            real bars
 *     -> buildDocument()                        the one statement
 *     -> buildSceneModel()                      what the 3-D view renders
 *
 * ── Why this test exists next to the schedule and the drawings ─────
 *
 * `projections-agree.test.ts` cross-examines the outputs on a hand-built document, which is
 * the right place to pin the RULE. It cannot catch a chain that produces no bars at all, or a
 * footing solid placed at the origin because the real record carries its position somewhere
 * the fixture did not.
 *
 * So this one runs the production commands and asks the same questions of what comes out.
 * If the app can design this project, the 3-D view can show it, and what it shows is what the
 * drawings draw and the schedule bills.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { modelStore } from '../../store/model.svelte';
import { resultsStore } from '../../store/results.svelte';
import { detailingStore } from '../../store/detailing.svelte';
import { designRunStore } from '../../store/design-run.svelte';
import { deserializeProject } from '../../store/file';
import { isSolverReady } from '../../engine/wasm-solver';
import { buildSceneModel, summariseScene } from '../../engine/detailing/scene-model';
import { membersFromModel } from '../../engine/detailing/member-geometry';
import { renderDrawings, renderSchedule } from '../../engine/detailing/document-render';
import type { DocumentModel } from '../../engine/detailing/document-model';

const FIXTURE = new URL('../__fixtures__/rc-footing-cad-poc.ded.json', import.meta.url);
const OPTS = { locale: 'es', projectName: 'Chain' };

/** Restore, solve, design, detail and build the document. The real commands, in order. */
async function chainToDocument(): Promise<DocumentModel> {
  modelStore.clear();
  resultsStore.clear();
  detailingStore.clear();
  designRunStore.resetMarks();

  expect(deserializeProject(readFileSync(FIXTURE, 'utf8'))).toBe(true);
  expect(isSolverReady(), 'real WASM solver, not the Vite stub').toBe(true);

  const solved = await modelStore.solveCombinations3DParallel(true, false, true);
  expect(typeof solved).not.toBe('string');
  const r = solved as { perCase: Map<number, never>; perCombo: Map<number, never>; envelope: never };
  resultsStore.setCombinationResults3D(r.perCase as never, r.perCombo as never, r.envelope as never);

  expect(designRunStore.computeDemands().ok).toBe(true);
  expect(designRunStore.runCodeCheck().ok).toBe(true);
  expect(designRunStore.designAll().ok).toBe(true);

  detailingStore.generate({ verifierId: 'cirsoc201.provided.v2.2025' });
  detailingStore.generateFloors({ verifierId: 'cirsoc201.provided.v2.2025' });

  const doc = detailingStore.buildDocument({
    author: 'chain', at: '2026-08-04T00:00:00Z',
  });
  expect(doc, 'the chain produces a document').toBeTruthy();
  return doc!;
}

/** The scene, built the way the panel builds it. */
function sceneFrom(doc: DocumentModel) {
  const elementIds = [...new Set(doc.assemblies.flatMap((a) => a.elementIds))];
  const { members, refused } = membersFromModel({
    elementIds,
    nodes: [...modelStore.model.nodes.values()],
    elements: [...modelStore.model.elements.values()],
    sections: [...modelStore.model.sections.values()],
  });
  return { scene: buildSceneModel(doc, { members }), refused };
}

describe('the production chain reaches a renderable scene', () => {
  beforeEach(() => { modelStore.clear(); });

  it('produces bars, and every one of them has geometry to draw', async () => {
    const doc = await chainToDocument();
    const { scene } = sceneFrom(doc);

    expect(scene.bars.length, 'the chain designed steel').toBeGreaterThan(0);
    for (const b of scene.bars) {
      // A bar with one point renders as nothing and would be invisible rather than reported.
      expect(b.polyline.length, `polyline of ${b.barId}`).toBeGreaterThanOrEqual(2);
      expect(b.cuttingLength, `length of ${b.barId}`).toBeGreaterThan(0);
      expect(Number.isFinite(b.polyline[0].x + b.polyline[0].y + b.polyline[0].z)).toBe(true);
    }
  });

  it('shows every bar the document carries — none dropped on the way to the view', async () => {
    const doc = await chainToDocument();
    const { scene } = sceneFrom(doc);
    const inDoc = doc.assemblies.flatMap((a) => a.bars).map((b) => b.id).sort();
    expect(scene.bars.map((b) => b.barId).sort()).toEqual(inDoc);
  });

  it('places the footing solid on its real dowels, not at the origin', async () => {
    const doc = await chainToDocument();
    const { scene } = sceneFrom(doc);
    const footing = scene.solids.find((s) => s.kind === 'footing');
    expect(footing, 'the designed footing has a solid').toBeTruthy();

    // Its base must enclose the dowels that start from it. A footing drawn at (0,0) while its
    // steel stands elsewhere is the failure this asserts against, and it looks fine in
    // isolation — you only see it when the bars are in the picture too.
    const dowels = scene.bars.filter((b) => b.family === 'footing' && b.role === 'longitudinal');
    expect(dowels.length, 'the chain produced dowels').toBeGreaterThan(0);
    const xs = footing!.base.map((p) => p.x);
    const ys = footing!.base.map((p) => p.y);
    for (const d of dowels) {
      const p = d.polyline[0];
      expect(p.x, `dowel ${d.barId} inside B`)
        .toBeGreaterThanOrEqual(Math.min(...xs) - 1e-9);
      expect(p.x).toBeLessThanOrEqual(Math.max(...xs) + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-9);
      expect(p.y).toBeLessThanOrEqual(Math.max(...ys) + 1e-9);
    }
  });

  it('frames something a camera can point at', async () => {
    const doc = await chainToDocument();
    const { scene } = sceneFrom(doc);
    expect(scene.bounds).not.toBeNull();
    const span = scene.bounds!.max.z - scene.bounds!.min.z;
    expect(span, 'the scene has real extent').toBeGreaterThan(0.1);
  });

  it('carries the document’s own readiness rather than an optimistic default', async () => {
    const doc = await chainToDocument();
    const { scene } = sceneFrom(doc);
    expect(scene.readiness).toBe(doc.readiness);
    // This project is known to carry unresolved spacing conflicts, so the view must not
    // present it as anything better than a draft.
    expect(doc.openConflicts.length).toBeGreaterThan(0);
    expect(scene.readiness).toBe('REVIEW_DRAFT');
    expect(summariseScene(scene).conflictedBars).toBeGreaterThan(0);
  });
});

describe('on real data the four projections still agree', () => {
  beforeEach(() => { modelStore.clear(); });

  it('the scene, the drawings and the schedule name the same marks', async () => {
    const doc = await chainToDocument();
    const { scene } = sceneFrom(doc);

    const marksInScene = new Set(scene.bars.map((b) => b.mark).filter(Boolean) as string[]);
    expect(marksInScene.size, 'the chain marked its steel').toBeGreaterThan(0);

    const scheduleText = renderSchedule(doc, OPTS)
      .flatMap(({ aoa }) => aoa.map((row) => String(row[0] ?? '').trim()));
    const svg = renderDrawings(doc, OPTS).sheets.map((s) => s.svg).join('\n');

    for (const mark of marksInScene) {
      expect(scheduleText, `${mark} billed`).toContain(mark);
      expect(svg, `${mark} drawn`).toContain(mark);
    }
  });

  it('reports the members whose concrete it could not draw, instead of hiding them', async () => {
    const doc = await chainToDocument();
    const { scene, refused } = sceneFrom(doc);
    // Whatever the count, the two views of the same gap must agree — the scene's list is
    // built from the assemblies, the refusal list from the model, and a member missing from
    // one and not the other means one of them is guessing.
    expect(scene.unresolvedMembers.sort((a, b) => a - b))
      .toEqual(refused.map((r) => r.elementId).sort((a, b) => a - b));
  });
});
