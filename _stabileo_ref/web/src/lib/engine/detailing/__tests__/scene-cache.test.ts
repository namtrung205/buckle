/**
 * The cache must be fast AND never wrong.
 *
 * Fast is the easy half. The half worth testing is staleness: a cache that serves a scene from
 * before a re-design, or from before a section edit, turns a performance fix into a viewer
 * that shows steel the model no longer contains — which is worse than the 2,4 s it saves.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  cachedSceneModel, membersSignature, resetSceneCache, sceneCacheStats,
} from '../scene-cache';
import { buildDocumentModel } from '../document-model';
import type { DetailingAssembly } from '../assembly';
import type { MemberGeometry } from '../scene-model';
import { buildStraightBarWithHooks, type BarPath } from '../../../codes/cirsoc201/bar-geometry';

const X = { x: 1, y: 0, z: 0 };
const UP = { x: 0, y: 0, z: 1 };

function bar(id: string): BarPath {
  return buildStraightBarWithHooks({
    id, diameterMm: 16, role: 'longitudinal',
    start: { x: 0, y: 0, z: 0.05 }, end: { x: 5, y: 0, z: 0.05 },
    axis: X, hookNormal: UP, ownerElementIds: [1], layerId: 'e1:bottom:0',
  });
}

function assembly(): DetailingAssembly {
  return {
    id: 'a', labelKey: 'detailing.assembly.level', labelParams: { level: '1' },
    kind: 'beamLine', elementIds: [1], bars: [bar('b1')], marks: [],
    joints: [], conflicts: [], unsupported: [],
    state: 'ISSUED', stateBlockers: [], detailingRevision: 1, demandRevision: 1,
    maturity: 'VALIDATED',
    provenance: { edition: '2025', verifierId: 'v', trace: [], assumptions: [] },
  } as unknown as DetailingAssembly;
}

function doc(revision = 1) {
  return buildDocumentModel({
    seriesId: 'S',
    revision: {
      number: revision, at: '2026-08-09T00:00:00Z', author: 'a',
      detailingRevision: 1, demandRevision: 1,
    },
    regulations: [{ id: 'cirsoc-201', edition: '2025' }],
    assemblies: [assembly()], laps: [], certificates: [],
  });
}

const MEMBERS: MemberGeometry[] = [{
  elementId: 1, kind: 'beam',
  start: { x: 0, y: 0, z: 0 }, end: { x: 5, y: 0, z: 0 },
  width: 0.2, depth: 0.5,
}];

describe('the cache serves one document, once', () => {
  beforeEach(() => resetSceneCache());

  it('returns the SAME scene for the same document and members', () => {
    const d = doc();
    const a = cachedSceneModel(d, MEMBERS);
    const b = cachedSceneModel(d, [...MEMBERS]);
    // A fresh array with identical content must hit: `membersFromModel` returns a new one on
    // every call, which is precisely why the scene was being rebuilt on every reactive touch.
    expect(b).toBe(a);
    expect(sceneCacheStats()).toEqual({ hits: 1, misses: 1 });
  });
});

describe('the cache is never stale', () => {
  beforeEach(() => resetSceneCache());

  it('rebuilds when the DOCUMENT is rebuilt', () => {
    /**
     * By identity, deliberately. `buildDocument` produces a new object every run, and that is
     * exactly when the scene must be rebuilt: a document rebuilt from the same detailing is
     * still a new statement with its own revision and readiness on its face.
     */
    const first = cachedSceneModel(doc(1), MEMBERS);
    const second = cachedSceneModel(doc(2), MEMBERS);
    expect(second).not.toBe(first);
    expect(second.revision).toBe(2);
  });

  it('rebuilds when a section is edited', () => {
    const d = doc();
    const before = cachedSceneModel(d, MEMBERS);
    const widened = [{ ...MEMBERS[0], width: 0.4 }];
    const after = cachedSceneModel(d, widened);
    expect(after).not.toBe(before);
    // And the new geometry is actually in it, not just a new object.
    const solid = after.solids.find((s) => s.id === 'member:1')!;
    const ys = solid.base.map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.4, 9);
  });

  it('rebuilds when a member moves', () => {
    const d = doc();
    const before = cachedSceneModel(d, MEMBERS);
    const moved = [{ ...MEMBERS[0], end: { x: 7, y: 0, z: 0 } }];
    expect(cachedSceneModel(d, moved)).not.toBe(before);
  });

  it('rebuilds when a member is added or removed', () => {
    const d = doc();
    const before = cachedSceneModel(d, MEMBERS);
    expect(cachedSceneModel(d, [])).not.toBe(before);
  });
});

describe('the members signature covers what the projection reads', () => {
  it('changes with the section, the position and the roll', () => {
    const base = membersSignature(MEMBERS);
    expect(membersSignature([{ ...MEMBERS[0], width: 0.21 }])).not.toBe(base);
    expect(membersSignature([{ ...MEMBERS[0], depth: 0.51 }])).not.toBe(base);
    expect(membersSignature([{ ...MEMBERS[0], rollDeg: 30 }])).not.toBe(base);
    expect(membersSignature([{ ...MEMBERS[0], start: { x: 1, y: 0, z: 0 } }])).not.toBe(base);
    expect(membersSignature([{ ...MEMBERS[0], kind: 'column' }])).not.toBe(base);
  });

  it('is stable under float noise below a millimetre', () => {
    // The geometry is authored to the millimetre. Letting the last bits of a double defeat the
    // cache would spend seconds to redraw a picture nobody could tell apart.
    expect(membersSignature([{ ...MEMBERS[0], width: 0.2 + 1e-9 }]))
      .toBe(membersSignature(MEMBERS));
  });
});
