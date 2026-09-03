import { useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { observer } from 'mobx-react-lite';
import { useModel } from '../../../model/Context';
import Dialog from '../../../components/Dialog/Dialog';
import Select from '../../../components/Select';
import { colors, fieldLabelSx } from '../../../theme';
import { WorkPlaneAxes } from '../../../model/Geometry/WorkingPlane/WorkingPlane';

interface WorkPlaneDialogProps {
  open: boolean;
  onClose: () => void;
}

/* ── shared inline input styling (matches the other model dialogs) ────────── */
const INLINE_INPUT_SX = {
  width: '100%',
  boxSizing: 'border-box' as const,
  padding: '5px 8px',
  borderRadius: '4px',
  border: `1px solid ${colors.borderDark}`,
  background: colors.surfaceAlt,
  color: colors.text,
  fontSize: '0.82rem',
  outline: 'none',
  textAlign: 'right' as const,
};

const AXES_OPTIONS = [
  { id: 'OXY', name: 'OXY — Plan (nằm ngang)' },
  { id: 'OXZ', name: 'OXZ — Mặt đứng' },
  { id: 'OYZ', name: 'OYZ — Mặt đứng' },
];

const num = (v: string | number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const WorkPlaneDialog = observer(({ open, onClose }: WorkPlaneDialogProps) => {
  const model = useModel();
  const [axes, setAxes] = useState<WorkPlaneAxes>('OXY');
  const [offset, setOffset] = useState(0);
  const [level, setLevel] = useState<number | null>(model?.levels?.[0]?.value ?? 0);
  const [gridId, setGridId] = useState<number | null>(null);
  const [gridLineId, setGridLineId] = useState<string>('');

  const wp = model?.workingPlane ?? null;
  const picker = model?.toolsController.getTool('planePick');
  const pickCount = (picker as { points?: unknown[] } | undefined)?.points?.length ?? 0;
  const picking = (picker as { state?: number } | undefined)?.state === 1;

  const applyAxes = () => {
    if (!wp) return;
    wp.setAxes(axes, num(offset));
  };

  const applyLevel = () => {
    if (!wp || level == null) return;
    const lv = model?.levels.find((l) => l.value === level);
    if (lv) wp.setLevel(lv.value, lv.label);
  };

  const applyGrid = () => {
    if (!wp || gridId == null) return;
    const g = model?.grids.find((gg) => gg.id === gridId);
    if (!g) return;
    const opt = gridLineOptions.find((o) => o.id === gridLineId);
    if (opt) wp.setGridLine(g.name, opt.axis, opt.label, opt.coord);
  };

  const reset = () => wp?.setWorld();

  const startPick = () => model?.toolsController.activate('planePick');
  const cancelPick = () => model?.toolsController.deactivate();

  const close = () => {
    if (picking) model?.toolsController.deactivate();
    onClose();
  };

  const levelOptions = (model?.levels || []).map((lv) => ({ id: lv.value, name: lv.label }));
  const gridOptions = (model?.grids || []).map((g) => ({ id: g.id, name: g.name }));

  // Axis lines of the selected grid — each becomes a VERTICAL working plane.
  const gridLineOptions: { id: string; name: string; axis: 'X' | 'Y'; label: string; coord: number }[] = (() => {
    const g = model?.grids.find((gg) => gg.id === gridId);
    if (!g) return [];
    return [
      ...g.xLines.map((l) => ({ id: `X-${l.label}`, name: `X · ${l.label} — OYZ x=${l.coord}`, axis: 'X' as const, label: l.label, coord: l.coord })),
      ...g.yLines.map((l) => ({ id: `Y-${l.label}`, name: `Y · ${l.label} — OXZ z=${l.coord}`, axis: 'Y' as const, label: l.label, coord: l.coord })),
    ];
  })();

  const handleGridChange = (id: number) => {
    setGridId(id);
    const g = model?.grids.find((gg) => gg.id === id);
    const first = g?.xLines[0] || g?.yLines[0];
    setGridLineId(g && first ? `${first.axis}-${first.label}` : '');
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" draggable title="Working Plane"
      actions={null}>
      <Stack spacing={1.5}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.75, borderRadius: '6px', border: `1px solid ${colors.border}`, backgroundColor: 'rgba(0,0,0,0.12)' }}>
          <Typography sx={{ fontSize: '0.78rem', color: colors.textDim, fontWeight: 600, flexShrink: 0 }}>Active:</Typography>
          <Typography sx={{ fontSize: '0.82rem', color: colors.accentSoft, fontWeight: 600, fontFamily: '"Consolas", "Roboto Mono", ui-monospace, monospace' }}>
            {wp?.label ?? '—'}
          </Typography>
        </Box>
{/* ── plane by axis pair ── */}
        <Box>
          <Typography sx={fieldLabelSx}>By axis pair</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Box sx={{ flex: 2 }}>
              <Select
                label=""
                size="small"
                list={AXES_OPTIONS}
                value={axes}
                onChange={(e: { target: { value: string } }) => setAxes(e.target.value as WorkPlaneAxes)}
              />
            </Box>
            <Box sx={{ flex: 1 }}>
              <input
                type="number"
                value={offset}
                onChange={(e) => setOffset(num(e.target.value))}
                style={INLINE_INPUT_SX}
                title="Offset along the remaining (normal) axis, in metres"
              />
            </Box>
            <Button size="small" variant="contained" disableElevation onClick={applyAxes} sx={{ minWidth: 0, px: 1.25 }}>
              Apply
            </Button>
          </Box>
        </Box>

        {/* ── plane by level ── */}
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
          <Box sx={{ flex: 1 }}>
            <Typography sx={fieldLabelSx}>By level (horizontal)</Typography>
            <Select
              label=""
              size="small"
              list={levelOptions}
              value={level}
              onChange={(e: { target: { value: string } }) => setLevel(Number(e.target.value))}
            />
          </Box>
          <Button size="small" variant="contained" disableElevation onClick={applyLevel} sx={{ minWidth: 0, px: 1.25 }}>
            Apply
          </Button>
        </Box>

        {/* ── plane by grid system axis (VERITCAL plane along a grid line) ── */}
        <Box>
          <Typography sx={fieldLabelSx}>By structural grid axis</Typography>
          <Typography sx={{ fontSize: '0.7rem', color: colors.textFaint, lineHeight: 1.4, mb: 0.75 }}>
            Each grid axis (A, B, C… / 1, 2, 3…) is a VERTICAL plane standing on that line — pick which axis to draw on.
          </Typography>
          <Stack spacing={1}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ ...fieldLabelSx, mb: 0.25 }}>Grid</Typography>
                <Select
                  label=""
                  size="small"
                  list={gridOptions}
                  value={gridId}
                  onChange={(e: { target: { value: string } }) => handleGridChange(Number(e.target.value))}
                />
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
              <Box sx={{ flex: 2 }}>
                <Typography sx={{ ...fieldLabelSx, mb: 0.25 }}>Axis</Typography>
                <Select
                  label=""
                  size="small"
                  list={gridLineOptions}
                  value={gridLineId}
                  onChange={(e: { target: { value: string } }) => setGridLineId(e.target.value)}
                />
              </Box>
              <Button size="small" variant="contained" disableElevation onClick={applyGrid} sx={{ minWidth: 0, px: 1.25 }}>
                Apply
              </Button>
            </Box>
          </Stack>
        </Box>

        {/* ── plane by three points ── */}
        <Box>
          <Typography sx={fieldLabelSx}>By three points</Typography>
          <Typography sx={{ fontSize: '0.7rem', color: colors.textFaint, lineHeight: 1.4, mb: 0.75 }}>
            Click three points on the current plane (snap to nodes / grid). The plane through them becomes the working plane.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              size="small"
              variant={picking ? 'outlined' : 'contained'}
              disableElevation
              onClick={picking ? cancelPick : startPick}
              sx={{ flex: 1 }}
            >
              {picking ? `Picking… ${pickCount}/3` : 'Pick 3 points'}
            </Button>
          </Box>
        </Box>

        <Button size="small" variant="text" onClick={reset} sx={{ alignSelf: 'flex-start', color: colors.textDim }}>
          Reset to OXY plan
        </Button>
      </Stack>
    </Dialog>
  );
});

export default WorkPlaneDialog;