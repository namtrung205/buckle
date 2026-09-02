/**
 * sectionDrawing.ts — one SVG path builder for cross-section outlines, shared
 * by every place in the app that draws one (the picker table thumbnails, the
 * live preview, the committed-section preview).
 *
 * Mirrors the backend `opensees/sections/catalogue.py` geometry rules so the
 * drawing and the computed properties are two projections of ONE description,
 * with the same fillets and flange taper. A rolled I-beam therefore shows its
 * root fillets, an IPN/UPN its taper, an angle its toe/root rounds, and an
 * RHS its corner radius — never a sharp-cornered stand-in.
 *
 * Output fits a `viewBox="-90 -90 180 180"` frame, centred on the section's
 * bounding box.
 */

import type { SectionType } from '../types';
import type { StandardSection } from './sections';

export const OUTLINE_VIEWBOX = '-90 -90 180 180';
const FIT = 80;
/** Arc segments shared by every rounded/filleted corner. */
const ARC_SEGMENTS = 8;

type Pt = [number, number];

// --------------------------------------------------------------------------- //
// Arc helper (angles in radians; SVG +y is down, so we render in y/z directly)
// --------------------------------------------------------------------------- //
function arcPoints(cy: number, cz: number, r: number, a0: number, a1: number, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cy + r * Math.cos(a), cz + r * Math.sin(a)]);
  }
  return out;
}

/** Close the loop and flatten to SVG path commands (y → x, z → -y for SVG). */
function toPath(pts: Pt[], cy: number, cz: number, sc: number): string {
  const parts = pts.map(([y, z], i) => {
    const x = ((y - cy) * sc).toFixed(3);
    const yy = (-(z - cz) * sc).toFixed(3);
    return `${i === 0 ? 'M' : 'L'}${x} ${yy}`;
  });
  return parts.join(' ') + ' Z';
}

// --------------------------------------------------------------------------- //
// Outline builders — coordinates in mm, origin arbitrary (centred later)
// --------------------------------------------------------------------------- //
function iOutline(h: number, b: number, tw: number, tf: number, r: number): Pt[] {
  const hb = b / 2, hh = h / 2, tb = tw / 2;
  const zb = -hh + tf, zt = hh - tf;
  const rr = Math.min(r, (zt - zb) / 2, hb - tb);
  const n = ARC_SEGMENTS;
  const pi = Math.PI;
  const v: Pt[] = [[-hb, -hh], [hb, -hh], [hb, zb]];
  if (rr > 0) {
    v.push(...arcPoints(tb + rr, zb + rr, rr, -pi / 2, -pi, n));
    v.push(...arcPoints(tb + rr, zt - rr, rr, pi, pi / 2, n));
  } else {
    v.push([tb, zb], [tb, zt]);
  }
  v.push([hb, zt], [hb, hh], [-hb, hh], [-hb, zt]);
  if (rr > 0) {
    v.push(...arcPoints(-tb - rr, zt - rr, rr, pi / 2, 0, n));
    v.push(...arcPoints(-tb - rr, zb + rr, rr, 0, -pi / 2, n));
  } else {
    v.push([-tb, zt], [-tb, zb]);
  }
  v.push([-hb, zb]);
  return v;
}

/** IPN tapered flange (DIN 1025-1): slope 14 %, r_root = tw, r_toe = 0.6 tw. */
function ipnOutline(h: number, b: number, tw: number, tf: number): Pt[] {
  const hh = h / 2, hb = b / 2, tb = tw / 2;
  const m = 0.14;
  const c = hh - tf - m * (b / 4);
  const n = ARC_SEGMENTS;
  const pi = Math.PI;
  const k = Math.sqrt(1 + m * m);
  const run: Pt[] = [];
  // toe (convex) then root (concave) along the flange inner face
  const rToe = 0.6 * tw, rRoot = tw;
  if (rToe > 0) {
    const cw = hb - rToe;
    const cv = m * cw + c + rToe * k;
    run.push(...arcPoints(cw, cv, rToe, 0, -(pi / 2 - Math.atan(m)), n));
  } else {
    run.push([hb, m * hb + c]);
  }
  if (rRoot > 0) {
    const cw = tb + rRoot;
    const cv = m * cw + c - rRoot * k;
    run.push(...arcPoints(cw, cv, rRoot, pi / 2 + Math.atan(m), pi, n));
  } else {
    run.push([tb, m * tb + c]);
  }
  // upper-right quadrant, mirrored 3× (keeps Iyz exactly zero)
  const q: Pt[] = [[0, hh], [hb, hh], ...run, [tb, 0]];
  const mirror = (pts: Pt[], fw: boolean, fv: boolean, rev: boolean) => {
    const sw = fw ? -1 : 1, sv = fv ? -1 : 1;
    const m = pts.map(([x, y]) => [sw * x, sv * y] as Pt);
    return rev ? m.reverse() : m;
  };
  const v: Pt[] = [...q];
  v.push(...mirror(q, false, true, true).slice(1));
  v.push(...mirror(q, true, true, false).slice(1));
  const last = mirror(q, true, false, true);
  v.push(...last.slice(1, last.length - 1));
  return v;
}

/** UPN tapered channel (DIN 1026-1): slope 8 %, r_root = tf, r_toe = 0.5 tf. */
function upnOutline(h: number, b: number, tw: number, tf: number): Pt[] {
  const hh = h / 2;
  const m = 0.08;
  const c = hh - tf - m * (b / 2);
  const n = ARC_SEGMENTS;
  const pi = Math.PI;
  const k = Math.sqrt(1 + m * m);
  const rToe = 0.5 * tf, rRoot = tf;
  const run: Pt[] = [];
  if (rToe > 0) {
    const cw = b - rToe;
    const cv = m * cw + c + rToe * k;
    run.push(...arcPoints(cw, cv, rToe, 0, -(pi / 2 - Math.atan(m)), n));
  } else {
    run.push([b, m * b + c]);
  }
  if (rRoot > 0) {
    const cw = tw + rRoot;
    const cv = m * cw + c - rRoot * k;
    run.push(...arcPoints(cw, cv, rRoot, pi / 2 + Math.atan(m), pi, n));
  } else {
    run.push([tw, m * tw + c]);
  }
  const top: Pt[] = [[0, hh], [b, hh], ...run, [tw, 0]];
  const mirror = (pts: Pt[], rev: boolean) => {
    const m = pts.map(([x, y]) => [x, -y] as Pt);
    return rev ? m.reverse() : m;
  };
  const v: Pt[] = [...top];
  v.push(...mirror(top, true).slice(1));
  return v;
}

/** channelOutline — parallel-flange channel (no taper), with optional root fillet. */
function channelOutline(h: number, b: number, tw: number, tf: number, r: number): Pt[] {
  const hh = h / 2;
  const rr = Math.min(r, (b - tw) / 2, (h / 2 - tf));
  const n = ARC_SEGMENTS;
  const pi = Math.PI;
  const v: Pt[] = [[0, -hh], [b, -hh]];
  if (rr > 0) {
    v.push(...arcPoints(b - rr, -hh + tf + rr, rr, -pi / 2, 0, n));
    v.push(...arcPoints(tw + rr, hh - tf - rr, rr, pi, pi / 2, n));
  } else {
    v.push([b, -hh + tf], [tw, -hh + tf], [tw, hh - tf]);
  }
  v.push([b, hh - tf], [b, hh], [0, hh]);
  return v;
}

/** Equal-leg angle with root + toe fillets. */
function angleOutline(b: number, t: number, r: number): Pt[] {
  const r1 = Math.min(r, b - t);
  const r2 = Math.min(r / 2, t);
  const n = ARC_SEGMENTS;
  const pi = Math.PI;
  const v: Pt[] = [[0, 0], [b, 0]];
  if (r2 > 0) {
    v.push([b, t - r2]);
    v.push(...arcPoints(b - r2, t - r2, r2, 0, pi / 2, n));
  } else {
    v.push([b, t]);
  }
  if (r1 > 0) {
    v.push([t + r1, t]);
    v.push(...arcPoints(t + r1, t + r1, r1, -pi / 2, -pi, n));
  } else {
    v.push([t, t]);
  }
  if (r2 > 0) {
    v.push([t, b - r2]);
    v.push(...arcPoints(t - r2, b - r2, r2, 0, pi / 2, n));
  } else {
    v.push([t, b]);
  }
  v.push([0, b]);
  return v;
}

/** Rectangular hollow with rounded outer corners (R = ri, inner R = ri - t). */
function rhsRoundedOutline(h: number, b: number, t: number, ri: number): Pt[] {
  const ro = Math.min(ri, Math.min(h, b) / 2);
  const riInner = Math.max(ro - t, 0);
  const n = ARC_SEGMENTS;
  const pi = Math.PI;
  const ring = (bb: number, hh: number, r: number): Pt[] => {
    const hw = bb / 2, hd = hh / 2;
    if (r <= 0) return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    const v: Pt[] = [];
    const corners: [number, number, number][] = [
      [1, -1, -pi / 2], [1, 1, 0], [-1, 1, pi / 2], [-1, -1, pi],
    ];
    for (const [sw, sd, a0] of corners) {
      v.push(...arcPoints(sw * (hw - r), sd * (hd - r), r, a0, a0 + pi / 2, n));
    }
    return v;
  };
  return [...ring(b, h, ro), ...ring(b - 2 * t, h - 2 * t, riInner)];
}

function circleOutline(d: number): Pt[] {
  return arcPoints(0, 0, d / 2, 0, 2 * Math.PI, 32);
}
function solidRectOutline(h: number, b: number): Pt[] {
  const hw = b / 2, hh = h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
}
function teeOutline(h: number, b: number, tw: number, tf: number): Pt[] {
  const hw = b / 2, hh = h / 2, tb = tw / 2;
  return [[-tb, -hh], [tb, -hh], [tb, hh - tf], [hw, hh - tf], [hw, hh], [-hw, hh], [-hw, hh - tf], [-tb, hh - tf]];
}

// --------------------------------------------------------------------------- //
// Public API
// --------------------------------------------------------------------------- //
export interface Outline {
  /** SVG path data in the shared viewBox, or null if no shape can be drawn. */
  d: string | null;
  /** Whether the outline is exact (filleted/tapered) or a parametric fallback. */
  exact: boolean;
}

const FAMILY_MAP: Record<string, SectionType> = {
  I: 'I', IPN: 'IPN', UPN: 'UPN', Channel: 'Channel', UPE: 'Channel',
  Angle: 'Angle', L: 'Angle', RectangularHollow: 'RectangularHollow', RHS: 'RectangularHollow',
  SHS: 'RectangularHollow', HSS: 'RectangularHollow', HollowCircular: 'HollowCircular', CHS: 'HollowCircular',
  Circular: 'Circular', Rectangular: 'Rectangular', Tee: 'Tee', T: 'Tee',
};

/** Build the exact SVG outline for a standard catalogue section. */
export function standardOutline(sec: StandardSection): Outline {
  const family = FAMILY_MAP[(sec as any).family] ?? (sec.family as SectionType);
  const pts = buildPts(family, sec);
  if (!pts) return { d: null, exact: false };
  return { d: project(pts), exact: true };
}

/** Build the exact SVG outline for an arbitrary (custom) section shape. */
export function customOutline(
  type: SectionType,
  dims: { depth?: number; height?: number; width?: number; diameter?: number; tw?: number; tf?: number; thickness?: number; r?: number; ri?: number },
): Outline {
  const pts = buildPts(type, dims as StandardSection);
  if (!pts) return { d: null, exact: false };
  return { d: project(pts), exact: true };
}

function buildPts(type: SectionType, s: StandardSection): Pt[] | null {
  switch (type) {
    case 'I':
      if (s.depth && s.width && s.tw != null && s.tf != null) {
        return iOutline(s.depth, s.width, s.tw, s.tf, s.r ?? 0);
      }
      return null;
    case 'IPN':
      if (s.depth && s.width && s.tw != null && s.tf != null) {
        return ipnOutline(s.depth, s.width, s.tw, s.tf);
      }
      return null;
    case 'UPN':
      if (s.depth && s.width && s.tw != null && s.tf != null) {
        return upnOutline(s.depth, s.width, s.tw, s.tf);
      }
      return null;
    case 'Channel':
      if (s.depth && s.width && s.tw != null && s.tf != null) {
        return channelOutline(s.depth, s.width, s.tw, s.tf, s.r ?? 0);
      }
      return null;
    case 'Angle':
      if (s.width && s.thickness != null) {
        return angleOutline(s.width, s.thickness, s.r ?? 0);
      }
      return null;
    case 'Tee':
      if (s.depth && s.width && s.tw != null && s.tf != null) {
        return teeOutline(s.depth, s.width, s.tw, s.tf);
      }
      return null;
    case 'RectangularHollow': {
      const h = s.height ?? s.depth;
      const b = s.width;
      const t = s.thickness;
      if (h && b && t != null) {
        return rhsRoundedOutline(h, b, t, s.ri ?? 0);
      }
      return null;
    }
    case 'HollowCircular':
    case 'Circular':
      if (s.diameter) return circleOutline(s.diameter);
      return null;
    case 'Rectangular': {
      const h = s.height ?? s.depth;
      const b = s.width;
      if (h && b) return solidRectOutline(h, b);
      return null;
    }
    default:
      return null;
  }
}

function project(pts: Pt[]): string {
  let yMin = Infinity, yMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  for (const [y, z] of pts) {
    yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
    zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
  }
  const w = Math.max(yMax - yMin, 1e-12);
  const h = Math.max(zMax - zMin, 1e-12);
  const sc = FIT / Math.max(w, h);
  const cy = (yMin + yMax) / 2;
  const cz = (zMin + zMax) / 2;
  return toPath(pts, cy, cz, sc);
}