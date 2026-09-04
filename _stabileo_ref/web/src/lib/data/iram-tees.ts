/**
 * iram-tees.ts — rolled T sections per IRAM-IAS U 500-561, tabulated for
 * CIRSOC 301-EL / 302-EL.
 *
 * Small equal-leg tees, and like the IRAM angles they publish both fillet
 * radii per profile rather than leaving the toe to a rule. Areas run around
 * 1-3 cm² published to three figures, so table rounding alone is worth a
 * percent or two; every profile here reconciles inside 1.9 %, and one that did
 * not was dropped rather than shipped.
 *
 * `iy`/`iz` are INTEGRATED from the outline rather than transcribed, for the
 * same reason as the angles: the table's inertia columns are about the
 * principal axes while the rest of the catalogue uses the geometric ones.
 *
 * Units: dimensions mm, area cm2, inertia cm4, mass kg/m.
 */

import type { SteelProfile } from './steel-profiles';

/** Rolled T sections. */
export const IRAM_T: SteelProfile[] = [
  { family: 'T', name: 'T 19x19x3.2', h: 19, b: 19, a: 1.14, iy: 0.3597, iz: 0.1839, weight: 0.89, tw: 3.2, tf: 3.2, r: 1.5 },
  { family: 'T', name: 'T 22x22x3.2', h: 22, b: 22, a: 1.33, iy: 0.5761, iz: 0.2845, weight: 1.04, tw: 3.2, tf: 3.2, r: 1.5 },
  { family: 'T', name: 'T 25x25x3.2', h: 25, b: 25, a: 1.52, iy: 0.866, iz: 0.4165, weight: 1.19, tw: 3.2, tf: 3.2, r: 1.5 },
  { family: 'T', name: 'T 25x25x4.8', h: 25, b: 25, a: 2.22, iy: 1.1921, iz: 0.6395, weight: 1.74, tw: 4.8, tf: 4.8, r: 2.5 },
  { family: 'T', name: 'T 29x29x3.2', h: 29, b: 29, a: 1.77, iy: 1.3855, iz: 0.649, weight: 1.39, tw: 3.2, tf: 3.2, r: 1.5 },
  { family: 'T', name: 'T 32x32x3.2', h: 32, b: 32, a: 1.96, iy: 1.8889, iz: 0.8713, weight: 1.54, tw: 3.2, tf: 3.2, r: 1.5 },
  { family: 'T', name: 'T 32x32x4.8', h: 32, b: 32, a: 2.89, iy: 2.6452, iz: 1.3275, weight: 2.27, tw: 4.8, tf: 4.8, r: 2.5 },
  { family: 'T', name: 'T 38x38x3.2', h: 38, b: 38, a: 2.34, iy: 3.235, iz: 1.458, weight: 1.84, tw: 3.2, tf: 3.2, r: 1.5 },
  { family: 'T', name: 'T 38x38x4.8', h: 38, b: 38, a: 3.46, iy: 4.5766, iz: 2.2127, weight: 2.72, tw: 4.8, tf: 4.8, r: 2.5 },
  { family: 'T', name: 'T 45x45x4.8', h: 45, b: 45, a: 4.13, iy: 7.8122, iz: 3.6631, weight: 3.24, tw: 4.8, tf: 4.8, r: 2.5 },
  { family: 'T', name: 'T 51x51x4.8', h: 51, b: 51, a: 4.7, iy: 11.5757, iz: 5.3236, weight: 3.69, tw: 4.8, tf: 4.8, r: 2.5 },
];
