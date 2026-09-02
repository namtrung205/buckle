/**
 * Standard section libraries (European EN and American AISC/ASTM).
 *
 * Each entry carries the *dimensional* data needed to build a section and to
 * compute its geometric properties analytically in the backend.
 *
 *   I / H    -> depth(d/h), width(b/bf), tw, tf, r   (also used for Channel / Tee)
 *   CHS      -> diameter(d), thickness(t)
 *   RHS/HSS  -> height(h), width(b), thickness(t), ri (inner corner radius)
 *   Angle    -> width(b/leg), thickness(t)
 *
 * Dimensions in millimetres.
 */
import { SectionType } from '../types';

export interface StandardSection {
  /** Library family this section belongs to (used for filtering). */
  family: SectionType;
  /** Designation string, e.g. "IPE300", "W10X12", "HSS4X2X1/4". */
  name: string;
  /** Source standard, e.g. "EN 10365", "AISC", "ASTM A500". */
  standard: string;
  // shared dimensions (only the relevant ones are set per family)
  depth?: number;
  height?: number;
  width?: number;
  tw?: number;
  tf?: number;
  r?: number;
  diameter?: number;
  thickness?: number;
  ri?: number;
}

// --------------------------------------------------------------------------- //
// European I-sections: IPE (EN 10365 / DIN 1025-5)
// --------------------------------------------------------------------------- //
const IPE: StandardSection[] = [
  { family: 'I', name: 'IPE80', standard: 'EN 10365', depth: 80, width: 46, tw: 3.8, tf: 5.2, r: 5 },
  { family: 'I', name: 'IPE100', standard: 'EN 10365', depth: 100, width: 55, tw: 4.1, tf: 5.7, r: 7 },
  { family: 'I', name: 'IPE120', standard: 'EN 10365', depth: 120, width: 64, tw: 4.4, tf: 6.3, r: 7 },
  { family: 'I', name: 'IPE140', standard: 'EN 10365', depth: 140, width: 73, tw: 4.7, tf: 6.9, r: 7 },
  { family: 'I', name: 'IPE160', standard: 'EN 10365', depth: 160, width: 82, tw: 5.0, tf: 7.4, r: 9 },
  { family: 'I', name: 'IPE180', standard: 'EN 10365', depth: 180, width: 91, tw: 5.3, tf: 8.0, r: 9 },
  { family: 'I', name: 'IPE200', standard: 'EN 10365', depth: 200, width: 100, tw: 5.6, tf: 8.5, r: 12 },
  { family: 'I', name: 'IPE220', standard: 'EN 10365', depth: 220, width: 110, tw: 5.9, tf: 9.2, r: 12 },
  { family: 'I', name: 'IPE240', standard: 'EN 10365', depth: 240, width: 120, tw: 6.2, tf: 9.8, r: 15 },
  { family: 'I', name: 'IPE270', standard: 'EN 10365', depth: 270, width: 135, tw: 6.6, tf: 10.2, r: 15 },
  { family: 'I', name: 'IPE300', standard: 'EN 10365', depth: 300, width: 150, tw: 7.1, tf: 10.7, r: 15 },
  { family: 'I', name: 'IPE330', standard: 'EN 10365', depth: 330, width: 160, tw: 7.5, tf: 11.5, r: 18 },
  { family: 'I', name: 'IPE360', standard: 'EN 10365', depth: 360, width: 170, tw: 8.0, tf: 12.7, r: 18 },
  { family: 'I', name: 'IPE400', standard: 'EN 10365', depth: 400, width: 180, tw: 8.6, tf: 13.5, r: 21 },
  { family: 'I', name: 'IPE450', standard: 'EN 10365', depth: 450, width: 190, tw: 9.4, tf: 14.6, r: 21 },
  { family: 'I', name: 'IPE500', standard: 'EN 10365', depth: 500, width: 200, tw: 10.2, tf: 16.0, r: 21 },
  { family: 'I', name: 'IPE550', standard: 'EN 10365', depth: 550, width: 210, tw: 11.1, tf: 17.2, r: 24 },
  { family: 'I', name: 'IPE600', standard: 'EN 10365', depth: 600, width: 220, tw: 12.0, tf: 19.0, r: 24 },
];

// --------------------------------------------------------------------------- //
// European HEA / HEB / HEM series (EN 10365 / DIN 1025-3,4)
// --------------------------------------------------------------------------- //
const HEA: StandardSection[] = [
  { family: 'I', name: 'HEA100', standard: 'EN 10365', depth: 96, width: 100, tw: 5, tf: 8, r: 12 },
  { family: 'I', name: 'HEA120', standard: 'EN 10365', depth: 114, width: 120, tw: 5, tf: 8, r: 12 },
  { family: 'I', name: 'HEA140', standard: 'EN 10365', depth: 133, width: 140, tw: 5.5, tf: 8.5, r: 12 },
  { family: 'I', name: 'HEA160', standard: 'EN 10365', depth: 152, width: 160, tw: 6, tf: 9, r: 15 },
  { family: 'I', name: 'HEA180', standard: 'EN 10365', depth: 171, width: 180, tw: 6, tf: 9.5, r: 15 },
  { family: 'I', name: 'HEA200', standard: 'EN 10365', depth: 190, width: 200, tw: 6.5, tf: 10, r: 18 },
  { family: 'I', name: 'HEA220', standard: 'EN 10365', depth: 210, width: 220, tw: 7, tf: 11, r: 18 },
  { family: 'I', name: 'HEA240', standard: 'EN 10365', depth: 230, width: 240, tw: 7.5, tf: 12, r: 21 },
  { family: 'I', name: 'HEA260', standard: 'EN 10365', depth: 250, width: 260, tw: 7.5, tf: 12.5, r: 24 },
  { family: 'I', name: 'HEA280', standard: 'EN 10365', depth: 270, width: 280, tw: 8, tf: 13, r: 24 },
  { family: 'I', name: 'HEA300', standard: 'EN 10365', depth: 290, width: 300, tw: 8.5, tf: 14, r: 27 },
  { family: 'I', name: 'HEA320', standard: 'EN 10365', depth: 310, width: 300, tw: 9, tf: 15.5, r: 27 },
  { family: 'I', name: 'HEA340', standard: 'EN 10365', depth: 330, width: 300, tw: 9.5, tf: 16.5, r: 27 },
  { family: 'I', name: 'HEA360', standard: 'EN 10365', depth: 350, width: 300, tw: 10, tf: 17.5, r: 27 },
  { family: 'I', name: 'HEA400', standard: 'EN 10365', depth: 390, width: 300, tw: 11, tf: 19, r: 27 },
  { family: 'I', name: 'HEA450', standard: 'EN 10365', depth: 440, width: 300, tw: 11.5, tf: 21, r: 27 },
  { family: 'I', name: 'HEA500', standard: 'EN 10365', depth: 490, width: 300, tw: 12, tf: 23, r: 27 },
  { family: 'I', name: 'HEA550', standard: 'EN 10365', depth: 540, width: 300, tw: 12.5, tf: 24, r: 27 },
  { family: 'I', name: 'HEA600', standard: 'EN 10365', depth: 590, width: 300, tw: 13, tf: 25, r: 27 },
  { family: 'I', name: 'HEA650', standard: 'EN 10365', depth: 640, width: 300, tw: 13.5, tf: 26, r: 27 },
  { family: 'I', name: 'HEA700', standard: 'EN 10365', depth: 690, width: 300, tw: 14.5, tf: 27, r: 27 },
  { family: 'I', name: 'HEA800', standard: 'EN 10365', depth: 790, width: 300, tw: 15, tf: 28, r: 30 },
  { family: 'I', name: 'HEA900', standard: 'EN 10365', depth: 890, width: 300, tw: 16, tf: 30, r: 30 },
  { family: 'I', name: 'HEA1000', standard: 'EN 10365', depth: 990, width: 300, tw: 16.5, tf: 31, r: 30 },
];

const HEB: StandardSection[] = [
  { family: 'I', name: 'HEB100', standard: 'EN 10365', depth: 100, width: 100, tw: 6, tf: 10, r: 12 },
  { family: 'I', name: 'HEB120', standard: 'EN 10365', depth: 120, width: 120, tw: 6.5, tf: 11, r: 12 },
  { family: 'I', name: 'HEB140', standard: 'EN 10365', depth: 140, width: 140, tw: 7, tf: 12, r: 12 },
  { family: 'I', name: 'HEB160', standard: 'EN 10365', depth: 160, width: 160, tw: 8, tf: 13, r: 15 },
  { family: 'I', name: 'HEB180', standard: 'EN 10365', depth: 180, width: 180, tw: 8.5, tf: 14, r: 15 },
  { family: 'I', name: 'HEB200', standard: 'EN 10365', depth: 200, width: 200, tw: 9, tf: 15, r: 18 },
  { family: 'I', name: 'HEB220', standard: 'EN 10365', depth: 220, width: 220, tw: 9.5, tf: 16, r: 18 },
  { family: 'I', name: 'HEB240', standard: 'EN 10365', depth: 240, width: 240, tw: 10, tf: 17, r: 21 },
  { family: 'I', name: 'HEB260', standard: 'EN 10365', depth: 260, width: 260, tw: 10, tf: 17.5, r: 24 },
  { family: 'I', name: 'HEB280', standard: 'EN 10365', depth: 280, width: 280, tw: 10.5, tf: 18, r: 24 },
  { family: 'I', name: 'HEB300', standard: 'EN 10365', depth: 300, width: 300, tw: 11, tf: 19, r: 27 },
  { family: 'I', name: 'HEB320', standard: 'EN 10365', depth: 320, width: 300, tw: 11.5, tf: 20.5, r: 27 },
  { family: 'I', name: 'HEB340', standard: 'EN 10365', depth: 340, width: 300, tw: 12, tf: 21.5, r: 27 },
  { family: 'I', name: 'HEB360', standard: 'EN 10365', depth: 360, width: 300, tw: 12.5, tf: 22.5, r: 27 },
  { family: 'I', name: 'HEB400', standard: 'EN 10365', depth: 400, width: 300, tw: 13.5, tf: 24, r: 27 },
  { family: 'I', name: 'HEB450', standard: 'EN 10365', depth: 450, width: 300, tw: 14, tf: 26, r: 27 },
  { family: 'I', name: 'HEB500', standard: 'EN 10365', depth: 500, width: 300, tw: 14.5, tf: 28, r: 27 },
  { family: 'I', name: 'HEB550', standard: 'EN 10365', depth: 550, width: 300, tw: 15, tf: 29, r: 27 },
  { family: 'I', name: 'HEB600', standard: 'EN 10365', depth: 600, width: 300, tw: 15.5, tf: 30, r: 27 },
  { family: 'I', name: 'HEB650', standard: 'EN 10365', depth: 650, width: 300, tw: 16, tf: 31, r: 27 },
  { family: 'I', name: 'HEB700', standard: 'EN 10365', depth: 700, width: 300, tw: 17, tf: 32, r: 27 },
  { family: 'I', name: 'HEB800', standard: 'EN 10365', depth: 800, width: 300, tw: 17.5, tf: 33, r: 30 },
  { family: 'I', name: 'HEB900', standard: 'EN 10365', depth: 900, width: 300, tw: 18.5, tf: 35, r: 30 },
  { family: 'I', name: 'HEB1000', standard: 'EN 10365', depth: 1000, width: 300, tw: 19, tf: 36, r: 30 },
];

const HEM: StandardSection[] = [
  { family: 'I', name: 'HEM100', standard: 'EN 10365', depth: 120, width: 106, tw: 12, tf: 20, r: 12 },
  { family: 'I', name: 'HEM120', standard: 'EN 10365', depth: 140, width: 126, tw: 12.5, tf: 21, r: 12 },
  { family: 'I', name: 'HEM140', standard: 'EN 10365', depth: 160, width: 146, tw: 13, tf: 22, r: 12 },
  { family: 'I', name: 'HEM160', standard: 'EN 10365', depth: 180, width: 166, tw: 14, tf: 23, r: 15 },
  { family: 'I', name: 'HEM180', standard: 'EN 10365', depth: 200, width: 186, tw: 14.5, tf: 24, r: 15 },
  { family: 'I', name: 'HEM200', standard: 'EN 10365', depth: 220, width: 206, tw: 15, tf: 25, r: 18 },
  { family: 'I', name: 'HEM220', standard: 'EN 10365', depth: 240, width: 226, tw: 15.5, tf: 26, r: 18 },
  { family: 'I', name: 'HEM240', standard: 'EN 10365', depth: 270, width: 242, tw: 18, tf: 32, r: 21 },
  { family: 'I', name: 'HEM260', standard: 'EN 10365', depth: 290, width: 262, tw: 18, tf: 32.5, r: 24 },
  { family: 'I', name: 'HEM280', standard: 'EN 10365', depth: 310, width: 282, tw: 18.5, tf: 33, r: 24 },
  { family: 'I', name: 'HEM300', standard: 'EN 10365', depth: 340, width: 302, tw: 19, tf: 34, r: 27 },
  { family: 'I', name: 'HEM320', standard: 'EN 10365', depth: 359, width: 304, tw: 21, tf: 40, r: 27 },
  { family: 'I', name: 'HEM340', standard: 'EN 10365', depth: 377, width: 304, tw: 21.5, tf: 40, r: 27 },
  { family: 'I', name: 'HEM360', standard: 'EN 10365', depth: 395, width: 305, tw: 22, tf: 40.5, r: 27 },
  { family: 'I', name: 'HEM400', standard: 'EN 10365', depth: 432, width: 305, tw: 24, tf: 42, r: 27 },
  { family: 'I', name: 'HEM450', standard: 'EN 10365', depth: 478, width: 305, tw: 26, tf: 45, r: 27 },
  { family: 'I', name: 'HEM500', standard: 'EN 10365', depth: 524, width: 306, tw: 28, tf: 48, r: 27 },
  { family: 'I', name: 'HEM550', standard: 'EN 10365', depth: 572, width: 306, tw: 29, tf: 50, r: 27 },
  { family: 'I', name: 'HEM600', standard: 'EN 10365', depth: 620, width: 306, tw: 30, tf: 52, r: 27 },
  { family: 'I', name: 'HEM650', standard: 'EN 10365', depth: 668, width: 306, tw: 31, tf: 54, r: 27 },
  { family: 'I', name: 'HEM700', standard: 'EN 10365', depth: 716, width: 306, tw: 32, tf: 56, r: 27 },
  { family: 'I', name: 'HEM800', standard: 'EN 10365', depth: 814, width: 306, tw: 34, tf: 60, r: 30 },
  { family: 'I', name: 'HEM900', standard: 'EN 10365', depth: 910, width: 306, tw: 36, tf: 64, r: 30 },
  { family: 'I', name: 'HEM1000', standard: 'EN 10365', depth: 1008, width: 302, tw: 38, tf: 68, r: 30 },
];

// --------------------------------------------------------------------------- //
// Tapered I-beams IPN (DIN 1025-1). tf is quoted at b/4; the flange slope
// (14 %) and root/toe radii (tw, 0.6 tw) are rules, applied in the backend.
// --------------------------------------------------------------------------- //
const IPN: StandardSection[] = [
  { family: 'IPN', name: 'IPN80', standard: 'DIN 1025-1', depth: 80, width: 42, tw: 3.9, tf: 5.9 },
  { family: 'IPN', name: 'IPN100', standard: 'DIN 1025-1', depth: 100, width: 50, tw: 4.5, tf: 6.8 },
  { family: 'IPN', name: 'IPN120', standard: 'DIN 1025-1', depth: 120, width: 58, tw: 5.1, tf: 7.7 },
  { family: 'IPN', name: 'IPN140', standard: 'DIN 1025-1', depth: 140, width: 66, tw: 5.7, tf: 8.6 },
  { family: 'IPN', name: 'IPN160', standard: 'DIN 1025-1', depth: 160, width: 74, tw: 6.3, tf: 9.5 },
  { family: 'IPN', name: 'IPN180', standard: 'DIN 1025-1', depth: 180, width: 82, tw: 6.9, tf: 10.4 },
  { family: 'IPN', name: 'IPN200', standard: 'DIN 1025-1', depth: 200, width: 90, tw: 7.5, tf: 11.3 },
  { family: 'IPN', name: 'IPN220', standard: 'DIN 1025-1', depth: 220, width: 98, tw: 8.1, tf: 12.2 },
  { family: 'IPN', name: 'IPN240', standard: 'DIN 1025-1', depth: 240, width: 106, tw: 8.7, tf: 13.1 },
  { family: 'IPN', name: 'IPN260', standard: 'DIN 1025-1', depth: 260, width: 113, tw: 9.4, tf: 14.1 },
  { family: 'IPN', name: 'IPN280', standard: 'DIN 1025-1', depth: 280, width: 119, tw: 10.1, tf: 15.2 },
  { family: 'IPN', name: 'IPN300', standard: 'DIN 1025-1', depth: 300, width: 125, tw: 10.8, tf: 16.2 },
  { family: 'IPN', name: 'IPN320', standard: 'DIN 1025-1', depth: 320, width: 131, tw: 11.5, tf: 17.3 },
  { family: 'IPN', name: 'IPN340', standard: 'DIN 1025-1', depth: 340, width: 137, tw: 12.2, tf: 18.3 },
  { family: 'IPN', name: 'IPN360', standard: 'DIN 1025-1', depth: 360, width: 143, tw: 13.0, tf: 19.5 },
  { family: 'IPN', name: 'IPN380', standard: 'DIN 1025-1', depth: 380, width: 149, tw: 13.7, tf: 20.5 },
  { family: 'IPN', name: 'IPN400', standard: 'DIN 1025-1', depth: 400, width: 155, tw: 14.4, tf: 21.6 },
  { family: 'IPN', name: 'IPN450', standard: 'DIN 1025-1', depth: 450, width: 170, tw: 16.2, tf: 24.3 },
  { family: 'IPN', name: 'IPN500', standard: 'DIN 1025-1', depth: 500, width: 185, tw: 18.0, tf: 27.0 },
  { family: 'IPN', name: 'IPN550', standard: 'DIN 1025-1', depth: 550, width: 200, tw: 19.0, tf: 30.0 },
  { family: 'IPN', name: 'IPN600', standard: 'DIN 1025-1', depth: 600, width: 215, tw: 21.6, tf: 32.4 },
];

// --------------------------------------------------------------------------- //
// European channels UPN (DIN 1026-1) — tapered flanges: slope 8 %,
// root radius = tf, toe radius = 0.5 tf, tf quoted at b/2 (backend rules).
// --------------------------------------------------------------------------- //
const UPN: StandardSection[] = [
  { family: 'UPN', name: 'UPN80', standard: 'DIN 1026-1', depth: 80, width: 45, tw: 6.0, tf: 8.0 },
  { family: 'UPN', name: 'UPN100', standard: 'DIN 1026-1', depth: 100, width: 50, tw: 6.0, tf: 8.5 },
  { family: 'UPN', name: 'UPN120', standard: 'DIN 1026-1', depth: 120, width: 55, tw: 7.0, tf: 9.0 },
  { family: 'UPN', name: 'UPN140', standard: 'DIN 1026-1', depth: 140, width: 60, tw: 7.0, tf: 10.0 },
  { family: 'UPN', name: 'UPN160', standard: 'DIN 1026-1', depth: 160, width: 65, tw: 7.5, tf: 10.5 },
  { family: 'UPN', name: 'UPN180', standard: 'DIN 1026-1', depth: 180, width: 70, tw: 8.0, tf: 11.0 },
  { family: 'UPN', name: 'UPN200', standard: 'DIN 1026-1', depth: 200, width: 75, tw: 8.5, tf: 11.5 },
  { family: 'UPN', name: 'UPN220', standard: 'DIN 1026-1', depth: 220, width: 80, tw: 9.0, tf: 12.5 },
  { family: 'UPN', name: 'UPN240', standard: 'DIN 1026-1', depth: 240, width: 85, tw: 9.5, tf: 13.0 },
  { family: 'UPN', name: 'UPN260', standard: 'DIN 1026-1', depth: 260, width: 90, tw: 10.0, tf: 14.0 },
  { family: 'UPN', name: 'UPN280', standard: 'DIN 1026-1', depth: 280, width: 95, tw: 10.0, tf: 15.0 },
  { family: 'UPN', name: 'UPN300', standard: 'DIN 1026-1', depth: 300, width: 100, tw: 10.0, tf: 16.0 },
];

// --------------------------------------------------------------------------- //
// Equal-leg angles (EN 10056-1) — with tabulated root radius (r) and toe radius
// r2 = r/2. Iy/Iz come from the filleted outline, not a sharp angle.
// --------------------------------------------------------------------------- //
const ANGLE_EU: StandardSection[] = [
  { family: 'Angle', name: 'L30x30x3', standard: 'EN 10056-1', width: 30, thickness: 3, r: 5 },
  { family: 'Angle', name: 'L40x40x4', standard: 'EN 10056-1', width: 40, thickness: 4, r: 6 },
  { family: 'Angle', name: 'L50x50x5', standard: 'EN 10056-1', width: 50, thickness: 5, r: 7 },
  { family: 'Angle', name: 'L60x60x6', standard: 'EN 10056-1', width: 60, thickness: 6, r: 8 },
  { family: 'Angle', name: 'L70x70x7', standard: 'EN 10056-1', width: 70, thickness: 7, r: 9 },
  { family: 'Angle', name: 'L80x80x8', standard: 'EN 10056-1', width: 80, thickness: 8, r: 10 },
  { family: 'Angle', name: 'L90x90x9', standard: 'EN 10056-1', width: 90, thickness: 9, r: 11 },
  { family: 'Angle', name: 'L100x100x10', standard: 'EN 10056-1', width: 100, thickness: 10, r: 12 },
  { family: 'Angle', name: 'L120x120x12', standard: 'EN 10056-1', width: 120, thickness: 12, r: 13 },
  { family: 'Angle', name: 'L150x150x15', standard: 'EN 10056-1', width: 150, thickness: 15, r: 16 },
];

// --------------------------------------------------------------------------- //
// American / EN hollow & channel datasets (defined in sectionsData.ts)
// --------------------------------------------------------------------------- //
import {
  W_SHAPES,
  HSS_RECT,
  HSS_ROUND_CHS,
  RHS_SHS,
  CHANNELS_US,
} from './sectionsData';

// --------------------------------------------------------------------------- //
// Master collection
// --------------------------------------------------------------------------- //
export const SECTION_STANDARDS: StandardSection[] = [
  ...IPE,
  ...IPN,
  ...HEA,
  ...HEB,
  ...HEM,
  ...W_SHAPES,
  ...HSS_ROUND_CHS,
  ...HSS_RECT,
  ...RHS_SHS,
  ...UPN,
  ...CHANNELS_US,
  ...ANGLE_EU,
];

/** Return the standard sections relevant to a given section type. */
export function filterStandards(type: SectionType): StandardSection[] {
  return SECTION_STANDARDS.filter((s) => s.family === type);
}

/** Look up a standard section by its designation name. */
export function findStandard(name: string): StandardSection | undefined {
  return SECTION_STANDARDS.find((s) => s.name === name);
}