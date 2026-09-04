import { useState } from 'react';
import { Box, Button, Grid, Stack, Typography } from '@mui/material';
import { observer } from 'mobx-react-lite';
import { toast } from 'react-toastify';
import Dialog from '../../../components/Dialog/Dialog';
import TextField from '../../../components/TextField';
import Select from '../../../components/Select';
import { useModel } from '../../../model/Context';
import { colors, fieldLabelSx } from '../../../theme';
import { generateTower } from '../../../model/Generators/TowerGenerator';

interface TowerGeneratorProps {
  open: boolean;
  onClose: () => void;
}

const defaults = {
  circuit: 'double',
  bodyHeight: '30',
  peakHeight: '6',
  baseWidth: '10',
  topWidth: '2',
  panelCount: '6',
  taper: 'linear',
  armCount: '3',
  armLength: '5',
  armDrop: '1.5',
  armSpacing: '5',
  sectionId: '',
};

/**
 * Transmission-tower generator dialog (Model > Generate > Tower).
 * Collects the geometry parameters of a lattice transmission tower and
 * generates nodes + members directly into the model.
 */
const TowerGeneratorDialog = observer(({ open, onClose }: TowerGeneratorProps) => {
  const model = useModel();
  const [p, setP] = useState<any>({ ...defaults });

  const set = (key: string) => (e: any) => setP((prev: any) => ({ ...prev, [key]: e.target.value }));
  const num = (key: string) => Number(p[key]);

  const sectionOptions = (model?.sections ?? []).map((s: any) => ({ id: s.id, name: s.name }));

  const totalHeight = (Number(p.bodyHeight) || 0) + (Number(p.peakHeight) || 0);

  const handleGenerate = () => {
    if (!model) return;
    const bodyHeight = num('bodyHeight');
    const peakHeight = num('peakHeight');
    const baseWidth = num('baseWidth');
    const topWidth = num('topWidth');
    const panelCount = num('panelCount');
    const armCount = num('armCount');
    const armLength = num('armLength');

    if (!(bodyHeight > 0)) return toast.error('Body height must be > 0 m');
    if (!(peakHeight >= 0)) return toast.error('Peak height must be >= 0 m');
    if (!(baseWidth > 0)) return toast.error('Base width must be > 0 m');
    if (!(topWidth > 0 && topWidth < baseWidth)) return toast.error('Top width must be > 0 and smaller than base width');
    if (!(panelCount >= 1)) return toast.error('Panels must be >= 1');
    if (!(armCount >= 0 && armCount <= 3)) return toast.error('Arms per side must be 0..3');
    if (!(armLength > 0)) return toast.error('Arm length must be > 0 m');
    if (!p.sectionId) return toast.error('Choose a section for the tower members');

    try {
      const res = generateTower(model, {
        circuit: p.circuit,
        bodyHeight,
        peakHeight,
        baseWidth,
        topWidth,
        panelCount,
        taper: p.taper,
        armCount,
        armLength,
        armDrop: num('armDrop'),
        armSpacing: num('armSpacing'),
        sectionId: Number(p.sectionId),
      });
      toast.success(`Tower generated — ${res.nodes} nodes, ${res.members} members`);
      onClose();
    } catch (e: any) {
      toast.error(e?.message || 'Tower generation failed');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth={false} draggable title="Tower generator (500 kV)">
      <Stack spacing={0.5} sx={{ width: '280px' }}>
        <Box>
          <Typography sx={fieldLabelSx}>Circuit</Typography>
          <Select
            label={''}
            list={[{ id: 'double', name: 'Double circuit (delta arms)' }, { id: 'single', name: 'Single circuit' }]}
            value={p.circuit}
            onChange={set('circuit')}
            size="small"
          />
        </Box>

        <Grid container spacing={1} alignItems="center">
          <Grid item xs={6}>
            <Typography sx={fieldLabelSx}>Body height (m)</Typography>
            <TextField value={p.bodyHeight} onChange={set('bodyHeight')} name="bodyHeight" placeholder="" size="small" fullWidth />
          </Grid>
          <Grid item xs={6}>
            <Typography sx={fieldLabelSx}>Peak height (m)</Typography>
            <TextField value={p.peakHeight} onChange={set('peakHeight')} name="peakHeight" placeholder="" size="small" fullWidth />
          </Grid>
          <Grid item xs={6}>
            <Typography sx={fieldLabelSx}>Base width (m)</Typography>
            <TextField value={p.baseWidth} onChange={set('baseWidth')} name="baseWidth" placeholder="" size="small" fullWidth />
          </Grid>
          <Grid item xs={6}>
            <Typography sx={fieldLabelSx}>Top width (m)</Typography>
            <TextField value={p.topWidth} onChange={set('topWidth')} name="topWidth" placeholder="" size="small" fullWidth />
          </Grid>
          <Grid item xs={6}>
            <Typography sx={fieldLabelSx}>Panels (storeys)</Typography>
            <TextField value={p.panelCount} onChange={set('panelCount')} name="panelCount" placeholder="" size="small" fullWidth />
          </Grid>
          <Grid item xs={6}>
            <Typography sx={fieldLabelSx}>Taper</Typography>
            <Select
              label={''}
              list={[{ id: 'linear', name: 'Linear (raking legs)' }, { id: 'step', name: 'Step (belted)' }]}
              value={p.taper}
              onChange={set('taper')}
              size="small"
            />
          </Grid>
        </Grid>

        <Box sx={{ pt: 0.5 }}>
          <Typography sx={fieldLabelSx}>Arms per side (tai đỡ)</Typography>
          <Select
            label={''}
            list={[{ id: 0, name: '0 — none' }, { id: 1, name: '1' }, { id: 2, name: '2' }, { id: 3, name: '3' }]}
            value={num('armCount')}
            onChange={set('armCount')}
            size="small"
          />
        </Box>

        <Grid container spacing={1} alignItems="center">
          <Grid item xs={4}>
            <Typography sx={fieldLabelSx}>Length (m)</Typography>
            <TextField value={p.armLength} onChange={set('armLength')} name="armLength" placeholder="" size="small" fullWidth />
          </Grid>
          <Grid item xs={4}>
            <Typography sx={fieldLabelSx}>Tip drop (m)</Typography>
            <TextField value={p.armDrop} onChange={set('armDrop')} name="armDrop" placeholder="" size="small" fullWidth />
          </Grid>
          <Grid item xs={4}>
            <Typography sx={fieldLabelSx}>Spacing (m)</Typography>
            <TextField value={p.armSpacing} onChange={set('armSpacing')} name="armSpacing" placeholder="" size="small" fullWidth />
          </Grid>
        </Grid>

        <Box sx={{ pt: 0.5 }}>
          <Typography sx={fieldLabelSx}>Section (all tower members)</Typography>
          <Select
            label={''}
            list={sectionOptions}
            value={p.sectionId === '' ? '' : Number(p.sectionId)}
            onChange={set('sectionId')}
            size="small"
          />
        </Box>

        <Typography sx={{ fontSize: '0.7rem', color: colors.textFaint }}>
          Total height: {totalHeight.toFixed(1)} m — body {Number(p.bodyHeight) || 0} m + peak {Number(p.peakHeight) || 0} m.
          Arms snap to the nearest body belt.
        </Typography>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, pt: 1 }}>
          <Button variant="outlined" color="inherit" size="small" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="contained" size="small" onClick={handleGenerate}>
            Generate
          </Button>
        </Box>
      </Stack>
    </Dialog>
  );
});

export default TowerGeneratorDialog;
