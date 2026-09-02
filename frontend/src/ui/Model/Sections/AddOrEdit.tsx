import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Stack,
  Button,
} from '@mui/material';
import { Save as SaveIcon } from '@mui/icons-material';
import { observer } from 'mobx-react-lite';
import { useModel } from '../../../model/Context';
import Dialog from '../../../components/Dialog/Dialog';
import { Section, SectionType, Material } from '../../../types';
import SectionModel from '../../../model/Section/Section';
import TextField from '../../../components/TextField/TextField';
import Select from '../../../components/Select';
import { fieldLabelSx } from '../../../theme';
import SectionPreview from './SectionPreview';
import { StandardSection, filterStandards } from '../../../libraries/sections';

interface EditSectionProps {
  open: boolean;
  onClose: () => void;
  section: Section | null;
}

interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
}

const TYPE_OPTIONS: { id: SectionType; name: string }[] = [
  { id: 'Rectangular', name: 'Rectangular (solid)' },
  { id: 'Circular', name: 'Circular (solid)' },
  { id: 'HollowCircular', name: 'Circular hollow (pipe / CHS)' },
  { id: 'RectangularHollow', name: 'Rectangular hollow (box / HSS / RHS)' },
  { id: 'I', name: 'I / H section' },
  { id: 'IPN', name: 'Tapered I-beam (IPN)' },
  { id: 'Channel', name: 'Channel (C / UPE)' },
  { id: 'UPN', name: 'Tapered channel (UPN)' },
  { id: 'Angle', name: 'Angle (L)' },
  { id: 'Tee', name: 'Tee (T)' },
];

const FIELD_DEFS: Record<SectionType, FieldDef[]> = {
  Rectangular: [
    { key: 'width', label: 'Width b (mm)', placeholder: 'Width' },
    { key: 'height', label: 'Height h (mm)', placeholder: 'Height' },
  ],
  Circular: [
    { key: 'diameter', label: 'Diameter d (mm)', placeholder: 'Diameter' },
  ],
  HollowCircular: [
    { key: 'diameter', label: 'Outer diameter d (mm)', placeholder: 'Diameter' },
    { key: 'thickness', label: 'Wall thickness t (mm)', placeholder: 'Thickness' },
  ],
  RectangularHollow: [
    { key: 'height', label: 'Height h (mm)', placeholder: 'Height' },
    { key: 'width', label: 'Width b (mm)', placeholder: 'Width' },
    { key: 'thickness', label: 'Wall thickness t (mm)', placeholder: 'Thickness' },
    { key: 'ri', label: 'Inner corner radius ri (mm)', placeholder: 'ri (0 = sharp)' },
  ],
  I: [
    { key: 'depth', label: 'Depth h (mm)', placeholder: 'Depth' },
    { key: 'width', label: 'Flange width b (mm)', placeholder: 'Width' },
    { key: 'tw', label: 'Web thickness tw (mm)', placeholder: 'tw' },
    { key: 'tf', label: 'Flange thickness tf (mm)', placeholder: 'tf' },
    { key: 'r', label: 'Root radius r (mm)', placeholder: 'r' },
  ],
  Channel: [
    { key: 'depth', label: 'Depth h (mm)', placeholder: 'Depth' },
    { key: 'width', label: 'Flange width b (mm)', placeholder: 'Width' },
    { key: 'tw', label: 'Web thickness tw (mm)', placeholder: 'tw' },
    { key: 'tf', label: 'Flange thickness tf (mm)', placeholder: 'tf' },
    { key: 'r', label: 'Root radius r (mm)', placeholder: 'r' },
  ],
  IPN: [
    { key: 'depth', label: 'Depth h (mm)', placeholder: 'Depth' },
    { key: 'width', label: 'Flange width b (mm)', placeholder: 'Width' },
    { key: 'tw', label: 'Web thickness tw (mm)', placeholder: 'tw' },
    { key: 'tf', label: 'Flange thickness tf (mm, at b/4)', placeholder: 'tf' },
  ],
  UPN: [
    { key: 'depth', label: 'Depth h (mm)', placeholder: 'Depth' },
    { key: 'width', label: 'Flange width b (mm)', placeholder: 'Width' },
    { key: 'tw', label: 'Web thickness tw (mm)', placeholder: 'tw' },
    { key: 'tf', label: 'Flange thickness tf (mm, at b/2)', placeholder: 'tf' },
  ],
  Angle: [
    { key: 'width', label: 'Leg width b (mm)', placeholder: 'Leg' },
    { key: 'thickness', label: 'Leg thickness t (mm)', placeholder: 'Thickness' },
  ],
  Tee: [
    { key: 'depth', label: 'Depth h (mm)', placeholder: 'Depth' },
    { key: 'width', label: 'Flange width b (mm)', placeholder: 'Width' },
    { key: 'tw', label: 'Stem thickness tw (mm)', placeholder: 'tw' },
    { key: 'tf', label: 'Flange thickness tf (mm)', placeholder: 'tf' },
  ],
};

const DEFAULT_FORM: Record<string, any> = {
  id: null,
  name: '',
  type: 'I' as SectionType,
  material: null,
  width: 150,
  height: 300,
  diameter: 200,
  thickness: 10,
  depth: 300,
  tw: 7.1,
  tf: 10.7,
  r: 15,
  ri: 0,
  standard: '',
};

const EditSection = observer(({ open, onClose, section }: EditSectionProps) => {
  const model = useModel();

  const [formData, setFormData] = useState<any>({ ...DEFAULT_FORM });

  useEffect(() => {
    if (!open) return;
    if (section) {
      setFormData({
        ...DEFAULT_FORM,
        ...section,
        material: (section.material as Material)?.id ?? null,
        standard: (section as any).standard || '',
      });
    } else {
      setFormData({ ...DEFAULT_FORM });
    }
  }, [section, open]);

  const handleChange = (e: any) => {
    const { name, value } = e.target;
    setFormData((prev: any) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (field: string, value: any) => {
    setFormData((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleTypeChange = (type: SectionType) => {
    setFormData((prev: any) => ({ ...prev, type, standard: '' }));
  };

  const materials = model?.materials.map((mat) => ({ id: mat.id, name: mat.name }));

  const standards = useMemo<StandardSection[]>(
    () => filterStandards(formData.type),
    [formData.type],
  );

  const applyStandard = (std: StandardSection) => {
    setFormData((prev: any) => ({
      ...prev,
      standard: std.name,
      depth: std.depth ?? prev.depth,
      height: std.height ?? prev.height,
      width: std.width ?? prev.width,
      tw: std.tw ?? prev.tw,
      tf: std.tf ?? prev.tf,
      r: std.r ?? prev.r,
      diameter: std.diameter ?? prev.diameter,
      thickness: std.thickness ?? prev.thickness,
      ri: std.ri ?? prev.ri,
    }));
  };

  const previewSection = useMemo<Section>(() => {
    const f = formData;
    const mat = { id: 0, name: '', E: 210e9, nu: 0.3 };
    const n = (v: any) => Number(v) || 0;
    switch (f.type as SectionType) {
      case 'Rectangular':
        return { id: 0, name: '', type: 'Rectangular', width: n(f.width), height: n(f.height), material: mat } as Section;
      case 'Circular':
        return { id: 0, name: '', type: 'Circular', diameter: n(f.diameter), material: mat } as Section;
      case 'HollowCircular':
        return { id: 0, name: '', type: 'HollowCircular', diameter: n(f.diameter), thickness: n(f.thickness), material: mat } as Section;
      case 'RectangularHollow':
        return { id: 0, name: '', type: 'RectangularHollow', height: n(f.height), width: n(f.width), thickness: n(f.thickness), ri: n(f.ri), material: mat } as Section;
      case 'I':
        return { id: 0, name: '', type: 'I', depth: n(f.depth), width: n(f.width), tw: n(f.tw), tf: n(f.tf), r: n(f.r), material: mat } as Section;
      case 'Channel':
        return { id: 0, name: '', type: 'Channel', depth: n(f.depth), width: n(f.width), tw: n(f.tw), tf: n(f.tf), r: n(f.r), material: mat } as Section;
      case 'IPN':
        return { id: 0, name: '', type: 'IPN', depth: n(f.depth), width: n(f.width), tw: n(f.tw), tf: n(f.tf), material: mat } as Section;
      case 'UPN':
        return { id: 0, name: '', type: 'UPN', depth: n(f.depth), width: n(f.width), tw: n(f.tw), tf: n(f.tf), material: mat } as Section;
      case 'Angle':
        return { id: 0, name: '', type: 'Angle', width: n(f.width), thickness: n(f.thickness), material: mat } as Section;
      case 'Tee':
        return { id: 0, name: '', type: 'Tee', depth: n(f.depth), width: n(f.width), tw: n(f.tw), tf: n(f.tf), r: n(f.r), material: mat } as Section;
      default:
        return { id: 0, name: '', type: 'Rectangular', width: 100, height: 100, material: mat } as Section;
    }
  }, [formData]);

  const handleSave = () => {
    const material = model.materials.find((m) => m.id === Number(formData.material));
    if (!material) {
      console.warn('Material not found');
      return;
    }

    const numeric = (v: any) => (v === '' || v === null || v === undefined ? 0 : Number(v));
    const type = formData.type as SectionType;
    const base: any = { id: formData.id, name: formData.name || `${type} section`, type, material };
    const fieldKeys = FIELD_DEFS[type].map((fd) => fd.key);
    fieldKeys.forEach((k) => {
      base[k] = numeric(formData[k]);
    });
    if (formData.standard) base.standard = formData.standard;

    const sectionInstance = new SectionModel(model, base);
    sectionInstance.createOrUpdate();
    onClose();
  };

  const fields = FIELD_DEFS[formData.type as SectionType] || [];

  const actions = (
    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
      <Button variant="outlined" color="inherit" size="small" onClick={onClose}>
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
      onClose={onClose}
      maxWidth="sm"
      fullWidth={false}
      hideBackdrop
      disableEnforceFocus
      disableAutoFocus
      draggable
      title={section ? 'Edit Section' : 'New Section'}
      actions={actions}
    >
      <Stack spacing={1.5}>
        <Box>
          <Typography sx={fieldLabelSx}>Name</Typography>
          <TextField value={formData.name} onChange={handleChange} name="name" placeholder="Section name" fullWidth />
        </Box>

        <Box>
          <Typography sx={fieldLabelSx}>Type</Typography>
          <Select
            label={''}
            list={TYPE_OPTIONS}
            value={formData.type}
            onChange={(e: any) => handleTypeChange(e.target.value as SectionType)}
            size="small"
          />
        </Box>

        <Box>
          <Typography sx={fieldLabelSx}>Material</Typography>
          <Select
            label={''}
            list={materials}
            value={formData.material || ''}
            onChange={(e: any) => handleSelectChange('material', e.target.value)}
            size="small"
          />
        </Box>

        {standards.length > 0 && (
          <Box>
            <Typography sx={fieldLabelSx}>Standard section (AISC / EN)</Typography>
            <Select
              label={''}
              list={[{ id: '', name: 'â€” Custom â€”' }, ...standards.map((s) => ({ id: s.name, name: s.name }))]}
              value={formData.standard || ''}
              onChange={(e: any) => {
                const name = e.target.value;
                const std = standards.find((s) => s.name === name);
                if (std) applyStandard(std);
                else handleSelectChange('standard', '');
              }}
              size="small"
            />
          </Box>
        )}

        {fields.map((fd) => (
          <Box key={fd.key}>
            <Typography sx={fieldLabelSx}>{fd.label}</Typography>
            <TextField
              value={formData[fd.key] ?? ''}
              onChange={handleChange}
              name={fd.key}
              placeholder={fd.placeholder}
              type="number"
              fullWidth
            />
          </Box>
        ))}

        <Box>
          <Typography sx={fieldLabelSx}>Preview</Typography>
          <SectionPreview section={previewSection} />
        </Box>
      </Stack>
    </Dialog>
  );
});

export default EditSection;