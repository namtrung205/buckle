/**
 * Standard material library (frontend mirror of backend/opensees/materials/library.py).
 *
 * Values follow European (EN/Eurocode) and American (ACI/AISC/ASTM/NDS) codes.
 * Units: E/G in Pa, density in kg/m^3, alpha in 1/K, strengths in Pa.
 */

import { Material, MaterialCategory } from '../types';

export interface MaterialPreset {
  key: string;
  name: string;
  category: MaterialCategory;
  code: string;
  E: number;
  nu: number;
  rho: number;
  alpha: number;
  fy?: number;
  fc?: number;
  fu?: number;
  ft?: number;
  grade?: string;
}

export const MATERIAL_CATEGORY_LABELS: Record<MaterialCategory, string> = {
  steel: 'Structural Steel',
  concrete: 'Concrete',
  aluminum: 'Aluminum',
  timber: 'Timber / Glulam',
  rebar: 'Rebar / Prestressing',
  other: 'Other',
};

// -------------------------------------------------------------------------- //
// Steel (EN 10025 / ASTM)
// -------------------------------------------------------------------------- //
const STEEL: MaterialPreset[] = [
  { key: 'steel_s235', name: 'S235 (EN 10025)', category: 'steel', code: 'EN', E: 210e9, nu: 0.30, rho: 7850, alpha: 12e-6, fy: 235e6, fu: 360e6, grade: 'S235' },
  { key: 'steel_s275', name: 'S275 (EN 10025)', category: 'steel', code: 'EN', E: 210e9, nu: 0.30, rho: 7850, alpha: 12e-6, fy: 275e6, fu: 430e6, grade: 'S275' },
  { key: 'steel_s355', name: 'S355 (EN 10025)', category: 'steel', code: 'EN', E: 210e9, nu: 0.30, rho: 7850, alpha: 12e-6, fy: 355e6, fu: 510e6, grade: 'S355' },
  { key: 'steel_s420', name: 'S420 (EN 10025)', category: 'steel', code: 'EN', E: 210e9, nu: 0.30, rho: 7850, alpha: 12e-6, fy: 420e6, fu: 520e6, grade: 'S420' },
  { key: 'steel_s460', name: 'S460 (EN 10025)', category: 'steel', code: 'EN', E: 210e9, nu: 0.30, rho: 7850, alpha: 12e-6, fy: 460e6, fu: 540e6, grade: 'S460' },
  { key: 'steel_a36', name: 'A36 (ASTM)', category: 'steel', code: 'ASTM', E: 200e9, nu: 0.30, rho: 7850, alpha: 11.7e-6, fy: 250e6, fu: 400e6, grade: 'A36' },
  { key: 'steel_a572_50', name: 'A572 Gr.50', category: 'steel', code: 'ASTM', E: 200e9, nu: 0.30, rho: 7850, alpha: 11.7e-6, fy: 345e6, fu: 450e6, grade: 'A572-50' },
  { key: 'steel_a992', name: 'A992 (W-shapes)', category: 'steel', code: 'ASTM', E: 200e9, nu: 0.30, rho: 7850, alpha: 11.7e-6, fy: 345e6, fu: 450e6, grade: 'A992' },
  { key: 'steel_a500_grb', name: 'A500 Gr.B (HSS)', category: 'steel', code: 'ASTM', E: 200e9, nu: 0.30, rho: 7850, alpha: 11.7e-6, fy: 317e6, fu: 400e6, grade: 'A500-B' },
  { key: 'steel_a500_grc', name: 'A500 Gr.C (HSS)', category: 'steel', code: 'ASTM', E: 200e9, nu: 0.30, rho: 7850, alpha: 11.7e-6, fy: 345e6, fu: 427e6, grade: 'A500-C' },
  { key: 'steel_a913_65', name: 'A913 Gr.65', category: 'steel', code: 'ASTM', E: 200e9, nu: 0.30, rho: 7850, alpha: 11.7e-6, fy: 448e6, fu: 550e6, grade: 'A913-65' },
];

// -------------------------------------------------------------------------- //
// Concrete (EN 1992-1-1 / ACI 318)
// -------------------------------------------------------------------------- //
const CONCRETE: MaterialPreset[] = [
  { key: 'concrete_c20', name: 'C20/25 (EN 1992)', category: 'concrete', code: 'EN', E: 30.0e9, nu: 0.20, rho: 2400, alpha: 10e-6, fc: 20e6, grade: 'C20/25' },
  { key: 'concrete_c25', name: 'C25/30 (EN 1992)', category: 'concrete', code: 'EN', E: 31.0e9, nu: 0.20, rho: 2400, alpha: 10e-6, fc: 25e6, grade: 'C25/30' },
  { key: 'concrete_c30', name: 'C30/37 (EN 1992)', category: 'concrete', code: 'EN', E: 33.0e9, nu: 0.20, rho: 2400, alpha: 10e-6, fc: 30e6, grade: 'C30/37' },
  { key: 'concrete_c35', name: 'C35/45 (EN 1992)', category: 'concrete', code: 'EN', E: 34.0e9, nu: 0.20, rho: 2400, alpha: 10e-6, fc: 35e6, grade: 'C35/45' },
  { key: 'concrete_c40', name: 'C40/50 (EN 1992)', category: 'concrete', code: 'EN', E: 35.0e9, nu: 0.20, rho: 2400, alpha: 10e-6, fc: 40e6, grade: 'C40/50' },
  { key: 'concrete_c50', name: 'C50/60 (EN 1992)', category: 'concrete', code: 'EN', E: 37.0e9, nu: 0.20, rho: 2400, alpha: 10e-6, fc: 50e6, grade: 'C50/60' },
  { key: 'concrete_fc3000', name: "fc' = 3000 psi (ACI)", category: 'concrete', code: 'ACI', E: 22.0e9, nu: 0.20, rho: 2320, alpha: 9.9e-6, fc: 20.7e6, grade: '3000 psi' },
  { key: 'concrete_fc4000', name: "fc' = 4000 psi (ACI)", category: 'concrete', code: 'ACI', E: 24.9e9, nu: 0.20, rho: 2320, alpha: 9.9e-6, fc: 27.6e6, grade: '4000 psi' },
  { key: 'concrete_fc5000', name: "fc' = 5000 psi (ACI)", category: 'concrete', code: 'ACI', E: 27.8e9, nu: 0.20, rho: 2320, alpha: 9.9e-6, fc: 34.5e6, grade: '5000 psi' },
  { key: 'concrete_fc6000', name: "fc' = 6000 psi (ACI)", category: 'concrete', code: 'ACI', E: 29.9e9, nu: 0.20, rho: 2320, alpha: 9.9e-6, fc: 41.4e6, grade: '6000 psi' },
  { key: 'concrete_fc8000', name: "fc' = 8000 psi (ACI)", category: 'concrete', code: 'ACI', E: 33.3e9, nu: 0.20, rho: 2320, alpha: 9.9e-6, fc: 55.2e6, grade: '8000 psi' },
];

// -------------------------------------------------------------------------- //
// Aluminum (EN 1999 / AA)
// -------------------------------------------------------------------------- //
const ALUMINUM: MaterialPreset[] = [
  { key: 'alu_5083', name: '5083-H111 (EN 1999)', category: 'aluminum', code: 'EN', E: 71e9, nu: 0.33, rho: 2660, alpha: 23e-6, fy: 125e6, fu: 270e6, grade: '5083' },
  { key: 'alu_6061_t6', name: '6061-T6 (EN 1999)', category: 'aluminum', code: 'EN', E: 69e9, nu: 0.33, rho: 2700, alpha: 23.6e-6, fy: 240e6, fu: 260e6, grade: '6061-T6' },
  { key: 'alu_6063_t6', name: '6063-T6', category: 'aluminum', code: 'EN', E: 69e9, nu: 0.33, rho: 2700, alpha: 23.4e-6, fy: 160e6, fu: 195e6, grade: '6063-T6' },
  { key: 'alu_6082_t6', name: '6082-T6', category: 'aluminum', code: 'EN', E: 70e9, nu: 0.33, rho: 2700, alpha: 23.4e-6, fy: 260e6, fu: 310e6, grade: '6082-T6' },
];

// -------------------------------------------------------------------------- //
// Timber (EN 338 / EN 14080 / NDS)
// -------------------------------------------------------------------------- //
const TIMBER: MaterialPreset[] = [
  { key: 'timber_c24', name: 'C24 softwood (EN 338)', category: 'timber', code: 'EN', E: 11.0e9, nu: 0.30, rho: 420, alpha: 5e-6, fc: 21e6, ft: 14e6, grade: 'C24' },
  { key: 'timber_c30', name: 'C30 softwood (EN 338)', category: 'timber', code: 'EN', E: 12.0e9, nu: 0.30, rho: 460, alpha: 5e-6, fc: 23e6, ft: 18e6, grade: 'C30' },
  { key: 'timber_d30', name: 'D30 hardwood (EN 338)', category: 'timber', code: 'EN', E: 10.0e9, nu: 0.30, rho: 640, alpha: 5e-6, fc: 23e6, ft: 18e6, grade: 'D30' },
  { key: 'timber_gl24h', name: 'GL24h glulam (EN 14080)', category: 'timber', code: 'EN', E: 11.6e9, nu: 0.30, rho: 380, alpha: 5e-6, fc: 24e6, ft: 19.2e6, grade: 'GL24h' },
  { key: 'timber_gl28h', name: 'GL28h glulam (EN 14080)', category: 'timber', code: 'EN', E: 12.6e9, nu: 0.30, rho: 420, alpha: 5e-6, fc: 28e6, ft: 22.4e6, grade: 'GL28h' },
  { key: 'timber_dfl', name: 'Douglas Fir-Larch (NDS)', category: 'timber', code: 'NDS', E: 12.0e9, nu: 0.30, rho: 480, alpha: 5e-6, fc: 14.5e6, ft: 8.3e6, grade: 'D-Fir No.2' },
  { key: 'timber_spf', name: 'Spruce-Pine-Fir (NDS)', category: 'timber', code: 'NDS', E: 10.0e9, nu: 0.30, rho: 420, alpha: 5e-6, fc: 11.6e6, ft: 5.5e6, grade: 'SPF No.2' },
];

// -------------------------------------------------------------------------- //
// Reinforcement / prestressing
// -------------------------------------------------------------------------- //
const REBAR: MaterialPreset[] = [
  { key: 'rebar_b500_b', name: 'B500B rebar (EN 10080)', category: 'rebar', code: 'EN', E: 200e9, nu: 0.30, rho: 7850, alpha: 12e-6, fy: 500e6, fu: 552e6, grade: 'B500B' },
  { key: 'rebar_b400_b', name: 'B400B rebar (EN 10080)', category: 'rebar', code: 'EN', E: 200e9, nu: 0.30, rho: 7850, alpha: 12e-6, fy: 400e6, fu: 432e6, grade: 'B400B' },
  { key: 'rebar_gr40', name: 'Grade 40 (ASTM A615)', category: 'rebar', code: 'ASTM', E: 200e9, nu: 0.30, rho: 7850, alpha: 11.7e-6, fy: 276e6, fu: 414e6, grade: 'Gr.40' },
  { key: 'rebar_gr60', name: 'Grade 60 (ASTM A615)', category: 'rebar', code: 'ASTM', E: 200e9, nu: 0.30, rho: 7850, alpha: 11.7e-6, fy: 414e6, fu: 620e6, grade: 'Gr.60' },
  { key: 'rebar_gr75', name: 'Grade 75 (ASTM A615)', category: 'rebar', code: 'ASTM', E: 200e9, nu: 0.30, rho: 7850, alpha: 11.7e-6, fy: 517e6, fu: 689e6, grade: 'Gr.75' },
  { key: 'rebar_prestress_1860', name: 'Prestressing strand 1860', category: 'rebar', code: 'EN', E: 195e9, nu: 0.30, rho: 7850, alpha: 12e-6, fy: 1600e6, fu: 1860e6, grade: 'Y1860' },
];

export const MATERIAL_PRESETS: MaterialPreset[] = [
  ...STEEL,
  ...CONCRETE,
  ...ALUMINUM,
  ...TIMBER,
  ...REBAR,
];

export const MATERIAL_BY_KEY: Record<string, MaterialPreset> = Object.fromEntries(
  MATERIAL_PRESETS.map((p) => [p.key, p]),
);

export function presetsByCategory(category: MaterialCategory): MaterialPreset[] {
  return MATERIAL_PRESETS.filter((p) => p.category === category);
}

export const PRESETS_BY_CATEGORY: Record<MaterialCategory, MaterialPreset[]> = {
  steel: presetsByCategory('steel'),
  concrete: presetsByCategory('concrete'),
  aluminum: presetsByCategory('aluminum'),
  timber: presetsByCategory('timber'),
  rebar: presetsByCategory('rebar'),
  other: [],
};

/** Build a full Material record from a preset (fills elastic + design fields). */
export function materialFromPreset(preset: MaterialPreset): Material {
  return {
    id: 0,
    name: preset.name,
    category: preset.category,
    code: preset.code,
    E: preset.E,
    nu: preset.nu,
    rho: preset.rho,
    alpha: preset.alpha,
    fy: preset.fy,
    fc: preset.fc,
    fu: preset.fu,
    ft: preset.ft,
    grade: preset.grade,
    preset: preset.key,
  };
}