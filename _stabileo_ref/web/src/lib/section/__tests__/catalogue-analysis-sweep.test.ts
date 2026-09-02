/**
 * Section analysis over the whole shipped catalogue.
 *
 * "It works" for a section engine has to mean every profile a user can pick,
 * not the handful anyone thinks to try. Eight rolled channels used to panic
 * here — `unreachable`, a Rust panic surfacing through WASM — because their toe
 * fillet did not fit the flange tip and the outline closed through a
 * 1.7-degree spike that no Delaunay refiner can mesh. Bending answered fine
 * throughout, because bending needs no mesh; only shear and torsion fell over,
 * and only on eight profiles out of seven hundred.
 *
 * That is exactly the shape of defect a sweep catches and a spot check does not.
 *
 * Split in two on purpose: resolving and drawing is cheap and runs over
 * everything, while a full stress state meshes and solves and would take
 * minutes over the catalogue, so it runs on a representative sample — the
 * smallest and largest of every family, since degeneracies live at the extremes.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { initSolver } from '../../engine/wasm-solver';
import { ALL_PROFILES } from '../../data/steel-profiles';
import { resolveSectionState } from '../state';
import { canonicalStressState } from '../stress-state';
import { drawingGeometry } from '../drawing';
import type { Section } from '../../store/model.svelte';

beforeAll(async () => { await initSolver(); }, 60_000);

function asSection(p: (typeof ALL_PROFILES)[number], torsion = false): Section {
  const s = { id: 1, name: p.name, a: p.a * 1e-4, iy: p.iy * 1e-8, iz: p.iz * 1e-8 } as Section;
  s.canonical = resolveSectionState(s, { torsion });
  return s;
}

/** Smallest and largest of each family, where degenerate geometry shows up. */
function sample() {
  const byFamily = new Map<string, typeof ALL_PROFILES>();
  for (const p of ALL_PROFILES) {
    const list = byFamily.get(p.family) ?? [];
    list.push(p);
    byFamily.set(p.family, list);
  }
  const out: typeof ALL_PROFILES = [];
  for (const list of byFamily.values()) {
    const sorted = [...list].sort((a, b) => a.a - b.a);
    out.push(sorted[0], sorted[sorted.length - 1], sorted[Math.floor(sorted.length / 2)]);
  }
  return [...new Set(out)];
}

describe('every profile resolves and draws', () => {
  it('produces a finite outline with a real area', () => {
    const failures: string[] = [];
    for (const p of ALL_PROFILES) {
      const s = asSection(p);
      if (s.canonical?.kind !== 'geometry-backed') continue; // MC, documented
      try {
        const g = drawingGeometry(s.canonical);
        const [yMin, zMin, yMax, zMax] = g.bbox;
        if (!(yMax > yMin) || !(zMax > zMin)) failures.push(`${p.name}: empty bbox`);
        if (!g.solids.length) failures.push(`${p.name}: no outline`);
        if (!Number.isFinite(s.canonical.a) || s.canonical.a <= 0) failures.push(`${p.name}: area ${s.canonical.a}`);
      } catch (e) {
        failures.push(`${p.name}: ${(e as Error)?.message ?? e}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('only MC lacks geometry, and the count is stated rather than drifting', () => {
    const without = ALL_PROFILES.filter((p) => asSection(p).canonical?.kind !== 'geometry-backed');
    expect(new Set(without.map((p) => p.family))).toEqual(new Set(['MC']));
    expect(without.length).toBe(33);
  });
});

describe('a representative profile of every family carries a full stress state', () => {
  it('meshes, solves shear and torsion, and returns finite stresses', () => {
    const failures: string[] = [];
    for (const p of sample()) {
      const s = asSection(p, true);
      if (s.canonical?.kind !== 'geometry-backed') continue;
      const [, , , zMax] = drawingGeometry(s.canonical).bbox;
      const r = canonicalStressState(s, { n: 50, my: 30, mz: 5, vy: 10, vz: 20, t: 3 }, [0, zMax], 235);
      if (!r.ok) { failures.push(`${p.name}: ${r.reason} ${r.message ?? ''}`); continue; }
      const { sigma, tau, failure } = r.state;
      if (![sigma, tau, failure.vonMises].every(Number.isFinite)) {
        failures.push(`${p.name}: non-finite (σ=${sigma} τ=${tau})`);
      }
      // A stress state that is finite but absurd is still wrong.
      if (Math.abs(sigma) > 1e6) failures.push(`${p.name}: σ = ${sigma} MPa is not physical`);
    }
    expect(failures).toEqual([]);
  }, 120_000);

  it('the sample really does span every family', () => {
    expect(new Set(sample().map((p) => p.family)).size).toBe(
      new Set(ALL_PROFILES.map((p) => p.family)).size,
    );
  });
});
