/**
 * Every design code offers families that actually exist, and every family is
 * reachable from some code.
 *
 * Basic ships four regions — Argentina, Europe, the United States and Brazil —
 * and the picker is filtered by design code. Two failures are possible and both
 * are silent: a code listing a family with no profiles behind it, which empties
 * the picker with no explanation, and a family shipped without belonging to any
 * code, which strands the profiles behind it — 721 across the 15 families at
 * this writing — for anyone who has chosen a code.
 *
 * Neither shows up in a type check or a rendering test, because both are
 * questions about the DATA agreeing with itself.
 *
 * Eurocode 3 was the second kind of failure in reverse: it carried an
 * explanatory note about which tubes are shipped while listing no hollow family
 * at all, so a European user read an explanation of something they could not
 * select.
 */

import { describe, it, expect } from 'vitest';
import {
  DESIGN_CODES, ALL_FAMILIES, familiesForCode, classifyFamily, groupBySeries,
} from '../section-catalog';
import { ALL_PROFILES } from '../steel-profiles';
import { t } from '../../i18n';

/** How many profiles each family actually ships. */
function profileCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of ALL_PROFILES) counts.set(p.family, (counts.get(p.family) ?? 0) + 1);
  return counts;
}

describe('the four regions Basic ships', () => {
  it('covers Argentina, Europe, the US and Brazil, once each', () => {
    expect(DESIGN_CODES.map((c) => c.region).sort()).toEqual(['AR', 'BR', 'EU', 'US']);
  });

  for (const code of DESIGN_CODES) {
    describe(`${code.label} (${code.region})`, () => {
      it('offers only families that have profiles behind them', () => {
        const counts = profileCounts();
        const empty = code.families.filter((f) => !counts.get(f));
        expect(empty, `families with no profiles: ${empty.join(', ')}`).toEqual([]);
      });

      it('offers at least one section of each kind an engineer needs', () => {
        // A beam and a column, at minimum. A code that offers only angles is
        // technically consistent and practically useless.
        const series = new Set(code.families.map((f) => classifyFamily(f)?.series));
        expect(series.has('i-beam')).toBe(true);
      });

      it('groups into series without losing a family on the way', () => {
        const grouped = groupBySeries(code.families).flatMap((g) => g.families);
        expect(grouped.slice().sort()).toEqual(code.families.slice().sort());
      });

      it('has a note that resolves to real text', () => {
        if (!code.note) return;
        // A missing key falls back to the key itself, which would ship a
        // string like "cat.note.aisc" into the interface.
        expect(t(code.note)).not.toBe(code.note);
        expect(t(code.note).length).toBeGreaterThan(20);
      });
    });
  }
});

describe('the catalogue as a whole', () => {
  it('leaves no family unreachable from every code', () => {
    const reachable = new Set(DESIGN_CODES.flatMap((c) => c.families));
    const orphans = ALL_FAMILIES.filter((f) => !reachable.has(f));
    expect(orphans, `families no code offers: ${orphans.join(', ')}`).toEqual([]);
  });

  it('ships profiles for every family it lists', () => {
    const counts = profileCounts();
    const empty = ALL_FAMILIES.filter((f) => !counts.get(f));
    expect(empty, `listed but empty: ${empty.join(', ')}`).toEqual([]);
  });

  it('classifies every family it lists', () => {
    const unclassified = ALL_FAMILIES.filter((f) => !classifyFamily(f));
    expect(unclassified).toEqual([]);
  });

  it('offers everything when no code is chosen', () => {
    expect(familiesForCode(null)).toEqual(ALL_FAMILIES);
  });

  it('over-offers rather than emptying itself on an unknown code', () => {
    // A picker that silently empties is worse than one that shows too much.
    expect(familiesForCode('nonesuch-2099')).toEqual(ALL_FAMILIES);
  });

  it('every European family a Eurocode user needs is offered', () => {
    // The hollow families in particular: a European frame without a tube is
    // not a small gap, and the note explaining which tubes ship was already
    // written while none were listed.
    const eu = familiesForCode('eurocode-3');
    for (const f of ['IPE', 'HEA', 'HEB', 'L', 'CHS', 'RHS', 'SHS']) {
      expect(eu, `Eurocode 3 must offer ${f}`).toContain(f);
    }
  });
});
