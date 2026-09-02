/**
 * One outline builder for the whole app.
 *
 * The defect this closes was reported from the product side: the same IPN 300
 * looked square in the profile picker and correctly tapered in Section
 * Analysis, because the picker built its own parallel-flange path from bare
 * dimensions. What is pinned here is that a picker thumbnail and the committed
 * section's drawing come from the same geometry, and that when they cannot,
 * the caller is told which it got instead of being handed a lookalike.
 */

import { describe, it, expect } from 'vitest';
import { sectionOutline, profileOutline, OUTLINE_VIEWBOX } from '../outline';
import { resolveSectionState } from '../state';
import { ALL_PROFILES } from '../../data/steel-profiles';
import type { Section } from '../../store/model.svelte';

const profile = (name: string) => ALL_PROFILES.find((p) => p.name === name)!;

/** Every coordinate in an SVG path, for geometry assertions. */
function coords(d: string): Array<[number, number]> {
  return [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [
    parseFloat(m[1]),
    parseFloat(m[2]),
  ]);
}

describe('catalogue profiles draw their real outline', () => {
  const GEOMETRY_BACKED = ['IPE 300', 'HEA 300', 'HEB 200', 'IPN 300', 'UPN 200', 'L 100x100x10', 'CHS 88.9x3.2', 'RHS 120x60x4', 'SHS 100x100x4'];

  for (const name of GEOMETRY_BACKED) {
    it(`${name} is drawn from canonical geometry, not approximated`, () => {
      const o = profileOutline(profile(name));
      expect(o.source, name).toBe('canonical');
      expect(o.d).toBeTruthy();
      expect(coords(o.d!).length).toBeGreaterThan(8);
    });
  }

  it('a rolled tube is drawn with its rounded corners, not as a sharp box', () => {
    // IRAM-IAS fixes the outer corner at 2t, so this is exact geometry now.
    // A sharp box would have exactly 8 vertices; the rounded one has many more.
    const o = profileOutline(profile('RHS 120x60x4'));
    expect(o.source).toBe('canonical');
    expect(coords(o.d!).length).toBeGreaterThan(20);
  });

  it('an IPN is drawn with a tapered flange — the reported defect', () => {
    // The old picker path drew parallel flanges. Measure the flange depth near
    // the web against the depth at the tip: on a real IPN they differ.
    const d = profileOutline(profile('IPN 300')).d!;
    const pts = coords(d);
    // SVG y grows downward, so the top flange has the most negative y.
    const top = pts.filter(([, y]) => y < 0);
    const yTop = Math.min(...top.map(([, y]) => y));
    const nearWeb = top.filter(([x]) => Math.abs(x) > 2 && Math.abs(x) < 12);
    const nearTip = top.filter(([x]) => Math.abs(x) > 30);
    const depth = (a: Array<[number, number]>) => Math.max(...a.map(([, y]) => y)) - yTop;
    expect(depth(nearWeb)).toBeGreaterThan(depth(nearTip) * 1.15);
  });

  it('a parallel-flange IPE is NOT tapered — the fix did not overshoot', () => {
    const pts = coords(profileOutline(profile('IPE 300')).d!);
    const top = pts.filter(([, y]) => y < 0);
    const yTop = Math.min(...top.map(([, y]) => y));
    // Every point on the flange underside sits at one depth, within the
    // root fillet's own extent.
    const underside = top.filter(([, y]) => y - yTop > 1);
    const depths = underside.map(([, y]) => y - yTop);
    expect(Math.max(...depths) - Math.min(...depths)).toBeLessThan(
      Math.max(...depths) * 0.9,
    );
  });
});

describe('the thumbnail and the committed section are the same geometry', () => {
  for (const name of ['IPN 300', 'UPN 200', 'L 100x100x10']) {
    it(`${name} draws identically before and after being added to the model`, () => {
      const p = profile(name);
      const fromPicker = profileOutline(p);
      const committed: Section = {
        id: 1,
        name: p.name,
        a: p.a * 1e-4,
        iy: p.iy * 1e-8,
        iz: p.iz * 1e-8,
      } as Section;
      committed.canonical = resolveSectionState(committed);
      const fromModel = sectionOutline(committed);
      expect(fromModel.source).toBe('canonical');
      expect(fromModel.d).toBe(fromPicker.d);
    });
  }
});

describe('the outline is framed so it always fits its box', () => {
  // CPU-bound loop over ~700 profiles: 1.5 s on a quiet machine, well over
  // the 5 s default when the suite shares cores with a build. The budget is
  // generous on purpose — a genuine hang still fails, contention does not.
  it('every geometry-backed profile stays inside the shared viewBox', { timeout: 30000 }, () => {
    expect(OUTLINE_VIEWBOX).toBe('-90 -90 180 180');
    for (const p of ALL_PROFILES) {
      const o = profileOutline(p);
      if (!o.d) continue;
      for (const [x, y] of coords(o.d)) {
        expect(Math.abs(x), `${p.name} x`).toBeLessThanOrEqual(90);
        expect(Math.abs(y), `${p.name} y`).toBeLessThanOrEqual(90);
      }
    }
  });

  it('an angle is centred on its bounding box, not on its off-centre centroid', () => {
    // An L's centroid sits far from the middle of its bounding box. Centring on
    // the centroid pushes the drawing hard against one corner of the frame.
    const pts = coords(profileOutline(profile('L 100x100x10')).d!);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    expect(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2)).toBeLessThan(1);
    expect(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2)).toBeLessThan(1);
  });

  it('a section with neither geometry nor dimensions reports nothing to draw', () => {
    const o = sectionOutline({ id: 1, name: 'Equivalente', a: 0.01, iz: 1e-5 } as Section);
    expect(o.source).toBe('none');
    expect(o.d).toBeNull();
  });
});
