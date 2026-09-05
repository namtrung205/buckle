import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Checkbox, FormControlLabel, Grid, Stack, Typography } from '@mui/material';
import { observer } from 'mobx-react-lite';
import { toast } from 'react-toastify';
import Dialog from '../../../components/Dialog/Dialog';
import TextField from '../../../components/TextField';
import Select from '../../../components/Select';
import { useModel } from '../../../model/Context';
import { colors, fieldLabelSx } from '../../../theme';
import {
  generateTower,
  generateTowerElevation,
} from '../../../model/Generators/TowerGenerator';
import type { ElevationGeometry } from '../../../model/Generators/TowerGenerator';

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
  straightPanels: '2',
  taper: 'linear',
  armCount: '3',
  armLength: '5',
  armDrop: '1.5',
  armSpacing: '5',
  legSectionId: '',
  braceSectionId: '',
  autoSupports: true,
  supportKind: 'pinned',
  autoLoads: true,
  windX: '0',
  windY: '0',
  windZ: '1',
  windForce: '1',
};

const LEG_COLOR = '#e0e0e0';
const BRACE_COLOR = '#8ab4f8';
const BELT_COLOR = '#c9c9c9';
const PEAK_COLOR = '#e0e0e0';
const ARM_COLOR = '#f2b24b';
const SUPPORT_COLOR = '#32d74b';

/** Draw the elevation preview onto a 2D canvas. */
function drawElevation(canvas: HTMLCanvasElement, geom: ElevationGeometry | null) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300;
  const h = canvas.clientHeight || 460;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  // Background
  ctx.fillStyle = colors.surface;
  ctx.fillRect(0, 0, w, h);

  if (!geom || geom.height <= 0) {
    ctx.fillStyle = colors.textFaint;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No preview', w / 2, h / 2);
    return;
  }

  // World → canvas mapping (center horizontally, small margin).
  const pad = 18;
  const scale = Math.min((w - pad * 2) / Math.max(geom.width, 1e-3), (h - pad * 2) / Math.max(geom.height, 1e-3));
  const mapX = (x: number) => w / 2 + x * scale;
  const mapY = (y: number) => h - pad - y * scale; // flip Y (world up → canvas down)

  // Ground line
  ctx.strokeStyle = colors.textFaint;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mapX(-geom.width / 2 - 1), mapY(0));
  ctx.lineTo(mapX(geom.width / 2 + 1), mapY(0));
  ctx.stroke();

  const colorFor = (kind: string) => {
    switch (kind) {
      case 'leg': return LEG_COLOR;
      case 'brace': return BRACE_COLOR;
      case 'belt': return BELT_COLOR;
      case 'peak': return PEAK_COLOR;
      case 'arm': return ARM_COLOR;
      default: return '#ffffff';
    }
  };

  ctx.lineCap = 'round';
  for (const seg of geom.segments) {
    ctx.strokeStyle = colorFor(seg.kind);
    ctx.lineWidth = seg.kind === 'leg' ? 2.5 : 1.2;
    ctx.beginPath();
    ctx.moveTo(mapX(seg.from.x), mapY(seg.from.y));
    ctx.lineTo(mapX(seg.to.x), mapY(seg.to.y));
    ctx.stroke();
  }

  // Base support markers
  ctx.fillStyle = SUPPORT_COLOR;
  for (const b of geom.baseNodes) {
    ctx.beginPath();
    ctx.arc(mapX(b.x), mapY(b.y), 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Apex
  if (geom.apex.y > 0) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(mapX(geom.apex.x), mapY(geom.apex.y), 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

const ElevationPreview = ({ geom }: { geom: ElevationGeometry | null }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawElevation(ref.current, geom);
  }, [geom]);
  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
    </Box>
  );
};

const TowerGeneratorDialog = observer(({ open, onClose }: TowerGeneratorProps) => {
  const model = useModel();
  const [p, setP] = useState<any>({ ...defaults });

  const set = (key: string) => (e: any) => {
    const val = e?.target?.value ?? e;
    setP((prev: any) => ({ ...prev, [key]: val }));
  };
  const setBool = (key: string) => (e: any) => setP((prev: any) => ({ ...prev, [key]: e.target.checked }));
  const num = (key: string) => Number(p[key]);

  const sectionOptions = (model?.sections ?? []).map((s: any) => ({ id: s.id, name: s.name }));

  const totalHeight = (Number(p.bodyHeight) || 0) + (Number(p.peakHeight) || 0);

  const elevation = useMemo(() => {
    try {
      return generateTowerElevation({
        circuit: p.circuit,
        bodyHeight: Number(p.bodyHeight) || 0,
        peakHeight: Number(p.peakHeight) || 0,
        baseWidth: Number(p.baseWidth) || 0,
        topWidth: Number(p.topWidth) || 0,
        panelCount: Math.max(1, Number(p.panelCount) || 1),
        straightPanels: Math.max(0, Number(p.straightPanels) || 0),
        taper: p.taper,
        armCount: Number(p.armCount) || 0,
        armLength: Number(p.armLength) || 0,
        armDrop: Number(p.armDrop) || 0,
        armSpacing: Number(p.armSpacing) || 0,
      });
    } catch {
      return null;
    }
  }, [p]);

  const handleGenerate = () => {
    if (!model) return;
    const bodyHeight = num('bodyHeight');
    const peakHeight = num('peakHeight');
    const baseWidth = num('baseWidth');
    const topWidth = num('topWidth');
    const panelCount = num('panelCount');
    const straightPanels = Math.max(0, Math.round(num('straightPanels')));
    const armCount = num('armCount');
    const armLength = num('armLength');

    if (!(bodyHeight > 0)) return toast.error('Body height must be > 0 m');
    if (!(peakHeight >= 0)) return toast.error('Peak height must be >= 0 m');
    if (!(baseWidth > 0)) return toast.error('Base width must be > 0 m');
    if (!(topWidth > 0 && topWidth < baseWidth)) return toast.error('Top width must be > 0 and smaller than base width');
    if (!(panelCount >= 1)) return toast.error('Panels must be >= 1');
    if (!(straightPanels >= 0 && straightPanels < panelCount)) return toast.error('Straight head panels must be 0..panelCount-1');
    if (!(armCount >= 0 && armCount <= 3)) return toast.error('Arms per side must be 0..3');
    if (!(armLength > 0)) return toast.error('Arm length must be > 0 m');
    if (!p.legSectionId) return toast.error('Choose a section for the main (leg) members');
    if (!p.braceSectionId) return toast.error('Choose a section for the diagonal (brace) members');

    try {
      const res = generateTower(model, {
        circuit: p.circuit,
        bodyHeight,
        peakHeight,
        baseWidth,
        topWidth,
        panelCount,
        straightPanels,
        taper: p.taper,
        armCount,
        armLength,
        armDrop: num('armDrop'),
        armSpacing: num('armSpacing'),
        legSectionId: Number(p.legSectionId),
        braceSectionId: Number(p.braceSectionId),
        autoSupports: !!p.autoSupports,
        supportKind: p.supportKind,
        autoLoads: !!p.autoLoads,
        windVector: { x: num('windX'), y: num('windY'), z: num('windZ') },
        windForce: num('windForce'),
      });
      toast.success(
        `Tower generated — ${res.nodes} nodes, ${res.members} members` +
          (res.supports ? `, ${res.supports} supports` : '') +
          (res.loads ? `, ${res.loads} loads` : ''),
      );
      onClose();
    } catch (e: any) {
      toast.error(e?.message || 'Tower generation failed');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth={false} draggable title="Tower generator (500 kV)">
      <Stack direction="row" spacing={2} alignItems="stretch">
        {/* ── Left: input columns ── */}
        <Stack spacing={0.5} sx={{ width: '320px', flexShrink: 0 }}>
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
              <Typography sx={fieldLabelSx}>Straight head panels (tầng 2)</Typography>
              <TextField value={p.straightPanels} onChange={set('straightPanels')} name="straightPanels" placeholder="" size="small" fullWidth />
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
            <Typography sx={fieldLabelSx}>Main members (legs / peak)</Typography>
            <Select
              label={''}
              list={sectionOptions}
              value={p.legSectionId === '' ? '' : Number(p.legSectionId)}
              onChange={set('legSectionId')}
              size="small"
            />
          </Box>
          <Box sx={{ pt: 0.5 }}>
            <Typography sx={fieldLabelSx}>Diagonal members (braces / belts / arms)</Typography>
            <Select
              label={''}
              list={sectionOptions}
              value={p.braceSectionId === '' ? '' : Number(p.braceSectionId)}
              onChange={set('braceSectionId')}
              size="small"
            />
          </Box>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, pt: 0.5 }}>
            <FormControlLabel
              sx={{ fontSize: '0.8rem' }}
              control={<Checkbox size="small" checked={!!p.autoSupports} onChange={setBool('autoSupports')} />}
              label="Auto supports at base"
            />
            {p.autoSupports && (
              <Box sx={{ width: '110px' }}>
                <Select
                  label={''}
                  list={[{ id: 'pinned', name: 'Pinned' }, { id: 'fixed', name: 'Fixed' }]}
                  value={p.supportKind}
                  onChange={set('supportKind')}
                  size="small"
                />
              </Box>
            )}
          </Box>

          <Box>
            <FormControlLabel
              sx={{ fontSize: '0.8rem' }}
              control={<Checkbox size="small" checked={!!p.autoLoads} onChange={setBool('autoLoads')} />}
              label="Auto loads (self-weight + wind)"
            />
          </Box>

          {p.autoLoads && (
            <Grid container spacing={1} alignItems="center">
              <Grid item xs={4}>
                <Typography sx={fieldLabelSx}>Wind X</Typography>
                <TextField value={p.windX} onChange={set('windX')} name="windX" placeholder="" size="small" fullWidth />
              </Grid>
              <Grid item xs={4}>
                <Typography sx={fieldLabelSx}>Wind Y</Typography>
                <TextField value={p.windY} onChange={set('windY')} name="windY" placeholder="" size="small" fullWidth />
              </Grid>
              <Grid item xs={4}>
                <Typography sx={fieldLabelSx}>Wind Z</Typography>
                <TextField value={p.windZ} onChange={set('windZ')} name="windZ" placeholder="" size="small" fullWidth />
              </Grid>
              <Grid item xs={12}>
                <Typography sx={fieldLabelSx}>Wind magnitude (kN per node)</Typography>
                <TextField value={p.windForce} onChange={set('windForce')} name="windForce" placeholder="" size="small" fullWidth />
              </Grid>
            </Grid>
          )}

          <Typography sx={{ fontSize: '0.7rem', color: colors.textFaint }}>
            Total height: {totalHeight.toFixed(1)} m — body {Number(p.bodyHeight) || 0} m + peak {Number(p.peakHeight) || 0} m.
            Two-part body: {Math.max(0, Number(p.panelCount) || 0) - (Math.max(0, Math.round(Number(p.straightPanels) || 0)))} tapering panels below, {Math.max(0, Math.round(Number(p.straightPanels) || 0))} straight head panels above. Arms attach to the straight head only.
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

        {/* ── Right: 2D elevation preview ── */}
        <Box
          sx={{
            border: `1px solid ${colors.surfaceAlt}`,
            borderRadius: '6px',
            height: '520px',
            width: '340px',
            overflow: 'hidden',
          }}
        >
          <ElevationPreview geom={elevation} />
        </Box>
      </Stack>
    </Dialog>
  );
});

export default TowerGeneratorDialog;