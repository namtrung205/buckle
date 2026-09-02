/**
 * Canonical state must exist by the time the panel asks for it.
 *
 * Reported defect: selecting any standard catalogue profile and opening
 * Section Analysis reported "la sección seleccionada es amorfa" — an amorphous
 * section — even though a real profile was assigned and visible in both the
 * side panel and the element.
 *
 * Cause: `canonical` was populated only by `updateSection` and by restoring a
 * snapshot. A section created with `addSection` — which is what examples and
 * the default section use — never had it, so `supportsDetailedAnalysis`
 * correctly answered "no known geometry" and the panel refused. Compounding
 * it, the engine initialises asynchronously, so even a resolve at creation
 * time would have yielded properties-only at startup with nothing to revisit
 * it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { modelStore } from '../../store/model.svelte';
import { supportsDetailedAnalysis } from '../drawing';
import { canonicalPanelResult } from '../panel';
import { ALL_PROFILES } from '../../data/steel-profiles';

const cat = (name: string) => {
  const p = ALL_PROFILES.find((x) => x.name === name)!;
  return { name: p.name, a: p.a * 1e-4, iy: p.iy * 1e-8, iz: p.iz * 1e-8 };
};

beforeEach(() => modelStore.clear());

describe('a section added through the normal path is immediately analysable', () => {
  for (const name of ['IPE 300', 'HEA 300', 'HEB 200', 'CHS 88.9x4']) {
    it(`${name} is geometry-backed straight after addSection`, () => {
      const id = modelStore.addSection(cat(name));
      const sec = modelStore.sections.get(id)!;
      expect(sec.canonical, `${name} must carry canonical state on creation`).toBeDefined();
      expect(sec.canonical!.kind).toBe('geometry-backed');
      // The exact predicate the panel uses to decide "amorphous".
      expect(supportsDetailedAnalysis(sec), `${name} must not read as amorphous`).toBe(true);
    });
  }

  it('the panel produces a real result for a freshly added profile', () => {
    const id = modelStore.addSection(cat('IPE 300'));
    const sec = modelStore.sections.get(id)!;
    const r = canonicalPanelResult(sec, { n: 100, my: 50, mz: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bending.digest).toBe(r.geometry.digest);
  });

  it('the default section resolves to real geometry, so the panel works out of the box', () => {
    // `modelStore.clear()` restores the built-in default, an IPN 300. This
    // used to be the one profile a brand-new model could not analyse, which is
    // how a user first hit the refusal: open the app, ask for Section
    // Analysis, get told the section was amorphous. The default is unchanged;
    // what changed is that IPN now has geometry, so the out-of-the-box path
    // works rather than dead-ending.
    const first = [...modelStore.sections.values()][0];
    expect(first).toBeDefined();
    expect(first.name).toContain('IPN');
    modelStore.refreshCanonicalSections();
    const refreshed = [...modelStore.sections.values()][0];
    expect(refreshed.canonical).toBeDefined();
    expect(refreshed.canonical!.kind).toBe('geometry-backed');
    expect(supportsDetailedAnalysis(refreshed)).toBe(true);
  });

  it('a section declared by properties alone still refuses detailed analysis', () => {
    // Every catalogue family is geometry-backed now, so the refusal path is
    // reached only by a section the user declares with properties and no
    // shape — an equivalent slab, a composite member sized by hand.
    for (const spec of [
      { name: 'Losa equivalente', a: 0.05, iy: 4e-4, iz: 1e-4 },
      { name: 'Sección compuesta', a: 0.02, iy: 9e-5, iz: 3e-5 },
    ]) {
      const id = modelStore.addSection(spec);
      const s = modelStore.sections.get(id)!;
      expect(s.canonical!.kind, spec.name).toBe('properties-only');
      expect(supportsDetailedAnalysis(s), spec.name).toBe(false);
    }
  });
});

describe('refreshCanonicalSections repairs sections resolved before the engine was ready', () => {
  it('upgrades a section that carries no canonical state at all', () => {
    const id = modelStore.addSection(cat('HEB 200'));
    // Simulate the startup ordering: state stripped, as it would be if the
    // engine had not been initialised when the model loaded.
    const stripped = { ...modelStore.sections.get(id)!, canonical: undefined };
    modelStore.sections.set(id, stripped);
    expect(supportsDetailedAnalysis(modelStore.sections.get(id)!)).toBe(false);

    modelStore.refreshCanonicalSections();

    const after = modelStore.sections.get(id)!;
    expect(after.canonical!.kind).toBe('geometry-backed');
    expect(supportsDetailedAnalysis(after)).toBe(true);
  });

  it('is idempotent and preserves the digest', () => {
    const id = modelStore.addSection(cat('IPE 300'));
    modelStore.refreshCanonicalSections();
    const first = modelStore.sections.get(id)!.canonical!;
    modelStore.refreshCanonicalSections();
    modelStore.refreshCanonicalSections();
    const last = modelStore.sections.get(id)!.canonical!;
    if (first.kind !== 'geometry-backed' || last.kind !== 'geometry-backed') throw new Error('geometry-backed');
    expect(last.digest).toBe(first.digest);
  });

  it('does not invalidate existing results — deriving geometry is not a model edit', () => {
    modelStore.addSection(cat('IPE 300'));
    const versionBefore = modelStore.modelVersion;
    modelStore.refreshCanonicalSections();
    expect(modelStore.modelVersion).toBe(versionBefore);
  });
});
