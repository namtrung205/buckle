import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { Save as SaveIcon } from '@mui/icons-material';
import { observer } from 'mobx-react-lite';
import { useModel } from '../../../model/Context';
import Dialog from '../../../components/Dialog/Dialog';
import { Section, Material } from '../../../types';
import SectionModel from '../../../model/Section/Section';
import { colors, fieldLabelSx } from '../../../theme';
import SectionFigure from './SectionFigure';
import {
  StandardSection,
  SECTION_STANDARDS,
  SECTION_CODES,
  sectionsForCode,
  groupBySeries,
} from '../../../libraries/sections';
import { standardOutline, customOutline } from '../../../libraries/sectionDrawing';
import { materialFromPreset, MATERIAL_PRESETS } from '../../../libraries/materials';

/* ────────────────────────────────────────────────────────────────────────── */

interface SectionChangerProps {
  open: boolean;
  onClose: () => void;
  section: Section | null;
}

type MainTab = 'profile' | 'shape' | 'amorphous';

// The "build a section" tab: shape families with parameters.
interface ShapeDef {
  key: string;
  label: string;
  family: 'solid' | 'thin';
  type: 'Rectangular' | 'Circular' | 'HollowCircular' | 'RectangularHollow' | 'I' | 'Channel' | 'Angle' | 'Tee';
  params: { id: string; label: string; unit: string; def: number }[];
}

const SHAPES: ShapeDef[] = [
  { key: 'rect', label: 'Rectangle', family: 'solid', type: 'Rectangular', params: [
    { id: 'width', label: 'Width b', unit: 'mm', def: 200 },
    { id: 'height', label: 'Height h', unit: 'mm', def: 400 },
  ]},
  { key: 'circle', label: 'Circle', family: 'solid', type: 'Circular', params: [
    { id: 'diameter', label: 'Diameter d', unit: 'mm', def: 300 },
  ]},
  { key: 'ipe', label: 'I / H', family: 'thin', type: 'I', params: [
    { id: 'depth', label: 'Depth h', unit: 'mm', def: 300 },
    { id: 'width', label: 'Width b', unit: 'mm', def: 150 },
    { id: 'tw', label: 'Web tw', unit: 'mm', def: 7.1 },
    { id: 'tf', label: 'Flange tf', unit: 'mm', def: 10.7 },
    { id: 'r', label: 'Root r', unit: 'mm', def: 15 },
  ]},
  { key: 'channel', label: 'Channel', family: 'thin', type: 'Channel', params: [
    { id: 'depth', label: 'Depth h', unit: 'mm', def: 200 },
    { id: 'width', label: 'Width b', unit: 'mm', def: 75 },
    { id: 'tw', label: 'Web tw', unit: 'mm', def: 8.5 },
    { id: 'tf', label: 'Flange tf', unit: 'mm', def: 11.5 },
    { id: 'r', label: 'Root r', unit: 'mm', def: 11.5 },
  ]},
  { key: 'angle', label: 'Angle (L)', family: 'thin', type: 'Angle', params: [
    { id: 'width', label: 'Leg b', unit: 'mm', def: 80 },
    { id: 'thickness', label: 'Thickness t', unit: 'mm', def: 8 },
    { id: 'r', label: 'Root r', unit: 'mm', def: 10 },
  ]},
  { key: 'tee', label: 'Tee (T)', family: 'thin', type: 'Tee', params: [
    { id: 'depth', label: 'Depth h', unit: 'mm', def: 200 },
    { id: 'width', label: 'Width b', unit: 'mm', def: 150 },
    { id: 'tw', label: 'Stem tw', unit: 'mm', def: 10 },
    { id: 'tf', label: 'Flange tf', unit: 'mm', def: 15 },
  ]},
  { key: 'rhs', label: 'Hollow box', family: 'thin', type: 'RectangularHollow', params: [
    { id: 'height', label: 'Height h', unit: 'mm', def: 200 },
    { id: 'width', label: 'Width b', unit: 'mm', def: 100 },
    { id: 'thickness', label: 'Wall t', unit: 'mm', def: 8 },
    { id: 'ri', label: 'Corner r', unit: 'mm', def: 16 },
  ]},
  { key: 'chs', label: 'Pipe (CHS)', family: 'thin', type: 'HollowCircular', params: [
    { id: 'diameter', label: 'Diameter d', unit: 'mm', def: 168.3 },
    { id: 'thickness', label: 'Wall t', unit: 'mm', def: 8 },
  ]},
];

/* ────────────────────────────────────────────────────────────────────────── */

const SectionChanger = observer(({ open, onClose, section }: SectionChangerProps) => {
  const model = useModel();
  const [tab, setTab] = useState<MainTab>('profile');

  // ── standard-profile tab state ──
  const [codeId, setCodeId] = useState<string | null>(null);
  const [openSeries, setOpenSeries] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selFamily, setSelFamily] = useState<string>('I');

  const catalogueSections = useMemo(() => sectionsForCode(codeId), [codeId]);
  const seriesGroups = useMemo(() => groupBySeries(catalogueSections), [catalogueSections]);

  const familySections = useMemo(
    () => catalogueSections.filter((s) => s.family === selFamily),
    [catalogueSections, selFamily],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? familySections.filter((s) => s.name.toLowerCase().includes(q)) : familySections;
  }, [familySections, search]);

  const previewSection = useMemo(() => {
    const mid = filtered[Math.floor(filtered.length / 2)] ?? familySections[0];
    return mid;
  }, [filtered, familySections]);

  // ── shape tab state ──
  const [cat, setCat] = useState<'solid' | 'thin'>('thin');
  const shapes = useMemo(() => SHAPES.filter((s) => s.family === cat), [cat]);
  const [shapeKey, setShapeKey] = useState('ipe');
  const [params, setParams] = useState<Record<string, number>>({});
  const activeShape = shapes.find((s) => s.key === shapeKey) ?? shapes[0];

  useEffect(() => {
    if (!open) return;
    setTab('profile');
    // reset shape params to the active shape's defaults
    const sh = SHAPES.find((s) => s.key === 'ipe')!;
    const vals: Record<string, number> = {};
    sh.params.forEach((p) => (vals[p.id] = p.def));
    setParams(vals);
    if (section) {
      // pre-select the family matching the edited section
      setSelFamily(section.type);
    }
  }, [open, section]);

  const selectShape = (key: string) => {
    setShapeKey(key);
    const sh = SHAPES.find((s) => s.key === key)!;
    const vals: Record<string, number> = {};
    sh.params.forEach((p) => (vals[p.id] = p.def));
    setParams(vals);
  };

  // ── amorphous tab state ──
  const [amorph, setAmorph] = useState({ name: 'Amorphous', a: 0.005, iy: 0.00008, iz: 0.00002, j: 0.0000001 });

  // ── helpers ──
  const num = (v: unknown) => (v === '' || v == null ? 0 : Number(v));

  const defaultMaterial = (): Material => {
    const steel = MATERIAL_PRESETS.find((p) => p.key === 'steel_s355');
    return steel ? materialFromPreset(steel) : { id: 0, name: 'Steel', E: 210e9, nu: 0.3, rho: 7850 };
  };

  const saveSection = (base: Record<string, unknown>) => {
    const mat = model.materials.find((m) => m.id === Number(base.material)) ?? defaultMaterial();
    const instance = new SectionModel(model, { id: section?.id, name: String(base.name || 'Section'), type: base.type as Section['type'], material: mat, ...(base.fields as object) } as Section);
    instance.createOrUpdate();
    onClose();
  };

  // ── profile select ──
  const pickProfile = (std: StandardSection) => {
    const mat = model.materials.find((m) => m.id === defaultMaterial().id) ?? defaultMaterial();
    const fields: Record<string, number> = {};
    std.depth != null && (fields.depth = std.depth);
    std.height != null && (fields.height = std.height);
    std.width != null && (fields.width = std.width);
    std.tw != null && (fields.tw = std.tw);
    std.tf != null && (fields.tf = std.tf);
    std.r != null && (fields.r = std.r);
    std.diameter != null && (fields.diameter = std.diameter);
    std.thickness != null && (fields.thickness = std.thickness);
    std.ri != null && (fields.ri = std.ri);
    saveSection({ name: std.name, type: std.family, fields, material: mat.id });
  };

  // ── shape confirm (build a section) ──
  const confirmShape = () => {
    if (!activeShape) return;
    const fields: Record<string, number> = {};
    activeShape.params.forEach((p) => (fields[p.id] = num(params[p.id])));
    const name = `${activeShape.key.toUpperCase()} ${Object.values(fields).map((v) => Math.round(v)).join('x')}`;
    saveSection({ name, type: activeShape.type, fields, material: defaultMaterial().id });
  };

  // ── amorphous confirm: declare A/Iy/Iz directly (properties-only section) ──
  const confirmAmorphous = () => {
    const a = num(amorph.a), iy = num(amorph.iy), iz = num(amorph.iz), j = num(amorph.j);
    const mat = model.materials.find((m) => m.id === defaultMaterial().id) ?? defaultMaterial();
    const instance = new SectionModel(model, {
      id: section?.id,
      name: amorph.name || 'Amorphous section',
      type: 'Rectangular' as Section['type'],
      width: 100,
      height: 100,
      material: mat,
      properties: { A: a, Iy: iy, Iz: iz, Jxx: j, E: mat.E, G: (mat.E as number) / (2 * (1 + (mat.nu as number))), v: mat.nu as number },
    } as Section);
    instance.createOrUpdate();
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" draggable title={section ? 'Change Section' : 'New Section'}
      actions={null}>
      <Stack spacing={1.5}>
        {/* ── main tabs ── */}
        <Box sx={{ display: 'flex', borderBottom: `2px solid ${colors.divider}` }}>
          {([
            ['profile', 'Standard profile'],
            ['shape', 'Build a section'],
            ['amorphous', 'Amorphous'],
          ] as [MainTab, string][]).map(([k, label]) => (
            <Button key={k} disableRipple onClick={() => setTab(k)}
              sx={{
                flex: 1, py: 0.75, borderRadius: 0, bgcolor: 'transparent', color: tab === k ? colors.accentSoft : colors.textFaint,
                borderBottom: `2px solid ${tab === k ? colors.accent : 'transparent'}`, '&:hover': { bgcolor: colors.hover, color: colors.text },
              }}>
              {label}
            </Button>
          ))}
        </Box>

        {/* ══ Tab 1: standard profile ══ */}
        {tab === 'profile' && (
          <Stack spacing={1.5}>
            <Typography sx={{ fontSize: '0.72rem', color: colors.textDim }}>
              The catalogue is rolled steel — pick a family, then a size. Properties (A, Iy, Iz) reproduce the published tables exactly.
            </Typography>

            {/* code filter */}
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '0.68rem', color: colors.textFaint, textTransform: 'uppercase', letterSpacing: '0.04em', mr: 1 }}>Code</Typography>
              {SECTION_CODES.map((c) => (
                <Button key={c.id} size="small" disableRipple onClick={() => setCodeId(c.id === 'all' ? null : c.id)}
                  sx={{ minWidth: 0, px: 1.25, py: 0.3, borderRadius: '4px', fontSize: '0.72rem',
                    bgcolor: (c.id === 'all' ? codeId === null : codeId === c.id) ? colors.accent : 'transparent',
                    color: (c.id === 'all' ? codeId === null : codeId === c.id) ? '#fff' : colors.textDim,
                    border: `1px solid ${colors.border}`, '&:hover': { borderColor: colors.borderDark, color: colors.text } }}>
                  {c.label}
                </Button>
              ))}
            </Box>

            {/* preview + family accordion */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '190px 1fr', gap: 1.5 }}>
              <Stack spacing={1}>
                <Box sx={{ aspectRatio: '1', border: `1px solid ${colors.border}`, borderRadius: '6px', bgcolor: colors.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 1 }}>
                  <SectionFigure outline={previewSection ? standardOutline(previewSection) : { d: null, exact: false }} size={150} />
                </Box>
                <Box sx={{ p: 1, bgcolor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: '6px' }}>
                  <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: colors.text, borderBottom: `1px solid ${colors.divider}`, pb: 0.5, mb: 0.5 }}>{selFamily}</Typography>
                  {previewSection && (
                    <>
                      <Typography sx={{ fontSize: '0.7rem', color: colors.textFaint, display: 'flex', justifyContent: 'space-between' }}>
                        <span>Standard</span><span style={{ color: colors.textDim }}>{previewSection.standard}</span>
                      </Typography>
                    </>
                  )}
                </Box>
              </Stack>

              <Box sx={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                {seriesGroups.map((g) => {
                  const open = openSeries === g.series || g.families.includes(selFamily as never);
                  return (
                    <Box key={g.series}>
                      <Button disableRipple onClick={() => setOpenSeries(open ? null : g.series)}
                        sx={{ width: '100%', justifyContent: 'flex-start', gap: 1, px: 1, py: 0.5, color: open ? colors.text : colors.textDim,
                          fontSize: '0.78rem', '&:hover': { bgcolor: colors.hover, color: colors.text } }}>
                        <span style={{ fontSize: '0.62rem', color: colors.textFaint, width: 10 }}>{open ? '▾' : '▸'}</span>
                        {g.series}
                        <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: colors.textFaint, fontFamily: 'monospace' }}>{g.families.length}</span>
                      </Button>
                      {open && (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, pl: 3, pb: 0.75 }}>
                          {g.families.map((fam) => (
                            <Button key={fam} size="small" disableRipple onClick={() => { setSelFamily(fam); setSearch(''); }}
                              sx={{ minWidth: 0, px: 0.9, py: 0.25, borderRadius: '4px', fontSize: '0.76rem',
                                bgcolor: selFamily === fam ? colors.accent : 'transparent', color: selFamily === fam ? '#fff' : colors.textDim,
                                border: `1px solid ${colors.borderDark}`, '&:hover': { bgcolor: colors.hover, color: colors.text } }}>
                              {fam}
                            </Button>
                          ))}
                        </Box>
                      )}
                    </Box>
                  );
                })}
              </Box>
            </Box>

            {/* search */}
            <Box>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search profiles…"
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '4px', border: `1px solid ${colors.borderDark}`,
                  background: colors.surfaceAlt, color: colors.text, fontSize: '0.85rem', outline: 'none', fontFamily: 'inherit',
                }} />
            </Box>

            {/* table */}
            <Box sx={{ maxHeight: 300, overflowY: 'auto', border: `1px solid ${colors.divider}`, borderRadius: '6px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ position: 'sticky', top: 0, background: colors.surface }}>
                    {['Profile', 'h (mm)', 'b (mm)', 'A (cm²)', 'Iy (cm⁴)', 'Iz (cm⁴)', 'kg/m'].map((h, i) => (
                      <th key={h} style={{ color: colors.textFaint, fontWeight: 500, textAlign: i === 0 ? 'left' : 'right', padding: '6px 8px', borderBottom: `1px solid ${colors.divider}`, fontSize: '0.75rem' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.name} onClick={() => pickProfile(s)}
                      style={{ cursor: 'pointer' }}>
                      <td style={{ padding: '5px 8px', borderBottom: `1px solid ${colors.divider}`, display: 'flex', alignItems: 'center', gap: 1 }} className="name-cell">
                        <SectionFigure outline={standardOutline(s)} size={20} />
                        <span style={{ color: colors.text, fontWeight: 500 }}>{s.name}</span>
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: colors.text, borderBottom: `1px solid ${colors.divider}` }}>{s.depth ?? s.height ?? s.width ?? '—'}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: colors.text, borderBottom: `1px solid ${colors.divider}` }}>{s.width ?? s.diameter ?? '—'}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: colors.text, borderBottom: `1px solid ${colors.divider}` }}>{s.aCm2?.toFixed(1) ?? '—'}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: colors.text, borderBottom: `1px solid ${colors.divider}` }}>{s.iyCm4?.toFixed(0) ?? '—'}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: colors.text, borderBottom: `1px solid ${colors.divider}` }}>{s.izCm4?.toFixed(0) ?? '—'}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: colors.text, borderBottom: `1px solid ${colors.divider}` }}>{s.weightKgM?.toFixed(1) ?? '—'}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: colors.textFaint }}>No results</td></tr>
                  )}
                </tbody>
              </table>
            </Box>
          </Stack>
        )}

        {/* ══ Tab 2: build a section ══ */}
        {tab === 'shape' && (
          <Stack spacing={1.5}>
            <Box sx={{ display: 'flex', gap: 0, justifyContent: 'center' }}>
              {(['thin', 'solid'] as const).map((c) => (
                <Button key={c} disableRipple onClick={() => { setCat(c); const first = SHAPES.find((s) => s.family === c)!; selectShape(first.key); }}
                  sx={{ flex: 1, py: 0.5, borderRadius: c === 'thin' ? '6px 0 0 6px' : '0 6px 6px 0', fontSize: '0.8rem',
                    bgcolor: cat === c ? colors.surfaceAlt : 'transparent', color: cat === c ? colors.accentSoft : colors.textFaint,
                    border: `1px solid ${cat === c ? colors.accent : colors.border}`, '&:hover': { color: colors.text } }}>
                  {c === 'thin' ? 'Thin-walled' : 'Solid'}
                </Button>
              ))}
            </Box>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {shapes.map((sh) => (
                <Button key={sh.key} size="small" disableRipple onClick={() => selectShape(sh.key)}
                  sx={{ minWidth: 0, px: 1.2, py: 0.35, borderRadius: '4px', fontSize: '0.78rem',
                    bgcolor: shapeKey === sh.key ? colors.accent : 'transparent', color: shapeKey === sh.key ? '#fff' : colors.textDim,
                    border: `1px solid ${colors.borderDark}`, '&:hover': { bgcolor: colors.hover, color: colors.text } }}>
                  {sh.label}
                </Button>
              ))}
            </Box>

            {activeShape && (
              <>
                <Box sx={{ display: 'flex', justifyContent: 'center', my: 0.5 }}>
                  <Box sx={{ width: 140, height: 140, bgcolor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <SectionFigure outline={customOutline(activeShape.type as never, params as never)} showCentroid size={130} />
                  </Box>
                </Box>

                <Stack spacing={1}>
                  {activeShape.params.map((p) => (
                    <Box key={p.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography sx={fieldLabelSx}>{p.label}</Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <input type="number" value={params[p.id] ?? p.def}
                          onChange={(e) => setParams((prev) => ({ ...prev, [p.id]: num(e.target.value) }))}
                          style={{ width: 80, padding: '5px 6px', borderRadius: '4px', border: `1px solid ${colors.borderDark}`, background: colors.surfaceAlt, color: colors.text, textAlign: 'right', fontSize: '0.8rem', outline: 'none' }} />
                        <span style={{ fontSize: '0.7rem', color: colors.textFaint, minWidth: '1.5rem' }}>{p.unit}</span>
                      </Box>
                    </Box>
                  ))}
                </Stack>

                <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
                  <Button variant="contained" size="small" onClick={confirmShape} startIcon={<SaveIcon sx={{ fontSize: '0.875rem' }} />}>Apply section</Button>
                </Box>
              </>
            )}
          </Stack>
        )}

        {/* ══ Tab 3: amorphous ══ */}
        {tab === 'amorphous' && (
          <Stack spacing={1.5}>
            <Typography sx={{ fontSize: '0.72rem', color: colors.textDim }}>
              Declare a section by its properties directly (no shape). Useful when only A / Iy / Iz are known.
            </Typography>
            {[
              { id: 'a', label: 'Area A', unit: 'm²' },
              { id: 'iy', label: 'Iy (horizontal)', unit: 'm⁴' },
              { id: 'iz', label: 'Iz (vertical)', unit: 'm⁴' },
              { id: 'j', label: 'J ?torsion', unit: 'm⁴' },
            ].map((f) => (
              <Box key={f.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography sx={fieldLabelSx}>{f.label}</Typography>
                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                  <input type="number" value={(amorph as any)[f.id]}
                    onChange={(e) => setAmorph((prev) => ({ ...prev, [f.id]: num(e.target.value) }))}
                    style={{ width: 120, padding: '5px 6px', borderRadius: '4px', border: `1px solid ${colors.borderDark}`, background: colors.surfaceAlt, color: colors.text, textAlign: 'right', fontSize: '0.8rem', outline: 'none' }} />
                  <span style={{ fontSize: '0.7rem', color: colors.textFaint, minWidth: '1.5rem' }}>{f.unit}</span>
                </Box>
              </Box>
            ))}
            <Button variant="contained" size="small" onClick={confirmAmorphous}>Apply section</Button>
          </Stack>
        )}
      </Stack>
    </Dialog>
  );
});

export default SectionChanger;