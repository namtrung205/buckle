/**
 * Load-time canonical restoration.
 *
 * A saved digest is a claim, not an answer. Solver preparation reads cached
 * canonical values synchronously, so anything wrong here becomes wrong numbers
 * with no later chance to notice — these tests pin that a stored state is
 * always re-derived from the section's own dimensions and compared.
 */

import { describe, it, expect } from 'vitest';
import { restoreSectionState, restoreSections, supersededInertiaDelta } from '../migration';
import { resolveSectionState } from '../state';
import { CANONICAL_STATE_VERSION } from '../version';
import { ALL_PROFILES } from '../../data/steel-profiles';
import { modelStore } from '../../store/model.svelte';
import type { Section } from '../../store/model.svelte';

function sec(over: Partial<Section> & { id?: number }): Section {
  return { id: 1, name: '', a: 0.01, iz: 1e-5, ...over } as Section;
}
function fromCatalogue(name: string, id = 1): Section {
  const p = ALL_PROFILES.find((x) => x.name === name);
  if (!p) throw new Error(`no catalogue profile ${name}`);
  return sec({ id, name: p.name, a: p.a * 1e-4, iy: p.iy * 1e-8, iz: p.iz * 1e-8 });
}
/** A section as an OLD file would hold it: no canonical state at all. */
const legacy = (name: string, id = 1) => fromCatalogue(name, id);
/** An old file's section that never had a shape — declared by properties. */
const legacyBare = (name: string, id = 1) =>
  sec({ id, name, a: 0.05, iy: 4e-4, iz: 1e-4 });

// ─── Legacy files ──────────────────────────────────────────────────

describe('legacy files without canonical state', () => {
  it('a legacy IPE/HEA/HEB section is derived on load', () => {
    for (const name of ['IPE 300', 'HEA 300', 'HEB 200']) {
      const { section, outcome } = restoreSectionState(legacy(name));
      expect(outcome.kind, name).toBe('derived');
      expect(section.canonical!.kind).toBe('geometry-backed');
    }
  });

  it('a legacy tube is derived and lands on the exact annulus', () => {
    const p = ALL_PROFILES.find((x) => x.family === 'CHS' && x.h === 88.9)!;
    const { section, outcome } = restoreSectionState(legacy(p.name));
    expect(outcome.kind).toBe('derived');
    const st = section.canonical!;
    if (st.kind !== 'geometry-backed') throw new Error('expected geometry-backed');
    const ro = p.h / 2000, ri = ro - p.t! / 1000;
    const exact = (Math.PI / 4) * (ro ** 4 - ri ** 4);
    expect(Math.abs(st.iy - exact) / exact).toBeLessThan(2e-3);
  });

  it('a legacy shapeless section stays properties-only and still solves', () => {
    for (const name of ['Losa equivalente', 'Sección compuesta', 'Tabique', 'Viga cajón']) {
      const { section, outcome } = restoreSectionState(legacyBare(name));
      expect(outcome.kind, name).toBe('propertiesOnly');
      const st = section.canonical!;
      expect(st.kind).toBe('properties-only');
      if (st.kind === 'properties-only') {
        expect(st.a).toBeGreaterThan(0);
        expect(st.iz).toBeGreaterThan(0);
      }
    }
  });

  it('a legacy custom section with no shape stays properties-only', () => {
    const { section, outcome } = restoreSectionState(
      sec({ name: 'Old custom', a: 0.005, iy: 8e-5, iz: 2e-5 }),
    );
    expect(outcome.kind).toBe('propertiesOnly');
    expect(section.canonical!.kind).toBe('properties-only');
  });

  it('a legacy custom polygon with holes is derived as geometry-backed', () => {
    const { section, outcome } = restoreSectionState(
      sec({
        name: 'Box',
        polygon: [[0, 0], [0.2, 0], [0.2, 0.3], [0, 0.3]],
        holes: [[[0.05, 0.06], [0.15, 0.06], [0.15, 0.2], [0.05, 0.2]]],
      }),
    );
    expect(outcome.kind).toBe('derived');
    const st = section.canonical!;
    if (st.kind !== 'geometry-backed') throw new Error('expected geometry-backed');
    expect(st.geometry.polygons.filter((p) => p.isVoid).length).toBe(1);
    expect(Math.abs(st.a - (0.2 * 0.3 - 0.1 * 0.14)) / st.a).toBeLessThan(1e-12);
  });
});

// ─── The stored digest is checked, never trusted ───────────────────

describe('stored canonical state is verified against the geometry', () => {
  it('an unmodified section round-trips as verified', () => {
    const s = { ...fromCatalogue('IPE 300'), canonical: resolveSectionState(fromCatalogue('IPE 300')) };
    const { outcome } = restoreSectionState(s);
    expect(outcome.kind).toBe('verified');
  });

  it('a tampered digest is rejected and the re-derived state wins', () => {
    const base = fromCatalogue('IPE 300');
    const st = resolveSectionState(base);
    if (st.kind !== 'geometry-backed') throw new Error('geometry-backed');
    const tampered = { ...base, canonical: { ...st, digest: 'deadbeefdeadbeef' } };

    const { section, outcome } = restoreSectionState(tampered);
    expect(outcome.kind).toBe('digestMismatch');
    if (outcome.kind === 'digestMismatch') {
      expect(outcome.stored).toBe('deadbeefdeadbeef');
      expect(outcome.recomputed).toBe(st.digest);
    }
    expect(section.canonical!.kind).toBe('geometry-backed');
    if (section.canonical!.kind === 'geometry-backed') {
      expect(section.canonical!.digest).toBe(st.digest);
    }
  });

  it('stale derived properties are replaced, not published', () => {
    // A file whose stored area disagrees with its own dimensions: the
    // dimensions are the source of truth.
    const base = fromCatalogue('IPE 300');
    const st = resolveSectionState(base);
    if (st.kind !== 'geometry-backed') throw new Error('geometry-backed');
    const stale = { ...base, canonical: { ...st, a: st.a * 2, digest: 'staleaaaaaaaaaaa' } };

    const { section } = restoreSectionState(stale);
    const out = section.canonical!;
    if (out.kind !== 'geometry-backed') throw new Error('geometry-backed');
    expect(out.a).toBeCloseTo(st.a, 15);
    expect(out.a).not.toBeCloseTo(st.a * 2, 6);
  });

  it('an unsupported stored version is reported and re-derived', () => {
    const base = fromCatalogue('HEB 200');
    const st = resolveSectionState(base);
    if (st.kind !== 'geometry-backed') throw new Error('geometry-backed');
    const future = { ...base, canonical: { ...st, version: CANONICAL_STATE_VERSION + 7 } };

    const { section, outcome } = restoreSectionState(future);
    expect(outcome.kind).toBe('unsupportedVersion');
    if (outcome.kind === 'unsupportedVersion') {
      expect(outcome.stored).toBe(CANONICAL_STATE_VERSION + 7);
      expect(outcome.supported).toBe(CANONICAL_STATE_VERSION);
    }
    // Still usable: the dimensions still describe a valid section.
    expect(section.canonical!.kind).toBe('geometry-backed');
  });

  it('an invalid polygon degrades to properties-only and keeps the legacy values', () => {
    const { section, outcome } = restoreSectionState(
      sec({ name: 'Broken', a: 0.004, iz: 3e-5, polygon: [[0, 0], [1, 0], [2, 0]] }),
    );
    expect(outcome.kind).toBe('propertiesOnly');
    // The declared values survive so the model still solves globally.
    expect(section.a).toBe(0.004);
    expect(section.iz).toBe(3e-5);
  });
});

// ─── Idempotence ───────────────────────────────────────────────────

describe('save / open is a fixed point', () => {
  it('restoring twice gives an identical digest and properties', () => {
    const first = restoreSectionState(legacy('IPE 300')).section;
    const second = restoreSectionState(first).section;
    const third = restoreSectionState(second).section;
    const [a, b, c] = [first.canonical!, second.canonical!, third.canonical!];
    if (a.kind !== 'geometry-backed' || b.kind !== 'geometry-backed' || c.kind !== 'geometry-backed') {
      throw new Error('geometry-backed');
    }
    expect(b.digest).toBe(a.digest);
    expect(c.digest).toBe(a.digest);
    expect(b.a).toBe(a.a);
    expect(c.iy).toBe(a.iy);
  });

  it('a full JSON save/open cycle does not drift geometry or properties', () => {
    const saved = restoreSectionState(legacy('CHS 88.9x4')).section;
    const reopened = restoreSectionState(JSON.parse(JSON.stringify(saved))).section;
    const [a, b] = [saved.canonical!, reopened.canonical!];
    if (a.kind !== 'geometry-backed' || b.kind !== 'geometry-backed') throw new Error('geometry-backed');
    expect(b.digest).toBe(a.digest);
    expect(b.a).toBe(a.a);
    expect(b.iy).toBe(a.iy);
    expect(b.jProvenance).toBe(a.jProvenance);
    expect(b.geometry.arcSegments).toBe(a.geometry.arcSegments);
    expect(b.geometry.polygons.length).toBe(a.geometry.polygons.length);
  });

  it('restoring a whole model returns a fresh Map with no shared arrays', () => {
    const input = new Map<number, Section>([
      [1, legacy('IPE 300', 1)],
      [2, legacyBare('Losa equivalente', 2)],
    ]);
    const { sections, outcomes } = restoreSections(input);
    expect(sections).not.toBe(input);
    expect(sections.get(1)).not.toBe(input.get(1));
    expect(outcomes.get(1)!.kind).toBe('derived');
    expect(outcomes.get(2)!.kind).toBe('propertiesOnly');
  });
});

// ─── Superseded catalogue values stay auditable ────────────────────

describe('superseded CHS inertias', () => {
  it('a legacy file carrying an old value is recognised, by value not by name', () => {
    const old = sec({ name: 'Whatever the user renamed it', a: 4.53e-4, iz: 12.3e-8, iy: 12.3e-8 });
    const delta = supersededInertiaDelta(old);
    expect(delta).not.toBeNull();
    expect(delta!.profile).toBe('CHS 48.3x3.2');
    expect(delta!.superseded).toBe(12.3);
    expect(delta!.corrected).toBe(11.59);
  });

  it('a corrected value is not flagged', () => {
    expect(supersededInertiaDelta(sec({ iz: 11.59e-8 }))).toBeNull();
  });

  it('an unrelated section is not flagged', () => {
    expect(supersededInertiaDelta(fromCatalogue('IPE 300'))).toBeNull();
  });
});

// ─── The real restore path ─────────────────────────────────────────

describe('modelStore.restore resolves canonical state', () => {
  it('a snapshot restored into the store comes back geometry-backed', () => {
    modelStore.clear();
    const snapshot = {
      ...modelStore.snapshot(),
      sections: [[1, legacy('IPE 300', 1)]] as never,
    };
    modelStore.restore(snapshot as never);
    const restored = modelStore.sections.get(1)!;
    expect(restored.canonical).toBeDefined();
    expect(restored.canonical!.kind).toBe('geometry-backed');
    modelStore.clear();
  });

  it('restoring twice through the store is stable', () => {
    modelStore.clear();
    const snap = { ...modelStore.snapshot(), sections: [[1, legacy('HEB 200', 1)]] as never };
    modelStore.restore(snap as never);
    const first = modelStore.sections.get(1)!.canonical!;
    modelStore.restore(modelStore.snapshot());
    const second = modelStore.sections.get(1)!.canonical!;
    if (first.kind !== 'geometry-backed' || second.kind !== 'geometry-backed') throw new Error('geometry-backed');
    expect(second.digest).toBe(first.digest);
    modelStore.clear();
  });
});
