/**
 * Standard section libraries (European EN and American AISC/ASTM).
 *
 * Each entry carries the *dimensional* data needed to build a section and to
 * compute its geometric properties analytically in the backend, plus — for the
 * families whose published tables are reproduced — the tabulated A / Iy / Iz /
 * weight shown in the picker table.
 *
 *   I / H    -> depth(d/h), width(b/bf), tw, tf, r   (also used for Channel / Tee)
 *   CHS      -> diameter(d), thickness(t)
 *   RHS/HSS  -> height(h), width(b), thickness(t), ri (inner corner radius)
 *   Angle    -> width(b/leg), thickness(t), r (root radius)
 *
 * Dimensions in millimetres; tabulated area in cm², inertias in cm⁴, weight in kg/m.
 */
import { SectionType } from '../types';

export interface StandardSection {
  /** Library family this section belongs to (used for filtering). */
  family: SectionType;
  /** Designation string, e.g. "IPE300", "W10X12", "HSS4X2X1/4". */
  name: string;
  /** Source standard, e.g. "EN 10365", "AISC", "ASTM A500". */
  standard: string;
  /** Series grouping for the picker accordion (e.g. "I-sections", "Channels"). */
  series?: string;
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
  // tabulated values (cm² / cm⁴ / kg/m), where the source publishes them
  aCm2?: number;
  iyCm4?: number;
  izCm4?: number;
  weightKgM?: number;
}

// --------------------------------------------------------------------------- //
// European I-sections: IPE (EN 10365 / DIN 1025-5)
// --------------------------------------------------------------------------- //
const IPE: StandardSection[] = [
  { family: 'I', series: 'I-sections', name: 'IPE80', standard: 'EN 10365', depth: 80, width: 46, tw: 3.8, tf: 5.2, r: 5, aCm2: 7.64, iyCm4: 80.1, izCm4: 8.49, weightKgM: 6.0 },
  { family: 'I', series: 'I-sections', name: 'IPE100', standard: 'EN 10365', depth: 100, width: 55, tw: 4.1, tf: 5.7, r: 7, aCm2: 10.3, iyCm4: 171, izCm4: 15.9, weightKgM: 8.1 },
  { family: 'I', series: 'I-sections', name: 'IPE120', standard: 'EN 10365', depth: 120, width: 64, tw: 4.4, tf: 6.3, r: 7, aCm2: 13.2, iyCm4: 318, izCm4: 27.7, weightKgM: 10.4 },
  { family: 'I', series: 'I-sections', name: 'IPE140', standard: 'EN 10365', depth: 140, width: 73, tw: 4.7, tf: 6.9, r: 7, aCm2: 16.4, iyCm4: 541, izCm4: 44.9, weightKgM: 12.9 },
  { family: 'I', series: 'I-sections', name: 'IPE160', standard: 'EN 10365', depth: 160, width: 82, tw: 5.0, tf: 7.4, r: 9, aCm2: 20.1, iyCm4: 869, izCm4: 68.3, weightKgM: 15.8 },
  { family: 'I', series: 'I-sections', name: 'IPE180', standard: 'EN 10365', depth: 180, width: 91, tw: 5.3, tf: 8.0, r: 9, aCm2: 23.9, iyCm4: 1317, izCm4: 101, weightKgM: 18.8 },
  { family: 'I', series: 'I-sections', name: 'IPE200', standard: 'EN 10365', depth: 200, width: 100, tw: 5.6, tf: 8.5, r: 12, aCm2: 28.5, iyCm4: 1943, izCm4: 142, weightKgM: 22.4 },
  { family: 'I', series: 'I-sections', name: 'IPE220', standard: 'EN 10365', depth: 220, width: 110, tw: 5.9, tf: 9.2, r: 12, aCm2: 33.4, iyCm4: 2772, izCm4: 205, weightKgM: 26.2 },
  { family: 'I', series: 'I-sections', name: 'IPE240', standard: 'EN 10365', depth: 240, width: 120, tw: 6.2, tf: 9.8, r: 15, aCm2: 39.1, iyCm4: 3892, izCm4: 284, weightKgM: 30.7 },
  { family: 'I', series: 'I-sections', name: 'IPE270', standard: 'EN 10365', depth: 270, width: 135, tw: 6.6, tf: 10.2, r: 15, aCm2: 45.9, iyCm4: 5790, izCm4: 420, weightKgM: 36.1 },
  { family: 'I', series: 'I-sections', name: 'IPE300', standard: 'EN 10365', depth: 300, width: 150, tw: 7.1, tf: 10.7, r: 15, aCm2: 53.8, iyCm4: 8356, izCm4: 604, weightKgM: 42.2 },
  { family: 'I', series: 'I-sections', name: 'IPE330', standard: 'EN 10365', depth: 330, width: 160, tw: 7.5, tf: 11.5, r: 18, aCm2: 62.6, iyCm4: 11770, izCm4: 788, weightKgM: 49.1 },
  { family: 'I', series: 'I-sections', name: 'IPE360', standard: 'EN 10365', depth: 360, width: 170, tw: 8.0, tf: 12.7, r: 18, aCm2: 72.7, iyCm4: 16270, izCm4: 1043, weightKgM: 57.1 },
  { family: 'I', series: 'I-sections', name: 'IPE400', standard: 'EN 10365', depth: 400, width: 180, tw: 8.6, tf: 13.5, r: 21, aCm2: 84.5, iyCm4: 23130, izCm4: 1318, weightKgM: 66.3 },
  { family: 'I', series: 'I-sections', name: 'IPE450', standard: 'EN 10365', depth: 450, width: 190, tw: 9.4, tf: 14.6, r: 21, aCm2: 98.8, iyCm4: 33740, izCm4: 1676, weightKgM: 77.6 },
  { family: 'I', series: 'I-sections', name: 'IPE500', standard: 'EN 10365', depth: 500, width: 200, tw: 10.2, tf: 16.0, r: 21, aCm2: 116, iyCm4: 48200, izCm4: 2142, weightKgM: 90.7 },
  { family: 'I', series: 'I-sections', name: 'IPE550', standard: 'EN 10365', depth: 550, width: 210, tw: 11.1, tf: 17.2, r: 24, aCm2: 134, iyCm4: 67120, izCm4: 2668, weightKgM: 106 },
  { family: 'I', series: 'I-sections', name: 'IPE600', standard: 'EN 10365', depth: 600, width: 220, tw: 12.0, tf: 19.0, r: 24, aCm2: 156, iyCm4: 92080, izCm4: 3387, weightKgM: 122 },
];

// --------------------------------------------------------------------------- //
// European HEA / HEB / HEM series (EN 10365 / DIN 1025-3,4)
// --------------------------------------------------------------------------- //
const HEA: StandardSection[] = [
  { family: 'I', series: 'H-sections', name: 'HEA100', standard: 'EN 10365', depth: 96, width: 100, tw: 5, tf: 8, r: 12, aCm2: 21.2, iyCm4: 349, izCm4: 134, weightKgM: 16.7 },
  { family: 'I', series: 'H-sections', name: 'HEA120', standard: 'EN 10365', depth: 114, width: 120, tw: 5, tf: 8, r: 12, aCm2: 25.3, iyCm4: 606, izCm4: 231, weightKgM: 19.9 },
  { family: 'I', series: 'H-sections', name: 'HEA140', standard: 'EN 10365', depth: 133, width: 140, tw: 5.5, tf: 8.5, r: 12, aCm2: 31.4, iyCm4: 1033, izCm4: 389, weightKgM: 24.7 },
  { family: 'I', series: 'H-sections', name: 'HEA160', standard: 'EN 10365', depth: 152, width: 160, tw: 6, tf: 9, r: 15, aCm2: 38.8, iyCm4: 1673, izCm4: 616, weightKgM: 30.4 },
  { family: 'I', series: 'H-sections', name: 'HEA180', standard: 'EN 10365', depth: 171, width: 180, tw: 6, tf: 9.5, r: 15, aCm2: 45.3, iyCm4: 2510, izCm4: 925, weightKgM: 35.5 },
  { family: 'I', series: 'H-sections', name: 'HEA200', standard: 'EN 10365', depth: 190, width: 200, tw: 6.5, tf: 10, r: 18, aCm2: 53.8, iyCm4: 3692, izCm4: 1336, weightKgM: 42.3 },
  { family: 'I', series: 'H-sections', name: 'HEA220', standard: 'EN 10365', depth: 210, width: 220, tw: 7, tf: 11, r: 18, aCm2: 64.3, iyCm4: 5410, izCm4: 1955, weightKgM: 50.5 },
  { family: 'I', series: 'H-sections', name: 'HEA240', standard: 'EN 10365', depth: 230, width: 240, tw: 7.5, tf: 12, r: 21, aCm2: 76.8, iyCm4: 7763, izCm4: 2769, weightKgM: 60.3 },
  { family: 'I', series: 'H-sections', name: 'HEA260', standard: 'EN 10365', depth: 250, width: 260, tw: 7.5, tf: 12.5, r: 24, aCm2: 86.8, iyCm4: 10450, izCm4: 3668, weightKgM: 68.2 },
  { family: 'I', series: 'H-sections', name: 'HEA280', standard: 'EN 10365', depth: 270, width: 280, tw: 8, tf: 13, r: 24, aCm2: 97.3, iyCm4: 13670, izCm4: 4763, weightKgM: 76.4 },
  { family: 'I', series: 'H-sections', name: 'HEA300', standard: 'EN 10365', depth: 290, width: 300, tw: 8.5, tf: 14, r: 27, aCm2: 113, iyCm4: 18260, izCm4: 6310, weightKgM: 88.3 },
  { family: 'I', series: 'H-sections', name: 'HEA320', standard: 'EN 10365', depth: 310, width: 300, tw: 9, tf: 15.5, r: 27, aCm2: 124, iyCm4: 22930, izCm4: 6985, weightKgM: 97.6 },
  { family: 'I', series: 'H-sections', name: 'HEA340', standard: 'EN 10365', depth: 330, width: 300, tw: 9.5, tf: 16.5, r: 27, aCm2: 133, iyCm4: 27690, izCm4: 7436, weightKgM: 105 },
  { family: 'I', series: 'H-sections', name: 'HEA360', standard: 'EN 10365', depth: 350, width: 300, tw: 10, tf: 17.5, r: 27, aCm2: 143, iyCm4: 33090, izCm4: 7887, weightKgM: 112 },
  { family: 'I', series: 'H-sections', name: 'HEA400', standard: 'EN 10365', depth: 390, width: 300, tw: 11, tf: 19, r: 27, aCm2: 159, iyCm4: 45070, izCm4: 8564, weightKgM: 125 },
  { family: 'I', series: 'H-sections', name: 'HEA450', standard: 'EN 10365', depth: 440, width: 300, tw: 11.5, tf: 21, r: 27, aCm2: 178, iyCm4: 63720, izCm4: 9465, weightKgM: 140 },
  { family: 'I', series: 'H-sections', name: 'HEA500', standard: 'EN 10365', depth: 490, width: 300, tw: 12, tf: 23, r: 27, aCm2: 198, iyCm4: 86970, izCm4: 10370, weightKgM: 155 },
  { family: 'I', series: 'H-sections', name: 'HEA550', standard: 'EN 10365', depth: 540, width: 300, tw: 12.5, tf: 24, r: 27, aCm2: 212, iyCm4: 111900, izCm4: 10820, weightKgM: 166 },
  { family: 'I', series: 'H-sections', name: 'HEA600', standard: 'EN 10365', depth: 590, width: 300, tw: 13, tf: 25, r: 27, aCm2: 226, iyCm4: 141200, izCm4: 11270, weightKgM: 178 },
  { family: 'I', series: 'H-sections', name: 'HEA650', standard: 'EN 10365', depth: 640, width: 300, tw: 13.5, tf: 26, r: 27, aCm2: 242, iyCm4: 175200, izCm4: 11720, weightKgM: 190 },
  { family: 'I', series: 'H-sections', name: 'HEA700', standard: 'EN 10365', depth: 690, width: 300, tw: 14.5, tf: 27, r: 27, aCm2: 260, iyCm4: 215300, izCm4: 12180, weightKgM: 204 },
  { family: 'I', series: 'H-sections', name: 'HEA800', standard: 'EN 10365', depth: 790, width: 300, tw: 15, tf: 28, r: 30, aCm2: 286, iyCm4: 303400, izCm4: 12640, weightKgM: 224 },
  { family: 'I', series: 'H-sections', name: 'HEA900', standard: 'EN 10365', depth: 890, width: 300, tw: 16, tf: 30, r: 30, aCm2: 320, iyCm4: 422100, izCm4: 13550, weightKgM: 252 },
  { family: 'I', series: 'H-sections', name: 'HEA1000', standard: 'EN 10365', depth: 990, width: 300, tw: 16.5, tf: 31, r: 30, aCm2: 347, iyCm4: 553800, izCm4: 14010, weightKgM: 272 },
];

const HEB: StandardSection[] = [
  { family: 'I', series: 'H-sections', name: 'HEB100', standard: 'EN 10365', depth: 100, width: 100, tw: 6, tf: 10, r: 12, aCm2: 26.0, iyCm4: 450, izCm4: 167, weightKgM: 20.4 },
  { family: 'I', series: 'H-sections', name: 'HEB120', standard: 'EN 10365', depth: 120, width: 120, tw: 6.5, tf: 11, r: 12, aCm2: 34.0, iyCm4: 864, izCm4: 318, weightKgM: 26.7 },
  { family: 'I', series: 'H-sections', name: 'HEB140', standard: 'EN 10365', depth: 140, width: 140, tw: 7, tf: 12, r: 12, aCm2: 43.0, iyCm4: 1509, izCm4: 550, weightKgM: 33.7 },
  { family: 'I', series: 'H-sections', name: 'HEB160', standard: 'EN 10365', depth: 160, width: 160, tw: 8, tf: 13, r: 15, aCm2: 54.3, iyCm4: 2492, izCm4: 889, weightKgM: 42.6 },
  { family: 'I', series: 'H-sections', name: 'HEB180', standard: 'EN 10365', depth: 180, width: 180, tw: 8.5, tf: 14, r: 15, aCm2: 65.3, iyCm4: 3831, izCm4: 1363, weightKgM: 51.2 },
  { family: 'I', series: 'H-sections', name: 'HEB200', standard: 'EN 10365', depth: 200, width: 200, tw: 9, tf: 15, r: 18, aCm2: 78.1, iyCm4: 5696, izCm4: 2003, weightKgM: 61.3 },
  { family: 'I', series: 'H-sections', name: 'HEB220', standard: 'EN 10365', depth: 220, width: 220, tw: 9.5, tf: 16, r: 18, aCm2: 91.0, iyCm4: 8091, izCm4: 2843, weightKgM: 71.5 },
  { family: 'I', series: 'H-sections', name: 'HEB240', standard: 'EN 10365', depth: 240, width: 240, tw: 10, tf: 17, r: 21, aCm2: 106, iyCm4: 11260, izCm4: 3923, weightKgM: 83.2 },
  { family: 'I', series: 'H-sections', name: 'HEB260', standard: 'EN 10365', depth: 260, width: 260, tw: 10, tf: 17.5, r: 24, aCm2: 118, iyCm4: 14920, izCm4: 5135, weightKgM: 93.0 },
  { family: 'I', series: 'H-sections', name: 'HEB280', standard: 'EN 10365', depth: 280, width: 280, tw: 10.5, tf: 18, r: 24, aCm2: 131, iyCm4: 19270, izCm4: 6595, weightKgM: 103 },
  { family: 'I', series: 'H-sections', name: 'HEB300', standard: 'EN 10365', depth: 300, width: 300, tw: 11, tf: 19, r: 27, aCm2: 149, iyCm4: 25170, izCm4: 8563, weightKgM: 117 },
  { family: 'I', series: 'H-sections', name: 'HEB320', standard: 'EN 10365', depth: 320, width: 300, tw: 11.5, tf: 20.5, r: 27, aCm2: 161, iyCm4: 30820, izCm4: 9239, weightKgM: 127 },
  { family: 'I', series: 'H-sections', name: 'HEB340', standard: 'EN 10365', depth: 340, width: 300, tw: 12, tf: 21.5, r: 27, aCm2: 171, iyCm4: 36660, izCm4: 9690, weightKgM: 134 },
  { family: 'I', series: 'H-sections', name: 'HEB360', standard: 'EN 10365', depth: 360, width: 300, tw: 12.5, tf: 22.5, r: 27, aCm2: 181, iyCm4: 43190, izCm4: 10140, weightKgM: 142 },
  { family: 'I', series: 'H-sections', name: 'HEB400', standard: 'EN 10365', depth: 400, width: 300, tw: 13.5, tf: 24, r: 27, aCm2: 198, iyCm4: 57680, izCm4: 10820, weightKgM: 155 },
  { family: 'I', series: 'H-sections', name: 'HEB450', standard: 'EN 10365', depth: 450, width: 300, tw: 14, tf: 26, r: 27, aCm2: 218, iyCm4: 79890, izCm4: 11720, weightKgM: 171 },
  { family: 'I', series: 'H-sections', name: 'HEB500', standard: 'EN 10365', depth: 500, width: 300, tw: 14.5, tf: 28, r: 27, aCm2: 239, iyCm4: 107200, izCm4: 12620, weightKgM: 187 },
  { family: 'I', series: 'H-sections', name: 'HEB550', standard: 'EN 10365', depth: 550, width: 300, tw: 15, tf: 29, r: 27, aCm2: 254, iyCm4: 136700, izCm4: 13080, weightKgM: 199 },
  { family: 'I', series: 'H-sections', name: 'HEB600', standard: 'EN 10365', depth: 600, width: 300, tw: 15.5, tf: 30, r: 27, aCm2: 270, iyCm4: 171000, izCm4: 13530, weightKgM: 212 },
  { family: 'I', series: 'H-sections', name: 'HEB650', standard: 'EN 10365', depth: 650, width: 300, tw: 16, tf: 31, r: 27, aCm2: 286, iyCm4: 210600, izCm4: 13980, weightKgM: 225 },
  { family: 'I', series: 'H-sections', name: 'HEB700', standard: 'EN 10365', depth: 700, width: 300, tw: 17, tf: 32, r: 27, aCm2: 306, iyCm4: 256900, izCm4: 14440, weightKgM: 241 },
  { family: 'I', series: 'H-sections', name: 'HEB800', standard: 'EN 10365', depth: 800, width: 300, tw: 17.5, tf: 33, r: 30, aCm2: 334, iyCm4: 359100, izCm4: 14900, weightKgM: 262 },
  { family: 'I', series: 'H-sections', name: 'HEB900', standard: 'EN 10365', depth: 900, width: 300, tw: 18.5, tf: 35, r: 30, aCm2: 371, iyCm4: 494100, izCm4: 15820, weightKgM: 291 },
  { family: 'I', series: 'H-sections', name: 'HEB1000', standard: 'EN 10365', depth: 1000, width: 300, tw: 19, tf: 36, r: 30, aCm2: 400, iyCm4: 644700, izCm4: 16280, weightKgM: 314 },
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
  { family: 'IPN', series: 'I-sections', name: 'IPN80', standard: 'DIN 1025-1', depth: 80, width: 42, tw: 3.9, tf: 5.9, aCm2: 7.57, iyCm4: 77.8, izCm4: 6.29, weightKgM: 5.94 },
  { family: 'IPN', series: 'I-sections', name: 'IPN100', standard: 'DIN 1025-1', depth: 100, width: 50, tw: 4.5, tf: 6.8, aCm2: 10.6, iyCm4: 171, izCm4: 12.2, weightKgM: 8.34 },
  { family: 'IPN', series: 'I-sections', name: 'IPN120', standard: 'DIN 1025-1', depth: 120, width: 58, tw: 5.1, tf: 7.7, aCm2: 14.2, iyCm4: 328, izCm4: 21.5, weightKgM: 11.1 },
  { family: 'IPN', series: 'I-sections', name: 'IPN140', standard: 'DIN 1025-1', depth: 140, width: 66, tw: 5.7, tf: 8.6, aCm2: 18.2, iyCm4: 573, izCm4: 35.2, weightKgM: 14.3 },
  { family: 'IPN', series: 'I-sections', name: 'IPN160', standard: 'DIN 1025-1', depth: 160, width: 74, tw: 6.3, tf: 9.5, aCm2: 22.8, iyCm4: 935, izCm4: 54.7, weightKgM: 17.9 },
  { family: 'IPN', series: 'I-sections', name: 'IPN180', standard: 'DIN 1025-1', depth: 180, width: 82, tw: 6.9, tf: 10.4, aCm2: 27.9, iyCm4: 1450, izCm4: 81.3, weightKgM: 21.9 },
  { family: 'IPN', series: 'I-sections', name: 'IPN200', standard: 'DIN 1025-1', depth: 200, width: 90, tw: 7.5, tf: 11.3, aCm2: 33.4, iyCm4: 2140, izCm4: 117, weightKgM: 26.2 },
  { family: 'IPN', series: 'I-sections', name: 'IPN220', standard: 'DIN 1025-1', depth: 220, width: 98, tw: 8.1, tf: 12.2, aCm2: 39.5, iyCm4: 3060, izCm4: 162, weightKgM: 31.1 },
  { family: 'IPN', series: 'I-sections', name: 'IPN240', standard: 'DIN 1025-1', depth: 240, width: 106, tw: 8.7, tf: 13.1, aCm2: 46.1, iyCm4: 4250, izCm4: 221, weightKgM: 36.2 },
  { family: 'IPN', series: 'I-sections', name: 'IPN260', standard: 'DIN 1025-1', depth: 260, width: 113, tw: 9.4, tf: 14.1, aCm2: 53.3, iyCm4: 5740, izCm4: 288, weightKgM: 41.9 },
  { family: 'IPN', series: 'I-sections', name: 'IPN280', standard: 'DIN 1025-1', depth: 280, width: 119, tw: 10.1, tf: 15.2, aCm2: 61.0, iyCm4: 7590, izCm4: 364, weightKgM: 47.9 },
  { family: 'IPN', series: 'I-sections', name: 'IPN300', standard: 'DIN 1025-1', depth: 300, width: 125, tw: 10.8, tf: 16.2, aCm2: 69.0, iyCm4: 9800, izCm4: 451, weightKgM: 54.2 },
  { family: 'IPN', series: 'I-sections', name: 'IPN320', standard: 'DIN 1025-1', depth: 320, width: 131, tw: 11.5, tf: 17.3, aCm2: 77.7, iyCm4: 12510, izCm4: 555, weightKgM: 61.0 },
  { family: 'IPN', series: 'I-sections', name: 'IPN340', standard: 'DIN 1025-1', depth: 340, width: 137, tw: 12.2, tf: 18.3, aCm2: 86.7, iyCm4: 15700, izCm4: 674, weightKgM: 68.0 },
  { family: 'IPN', series: 'I-sections', name: 'IPN360', standard: 'DIN 1025-1', depth: 360, width: 143, tw: 13.0, tf: 19.5, aCm2: 97.0, iyCm4: 19610, izCm4: 818, weightKgM: 76.1 },
  { family: 'IPN', series: 'I-sections', name: 'IPN380', standard: 'DIN 1025-1', depth: 380, width: 149, tw: 13.7, tf: 20.5, aCm2: 107, iyCm4: 24010, izCm4: 975, weightKgM: 84.0 },
  { family: 'IPN', series: 'I-sections', name: 'IPN400', standard: 'DIN 1025-1', depth: 400, width: 155, tw: 14.4, tf: 21.6, aCm2: 118, iyCm4: 29210, izCm4: 1160, weightKgM: 92.4 },
  { family: 'IPN', series: 'I-sections', name: 'IPN450', standard: 'DIN 1025-1', depth: 450, width: 170, tw: 16.2, tf: 24.3, aCm2: 147, iyCm4: 45850, izCm4: 1730, weightKgM: 115 },
  { family: 'IPN', series: 'I-sections', name: 'IPN500', standard: 'DIN 1025-1', depth: 500, width: 185, tw: 18.0, tf: 27.0, aCm2: 179, iyCm4: 68740, izCm4: 2480, weightKgM: 141 },
  { family: 'IPN', series: 'I-sections', name: 'IPN550', standard: 'DIN 1025-1', depth: 550, width: 200, tw: 19.0, tf: 30.0, aCm2: 212, iyCm4: 99180, izCm4: 3490, weightKgM: 166 },
  { family: 'IPN', series: 'I-sections', name: 'IPN600', standard: 'DIN 1025-1', depth: 600, width: 215, tw: 21.6, tf: 32.4, aCm2: 254, iyCm4: 139000, izCm4: 4670, weightKgM: 199 },
];

// --------------------------------------------------------------------------- //
// European channels UPN (DIN 1026-1) — tapered flanges: slope 8 %,
// root radius = tf, toe radius = 0.5 tf, tf quoted at b/2 (backend rules).
// --------------------------------------------------------------------------- //
const UPN: StandardSection[] = [
  { family: 'UPN', series: 'Channels', name: 'UPN80', standard: 'DIN 1026-1', depth: 80, width: 45, tw: 6.0, tf: 8.0, aCm2: 11.0, iyCm4: 106, izCm4: 19.4, weightKgM: 8.64 },
  { family: 'UPN', series: 'Channels', name: 'UPN100', standard: 'DIN 1026-1', depth: 100, width: 50, tw: 6.0, tf: 8.5, aCm2: 13.5, iyCm4: 206, izCm4: 29.3, weightKgM: 10.6 },
  { family: 'UPN', series: 'Channels', name: 'UPN120', standard: 'DIN 1026-1', depth: 120, width: 55, tw: 7.0, tf: 9.0, aCm2: 17.0, iyCm4: 364, izCm4: 43.2, weightKgM: 13.4 },
  { family: 'UPN', series: 'Channels', name: 'UPN140', standard: 'DIN 1026-1', depth: 140, width: 60, tw: 7.0, tf: 10.0, aCm2: 20.4, iyCm4: 605, izCm4: 62.7, weightKgM: 16.0 },
  { family: 'UPN', series: 'Channels', name: 'UPN160', standard: 'DIN 1026-1', depth: 160, width: 65, tw: 7.5, tf: 10.5, aCm2: 24.0, iyCm4: 925, izCm4: 85.3, weightKgM: 18.8 },
  { family: 'UPN', series: 'Channels', name: 'UPN180', standard: 'DIN 1026-1', depth: 180, width: 70, tw: 8.0, tf: 11.0, aCm2: 28.0, iyCm4: 1350, izCm4: 114, weightKgM: 22.0 },
  { family: 'UPN', series: 'Channels', name: 'UPN200', standard: 'DIN 1026-1', depth: 200, width: 75, tw: 8.5, tf: 11.5, aCm2: 32.2, iyCm4: 1910, izCm4: 148, weightKgM: 25.3 },
  { family: 'UPN', series: 'Channels', name: 'UPN220', standard: 'DIN 1026-1', depth: 220, width: 80, tw: 9.0, tf: 12.5, aCm2: 37.4, iyCm4: 2690, izCm4: 197, weightKgM: 29.4 },
  { family: 'UPN', series: 'Channels', name: 'UPN240', standard: 'DIN 1026-1', depth: 240, width: 85, tw: 9.5, tf: 13.0, aCm2: 42.3, iyCm4: 3600, izCm4: 248, weightKgM: 33.2 },
  { family: 'UPN', series: 'Channels', name: 'UPN260', standard: 'DIN 1026-1', depth: 260, width: 90, tw: 10.0, tf: 14.0, aCm2: 48.3, iyCm4: 4820, izCm4: 317, weightKgM: 37.9 },
  { family: 'UPN', series: 'Channels', name: 'UPN280', standard: 'DIN 1026-1', depth: 280, width: 95, tw: 10.0, tf: 15.0, aCm2: 53.3, iyCm4: 6280, izCm4: 399, weightKgM: 41.8 },
  { family: 'UPN', series: 'Channels', name: 'UPN300', standard: 'DIN 1026-1', depth: 300, width: 100, tw: 10.0, tf: 16.0, aCm2: 58.8, iyCm4: 8030, izCm4: 495, weightKgM: 46.2 },
];

// --------------------------------------------------------------------------- //
// Equal-leg angles (EN 10056-1) — with tabulated root radius (r) and toe radius
// r2 = r/2. Iy/Iz come from the filleted outline, not a sharp angle.
// --------------------------------------------------------------------------- //
const ANGLE_EU: StandardSection[] = [
  { family: 'Angle', series: 'Angles', name: 'L30x30x3', standard: 'EN 10056-1', width: 30, thickness: 3, r: 5, aCm2: 1.74, iyCm4: 1.41, izCm4: 1.41, weightKgM: 1.36 },
  { family: 'Angle', series: 'Angles', name: 'L40x40x4', standard: 'EN 10056-1', width: 40, thickness: 4, r: 6, aCm2: 3.08, iyCm4: 4.47, izCm4: 4.47, weightKgM: 2.42 },
  { family: 'Angle', series: 'Angles', name: 'L50x50x5', standard: 'EN 10056-1', width: 50, thickness: 5, r: 7, aCm2: 4.80, iyCm4: 11.0, izCm4: 11.0, weightKgM: 3.77 },
  { family: 'Angle', series: 'Angles', name: 'L60x60x6', standard: 'EN 10056-1', width: 60, thickness: 6, r: 8, aCm2: 6.91, iyCm4: 22.8, izCm4: 22.8, weightKgM: 5.42 },
  { family: 'Angle', series: 'Angles', name: 'L70x70x7', standard: 'EN 10056-1', width: 70, thickness: 7, r: 9, aCm2: 9.40, iyCm4: 42.4, izCm4: 42.4, weightKgM: 7.38 },
  { family: 'Angle', series: 'Angles', name: 'L80x80x8', standard: 'EN 10056-1', width: 80, thickness: 8, r: 10, aCm2: 12.3, iyCm4: 72.2, izCm4: 72.2, weightKgM: 9.63 },
  { family: 'Angle', series: 'Angles', name: 'L90x90x9', standard: 'EN 10056-1', width: 90, thickness: 9, r: 11, aCm2: 15.5, iyCm4: 116, izCm4: 116, weightKgM: 12.2 },
  { family: 'Angle', series: 'Angles', name: 'L100x100x10', standard: 'EN 10056-1', width: 100, thickness: 10, r: 12, aCm2: 19.2, iyCm4: 177, izCm4: 177, weightKgM: 15.0 },
  { family: 'Angle', series: 'Angles', name: 'L120x120x12', standard: 'EN 10056-1', width: 120, thickness: 12, r: 13, aCm2: 27.5, iyCm4: 368, izCm4: 368, weightKgM: 21.6 },
  { family: 'Angle', series: 'Angles', name: 'L150x150x15', standard: 'EN 10056-1', width: 150, thickness: 15, r: 16, aCm2: 43.0, iyCm4: 898, izCm4: 898, weightKgM: 33.8 },
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

/**
 * Group the whole catalogue by its `series` label (e.g. "I-sections",
 * "H-sections", "Channels", "Angles"), so the picker can show an accordion
 * grouped by SHAPE — what a section is — rather than a flat list of
 * abbreviations. Sections without a `series` fall into one bucket per family.
 */
export interface SeriesGroup {
  series: string;
  families: SectionType[];
}

export function groupBySeries(sections: StandardSection[]): SeriesGroup[] {
  const seen = new Set<string>();
  const groups: SeriesGroup[] = [];
  for (const s of sections) {
    const label = s.series ?? familySeriesLabel(s.family);
    if (seen.has(label)) {
      const g = groups.find((x) => x.series === label)!;
      if (!g.families.includes(s.family)) g.families.push(s.family);
      continue;
    }
    seen.add(label);
    groups.push({ series: label, families: [s.family] });
  }
  return groups;
}

/** Fallback series label for families that do not set one explicitly. */
function familySeriesLabel(family: SectionType): string {
  switch (family) {
    case 'I':
    case 'IPN':
      return 'I-sections';
    case 'Channel':
    case 'UPN':
      return 'Channels';
    case 'Angle':
      return 'Angles';
    case 'RectangularHollow':
      return 'Hollow sections';
    case 'HollowCircular':
      return 'Hollow sections';
    case 'Tee':
      return 'Tees';
    default:
      return 'Shapes';
  }
}

/** All design codes represented in the catalogue, for the code-filter bar. */
export const SECTION_CODES: { id: string; label: string }[] = [
  { id: 'all', label: 'All codes' },
  { id: 'EN', label: 'EN / DIN' },
  { id: 'AISC', label: 'AISC (US)' },
];

/** Filter the catalogue by an optional design-code id. */
export function sectionsForCode(codeId: string | null): StandardSection[] {
  if (!codeId || codeId === 'all') return SECTION_STANDARDS;
  if (codeId === 'EN') {
    return SECTION_STANDARDS.filter((s) => s.standard.startsWith('EN') || s.standard.startsWith('DIN'));
  }
  if (codeId === 'AISC') {
    return SECTION_STANDARDS.filter((s) =>
      s.standard === 'AISC' || s.standard.startsWith('ASTM') || s.standard.startsWith('AISC'),
    );
  }
  return SECTION_STANDARDS;
}