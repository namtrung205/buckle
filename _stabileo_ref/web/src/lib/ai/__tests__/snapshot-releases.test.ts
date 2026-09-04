/**
 * Task D4 — typed end releases in the AI model snapshot.
 *
 * Two directions are covered:
 *  1. Outgoing (store -> AI request): the per-element serializer must include
 *     releaseI/releaseJ ONLY when some flag is true, to keep the snapshot
 *     payload compact (every frame element otherwise repeats
 *     `{my:false,mz:false,t:false}` twice for zero information).
 *  2. Incoming (AI response -> store, the Build tab's Apply flow): releases
 *     must round-trip through modelStore.restore() — the same normalization
 *     `fastRebuild()` uses — defaulting absent fields to NO_RELEASE, and the
 *     shape guard used by the Apply validator must reject malformed shapes
 *     the way it rejects other bad fields (not throw, just flag invalid).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { modelStore, NO_RELEASE } from '../../store/model.svelte';
import {
  serializeElementForAi,
  compactElementsForAi,
  compactSnapshotForAi,
  isValidReleaseShape,
  normalizeAiRelease,
  normalizeSnapshotReleases,
} from '../build-model';

describe('serializeElementForAi (outgoing compaction)', () => {
  it('includes releaseI when some flag is true', () => {
    const el = {
      id: 1, type: 'frame', nodeI: 1, nodeJ: 2, materialId: 1, sectionId: 1,
      releaseI: { my: false, mz: true, t: false },
      releaseJ: { ...NO_RELEASE },
    };
    const out = serializeElementForAi(el);
    expect(out.releaseI).toEqual({ my: false, mz: true, t: false });
  });

  it('omits releaseI/releaseJ when both ends are all-false (default)', () => {
    const el = {
      id: 2, type: 'frame', nodeI: 1, nodeJ: 2, materialId: 1, sectionId: 1,
      releaseI: { ...NO_RELEASE },
      releaseJ: { ...NO_RELEASE },
    };
    const out = serializeElementForAi(el);
    expect(out).not.toHaveProperty('releaseI');
    expect(out).not.toHaveProperty('releaseJ');
    // Rest of the element still serializes normally.
    expect(out).toMatchObject({ id: 2, type: 'frame', nodeI: 1, nodeJ: 2 });
  });

  it('omits releaseI/releaseJ when absent entirely', () => {
    const el = { id: 3, type: 'frame', nodeI: 1, nodeJ: 2, materialId: 1, sectionId: 1 };
    const out = serializeElementForAi(el);
    expect(out).not.toHaveProperty('releaseI');
    expect(out).not.toHaveProperty('releaseJ');
  });

  it('includes releaseJ independently of releaseI', () => {
    const el = {
      id: 4, type: 'frame', nodeI: 1, nodeJ: 2, materialId: 1, sectionId: 1,
      releaseI: { ...NO_RELEASE },
      releaseJ: { my: true, mz: false, t: false },
    };
    const out = serializeElementForAi(el);
    expect(out).not.toHaveProperty('releaseI');
    expect(out.releaseJ).toEqual({ my: true, mz: false, t: false });
  });

  it('compactElementsForAi maps a [id, element][] array (ModelSnapshot.elements shape)', () => {
    const elements: Array<[number, Record<string, unknown>]> = [
      [1, { id: 1, type: 'frame', nodeI: 1, nodeJ: 2, releaseI: { ...NO_RELEASE }, releaseJ: { ...NO_RELEASE } }],
      [2, { id: 2, type: 'frame', nodeI: 2, nodeJ: 3, releaseI: { my: false, mz: true, t: false }, releaseJ: { ...NO_RELEASE } }],
    ];
    const out = compactElementsForAi(elements as any);
    expect(out[0][1]).not.toHaveProperty('releaseI');
    expect(out[1][1]).toHaveProperty('releaseI', { my: false, mz: true, t: false });
  });

  it('compactSnapshotForAi compacts only the elements array of a full snapshot payload', () => {
    modelStore.clear();
    modelStore.addNode(0, 0);
    modelStore.addNode(6, 0);
    const elemId = modelStore.addElement(1, 2, 'frame');
    modelStore.toggleRelease(elemId, 'i', 'mz');

    // modelStore.snapshot() already unwraps Svelte 5 proxies internally (it's a
    // .svelte.ts module); `$state.snapshot()` itself is unavailable outside
    // .svelte/.svelte.ts files, so a plain .test.ts caller (like AiDrawer's own
    // production call site would if it weren't a .svelte file) uses the return
    // value as-is.
    const raw = modelStore.snapshot() as unknown as Record<string, unknown>;
    // Sanity: the raw store snapshot is verbose (always carries both releases).
    const rawElements = raw.elements as Array<[number, Record<string, unknown>]>;
    expect(rawElements[0][1]).toHaveProperty('releaseJ');

    const compact = compactSnapshotForAi(raw);
    const compactElements = compact.elements as Array<[number, Record<string, unknown>]>;
    expect(compactElements[0][1]).toHaveProperty('releaseI', { my: false, mz: true, t: false });
    expect(compactElements[0][1]).not.toHaveProperty('releaseJ');
    // Non-element fields pass through untouched.
    expect(compact.nodes).toEqual(raw.nodes);
  });
});

describe('isValidReleaseShape / normalizeAiRelease (apply-path guard)', () => {
  it('accepts an absent release (defaults to NO_RELEASE downstream)', () => {
    expect(isValidReleaseShape(undefined)).toBe(true);
    expect(normalizeAiRelease(undefined)).toEqual(NO_RELEASE);
  });

  it('accepts a well-typed partial release and normalizes missing flags to false', () => {
    expect(isValidReleaseShape({ mz: true })).toBe(true);
    expect(normalizeAiRelease({ mz: true })).toEqual({ my: false, mz: true, t: false });
  });

  it('accepts a fully-specified release with slide fields', () => {
    expect(isValidReleaseShape({ my: false, mz: false, t: false, slide: 'x', slideAxis: 'local' })).toBe(true);
    expect(normalizeAiRelease({ my: false, mz: false, t: false, slide: 'x', slideAxis: 'local' }))
      .toEqual({ my: false, mz: false, t: false, slide: 'x', slideAxis: 'local' });
  });

  it('rejects malformed shapes: non-boolean flags', () => {
    expect(isValidReleaseShape({ my: 'yes' })).toBe(false);
    expect(isValidReleaseShape({ mz: 1 })).toBe(false);
  });

  it('rejects malformed shapes: wrong type entirely (string/array instead of object)', () => {
    expect(isValidReleaseShape('mz')).toBe(false);
    expect(isValidReleaseShape([true, false, false])).toBe(false);
    expect(isValidReleaseShape(42)).toBe(false);
  });

  it('rejects malformed shapes: invalid slide/slideAxis enum values', () => {
    expect(isValidReleaseShape({ slide: 'y' })).toBe(false);
    expect(isValidReleaseShape({ slideAxis: 'diagonal' })).toBe(false);
  });
});

describe('normalizeSnapshotReleases (wired into the Build tab Apply flow before fastRebuild())', () => {
  it('strips unknown keys from a well-shaped release (isValidReleaseShape admits extras)', () => {
    const snapshot = {
      elements: [
        [1, {
          id: 1, type: 'frame', nodeI: 1, nodeJ: 2, materialId: 1, sectionId: 1,
          releaseI: { mz: true, junk: 1 },
        }],
      ],
    };
    // Sanity: the shape guard alone lets the extra key through unchanged.
    expect(isValidReleaseShape((snapshot.elements[0][1] as any).releaseI)).toBe(true);

    const out = normalizeSnapshotReleases(snapshot);
    const el = (out.elements as any)[0][1];
    expect(el.releaseI).toEqual({ my: false, mz: true, t: false });
    expect(el.releaseI).not.toHaveProperty('junk');
  });

  it('leaves an absent releaseI/releaseJ absent (restore() defaults it, not this function)', () => {
    const snapshot = {
      elements: [
        [1, { id: 1, type: 'frame', nodeI: 1, nodeJ: 2, materialId: 1, sectionId: 1 }],
      ],
    };
    const out = normalizeSnapshotReleases(snapshot);
    const el = (out.elements as any)[0][1];
    expect(el).not.toHaveProperty('releaseI');
    expect(el).not.toHaveProperty('releaseJ');
  });

  it('normalizes releaseI and releaseJ independently on the same element', () => {
    const snapshot = {
      elements: [
        [1, {
          id: 1, type: 'frame', nodeI: 1, nodeJ: 2, materialId: 1, sectionId: 1,
          releaseJ: { my: true, extra: 'x' },
        }],
      ],
    };
    const out = normalizeSnapshotReleases(snapshot);
    const el = (out.elements as any)[0][1];
    expect(el).not.toHaveProperty('releaseI');
    expect(el.releaseJ).toEqual({ my: true, mz: false, t: false });
  });

  it('is a safe no-op when elements is missing or not an array', () => {
    expect(normalizeSnapshotReleases({ foo: 'bar' } as any)).toEqual({ foo: 'bar' });
    expect(normalizeSnapshotReleases({ elements: 'not-an-array' } as any)).toEqual({ elements: 'not-an-array' });
  });

  it('leaves non-element fields untouched', () => {
    const snapshot = { nodes: [[1, { id: 1, x: 0, y: 0 }]], elements: [] };
    const out = normalizeSnapshotReleases(snapshot);
    expect(out.nodes).toEqual(snapshot.nodes);
  });
});

describe('AI-returned model applies releases to the store (Build tab Apply flow)', () => {
  beforeEach(() => {
    modelStore.clear();
  });

  it('modelStore.restore() (the function fastRebuild() calls) defaults an absent releaseJ to NO_RELEASE', () => {
    modelStore.restore({
      nodes: [[1, { id: 1, x: 0, y: 0 }], [2, { id: 2, x: 6, y: 0 }]],
      materials: [[1, { id: 1, name: 'Steel A36', e: 200000, nu: 0.3, rho: 78.5 }]],
      sections: [[1, { id: 1, name: 'IPE 300', a: 0.00538, iz: 8.356e-5 }]],
      elements: [[1, {
        id: 1, type: 'frame', nodeI: 1, nodeJ: 2, materialId: 1, sectionId: 1,
        releaseI: { my: false, mz: true, t: false },
        // releaseJ intentionally absent — as an AI response would send it after compaction.
      } as any]],
      supports: [],
      loads: [],
      nextId: { node: 3, material: 2, section: 2, element: 2, support: 1, load: 1 },
    } as any);

    const elem = modelStore.elements.get(1)!;
    expect(elem.releaseI).toEqual({ my: false, mz: true, t: false });
    expect(elem.releaseJ).toEqual(NO_RELEASE);
  });

  it('an AI-returned model with no release fields at all defaults both ends to NO_RELEASE', () => {
    modelStore.restore({
      nodes: [[1, { id: 1, x: 0, y: 0 }], [2, { id: 2, x: 6, y: 0 }]],
      materials: [[1, { id: 1, name: 'Steel A36', e: 200000, nu: 0.3, rho: 78.5 }]],
      sections: [[1, { id: 1, name: 'IPE 300', a: 0.00538, iz: 8.356e-5 }]],
      elements: [[1, { id: 1, type: 'frame', nodeI: 1, nodeJ: 2, materialId: 1, sectionId: 1 } as any]],
      supports: [],
      loads: [],
      nextId: { node: 3, material: 2, section: 2, element: 2, support: 1, load: 1 },
    } as any);

    const elem = modelStore.elements.get(1)!;
    expect(elem.releaseI).toEqual(NO_RELEASE);
    expect(elem.releaseJ).toEqual(NO_RELEASE);
  });
});
