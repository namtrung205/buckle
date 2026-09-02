/**
 * iram-angles.ts — equal-leg angles per IRAM-IAS U 500-558, as tabulated for
 * CIRSOC 301-EL / 302-EL.
 *
 * These extend rather than replace the EN 10056-1 angles: the Argentine series
 * runs to much smaller legs (16 mm up) on the imperial-derived sizes, and it
 * publishes BOTH fillet radii per profile instead of leaving the toe radius to
 * a rule. Sizes are the real millimetre values (15.9 = 5/8"), so no name
 * collides with a European one.
 *
 * Six profiles from the table are deliberately NOT here. The radii sit in
 * merged cells shared by a size group, and for those six the inherited pair
 * does not reproduce the published area — up to 23 % off, against a median of
 * 0.65 % for the rest. Rather than ship a radius that is probably the
 * neighbour's, they are dropped; the EN series already covers those sizes.
 *
 * `iy` is INTEGRATED from the outline rather than transcribed: the table's own
 * inertia columns are about the principal axes, not the leg-parallel axes the
 * rest of the catalogue uses, so transcribing them would mix conventions.
 *
 * Units: dimensions mm, area cm2, inertia cm4, mass kg/m.
 */

import type { SteelProfile } from './steel-profiles';

/** Equal-leg angles, IRAM-IAS series. */
export const IRAM_L: SteelProfile[] = [
  { family: 'L', name: 'L 15.9x15.9x3.2', h: 15.9, b: 15.9, a: 0.94, iy: 0.1925, iz: 0.1925, weight: 0.74, t: 3.2, r: 4 },
  { family: 'L', name: 'L 19x19x3.2', h: 19, b: 19, a: 1.13, iy: 0.346, iz: 0.346, weight: 0.89, t: 3.2, r: 4 },
  { family: 'L', name: 'L 22.2x22.2x3.2', h: 22.2, b: 22.2, a: 1.32, iy: 0.5741, iz: 0.5741, weight: 1.04, t: 3.2, r: 4 },
  { family: 'L', name: 'L 25.4x25.4x3.2', h: 25.4, b: 25.4, a: 1.51, iy: 0.8859, iz: 0.8859, weight: 1.19, t: 3.2, r: 4 },
  { family: 'L', name: 'L 25.4x25.4x6.4', h: 25.4, b: 25.4, a: 2.81, iy: 1.5205, iz: 1.5205, weight: 2.2, t: 6.4, r: 4 },
  { family: 'L', name: 'L 31.7x31.7x3.2', h: 31.7, b: 31.7, a: 1.97, iy: 1.7732, iz: 1.7732, weight: 1.55, t: 3.2, r: 5 },
  { family: 'L', name: 'L 31.7x31.7x4.8', h: 31.7, b: 31.7, a: 2.87, iy: 2.5041, iz: 2.5041, weight: 2.25, t: 4.8, r: 5 },
  { family: 'L', name: 'L 38.1x38.1x3.2', h: 38.1, b: 38.1, a: 2.37, iy: 3.1747, iz: 3.1747, weight: 1.86, t: 3.2, r: 5 },
  { family: 'L', name: 'L 38.1x38.1x6.4', h: 38.1, b: 38.1, a: 4.49, iy: 5.6802, iz: 5.6802, weight: 3.53, t: 6.4, r: 6 },
  { family: 'L', name: 'L 44.4x44.4x3.2', h: 44.4, b: 44.4, a: 2.83, iy: 5.0813, iz: 5.0813, weight: 2.22, t: 3.2, r: 6 },
  { family: 'L', name: 'L 44.4x44.4x4.8', h: 44.4, b: 44.4, a: 4.14, iy: 7.3113, iz: 7.3113, weight: 3.25, t: 4.8, r: 6 },
  { family: 'L', name: 'L 50.8x50.8x7.9', h: 50.8, b: 50.8, a: 7.49, iy: 17.0472, iz: 17.0472, weight: 5.88, t: 7.9, r: 6 },
  { family: 'L', name: 'L 57.1x57.1x3.2', h: 57.1, b: 57.1, a: 3.61, iy: 11.1545, iz: 11.1545, weight: 2.84, t: 3.2, r: 6 },
  { family: 'L', name: 'L 57.1x57.1x4.8', h: 57.1, b: 57.1, a: 5.31, iy: 16.1858, iz: 16.1858, weight: 4.17, t: 4.8, r: 6 },
  { family: 'L', name: 'L 63.5x63.5x4.8', h: 63.5, b: 63.5, a: 6, iy: 22.5781, iz: 22.5781, weight: 4.71, t: 4.8, r: 6 },
  { family: 'L', name: 'L 63.5x63.5x9.5', h: 63.5, b: 63.5, a: 11.34, iy: 40.1102, iz: 40.1102, weight: 8.91, t: 9.5, r: 9 },
  { family: 'L', name: 'L 76.2x76.2x9.5', h: 76.2, b: 76.2, a: 13.64, iy: 71.9991, iz: 71.9991, weight: 10.71, t: 9.5, r: 9 },
  { family: 'L', name: 'L 88.9x88.9x9.5', h: 88.9, b: 88.9, a: 16.14, iy: 117.52, iz: 117.52, weight: 12.67, t: 9.5, r: 9 },
  { family: 'L', name: 'L 88.9x88.9x12.7', h: 88.9, b: 88.9, a: 21.12, iy: 149.094, iz: 149.094, weight: 16.58, t: 12.7, r: 11 },
  { family: 'L', name: 'L 101.6x101.6x7.9', h: 101.6, b: 101.6, a: 15.65, iy: 151.084, iz: 151.084, weight: 12.28, t: 7.9, r: 11 },
  { family: 'L', name: 'L 101.6x101.6x9.5', h: 101.6, b: 101.6, a: 18.63, iy: 178.136, iz: 178.136, weight: 14.63, t: 9.5, r: 11 },
  { family: 'L', name: 'L 101.6x101.6x11.1', h: 101.6, b: 101.6, a: 21.57, iy: 203.958, iz: 203.958, weight: 16.93, t: 11.1, r: 11 },
  { family: 'L', name: 'L 101.6x101.6x12.7', h: 101.6, b: 101.6, a: 24.45, iy: 228.055, iz: 228.055, weight: 19.19, t: 12.7, r: 12 },
  { family: 'L', name: 'L 127x127x11.1', h: 127, b: 127, a: 27.17, iy: 411.389, iz: 411.389, weight: 21.33, t: 11.1, r: 12 },
  { family: 'L', name: 'L 127x127x12.7', h: 127, b: 127, a: 30.86, iy: 460.998, iz: 460.998, weight: 24.22, t: 12.7, r: 14 },
  { family: 'L', name: 'L 152.4x152.4x11.1', h: 152.4, b: 152.4, a: 32.79, iy: 724.915, iz: 724.915, weight: 25.74, t: 11.1, r: 14 },
  { family: 'L', name: 'L 152.4x152.4x12.7', h: 152.4, b: 152.4, a: 37.27, iy: 814.995, iz: 814.995, weight: 29.26, t: 12.7, r: 16 },
];
