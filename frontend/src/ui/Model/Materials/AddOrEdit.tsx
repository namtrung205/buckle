import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Stack,
  Typography,
} from '@mui/material';
import { Save as SaveIcon } from '@mui/icons-material';
import { observer } from 'mobx-react-lite';
import Dialog from '../../../components/Dialog/Dialog';
import TextField from '../../../components/TextField/TextField';
import Select from '../../../components/Select';
import { fieldLabelSx } from '../../../theme';
import { useModel } from '../../../model/Context';
import { ElasticIsotropicMaterial, MaterialCategory } from '../../../types';
import {
  MATERIAL_PRESETS,
  PRESETS_BY_CATEGORY,
  materialFromPreset,
  MATERIAL_CATEGORY_LABELS,
} from '../../../libraries/materials';

interface MaterialsProps {
  open: boolean;
  onClose: () => void;
  selectedMaterial?: ElasticIsotropicMaterial | null;
}

const CATEGORY_OPTIONS = (Object.keys(MATERIAL_CATEGORY_LABELS) as MaterialCategory[]).map((c) => ({
  id: c,
  name: MATERIAL_CATEGORY_LABELS[c],
}));

const EMPTY: ElasticIsotropicMaterial = {
  id: 0,
  name: '',
  E: 200e9,
  nu: 0.3,
  rho: 7850,
  alpha: 12e-6,
};

const AddOrEdit = observer(({ open, onClose, selectedMaterial = null }: MaterialsProps) => {
  const model = useModel();
  const [material, setMaterial] = useState<ElasticIsotropicMaterial>({ ...EMPTY });

  useEffect(() => {
    if (!open) return;
    if (selectedMaterial) setMaterial({ ...selectedMaterial });
    else reset();
  }, [open, selectedMaterial]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    const isText = name === 'name' || name === 'grade';
    setMaterial((prev) => ({
      ...prev,
      [name]: isText ? value : value === '' ? undefined : Number(value),
    }));
  };

  const handleSelect = (field: string, value: any) => {
    setMaterial((prev) => ({ ...prev, [field]: value }));
  };

  const presets = useMemo(() => {
    const cat = material.category as MaterialCategory;
    return cat && PRESETS_BY_CATEGORY[cat] ? PRESETS_BY_CATEGORY[cat] : MATERIAL_PRESETS;
  }, [material.category]);

  const applyPreset = (key: string) => {
    const preset = MATERIAL_PRESETS.find((p) => p.key === key);
    if (!preset) return;
    setMaterial((prev) => ({ ...prev, ...materialFromPreset(preset), id: prev.id }));
  };

  const handleSave = () => {
    if (!model) return;
    const id = selectedMaterial?.id || (Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) % 0x80000000);
    const next: ElasticIsotropicMaterial = {
      id,
      name: material.name || `Material ${model.materials.length + 1}`,
      category: material.category,
      code: material.code,
      grade: material.grade,
      preset: material.preset,
      E: Number(material.E),
      nu: Number(material.nu),
      rho: material.rho ?? 0,
      alpha: material.alpha,
      fy: material.fy,
      fc: material.fc,
      fu: material.fu,
      ft: material.ft,
    };

    if (selectedMaterial) {
      const currentMat = model.materials.find((m) => m.id === selectedMaterial.id);
      if (currentMat) Object.assign(currentMat, next);
    } else {
      model.materials.push(next);
    }

    onClose();
    reset();
  };

  const reset = () => setMaterial({ ...EMPTY });
  const handleCancel = () => {
    onClose();
    reset();
  };

  const field = (label: string, name: string, placeholder: string, value: any, isText = false) => (
    <Box>
      <Typography sx={fieldLabelSx}>{label}</Typography>
      <TextField
        value={value ?? ''}
        onChange={handleChange}
        name={name}
        placeholder={placeholder}
        fullWidth
        type={isText ? 'text' : 'number'}
      />
    </Box>
  );

  const actions = (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <Button variant="outlined" color="inherit" size="small" onClick={handleCancel}>
        Cancel
      </Button>
      <Button variant="contained" size="small" onClick={handleSave} startIcon={<SaveIcon sx={{ fontSize: '0.875rem' }} />}>
        Save
      </Button>
    </Box>
  );

  return (
    <Dialog
      open={open}
      onClose={handleCancel}
      maxWidth="sm"
      fullWidth={false}
      hideBackdrop
      disableEnforceFocus
      disableAutoFocus
      draggable
      title={selectedMaterial ? 'Edit Material' : 'New Material'}
      actions={actions}
    >
      <Stack spacing={1.5}>
        {field('Name', 'name', 'Material name', material.name, true)}

        <Box>
          <Typography sx={fieldLabelSx}>Category</Typography>
          <Select
            label={''}
            list={CATEGORY_OPTIONS}
            value={material.category || ''}
            onChange={(e: any) => handleSelect('category', e.target.value)}
            size="small"
          />
        </Box>

        <Box>
          <Typography sx={fieldLabelSx}>Standard preset (EN / AISC / ACI / NDS)</Typography>
          <Select
            label={''}
            list={[{ id: '', name: '— Custom —' }, ...presets.map((p) => ({ id: p.key, name: p.name }))]}
            value={material.preset || ''}
            onChange={(e: any) => applyPreset(e.target.value)}
            size="small"
          />
        </Box>

        {field('E — Young\u2019s modulus (Pa)', 'E', 'Young modulus', material.E)}
        {field('\u03bd — Poisson ratio', 'nu', 'Poisson ratio', material.nu)}
        {field('\u03c1 — Density (kg/m\u00b3)', 'rho', 'Density', material.rho)}
        {field('\u03b1 — Thermal expansion (1/K)', 'alpha', 'Thermal coefficient', material.alpha)}

        {field('fy — Yield strength (Pa)', 'fy', 'Yield strength', material.fy)}
        {field('fc — Compressive strength (Pa)', 'fc', 'Compressive strength', material.fc)}
        {field('fu — Ultimate strength (Pa)', 'fu', 'Ultimate tensile strength', material.fu)}
        {field('ft — Tensile strength (Pa)', 'ft', 'Tensile strength', material.ft)}
        {field('Grade', 'grade', 'Grade designation', material.grade, true)}
      </Stack>
    </Dialog>
  );
});

export default AddOrEdit;