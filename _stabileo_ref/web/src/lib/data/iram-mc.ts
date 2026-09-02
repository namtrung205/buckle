/**
 * iram-mc.ts — miscellaneous channels (MC) per IRAM-IAS U 500-509-4, as
 * tabulated for CIRSOC 301-EL / 302-EL.
 *
 * # Why this family alone is properties-only
 *
 * Its flange taper cannot be determined from what is published, and the app's
 * rule is that an outline is either known or refused — never inferred.
 *
 * The page footer prints a 16.66 % slope, but that diagram is shared with the
 * C series and the MC numbers contradict it: at 16.66 % the built outline
 * misses the published properties by 14.6 % median, and no position for where
 * `tf` is quoted rescues it (the best, three-quarter overhang, still misses by
 * 11.6 %). Fitting the slope per profile DOES work — every MC then lands
 * inside 1.5 %, and the fitted values cluster by sub-series, roughly 4-6 % for
 * MC18/MC12/MC10 and 13-15 % for MC13 — but that fits the slope against the
 * very properties it is meant to predict, which is circular. The name of the
 * series is the clue: these are the sections that do not follow the standard
 * one.
 *
 * So they ship with their published properties, which are exact and make them
 * fully usable for global analysis, and the section panel refuses detailed
 * stress rather than drawing a shape nobody verified. If a manufacturer's
 * dimensioned drawing turns up, the fitted slopes above are where to start
 * checking.
 *
 * Units: dimensions mm, area cm2, inertia cm4, mass kg/m.
 */

import type { SteelProfile } from './steel-profiles';

/** Miscellaneous channels — 33 profiles, properties-only by construction. */
export const IRAM_MC: SteelProfile[] = [
  { family: 'MC', name: 'MC18x58', h: 457, b: 107, a: 110.3, iy: 28137, iz: 741, weight: 86.3, tw: 17.8, tf: 15.9 },
  { family: 'MC', name: 'MC18x51,9', h: 457, b: 104, a: 98.71, iy: 26098, iz: 683, weight: 77.2, tw: 15.2, tf: 15.9 },
  { family: 'MC', name: 'MC18x45,8', h: 457, b: 102, a: 87.1, iy: 24058, iz: 629, weight: 68.2, tw: 12.7, tf: 15.9 },
  { family: 'MC', name: 'MC18x42,7', h: 457, b: 100, a: 81.29, iy: 23059, iz: 599, weight: 63.5, tw: 11.4, tf: 15.9 },
  { family: 'MC', name: 'MC13x50', h: 330, b: 112, a: 94.84, iy: 13070, iz: 687, weight: 74.4, tw: 20, tf: 15.5 },
  { family: 'MC', name: 'MC13x40', h: 330, b: 106, a: 76.13, iy: 11363, iz: 570, weight: 59.5, tw: 14.2, tf: 15.5 },
  { family: 'MC', name: 'MC13x35', h: 330, b: 103, a: 66.45, iy: 10489, iz: 512, weight: 52.1, tw: 11.4, tf: 15.5 },
  { family: 'MC', name: 'MC13x31,8', h: 330, b: 102, a: 60.32, iy: 9948, iz: 475, weight: 47.3, tw: 9.53, tf: 15.5 },
  { family: 'MC', name: 'MC12x50', h: 305, b: 105, a: 94.84, iy: 11197, iz: 724, weight: 74.4, tw: 21.2, tf: 17.8 },
  { family: 'MC', name: 'MC12x45', h: 305, b: 102, a: 85.16, iy: 10489, iz: 658, weight: 67, tw: 18.1, tf: 17.8 },
  { family: 'MC', name: 'MC12x40', h: 305, b: 98.8, a: 76.13, iy: 9740, iz: 595, weight: 59.5, tw: 15, tf: 17.8 },
  { family: 'MC', name: 'MC12x35', h: 305, b: 95.7, a: 66.45, iy: 8991, iz: 529, weight: 52.1, tw: 11.9, tf: 17.8 },
  { family: 'MC', name: 'MC12x31', h: 305, b: 93.2, a: 58.84, iy: 8449, iz: 470, weight: 46.1, tw: 9.4, tf: 17.8 },
  { family: 'MC', name: 'MC12x10,6', h: 305, b: 38.1, a: 20, iy: 2306, iz: 15.9, weight: 15.8, tw: 4.83, tf: 7.8 },
  { family: 'MC', name: 'MC10x41,1', h: 254, b: 110, a: 78.06, iy: 6576, iz: 658, weight: 61.2, tw: 20.2, tf: 14.6 },
  { family: 'MC', name: 'MC10x33,6', h: 254, b: 104, a: 63.68, iy: 5786, iz: 549, weight: 50, tw: 14.6, tf: 14.6 },
  { family: 'MC', name: 'MC10x28,5', h: 254, b: 100, a: 54, iy: 5286, iz: 475, weight: 42.4, tw: 10.8, tf: 14.6 },
  { family: 'MC', name: 'MC10x25', h: 254, b: 86.5, a: 47.42, iy: 4579, iz: 306, weight: 37.2, tw: 9.65, tf: 14.6 },
  { family: 'MC', name: 'MC10x22', h: 254, b: 84.2, a: 41.61, iy: 4287, iz: 271, weight: 32.7, tw: 7.37, tf: 14.6 },
  { family: 'MC', name: 'MC10x8,4', h: 254, b: 38.1, a: 15.87, iy: 1332, iz: 13.7, weight: 12.5, tw: 4.32, tf: 7.11 },
  { family: 'MC', name: 'MC9x25,4', h: 229, b: 88.9, a: 48.19, iy: 3663, iz: 318, weight: 37.8, tw: 11.43, tf: 13.97 },
  { family: 'MC', name: 'MC9x23,9', h: 229, b: 87.6, a: 45.29, iy: 3538, iz: 301, weight: 35.57, tw: 10.16, tf: 13.97 },
  { family: 'MC', name: 'MC8x22,8', h: 203, b: 89, a: 43.23, iy: 2656, iz: 294, weight: 33.93, tw: 10.85, tf: 13.34 },
  { family: 'MC', name: 'MC8x21,4', h: 203, b: 87.6, a: 40.52, iy: 2564, iz: 276, weight: 31.85, tw: 9.525, tf: 13.34 },
  { family: 'MC', name: 'MC8x20', h: 203, b: 76.8, a: 37.94, iy: 2268, iz: 186, weight: 29.76, tw: 10.16, tf: 12.7 },
  { family: 'MC', name: 'MC8x18,7', h: 203, b: 75.6, a: 35.48, iy: 2185, iz: 175, weight: 27.83, tw: 8.966, tf: 12.7 },
  { family: 'MC', name: 'MC8x8,5', h: 203, b: 47.6, a: 16.13, iy: 970, iz: 26.1, weight: 12.65, tw: 4.547, tf: 7.899 },
  { family: 'MC', name: 'MC7x22,7', h: 178, b: 91.5, a: 43.03, iy: 1977, iz: 303, weight: 33.78, tw: 12.78, tf: 12.7 },
  { family: 'MC', name: 'MC7x19,1', h: 178, b: 87.7, a: 36.19, iy: 1798, iz: 254, weight: 28.42, tw: 8.941, tf: 12.7 },
  { family: 'MC', name: 'MC6x18', h: 152, b: 89, a: 34.13, iy: 1236, iz: 247, weight: 26.79, tw: 9.627, tf: 12.07 },
  { family: 'MC', name: 'MC6x16,3', h: 152, b: 76.2, a: 30.9, iy: 1082, iz: 159, weight: 24.26, tw: 9.525, tf: 12.07 },
  { family: 'MC', name: 'MC6x15,1', h: 152, b: 74.7, a: 28.65, iy: 1041, iz: 146, weight: 22.47, tw: 8.026, tf: 12.07 },
  { family: 'MC', name: 'MC6x12', h: 152, b: 63.4, a: 22.77, iy: 778, iz: 77.8, weight: 17.86, tw: 7.874, tf: 9.525 },
];
