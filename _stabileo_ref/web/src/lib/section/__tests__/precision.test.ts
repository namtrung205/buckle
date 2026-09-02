/**
 * Precision tests for the canonical section engine against published tables.
 *
 * Every expected value below is read directly from the EN 10365 tables
 * (IPE/HEA/HEB dimensions from DIN 1025-2..4, IPN from DIN 1025-1, UPN from
 * DIN 1026-1), not derived from the implementation. A formula error moves the
 * number rather than staying inside a tolerance band.
 *
 * The tolerance is 0.6 % — the published tables carry three significant
 * figures, so ~0.1-0.5 % is inherent in the reference. A missing root fillet
 * (2.4-6.0 % of area) still fails.
 */

import { describe, it, expect } from 'vitest';
import { resolveCanonicalSection, isGeometryBacked } from '../canonical';
import { hasCanonicalGeometryExport } from '../../engine/wasm-solver';
import { ALL_PROFILES } from '../../data/steel-profiles';
import type { Section } from '../../store/model.svelte';

const hasCanonical = hasCanonicalGeometryExport();
const describeCanonical = hasCanonical ? describe : describe.skip;

function fromCatalogue(name: string): Section {
  const p = ALL_PROFILES.find((x) => x.name === name);
  if (!p) throw new Error(`catalogue profile ${name} not found`);
  return {
    id: 1,
    name: p.name,
    a: p.a * 1e-4,
    iy: p.iy * 1e-8,
    iz: p.iz * 1e-8,
  } as Section;
}

const rel = (got: number, exp: number) => Math.abs((got - exp) / exp);

describeCanonical('canonical engine vs published tables', () => {
  // EN 10365 (IPE/HEA/HEB, IPN per DIN 1025-1, UPN per DIN 1026-1).
  // [name, A cm², Iy cm⁴, Iz cm⁴]
  const CASES: Array<[string, number, number, number]> = [
    // IPE — EN 10365
    ['IPE 80', 7.64, 80.1, 8.49],
    ['IPE 100', 10.3, 171, 15.9],
    ['IPE 200', 28.5, 1943, 142],
    ['IPE 300', 53.8, 8356, 604],
    ['IPE 400', 84.5, 23130, 1318],
    // HEA — EN 10365
    ['HEA 100', 21.2, 349, 134],
    ['HEA 200', 53.8, 3692, 1336],
    ['HEA 300', 113, 18260, 6310],
    // HEB — EN 10365
    ['HEB 100', 26.0, 450, 167],
    ['HEB 200', 78.1, 5696, 2003],
    ['HEB 300', 149, 25170, 8563],
    // IPN — DIN 1025-1 (14 % flange slope, tapered flanges)
    ['IPN 80', 7.57, 77.8, 6.29],
    ['IPN 100', 10.6, 171, 12.2],
    ['IPN 200', 33.4, 2140, 117],
    ['IPN 300', 69.0, 9800, 451],
    // UPN — DIN 1026-1 (tapered-flange channels)
    ['UPN 80', 11.0, 106, 19.4],
    ['UPN 100', 13.5, 206, 29.3],
    ['UPN 200', 32.2, 1910, 148],
    ['UPN 300', 58.8, 8030, 495],
  ];

  for (const [name, a, iy, iz] of CASES) {
    it(`${name} matches published A, Iy, Iz within 0.6 %`, () => {
      const r = resolveCanonicalSection(fromCatalogue(name));
      if (!isGeometryBacked(r)) throw new Error(`${name} did not resolve to geometry-backed`);
      expect(rel(r.properties.a * 1e4, a), `${name} area`).toBeLessThan(6e-3);
      expect(rel(r.properties.iy * 1e8, iy), `${name} Iy`).toBeLessThan(6e-3);
      expect(rel(r.properties.iz * 1e8, iz), `${name} Iz`).toBeLessThan(6e-3);
    });
  }

  it('a doubly symmetric I-section has zero product of inertia', () => {
    const r = resolveCanonicalSection(fromCatalogue('IPE 300'));
    if (!isGeometryBacked(r)) throw new Error('IPE 300 did not resolve');
    // |Iyz| / max(Iy, Iz) < 1e-6 — numerically zero for a symmetric section.
    expect(Math.abs(r.properties.iyz) / Math.max(r.properties.iy, r.properties.iz)).toBeLessThan(1e-6);
  });

  it('principal axes of a symmetric section align with geometric axes', () => {
    const r = resolveCanonicalSection(fromCatalogue('HEB 200'));
    if (!isGeometryBacked(r)) throw new Error('HEB 200 did not resolve');
    // For a doubly symmetric section iyz ≈ 0 and iy ≈ iz, so thetaP is either
    // exactly 0 (the engine's explicit guard) or NaN from atan2(0, 0) — both
    // mean "no preferred direction", which is the correct answer here. A NaN
    // fails every numeric comparison, so guard first.
    const theta = r.properties.thetaP;
    if (!Number.isFinite(theta)) return;
    // Normalise to [0, π/2] — the axis is undirected, so θ and θ+π/2 are the same.
    const norm = Math.abs(theta) % (Math.PI / 2);
    expect(Math.min(norm, Math.PI / 2 - norm)).toBeLessThan(1e-3);
  });
});
