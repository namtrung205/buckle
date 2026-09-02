/**
 * The forty thousand conflicts, sorted into something a person can review.
 *
 * ── What is being asserted ─────────────────────────────────────────
 *
 * Two things, and the first matters more than the second.
 *
 * The first is that the inventory RESOLVES NOTHING. `rows.length` equals the conflict count,
 * every conflict gets exactly one category, and no threshold or verdict moves. A classifier
 * that quietly drops what it cannot classify is how forty thousand becomes a smaller and less
 * honest number, and that is the failure mode this file exists to prevent.
 *
 * The second is that the classification is the one it claims to be: each rule is exercised
 * against a conflict built to trip it, so the taxonomy can be argued with rather than
 * trusted. The rules are deliberately simple and each one is stated in the module.
 *
 * The census over the real building is printed rather than pinned to exact numbers: the point
 * of the inventory is that the shape is inspectable, and pinning 40 065 would make an
 * unrelated detailing improvement look like a regression. What IS pinned is the invariant —
 * nothing lost, nothing double-counted — and that blocking categories are a strict subset.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { workspaceScene } from './helpers/workspace-scene';
import {
  CONFLICT_CATEGORIES, DUPLICATE_RADIUS, blockingCount, buildConflictInventory,
} from '../conflict-inventory';
import type { OpenConflict } from '../document-model';
import type { DocumentModel } from '../document-model';

function conflict(over: Partial<OpenConflict> = {}): OpenConflict {
  return {
    assemblyId: 'A',
    elementIds: [1],
    barIds: ['a', 'b'],
    at: { x: 0, y: 0, z: 0 },
    clearance: 0.012,
    required: 0.025,
    shortfall: 0.013,
    severity: 'clearance',
    pairClass: 'sameLayerSpacing',
    refs: [],
    attempted: [],
    maturity: 'IMPLEMENTED_PROVISIONAL',
    suggestedAction: { key: 'x' } as never,
    ...over,
  };
}

describe('conflict inventory — the classification rules', () => {
  it('calls interpenetration by its name, whatever the pair class', () => {
    for (const pairClass of ['sameLayerSpacing', 'orthogonalCrossing', 'requiredContainment']) {
      const inv = buildConflictInventory([
        conflict({ pairClass, severity: 'overlap', clearance: -0.004, shortfall: 0.004 }),
      ]);
      expect(inv.rows[0].category, pairClass).toBe('interpenetration');
    }
  });

  it('separates a real spacing shortfall from a projection artefact', () => {
    const real = buildConflictInventory([conflict({ pairClass: 'sameLayerSpacing' })]);
    expect(real.rows[0].category).toBe('realSpacing');

    // Crossing bars are tied in contact; the clear-spacing clause governs bars standing
    // beside one another. Reported, not exempted — the classifier can be wrong.
    const crossing = buildConflictInventory([conflict({ pairClass: 'orthogonalCrossing' })]);
    expect(crossing.rows[0].category).toBe('projection');
  });

  it('names the two classes whose governing clause is a normative question', () => {
    for (const pairClass of ['cageSpacing', 'crossMemberSpacing']) {
      const inv = buildConflictInventory([conflict({ pairClass })]);
      expect(inv.rows[0].category, pairClass).toBe('needsCodeDecision');
    }
  });

  it('records intended contact instead of hiding it', () => {
    for (const pairClass of ['requiredContainment', 'spliceLap']) {
      const inv = buildConflictInventory([conflict({ pairClass })]);
      expect(inv.rows[0].category, pairClass).toBe('intentional');
      // Still a row. The classifier's decision that it was intentional is itself auditable.
      expect(inv.total).toBe(1);
    }
  });

  it('tells intra-family from cross-family when the caller knows the families', () => {
    const familyOfBar = new Map([['a', 'slab'], ['b', 'slab'], ['c', 'wall']]);
    const intra = buildConflictInventory([conflict({ barIds: ['a', 'b'] })], { familyOfBar });
    expect(intra.rows[0].category).toBe('intraFamily');
    const cross = buildConflictInventory([conflict({ barIds: ['a', 'c'] })], { familyOfBar });
    expect(cross.rows[0].category).toBe('crossFamily');
  });

  it('flags a repeat of one pair at the same place, and not one at a different place', () => {
    const same = buildConflictInventory([
      conflict({ barIds: ['a', 'b'], at: { x: 0, y: 0, z: 0 } }),
      // Order reversed on purpose: the pair is unordered, and a classifier that missed that
      // would report every pair twice as two originals.
      conflict({ barIds: ['b', 'a'], at: { x: 0.002, y: 0, z: 0 } }),
    ]);
    expect(same.rows.map((r) => r.category)).toEqual(['realSpacing', 'possibleDuplicate']);

    const apart = buildConflictInventory([
      conflict({ barIds: ['a', 'b'], at: { x: 0, y: 0, z: 0 } }),
      conflict({ barIds: ['a', 'b'], at: { x: DUPLICATE_RADIUS * 5, y: 0, z: 0 } }),
    ]);
    // A pair CAN legitimately conflict twice along its length. Calling that a duplicate would
    // hide a second real problem.
    expect(apart.rows.map((r) => r.category)).toEqual(['realSpacing', 'realSpacing']);
  });

  it('gives every row the evidence that assigned it', () => {
    const inv = buildConflictInventory([conflict()]);
    expect(inv.rows[0].evidence).toBeTruthy();
    expect(inv.rows[0].evidence).toContain('sameLayerSpacing');
  });

  it('breaks each category down by pair class', () => {
    const inv = buildConflictInventory([
      conflict({ pairClass: 'sameLayerSpacing', severity: 'overlap', clearance: -0.004, shortfall: 0.004 }),
      conflict({ barIds: ['c', 'd'], pairClass: 'sameLayerSpacing', severity: 'overlap', clearance: -0.006, shortfall: 0.006 }),
      conflict({ barIds: ['e', 'f'], pairClass: 'betweenLayerSpacing', severity: 'overlap', clearance: -0.002, shortfall: 0.002 }),
    ]);
    const inter = inv.summary.find((s) => s.category === 'interpenetration')!;
    expect(inter.count).toBe(3);
    // Commonest first, so the systematic cause is the first thing read.
    expect(inter.byPairClass.map((p) => [p.pairClass, p.count]))
      .toEqual([['sameLayerSpacing', 2], ['betweenLayerSpacing', 1]]);
    expect(inter.byPairClass.reduce((n, p) => n + p.count, 0)).toBe(inter.count);
  });

  it('preserves both bars, both members, the position and both measurements', () => {
    const c = conflict({
      barIds: ['x1', 'y2'], elementIds: [7, 9], at: { x: 1, y: 2, z: 3 },
      clearance: 0.011, required: 0.025, shortfall: 0.014,
    });
    const r = buildConflictInventory([c]).rows[0];
    expect(r.barIds).toEqual(['x1', 'y2']);
    expect(r.elementIds).toEqual([7, 9]);
    expect(r.at).toEqual({ x: 1, y: 2, z: 3 });
    expect(r.clearance).toBe(0.011);
    expect(r.required).toBe(0.025);
    expect(r.shortfall).toBe(0.014);
    expect(r.severity).toBe('clearance');
    expect(r.pairClass).toBe('sameLayerSpacing');
  });
});

// A whole-building test: 30 s rather than Vitest's 5 s default, for the reason set out in
// `provisional-projections.test.ts` — under a full-suite pool these were failing on
// contention with every assertion passing.
describe('conflict inventory — over the real building', { timeout: 30_000 }, () => {
  let doc: DocumentModel;

  beforeAll(async () => {
    doc = (await workspaceScene('pro-edificio-7p')).doc;
  }, 900_000);

  it('classifies every conflict exactly once, losing none', () => {
    const familyOfBar = new Map<string, string>();
    for (const a of doc.assemblies) {
      for (const rec of a.families) {
        for (const id of rec.barIds) familyOfBar.set(id, rec.family);
      }
    }
    const inv = buildConflictInventory(doc.openConflicts, { familyOfBar });

    // The invariant that makes the table trustworthy: nothing dropped, nothing invented.
    expect(inv.total).toBe(doc.openConflicts.length);
    expect(inv.rows.length).toBe(doc.openConflicts.length);
    // Exactly one category each, so the summary's counts add up to the total.
    expect(inv.summary.reduce((n, s) => n + s.count, 0)).toBe(inv.total);
    for (const s of inv.summary) expect(CONFLICT_CATEGORIES).toContain(s.category);

    // Blocking is a strict subset. If everything blocked, the split would say nothing.
    const blocking = blockingCount(inv);
    expect(blocking).toBeLessThanOrEqual(inv.total);
    expect(inv.blocking.length).toBeLessThan(CONFLICT_CATEGORIES.length);

    // Printed rather than pinned: the point is that the shape is inspectable, and an exact
    // count would make an unrelated detailing improvement read as a regression.
    // eslint-disable-next-line no-console
    console.log(`conflict inventory — ${inv.total} open conflicts, ${blocking} blocking\n`
      + inv.summary.map((s) =>
        `  ${s.category.padEnd(20)} ${String(s.count).padStart(6)}`
        + `  bars ${String(s.bars).padStart(5)}  members ${String(s.members).padStart(4)}`
        + `  median shortfall ${(s.medianShortfall * 1000).toFixed(1)} mm`
        + `  worst ${(s.worstShortfall * 1000).toFixed(1)} mm\n`
        + s.byPairClass.map((k) =>
          `      ${k.pairClass.padEnd(22)} ${String(k.count).padStart(6)}`
          + `  median ${(k.medianShortfall * 1000).toFixed(1)} mm`).join('\n')).join('\n'));
  });

  it('keeps every conflict traceable back to its two bars and its parent members', () => {
    const inv = buildConflictInventory(doc.openConflicts);
    const barIds = new Set(doc.assemblies.flatMap((a) => a.bars.map((b) => b.id)));
    for (const r of inv.rows) {
      expect(r.barIds[0], 'bar A is named').toBeTruthy();
      expect(r.barIds[1], 'bar B is named').toBeTruthy();
      expect(r.barIds[0]).not.toBe(r.barIds[1]);
      // Traceability is the whole requirement: a conflict nobody can follow back to two real
      // bars is a number, not a finding.
      expect(barIds.has(r.barIds[0]), `bar ${r.barIds[0]} exists in the document`).toBe(true);
      expect(barIds.has(r.barIds[1]), `bar ${r.barIds[1]} exists in the document`).toBe(true);
      expect(r.elementIds.length, 'the parent member is recorded').toBeGreaterThan(0);
      expect(Number.isFinite(r.at.x + r.at.y + r.at.z), 'it has a position').toBe(true);
      expect(Number.isFinite(r.clearance)).toBe(true);
      expect(Number.isFinite(r.required)).toBe(true);
    }
    // Six assertions across 40 065 conflicts is a quarter of a million of them — the point is
    // that a sample cannot prove "nothing is untraceable" — and that does not fit Vitest's 5 s
    // default on a loaded machine.
  }, 60_000);

  it('changes nothing about what the document reports', () => {
    // The inventory is a projection. Running it must not alter the conflicts, the readiness,
    // or anything else the document claims.
    const before = doc.openConflicts.length;
    const readiness = doc.readiness;
    buildConflictInventory(doc.openConflicts);
    expect(doc.openConflicts.length).toBe(before);
    expect(doc.readiness).toBe(readiness);
  });
});
