/**
 * The legacy stress path infers a section's shape from its NAME, which is the
 * defect the canonical path exists to remove. While that path still runs, the
 * families in the catalogue at least have to be recognised: an unrecognised
 * name falls through to 'generic' and is analysed as a featureless block, and
 * that would have silently happened to every IRAM family added recently.
 */

import { describe, it, expect } from 'vitest';
import { inferSectionShape } from '../section-stress';
import { ALL_PROFILES } from '../../data/steel-profiles';
import type { Section } from '../../store/model.svelte';

const asSection = (name: string): Section =>
  ({ id: 1, name, a: 0.01, iz: 1e-5 }) as Section;

describe('every catalogue family is recognised by the legacy shape inference', () => {
  it('no shipped profile falls through to generic', () => {
    const generic = ALL_PROFILES
      .filter((p) => inferSectionShape(asSection(p.name)) === 'generic')
      .map((p) => p.name);
    expect(generic).toEqual([]);
  });

  it('maps each family to the shape its stress formulas expect', () => {
    const cases: Array<[string, string]> = [
      ['IPE 300', 'I'], ['IPN 300', 'I'], ['HEB 200', 'H'], ['HEA 300', 'H'],
      ['W14x30', 'I'], ['HP14x117', 'H'], ['M12x11,8', 'I'],
      ['UPN 200', 'U'], ['C15x50', 'U'], ['MC18x58', 'U'],
      ['L 100x100x10', 'L'], ['CHS 88.9x3.2', 'CHS'],
      ['RHS 120x60x4', 'RHS'], ['SHS 100x100x4', 'RHS'],
    ];
    for (const [name, shape] of cases) {
      expect(inferSectionShape(asSection(name)), name).toBe(shape);
    }
  });

  it('an explicit shape always wins over the name', () => {
    // The property that keeps a rename from changing geometry wherever the
    // section actually carries its shape.
    const s = { ...asSection('IPE 300'), shape: 'rect' } as Section;
    expect(inferSectionShape(s)).toBe('rect');
  });
});
