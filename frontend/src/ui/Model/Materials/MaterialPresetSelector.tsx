import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { Save as SaveIcon } from '@mui/icons-material';
import { observer } from 'mobx-react-lite';
import { useModel } from '../../../model/Context';
import Dialog from '../../../components/Dialog/Dialog';
import { ElasticIsotropicMaterial, MaterialCategory } from '../../../types';
import { colors, fieldLabelSx } from '../../../theme';
import {
  MATERIAL_PRESETS,
  MATERIAL_CATEGORY_LABELS,
  PRESETS_BY_CATEGORY,
  materialFromPreset,
  type MaterialPreset,
} from '../../../libraries/materials';

interface MaterialSelectorProps {
  open: boolean;
  onClose: () => void;
  selectedMaterial?: ElasticIsotropicMaterial | null;
}

/** Codes offered per category (derived from each preset's `code` field). */
function codesFor(category: MaterialCategory): string[] {
  const seen = new Set<string>();
  for (const p of PRESETS_BY_CATEGORY[category] ?? []) {
    if (p.code) seen.add(p.code);
  }
  return Array.from(seen).sort();
}

const fmt = (v: number): string => {
  if (v >= 1e9) return `${(v / 1e9).toFixed(0)} GPa`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)} MPa`;
  return `${v}`;
};

const MaterialSelector = observer(({ open, onClose, selectedMaterial = null }: MaterialSelectorProps) => {
  const model = useModel();
  const [category, setCategory] = useState<MaterialCategory>('steel');
  const [codeId, setCodeId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [custom, setCustom] = useState<Partial<ElasticIsotropicMaterial>>({ name: '', E: 210e9, nu: 0.3, rho: 7850, alpha: 12e-6 });

  useEffect(() => {
    if (!open) return;
    setCategory(selectedMaterial?.category ?? 'steel');
    setCodeId(null);
    setSearch('');
  }, [open, selectedMaterial]);

  const codes = useMemo(() => codesFor(category), [category]);

  const presets = useMemo(() => {
    let list = PRESETS_BY_CATEGORY[category] ?? [];
    if (codeId) list = list.filter((p) => p.code === codeId);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || p.grade?.toLowerCase().includes(q));
    return list;
  }, [category, codeId, search]);

  const pickPreset = (preset: MaterialPreset) => {
    const mat = materialFromPreset(preset);
    const id = selectedMaterial?.id || (Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) % 0x80000000);
    const next: ElasticIsotropicMaterial = { ...mat, id };
    if (selectedMaterial) {
      const cur = model.materials.find((m) => m.id === selectedMaterial.id);
      if (cur) Object.assign(cur, next);
    } else {
      model.materials.push(next);
    }
    onClose();
  };

  const saveCustom = () => {
    const id = selectedMaterial?.id || (Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) % 0x80000000);
    const next: ElasticIsotropicMaterial = {
      id,
      name: custom.name || 'Custom',
      category,
      E: Number(custom.E),
      nu: Number(custom.nu),
      rho: Number(custom.rho) || 0,
      alpha: custom.alpha,
      fy: custom.fy,
      fc: custom.fc,
      fu: custom.fu,
      ft: custom.ft,
      grade: custom.grade,
    };
    if (selectedMaterial) {
      const cur = model.materials.find((m) => m.id === selectedMaterial.id);
      if (cur) Object.assign(cur, next);
    } else {
      model.materials.push(next);
    }
    onClose();
  };

  const strengthLine = (p: MaterialPreset): string => {
    if (p.category === 'concrete') return `fck ${fmt(p.fc ?? 0)}`;
    if (p.category === 'timber') return p.fc ? `fc ${(p.fc / 1e6).toFixed(1)} MPa` : '';
    if (p.fy) return `fy ${fmt(p.fy)} · fu ${fmt(p.fu ?? 0)}`;
    return '';
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" draggable hideBackdrop disableEnforceFocus disableAutoFocus
      title={selectedMaterial ? 'Change Material' : 'New Material'} actions={null}>
      <Stack spacing={1.5}>
        {/* category tabs */}
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {(Object.keys(MATERIAL_CATEGORY_LABELS) as MaterialCategory[]).filter((c) => c !== 'other').map((c) => (
            <Button key={c} size="small" disableRipple onClick={() => { setCategory(c); setCodeId(null); }}
              sx={{ minWidth: 0, px: 1.1, py: 0.3, borderRadius: '4px', fontSize: '0.74rem',
                bgcolor: category === c ? colors.accent : 'transparent', color: category === c ? '#fff' : colors.textDim,
                border: `1px solid ${colors.border}`, '&:hover': { borderColor: colors.borderDark, color: colors.text } }}>
              {MATERIAL_CATEGORY_LABELS[c]}
            </Button>
          ))}
        </Box>

        {/* code filter */}
        {codes.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '0.68rem', color: colors.textFaint, textTransform: 'uppercase', letterSpacing: '0.04em', mr: 1 }}>Code</Typography>
            <Button size="small" disableRipple onClick={() => setCodeId(null)}
              sx={{ minWidth: 0, px: 1, py: 0.3, fontSize: '0.72rem', borderRadius: '4px',
                bgcolor: codeId === null ? colors.accent : 'transparent', color: codeId === null ? '#fff' : colors.textDim, border: `1px solid ${colors.border}` }}>
              All
            </Button>
            {codes.map((cc) => (
              <Button key={cc} size="small" disableRipple onClick={() => setCodeId(codeId === cc ? null : cc)}
                sx={{ minWidth: 0, px: 1, py: 0.3, fontSize: '0.72rem', borderRadius: '4px',
                  bgcolor: codeId === cc ? colors.accent : 'transparent', color: codeId === cc ? '#fff' : colors.textDim, border: `1px solid ${colors.border}`, '&:hover': { color: colors.text } }}>
                {cc}
              </Button>
            ))}
          </Box>
        )}

        {/* search */}
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search materials…"
          style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '4px', border: `1px solid ${colors.borderDark}`, background: colors.surfaceAlt, color: colors.text, fontSize: '0.85rem', outline: 'none', fontFamily: 'inherit' }} />

        {/* preset list */}
        <Box sx={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {presets.map((p) => (
            <Box key={p.key} onClick={() => pickPreset(p)}
              sx={{ p: 1, border: `1px solid ${colors.divider}`, borderRadius: '6px', cursor: 'pointer',
                bgcolor: colors.surface, '&:hover': { bgcolor: colors.hover, borderColor: colors.borderDark } }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: colors.text }}>{p.grade ?? p.name}</Typography>
                <Typography sx={{ fontSize: '0.68rem', color: colors.textFaint, fontFamily: 'monospace' }}>{p.code}</Typography>
              </Box>
              <Typography sx={{ fontSize: '0.7rem', color: colors.textDim }}>{p.name}</Typography>
              <Typography sx={{ fontSize: '0.7rem', color: colors.textFaint, mt: 0.25 }}>
                E {fmt(p.E)} · {strengthLine(p)} · ρ {p.rho} kg/m³
              </Typography>
            </Box>
          ))}
          {presets.length === 0 && (
            <Typography sx={{ textAlign: 'center', color: colors.textFaint, py: 3, fontSize: '0.82rem' }}>No results</Typography>
          )}
        </Box>

        {/* custom material (collapsed summary) */}
        <Box sx={{ borderTop: `1px solid ${colors.divider}`, pt: 1.5 }}>
          <Typography sx={{ ...fieldLabelSx, mb: 1 }}>Custom material</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
            {([
              ['name', 'Name', 'text'],
              ['E', 'E (Pa)', 'number'],
              ['nu', 'ν (Poisson)', 'number'],
              ['rho', 'ρ (kg/m³)', 'number'],
              ['alpha', 'α (1/K)', 'number'],
            ] as [string, string, string][]).map(([key, label, kind]) => (
              <Box key={key}>
                <Typography sx={fieldLabelSx}>{label}</Typography>
                <input value={(custom as any)[key] ?? ''}
                  onChange={(e) => setCustom((prev) => ({ ...prev, [key]: kind === 'text' ? e.target.value : (e.target.value === '' ? undefined : Number(e.target.value)) }))}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '4px', border: `1px solid ${colors.borderDark}`, background: colors.surfaceAlt, color: colors.text, fontSize: '0.82rem', outline: 'none' }} />
              </Box>
            ))}
          </Box>
          <Box sx={{ mt: 1.5, display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            <Button variant="outlined" color="inherit" size="small" onClick={onClose}>Cancel</Button>
            <Button variant="contained" size="small" onClick={saveCustom} startIcon={<SaveIcon sx={{ fontSize: '0.875rem' }} />}>Save custom</Button>
          </Box>
        </Box>
      </Stack>
    </Dialog>
  );
});

export default MaterialSelector;