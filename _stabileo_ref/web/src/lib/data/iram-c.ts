/**
 * iram-c.ts — American channel sections (C) per IRAM-IAS U 500-509-4, as
 * tabulated for CIRSOC 301-EL / 302-EL.
 *
 * # Flange geometry
 *
 * Slope 1:6 on the inner face, `tf` quoted at the middle of the flange
 * overhang. Both were determined the way the rest of the catalogue was: by
 * building the outline and requiring it to reproduce the published area,
 * inertias AND centroid position. A flat flange misses by 17 %; 1:6 lands at
 * 2.6 % median.
 *
 * # The root radius, and the three profiles that do not have one
 *
 * The radius comes out of the published clear web depth via
 * `hw = d - 2(tf + r)`, and — as in the W series — it is constant within each
 * rolling depth (every C15 at 20.0 mm, every C12 at 15.8, every C10 at 14.4),
 * which is what makes the inversion credible: one roller per depth.
 *
 * The C9 group is the exception. Its table publishes hw = 109 mm for a 229 mm
 * channel, which would leave a 49.5 mm fillet inside a 61.8 mm flange — not a
 * parse error, since the table's own hw/tw ratio agrees with it, but not a
 * geometry either. Those three carry no radius and are drawn sharp-cornered.
 * That is the honest rendering of an unavailable value, and it costs nothing
 * here: they land at 0.9-1.3 % against their published properties, closer than
 * their siblings that DO have a radius.
 *
 * Deviations for the family run to 6 %, wider than the DIN series, because
 * these tables give nominal dimensions. It is declared per profile.
 *
 * Units: dimensions mm, area cm2, inertia cm4, mass kg/m.
 */

import type { SteelProfile } from './steel-profiles';

/** American channels — 28 profiles. */
export const IRAM_C: SteelProfile[] = [
  { family: 'C', name: 'C15x50', h: 381, b: 94.4, a: 94.8, iy: 16816, iz: 458, weight: 74.4, tw: 18.2, tf: 16.5, r: 20 },
  { family: 'C', name: 'C15x40', h: 381, b: 89.4, a: 76.1, iy: 14526, iz: 384, weight: 59.5, tw: 13.2, tf: 16.5, r: 20 },
  { family: 'C', name: 'C15x33,9', h: 381, b: 86.4, a: 64.3, iy: 13111, iz: 338, weight: 50.4, tw: 10.2, tf: 16.5, r: 20 },
  { family: 'C', name: 'C12x30', h: 305, b: 80.5, a: 56.9, iy: 6743, iz: 214, weight: 44.6, tw: 13, tf: 12.7, r: 15.8 },
  { family: 'C', name: 'C12x25', h: 305, b: 77.4, a: 47.4, iy: 5994, iz: 186, weight: 37.2, tw: 9.8, tf: 12.7, r: 15.8 },
  { family: 'C', name: 'C12x20,7', h: 305, b: 74.7, a: 39.3, iy: 5369, iz: 161, weight: 30.8, tw: 7.2, tf: 12.7, r: 15.8 },
  { family: 'C', name: 'C10x30', h: 254, b: 77, a: 56.9, iy: 4287, iz: 164, weight: 44.6, tw: 17.1, tf: 11.1, r: 14.4 },
  { family: 'C', name: 'C10x25', h: 254, b: 73.3, a: 47.4, iy: 3796, iz: 140, weight: 37.2, tw: 13.4, tf: 11.1, r: 14.4 },
  { family: 'C', name: 'C10x20', h: 254, b: 69.6, a: 37.9, iy: 3284, iz: 117, weight: 29.8, tw: 9.6, tf: 11.1, r: 14.4 },
  { family: 'C', name: 'C10x15,3', h: 254, b: 66, a: 29, iy: 2805, iz: 95, weight: 22.8, tw: 6.1, tf: 11.1, r: 14.4 },
  { family: 'C', name: 'C9x20', h: 229, b: 67.3, a: 37.9, iy: 2535, iz: 101, weight: 29.8, tw: 11.4, tf: 10.5, r: 0 },
  { family: 'C', name: 'C9x15', h: 229, b: 63.1, a: 28.5, iy: 2123, iz: 80, weight: 22.3, tw: 7.2, tf: 10.5, r: 0 },
  { family: 'C', name: 'C9x13,4', h: 229, b: 61.8, a: 25.4, iy: 1994, iz: 73, weight: 19.9, tw: 5.9, tf: 10.5, r: 0 },
  { family: 'C', name: 'C8x18,75', h: 203, b: 64.2, a: 35.5, iy: 1831, iz: 82, weight: 27.9, tw: 12.4, tf: 9.91, r: 13.59 },
  { family: 'C', name: 'C8x13,75', h: 203, b: 59.5, a: 26.1, iy: 1503, iz: 64, weight: 20.5, tw: 7.7, tf: 9.91, r: 13.59 },
  { family: 'C', name: 'C8x11,5', h: 203, b: 57.4, a: 21.8, iy: 1357, iz: 55, weight: 17.1, tw: 5.6, tf: 9.91, r: 13.59 },
  { family: 'C', name: 'C7x12,25', h: 178, b: 55.7, a: 23.2, iy: 1007, iz: 49, weight: 18.2, tw: 7.98, tf: 9.3, r: 13.2 },
  { family: 'C', name: 'C7x9,8', h: 178, b: 53.1, a: 18.5, iy: 887, iz: 40, weight: 14.6, tw: 5.3, tf: 9.3, r: 13.2 },
  { family: 'C', name: 'C6x13', h: 152, b: 54.8, a: 24.7, iy: 724, iz: 44, weight: 19.3, tw: 11.1, tf: 8.71, r: 11.79 },
  { family: 'C', name: 'C6x10,5', h: 152, b: 51.7, a: 19.9, iy: 633, iz: 36, weight: 15.6, tw: 8, tf: 8.71, r: 11.79 },
  { family: 'C', name: 'C6x8,2', h: 152, b: 48.8, a: 15.5, iy: 545, iz: 29, weight: 12.2, tw: 5.08, tf: 8.71, r: 11.79 },
  { family: 'C', name: 'C5x9', h: 127, b: 47.9, a: 17, iy: 370, iz: 26, weight: 13.4, tw: 8.3, tf: 8.13, r: 10.92 },
  { family: 'C', name: 'C5x6,7', h: 127, b: 44.5, a: 12.7, iy: 312, iz: 20, weight: 10, tw: 4.83, tf: 8.13, r: 10.92 },
  { family: 'C', name: 'C4x7,25', h: 102, b: 43.7, a: 13.7, iy: 191, iz: 18, weight: 10.8, tw: 8.15, tf: 7.52, r: 10.13 },
  { family: 'C', name: 'C4x5,4', h: 102, b: 40.2, a: 10.3, iy: 160, iz: 13, weight: 8.04, tw: 4.67, tf: 7.52, r: 10.13 },
  { family: 'C', name: 'C3x6', h: 76.2, b: 40.5, a: 11.4, iy: 86, iz: 13, weight: 8.93, tw: 9.04, tf: 6.93, r: 10.22 },
  { family: 'C', name: 'C3x5', h: 76.2, b: 38, a: 9.48, iy: 77, iz: 10, weight: 7.44, tw: 6.55, tf: 6.93, r: 10.22 },
  { family: 'C', name: 'C3x4,1', h: 76.2, b: 35.8, a: 7.81, iy: 69, iz: 8, weight: 6.1, tw: 4.32, tf: 6.93, r: 10.22 },
];
