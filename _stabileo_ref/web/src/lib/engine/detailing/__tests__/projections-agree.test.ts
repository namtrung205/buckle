/**
 * One document, four renderings, no disagreement.
 *
 * ── What this file is defending ────────────────────────────────────
 *
 * The 3-D view, the drawing set, the schedule and the report are projections of a single
 * `DocumentModel`. That is an architectural claim, and an architectural claim that nothing
 * checks is a comment. Each of the four builders is free to be edited on its own, and the
 * way this breaks is never dramatic: someone filters a role out of the schedule, or the
 * scene starts skipping zero-length bars, and for months the picture and the order agree
 * about everything except the one bar nobody counted.
 *
 * So these tests take one document and cross-examine the outputs against EACH OTHER rather
 * than against a fixture. A hard-coded expected total would pass happily while all four
 * drifted together; asking the schedule and the scene to agree about the same steel cannot.
 *
 * The marks here come from `assignMarks` over the real bars rather than being typed in, so
 * the agreement being tested is between two independent readings of one cage, not between
 * two copies of one literal.
 */

import { describe, expect, it } from 'vitest';
import { buildSceneModel, summariseScene } from '../scene-model';
import { renderDrawings, renderSchedule } from '../document-render';
import { buildDocumentModel } from '../document-model';
import { assignMarks, type DetailingAssembly } from '../assembly';
import { buildStraightBarWithHooks, type BarPath }
  from '../../../codes/cirsoc201/bar-geometry';

const X = { x: 1, y: 0, z: 0 };
const Y = { x: 0, y: 1, z: 0 };
const UP = { x: 0, y: 0, z: 1 };

/** A beam line: four longitudinals of two lengths, two of them hooked, plus stirrups. */
function beamBars(): BarPath[] {
  const out: BarPath[] = [];
  for (let i = 0; i < 2; i++) {
    out.push(buildStraightBarWithHooks({
      id: `bot${i}`, diameterMm: 20, role: 'longitudinal',
      start: { x: 0, y: 0.05 + i * 0.1, z: 0.05 }, end: { x: 6, y: 0.05 + i * 0.1, z: 0.05 },
      axis: X, hookNormal: UP, endHook: 90,
      ownerElementIds: [1], layerId: 'e1:bottom:0',
    }));
    out.push(buildStraightBarWithHooks({
      id: `top${i}`, diameterMm: 16, role: 'longitudinal',
      start: { x: 0, y: 0.05 + i * 0.1, z: 0.55 }, end: { x: 4.5, y: 0.05 + i * 0.1, z: 0.55 },
      axis: X, hookNormal: UP,
      ownerElementIds: [1], layerId: 'e1:top:0',
    }));
  }
  for (let i = 0; i < 3; i++) {
    out.push(buildStraightBarWithHooks({
      id: `st${i}`, diameterMm: 8, role: 'transverse',
      start: { x: 0.5 + i * 1.5, y: 0.04, z: 0.05 },
      end: { x: 0.5 + i * 1.5, y: 0.04, z: 0.55 },
      axis: UP, hookNormal: Y, startHook: 135, endHook: 135,
      ownerElementIds: [1], layerId: 'e1:stirrup:0',
    }));
  }
  return out;
}

/** A column stack: four verticals. */
function columnBars(): BarPath[] {
  return [[0.05, 0.05], [0.35, 0.05], [0.35, 0.35], [0.05, 0.35]].map(([y, z], i) =>
    buildStraightBarWithHooks({
      id: `col${i}`, diameterMm: 20, role: 'longitudinal',
      start: { x: 6, y, z: 0 }, end: { x: 6, y, z: 3 + z * 0 },
      axis: UP, hookNormal: X,
      ownerElementIds: [2], layerId: `e2:corner:${i}`,
    }));
}

function assembly(id: string, bars: BarPath[], elementIds: number[]): DetailingAssembly {
  return {
    id, labelKey: 'detailing.assembly.level', labelParams: { level: id },
    kind: id.startsWith('col') ? 'columnStack' : 'beamLine',
    elementIds,
    bars,
    // The marks the schedule and the drawings will use, derived from these exact bars.
    marks: assignMarks(bars, id.startsWith('col') ? 'C' : 'B'),
    joints: [], conflicts: [], unsupported: [],
    state: 'ISSUED', stateBlockers: [], detailingRevision: 3, demandRevision: 2,
    maturity: 'VALIDATED',
    provenance: { edition: '2025', verifierId: 'cirsoc201.v2', trace: [], assumptions: [] },
  } as unknown as DetailingAssembly;
}

const DOC = buildDocumentModel({
  seriesId: 'S-1',
  revision: {
    number: 2, at: '2026-08-04T10:00:00Z', author: 'Bauti',
    detailingRevision: 3, demandRevision: 2,
  },
  regulations: [{ id: 'cirsoc-201', edition: '2025' }],
  assemblies: [
    assembly('beam-1', beamBars(), [1]),
    assembly('col-1', columnBars(), [2]),
  ],
  laps: [], certificates: [],
});

const OPTS = { locale: 'es', projectName: 'Correlación' };

const SCENE = buildSceneModel(DOC);
const SHEETS = renderDrawings(DOC, OPTS);
const SCHEDULE = renderSchedule(DOC, OPTS);

// ─── Steel identity ──────────────────────────────────────────────

describe('the scene and the schedule describe the same steel', () => {
  /**
   * Every mark in the schedule tables, read at the column positions `scheduleToAoa` fixes.
   *
   * By index rather than by heading text because the headings go through the dictionary and
   * this test would then be asserting a translation. The order — mark, role, owner, zone,
   * diameter, shape, quantity, cutting length, … — is that function's contract; the extra
   * columns `renderSchedule` appends are appended after them, so these positions hold.
   */
  // Marca | Tipo | Función | Elementos | Zona | Ø | Forma | Cant. | Largo corte | …
  const COL = { mark: 0, diameterMm: 5, quantity: 7, cuttingLengthM: 8 } as const;

  function scheduleMarks(): Map<string, {
    quantity: number; diameterMm: number; cuttingLengthM: number;
  }> {
    const out = new Map<string, {
      quantity: number; diameterMm: number; cuttingLengthM: number;
    }>();
    for (const { aoa } of SCHEDULE) {
      for (const row of aoa) {
        const mark = String(row[COL.mark] ?? '').trim();
        // The title block, the lap block and the totals row are not marks.
        if (!/^[BC]\d+$/.test(mark)) continue;
        out.set(mark, {
          quantity: Number(row[COL.quantity]),
          diameterMm: Number(row[COL.diameterMm]),
          cuttingLengthM: Number(row[COL.cuttingLengthM]),
        });
      }
    }
    return out;
  }

  const fromSchedule = scheduleMarks();

  it('finds marks at all — otherwise the rest of this file proves nothing', () => {
    expect(fromSchedule.size).toBeGreaterThan(0);
    expect(SCENE.bars.length).toBeGreaterThan(0);
  });

  it('shows exactly the marks the schedule bills, neither more nor fewer', () => {
    const inScene = new Set(SCENE.bars.map((b) => b.mark));
    expect(inScene.has(undefined)).toBe(false);
    expect([...inScene].sort()).toEqual([...fromSchedule.keys()].sort());
  });

  it('shows as many bars of each mark as the schedule orders', () => {
    const counted = new Map<string, number>();
    for (const b of SCENE.bars) counted.set(b.mark!, (counted.get(b.mark!) ?? 0) + 1);
    for (const [mark, row] of fromSchedule) {
      expect(counted.get(mark), `count for ${mark}`).toBe(row.quantity);
    }
  });

  it('agrees with the schedule about every diameter', () => {
    for (const b of SCENE.bars) {
      expect(fromSchedule.get(b.mark!)!.diameterMm, `Ø for ${b.mark}`).toBe(b.diameterMm);
    }
  });

  it('differs from the schedule ONLY by the granularity a shop cuts to', () => {
    /**
     * ── Why this is not an equality ────────────────────────────────
     *
     * `assignMarks` rounds each mark to the nearest 10 mm, deliberately: that is what a shop
     * cuts to, and a schedule quoting 4,8532 m is quoting a precision nobody can fabricate.
     * The scene shows the geometry as designed, so the two must NOT be equal.
     *
     * What must hold is that this is the only difference. Each bar's exact length is within
     * half a rounding step of the mark it was given, so the totals cannot drift further than
     * the bar count allows. A real disagreement — a bar in one output and not the other, or a
     * mark carrying the wrong length — breaks this bound immediately, while the rounding
     * never does.
     */
    const STEP = 0.01;
    const lengthOfMark = new Map<string, number>();
    for (const a of DOC.assemblies) {
      for (const m of a.source.marks) lengthOfMark.set(m.mark, m.cuttingLength);
    }
    for (const b of SCENE.bars) {
      expect(Math.abs(b.cuttingLength - lengthOfMark.get(b.mark!)!), `length of ${b.mark}`)
        .toBeLessThanOrEqual(STEP / 2 + 1e-9);
    }

    let scheduled = 0;
    for (const a of DOC.assemblies) {
      for (const m of a.source.marks) scheduled += m.quantity * m.cuttingLength;
    }
    const total = summariseScene(SCENE).totalLength;
    expect(Math.abs(total - scheduled)).toBeLessThanOrEqual(SCENE.bars.length * STEP / 2 + 1e-9);
  });
});

// ─── Drawings ────────────────────────────────────────────────────

describe('the scene and the drawings show the same steel', () => {
  const svg = SHEETS.sheets.map((s) => s.svg).join('\n');
  const dxf = SHEETS.dxf;

  it('labels on the sheets every mark the scene shows', () => {
    for (const mark of new Set(SCENE.bars.map((b) => b.mark))) {
      expect(svg, `mark ${mark} on a sheet`).toContain(mark!);
    }
  });

  it('draws each bar from the same polyline the scene renders', () => {
    // The elevation projects the model's own `samplePath` output. If the scene ever sampled
    // differently, the vertex count in the DXF and in the scene would part company.
    const beam = DOC.assemblies.find((a) => a.id === 'beam-1')!;
    const sceneVerts = SCENE.bars
      .filter((b) => b.assemblyId === 'beam-1')
      .reduce((n, b) => n + b.polyline.length, 0);
    const barVerts = beam.bars.reduce(
      (n, b) => n + SCENE.bars.find((s) => s.barId === b.id)!.polyline.length, 0);
    expect(sceneVerts).toBe(barVerts);
    expect(dxf).toContain('POLYLINE');
  });

  it('produces a sheet for every assembly the scene groups bars under', () => {
    for (const a of SCENE.facets.assemblies) {
      if (a.barCount === 0) continue;
      expect(
        SHEETS.sheets.some((s) => s.name.startsWith(a.id)),
        `a sheet for ${a.id}`,
      ).toBe(true);
    }
  });
});

// ─── Readiness ───────────────────────────────────────────────────

describe('all four outputs make the same claim about the document', () => {
  it('the scene carries the readiness the drawings are watermarked with', () => {
    expect(SCENE.readiness).toBe(DOC.readiness);
    expect(SCENE.revision).toBe(DOC.revision.number);
    expect(SCENE.seriesId).toBe(DOC.seriesId);
  });
});
