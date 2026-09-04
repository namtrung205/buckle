/**
 * Plastic moduli and the warping constant, through the web path.
 *
 * `Z` is what a limit-state check needs and `Cw` is what lateral-torsional
 * buckling needs alongside `J`; between them they are the last section
 * properties the app could not produce. The values are checked against closed
 * forms and against the published tables, never against the code itself.
 */

import { describe, it, expect } from 'vitest';
import { analyzeSectionPlastic } from '../../engine/wasm-solver';
import { resolveCanonicalSection } from '../canonical';
import { ALL_PROFILES } from '../../data/steel-profiles';
import type { Section } from '../../store/model.svelte';

function geometryOf(over: Partial<Section>) {
  const r = resolveCanonicalSection({ id: 1, name: '', a: 0.01, iz: 1e-5, ...over } as Section);
  if (r.state !== 'geometry-backed') throw new Error('expected geometry-backed');
  return r.geometry;
}
function fromCatalogue(name: string) {
  const p = ALL_PROFILES.find((x) => x.name === name)!;
  return { profile: p, geometry: geometryOf({ name: p.name, a: p.a * 1e-4, iy: p.iy * 1e-8, iz: p.iz * 1e-8 }) };
}

describe('plastic moduli', () => {
  it('a rectangle gives b h² / 4', () => {
    const g = geometryOf({ shape: 'rect', b: 0.2, h: 0.4 });
    const r = analyzeSectionPlastic({ geometry: g });
    expect(r.zy / (0.2 * 0.4 ** 2 / 4)).toBeCloseTo(1, 2);
    expect(r.zz / (0.4 * 0.2 ** 2 / 4)).toBeCloseTo(1, 2);
  });

  it('the shape factor is 1.5 for a rectangle and much smaller for a rolled I', () => {
    // The reserve past first yield, and the reason Z matters at all.
    const rect = analyzeSectionPlastic({ geometry: geometryOf({ shape: 'rect', b: 0.2, h: 0.4 }) });
    expect(rect.zy / rect.sy).toBeCloseTo(1.5, 1);

    const { geometry } = fromCatalogue('IPE 300');
    const ipe = analyzeSectionPlastic({ geometry });
    const factor = ipe.zy / ipe.sy;
    expect(factor).toBeGreaterThan(1.05);
    expect(factor).toBeLessThan(1.25);
  });

  it('rolled profiles land on their published plastic modulus', () => {
    // Zx in cm³, from the CIRSOC 301-EL tables.
    for (const [name, published] of [['IPE 200', 220], ['IPE 300', 628], ['IPE 360', 1020]] as const) {
      const { geometry } = fromCatalogue(name);
      const r = analyzeSectionPlastic({ geometry });
      // Geometry is in metres, so Z comes back in m³; tables are cm³.
      expect(Math.abs((r.zy * 1e6) / published - 1), name).toBeLessThan(0.05);
    }
  });

  it('a symmetric section has its plastic axis at the centroid, a tee does not', () => {
    const ipe = analyzeSectionPlastic({ geometry: fromCatalogue('IPE 300').geometry });
    expect(Math.abs(ipe.pnaZ)).toBeLessThan(0.002);

    const tee = analyzeSectionPlastic({ geometry: geometryOf({ shape: 'T', h: 0.2, b: 0.15, tw: 0.008, tf: 0.012 }) });
    expect(Math.abs(tee.pnaZ)).toBeGreaterThan(0.005);
  });
});

describe('warping constant', () => {
  it('an I-profile matches the flange-couple formula', () => {
    const { profile, geometry } = fromCatalogue('IPE 300');
    const r = analyzeSectionPlastic({ geometry });
    expect(r.cw).toBeDefined();
    // Cw = Iz (h - tf)² / 4, the two flanges acting as a couple.
    const iz = profile.iz * 1e-8;
    const closed = (iz * (profile.h / 1000 - profile.tf! / 1000) ** 2) / 4;
    expect(Math.abs(r.cw! / closed - 1)).toBeLessThan(0.2);
  });

  it('a closed tube reports no warping constant rather than an overstated one', () => {
    // A closed cell barely warps, and solving it without the circulation
    // condition would overstate Cw. Absent is the honest answer.
    const r = analyzeSectionPlastic({ geometry: fromCatalogue('RHS 120x60x4').geometry });
    expect(r.cw).toBeUndefined();
    // The plastic moduli are still produced — only warping is refused.
    expect(r.zy).toBeGreaterThan(0);
  });

  it('a deeper profile warps more, roughly as the square of the flange spacing', () => {
    const shallow = analyzeSectionPlastic({ geometry: fromCatalogue('IPE 200').geometry });
    const deep = analyzeSectionPlastic({ geometry: fromCatalogue('IPE 400').geometry });
    expect(deep.cw! / shallow.cw!).toBeGreaterThan(5);
  });
});
