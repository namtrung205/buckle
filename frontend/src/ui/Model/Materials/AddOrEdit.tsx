import { ChangeEvent, useEffect, useState } from 'react';
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
import { fieldLabelSx } from '../../../theme';
import { useModel } from '../../../model/Context';
import { ElasticIsotropicMaterial } from '../../../types';

interface MaterialsProps {
  open: boolean;
  onClose: () => void;
  selectedMaterial?: ElasticIsotropicMaterial | null;
}

const AddOrEdit = observer(({ open, onClose, selectedMaterial = null }: MaterialsProps) => {
  const model = useModel();
  const [material, setMaterial] = useState<ElasticIsotropicMaterial>({
    id: 0,
    name: '',
    E: 200e9,
    nu: 0.3,
    rho: 7850,
  });

  useEffect(() => {
    if(!open) return 
    if (selectedMaterial) setMaterial({...selectedMaterial});
    else reset()
  }, [open, selectedMaterial ]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setMaterial((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSave = () => {
    if (!model) return;
    const id = selectedMaterial?.id ||  (Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) % 0x80000000)
    const rho =  material.rho || 0
    const newMaterial: ElasticIsotropicMaterial = {
      id: id,
      name: material.name || `Material ${model.materials.length + 1}`,
      E: Number(material.E),
      nu: Number(material.nu),
      rho: Number(rho),
    };

    if (selectedMaterial) {
      const currentMat = model.materials.find((m) => m.id === selectedMaterial.id);
      if (currentMat)  Object.assign(currentMat, newMaterial);
    } else model.materials.push(newMaterial);
    
    onClose();
    reset()
  };

  const reset = () => {
    setMaterial({
      id: 0,
      name: '',
      E: 200e9,
      nu: 0.3,
      rho: 7850,
    });
  }
  const handleCancel = () => {
    onClose();
    reset()
  };

  const actions = (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <Button
        variant="outlined"
        color="inherit"
        size="small"
        onClick={handleCancel}
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
      onClose={handleCancel}
      maxWidth="xs"
      fullWidth={false}
      hideBackdrop
      disableEnforceFocus
      disableAutoFocus
      draggable
      title={selectedMaterial ? 'Edit Material' : 'New Material'}
      actions={actions}
    >
        <Stack spacing={1.5}>
          <Box>
            <Typography sx={fieldLabelSx}>
              Name
            </Typography>
            <TextField
              value={material.name}
              onChange={handleChange}
              name="name"
              placeholder="Material name"
              fullWidth
            />
          </Box>

          <Box>
            <Typography sx={fieldLabelSx}>
              E (Pa)
            </Typography>
            <TextField
              value={material.E}
              onChange={handleChange}
              name="E"
              placeholder="Young's modulus"
              fullWidth
            />
          </Box>

          <Box>
            <Typography sx={fieldLabelSx}>
              ν
            </Typography>
            <TextField
              value={material.nu}
              onChange={handleChange}
              name="nu"
              placeholder="Poisson ratio"
              fullWidth
            />
          </Box>

          <Box>
            <Typography sx={fieldLabelSx}>
              ρ (kg/m³)
            </Typography>
            <TextField
              value={material.rho ?? ''}
              onChange={handleChange}
              name="rho"
              placeholder="Density"
              fullWidth
            />
          </Box>
        </Stack>
    </Dialog>
  );
});

export default AddOrEdit;

