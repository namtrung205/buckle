/**
 * Static guard: the canonical detailed-analysis path must not reach the legacy
 * geometry resolver.
 *
 * The legacy resolver infers a shape from the profile NAME and invents
 * thicknesses when they are missing — measured, a 40 % error in the shear
 * stress of an I-profile. A geometry-backed section has an exact outline, so
 * touching that code would silently reintroduce the defect the whole canonical
 * layer exists to remove.
 *
 * Source-level, because what matters is that no path CAN reach it, not that a
 * particular call happened not to.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Every module in the canonical detailed-analysis path. */
const CANONICAL_MODULES = [
  '../canonical.ts',
  '../state.ts',
  '../drawing.ts',
  '../panel.ts',
  '../migration.ts',
  '../version.ts',
];

describe('canonical modules never touch the legacy resolver', () => {
  for (const rel of CANONICAL_MODULES) {
    it(`${rel.replace('../', '')} does not import or call it`, () => {
      const src = read(rel);
      expect(src).not.toMatch(/resolveSectionGeometry\b/);
      expect(src).not.toMatch(/resolveSectionGeometryLegacy/);
      expect(src).not.toContain("from '../engine/section-stress'");
      expect(src).not.toContain("from '../engine/section-stress-3d'");
    });
  }

  it('no canonical module infers geometry from a profile name', () => {
    for (const rel of CANONICAL_MODULES) {
      const src = read(rel);
      // Name-based shape inference looked like startsWith('IPE') / match(/^L\d/).
      expect(src, rel).not.toMatch(/startsWith\(['"](IPE|HEB|HEA|UPN|IPN|RHS)/);
      expect(src, rel).not.toMatch(/\/\^L\\s\?\\d\//);
    }
  });

  it('no canonical module invents a thickness', () => {
    for (const rel of CANONICAL_MODULES) {
      const src = read(rel);
      // The old fallbacks: tw = b*0.05, tf = h*0.06, t = min(b,h)*0.05 ...
      expect(src, rel).not.toMatch(/\b(tw|tf|t)\s*=\s*\w+\s*\*\s*0\.\d/);
      expect(src, rel).not.toMatch(/\?\?\s*\w+\s*\*\s*0\.0\d/);
    }
  });
});

describe('the legacy resolver is named so it cannot be mistaken for canonical', () => {
  it('is exported only under its Legacy name and marked deprecated', () => {
    const src = read('../../engine/section-stress.ts');
    expect(src).toContain('export function resolveSectionGeometryLegacy');
    expect(src).not.toMatch(/export function resolveSectionGeometry\b\(/);
    expect(src).toContain('@deprecated');
  });

  it('its two remaining consumers are the legacy stress modules only', () => {
    const consumers = ['../../engine/section-stress.ts', '../../engine/section-stress-3d.ts'];
    for (const rel of consumers) {
      expect(read(rel)).toContain('resolveSectionGeometryLegacy');
    }
  });
});
