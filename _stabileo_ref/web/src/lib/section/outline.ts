/**
 * outline.ts — one SVG path builder for a section outline, shared by every
 * place in the app that draws one.
 *
 * # Why this exists
 *
 * Checkpoint 2B made the *stress panel* draw canonical geometry, and left the
 * six other places that draw a section — the profile picker, the section
 * changer, the shape builder, the element details panel, the sections table
 * and the PRO sections tab — still calling `crossSectionPath()`, which builds
 * a parallel-flange, sharp-cornered outline from `h/b/tw/tf` alone.
 *
 * The result was visible and was reported: the same IPN 300 looked square in
 * the picker and correctly tapered in Section Analysis. That is the two-
 * resolver defect again, just moved. A user cannot be expected to trust a
 * number attached to a picture of a different shape.
 *
 * So there is one path builder, it prefers canonical geometry, and when it
 * cannot have it the caller is *told* rather than silently handed an
 * approximation.
 */

import type { Section } from '../store/model.svelte';
import type { SteelProfile } from '../data/steel-profiles';
import { crossSectionPath } from '../utils/section-drawing';
import { familyToShape } from '../data/steel-profiles';
import { resolveSectionState } from './state';
import { drawingGeometry, type DrawingGeometry } from './drawing';

/** How the outline that came back was arrived at. */
export type OutlineSource =
  /** Exact: the polygons the engine also integrates for properties and stress. */
  | 'canonical'
  /** Approximate: parallel flanges and sharp corners from bare dimensions. */
  | 'parametric'
  /** Nothing to draw — the section declares properties but no shape. */
  | 'none';

export interface SectionOutline {
  /** SVG path data, or `null` when `source` is `'none'`. */
  d: string | null;
  source: OutlineSource;
  /** Extent actually drawn, in metres, for labelling and dimension lines. */
  size: { width: number; height: number } | null;
}

/** The viewBox every section drawing in the app shares. */
export const OUTLINE_VIEWBOX = '-90 -90 180 180';
/** Half-extent the outline is fitted into, inside that viewBox. */
const FIT = 80;

/**
 * Project canonical geometry into the shared viewBox.
 *
 * Canonical coordinates are metres with `+z` up; SVG is pixels with `+y` down.
 * Both transforms happen here, once, so no caller can apply one and forget the
 * other — which is exactly the bug that made the first canonical drawing land
 * as an invisible 0.3-unit speck.
 */
export function canonicalOutlinePath(g: DrawingGeometry): string {
  const [yMin, zMin, yMax, zMax] = g.bbox;
  const width = Math.max(yMax - yMin, 1e-12);
  const height = Math.max(zMax - zMin, 1e-12);
  const sc = FIT / Math.max(width, height);
  // Centre on the bounding box rather than the centroid: an angle's centroid
  // sits well off-centre, and a picker thumbnail that hangs out of its own
  // frame reads as a rendering bug even though the geometry is right.
  const cy = (yMin + yMax) / 2;
  const cz = (zMin + zMax) / 2;
  const ring = (poly: Array<[number, number]>) =>
    poly
      .map(
        ([y, z], i) =>
          `${i === 0 ? 'M' : 'L'}${((y - cy) * sc).toFixed(3)} ${(-(z - cz) * sc).toFixed(3)}`,
      )
      .join(' ') + ' Z';
  return [...g.solids, ...g.holes].map(ring).join(' ');
}

function canonicalFor(sec: Section): SectionOutline | null {
  const state = sec.canonical ?? null;
  if (state && state.kind === 'geometry-backed') {
    const g = drawingGeometry(state);
    const [yMin, zMin, yMax, zMax] = g.bbox;
    return {
      d: canonicalOutlinePath(g),
      source: 'canonical',
      size: { width: yMax - yMin, height: zMax - zMin },
    };
  }
  return null;
}

/**
 * Outline for a section the model already holds.
 *
 * Uses the canonical state the section carries; falls back to the parametric
 * builder only when the section has none, and says so.
 */
export function sectionOutline(sec: Section): SectionOutline {
  const canonical = canonicalFor(sec);
  if (canonical) return canonical;

  if (sec.shape && sec.h != null && sec.b != null) {
    return {
      d: crossSectionPath({
        shape: sec.shape,
        h: sec.h,
        b: sec.b,
        tw: sec.tw ?? 0,
        tf: sec.tf ?? 0,
        t: sec.t ?? 0,
      }),
      source: 'parametric',
      size: { width: sec.b, height: sec.h },
    };
  }
  return { d: null, source: 'none', size: null };
}

/**
 * Outline for a catalogue profile that is not (yet) a section in the model —
 * the picker case, where the user is choosing before committing.
 *
 * Resolving through the same entry point the model uses means the thumbnail in
 * the picker and the drawing after the click are the same geometry by
 * construction, not by two code paths agreeing.
 *
 * Memoized per profile: the picker renders one row per catalogue entry and
 * re-renders on every search keystroke, and an uncached call here is a full
 * canonical resolution (a WASM round trip) PER ROW PER KEYSTROKE.
 *
 * Only canonical outlines are cached. A resolution made before the engine is
 * ready (or while the feature flag is off) falls back to the approximate
 * parametric outline, and caching THAT would pin a degraded thumbnail for the
 * rest of the session — the exact picker/section mismatch this module exists
 * to eliminate. An uncached fallback re-resolves on the next render, by which
 * time the engine is usually up.
 */
const profileOutlineCache = new Map<string, SectionOutline>();

export function profileOutline(profile: SteelProfile): SectionOutline {
  const cached = profileOutlineCache.get(profile.name);
  if (cached) return cached;

  const mm = (v: number) => v / 1000;
  const probe = {
    id: -1,
    name: profile.name,
    a: profile.a * 1e-4,
    iy: profile.iy * 1e-8,
    iz: profile.iz * 1e-8,
    h: mm(profile.h),
    b: mm(profile.b),
    tw: profile.tw != null ? mm(profile.tw) : undefined,
    tf: profile.tf != null ? mm(profile.tf) : undefined,
    t: profile.t != null ? mm(profile.t) : undefined,
    shape: familyToShape(profile.family),
  } as Section;

  // `resolveSectionState` already answers "no geometry" with a properties-only
  // state rather than throwing, and it is the same call the model makes when
  // the profile is actually chosen — so the thumbnail and the committed
  // section cannot disagree.
  const state = resolveSectionState(probe);
  const outline = sectionOutline({ ...probe, canonical: state } as Section);
  if (outline.source === 'canonical') profileOutlineCache.set(profile.name, outline);
  return outline;
}
