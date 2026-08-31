import { useState, useEffect } from 'react';
import React from 'react';
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
import { Section as SectionType } from '../../../types';
import Section from '../../../model/Section/Section';
import TextField from '../../../components/TextField/TextField';
import Select from '../../../components/Select';
import { fieldLabelSx } from '../../../theme';
interface EditSectionProps {
  open: boolean;
  onClose: () => void;
  section: SectionType | null;
}


const EditSection = observer(({ open, onClose, section }: EditSectionProps) => {
  const model = useModel();
  
  const [formData, setFormData] = useState<any>({
    id: null,
    name: '',
    type: 'Rectangular',
    material: null,
    // Rectangular
    width: 300,
    height: 500,
    // Circular
    diameter: 200,
    // Hollow Circular
    thickness: 10,
    // I-Section
    depth: 400,
    tw: 10,
    tf: 15,
    r: 10,
  });

  useEffect(() => {
    if (section && open) {
      setFormData({
        id: section.id,
        name: section.name,
        type: section.type,
        material: section.material?.id || null,
        width: (section as any).width || 300,
        height: (section as any).height || 500,
        diameter: (section as any).diameter || 200,
        thickness: (section as any).thickness || 10,
        depth: (section as any).depth || 400,
        tw: (section as any).tw || 10,
        tf: (section as any).tf || 15,
        r: (section as any).r || 10,
      });
    }
  }, [section, open]);

  const handleChange = (e: any) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleSelectChange = (field: string, value: any) => {
    setFormData({ ...formData, [field]: value });
  };

  const sections = [
    { id: 'Rectangular', name: 'Rectangular' },
    { id: 'Circular', name: 'Circular' },
    { id: 'HollowCircular', name: 'Hollow Circular' },
    { id: 'I', name: 'I-Section' },
  ];
  const materials = model?.materials.map((mat) => {return {id : mat.id , name : mat.name}})

  const handleSave = () => {
    // if (!section) return;
    
    const material = model.materials.find(m => m.id === formData.material);
    if (!material) {
      console.warn('Material not found');
      return;
    }

    const sectionData = {
      ...formData,
      material: material,
      width: Number(formData.width),
      height: Number(formData.height),
      diameter: Number(formData.diameter),
      thickness: Number(formData.thickness),
      depth: Number(formData.depth),
      tw: Number(formData.tw),
      tf: Number(formData.tf),
      r: Number(formData.r),
    };

    const sectionInstance = new Section(model, sectionData);
    sectionInstance.createOrUpdate();
    onClose();
  };

  const actions = (
    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
      <Button
        variant="outlined"
        color="inherit"
        size="small"
        onClick={onClose}
      >
        Cancel
      </Button>
      <Button
        variant="contained"
        size="small"
        onClick={handleSave}
        startIcon={<SaveIcon sx={{ fontSize: '0.875rem' }} />}
      >
        Save
      </Button>
    </Box>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth={false}
      hideBackdrop
      disableEnforceFocus
      disableAutoFocus
      draggable
      title={section ? 'Edit Section' : 'New Section'}
      actions={actions}
    >
      <Stack spacing={1.5}>
          {/* Name */}
          <Box>
            <Typography
              sx={fieldLabelSx}
            >
              Name
            </Typography>
            <TextField
              key="name"
              value={formData.name}
              onChange={handleChange}
              name="name"
              placeholder="Section name"
              fullWidth
            />
          </Box>

          {/* Type */}
          <Box>
            <Typography
              sx={fieldLabelSx}
            >
              Type
            </Typography>
            <Select
              label={''}
              list={sections}
              value={formData.type}
              onChange={(e: any) => handleSelectChange('type', e.target.value)}
              size="small"
            />
          </Box>

          {/* Material */}
          <Box>
            <Typography
              sx={fieldLabelSx}
            >
              Material
            </Typography>
            <Select
              label={''}
              list={materials}
              value={formData.material || ''}
              onChange={(e: any) => handleSelectChange('material', e.target.value)}
              size="small"
            />
          </Box>

          {/* Rectangular fields */}
          {formData.type === 'Rectangular' && (
            <>
              <Box>
                <Typography
                  sx={fieldLabelSx}
                >
                  Width (mm)
                </Typography>
                <TextField
                  key="width"
                  value={formData.width}
                  onChange={handleChange}
                  name="width"
                  placeholder="Width"
                  fullWidth
                />
              </Box>
              <Box>
                <Typography
                  sx={fieldLabelSx}
                >
                  Height (mm)
                </Typography>
                <TextField
                  key="height"
                  value={formData.height}
                  onChange={handleChange}
                  name="height"
                  placeholder="Height"
                  fullWidth
                />
              </Box>
            </>
          )}

          {formData.type === 'Circular' && (
            <Box>
              <Typography
                sx={fieldLabelSx}
              >
                Diameter (mm)
              </Typography>
              <TextField
                key="diameter-circular"
                value={formData.diameter}
                onChange={handleChange}
                name="diameter"
                placeholder="Diameter"
                fullWidth
              />
            </Box>
          )}

          {formData.type === 'HollowCircular' && (
            <>
              <Box>
                <Typography
                  sx={fieldLabelSx}
                >
                  Diameter (mm)
                </Typography>
                <TextField
                  key="diameter-hollow"
                  value={formData.diameter}
                  onChange={handleChange}
                  name="diameter"
                  placeholder="Diameter"
                  fullWidth
                />
              </Box>
              <Box>
                <Typography
                  sx={fieldLabelSx}
                >
                  Thickness (mm)
                </Typography>
                <TextField
                  key="thickness"
                  value={formData.thickness}
                  onChange={handleChange}
                  name="thickness"
                  placeholder="Thickness"
                  fullWidth
                />
              </Box>
            </>
          )}

          {formData.type === 'I' && (
            <>
              <Box>
                <Typography
                  sx={fieldLabelSx}
                >
                  Depth (mm)
                </Typography>
                <TextField
                  key="depth"
                  value={formData.depth}
                  onChange={handleChange}
                  name="depth"
                  placeholder="Depth"
                  fullWidth
                />
              </Box>
              <Box>
                <Typography
                  sx={fieldLabelSx}
                >
                  Width (mm)
                </Typography>
                <TextField
                  key="width-i"
                  value={formData.width}
                  onChange={handleChange}
                  name="width"
                  placeholder="Width"
                  fullWidth
                />
              </Box>
              <Box>
                <Typography
                  sx={fieldLabelSx}
                >
                  tw (mm)
                </Typography>
                <TextField
                  key="tw"
                  value={formData.tw}
                  onChange={handleChange}
                  name="tw"
                  placeholder="tw"
                  fullWidth
                />
              </Box>
              <Box>
                <Typography
                  sx={fieldLabelSx}
                >
                  tf (mm)
                </Typography>
                <TextField
                  key="tf"
                  value={formData.tf}
                  onChange={handleChange}
                  name="tf"
                  placeholder="tf"
                  fullWidth
                />
              </Box>
              <Box>
                <Typography
                  sx={fieldLabelSx}
                >
                  r (mm)
                </Typography>
                <TextField
                  key="r"
                  value={formData.r}
                  onChange={handleChange}
                  name="r"
                  placeholder="r"
                  fullWidth
                />
              </Box>
            </>
          )}
        </Stack>
    </Dialog>
    );
});

export default EditSection;

