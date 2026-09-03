import { useEffect, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { observer } from 'mobx-react-lite';
import { useModel } from '../../../model/Context';
import Dialog from '../../../components/Dialog/Dialog';
import Select from '../../../components/Select';
import GridSystem, { GridDirectionSpec, GridSystemDef, resolveLines } from '../../../model/Grid/GridSystem';
import { colors, fieldLabelSx } from '../../../theme';

interface AddOrEditProps {
  open: boolean;
  onClose: () => void;
  /** Grid to edit, or null to create a new one. */
  grid: GridSystem | null;
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

const num = (v: string | number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const LABEL_STYLES = [
  { id: 'letters', name: 'A, B, C…' },
  { id: 'numbers', name: '1, 2, 3…' },
];

const GRID_MODES = [
  { id: 'equal', name: 'Equal spacing' },
  { id: 'list', name: 'Custom list' },
];

const defaultSpec = (labelStyle: 'letters' | 'numbers', spacing: number, count: number): GridDirectionSpec =>
  ({ labelStyle, mode: 'equal', start: 0, spacing, count, coords: [] });

const specValid = (s: GridDirectionSpec): boolean =>
  s.mode === 'equal' ? Math.floor(s.count) >= 1 && s.spacing > 0 : s.coords.length >= 1;

/** One grid direction (X or Y): label style, spacing mode and live preview. */
function DirectionEditor({ title, subtitle, spec, onChange }: {
  title: string;
  subtitle: string;
  spec: GridDirectionSpec;
  onChange: (next: GridDirectionSpec) => void;
}) {
  // Raw text for the 'list' mode input so the user can type freely.
  const [coordsText, setCoordsText] = useState(spec.coords.join(', '));

  // Re-sync the text box when the definition mode flips. Reopening the dialog
  // remounts this editor, so the initial state above covers the edit prefill.
  useEffect(() => {
    setCoordsText(spec.coords.join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.mode]);

  const applyCoords = (text: string) => {
    setCoordsText(text);
    const coords = text
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t !== '')
      .map(Number)
      .filter((n) => Number.isFinite(n));
    onChange({ ...spec, coords });
  };

  const preview = resolveLines(spec, 'X').map((l) => `${l.label}=${Math.round(l.coord * 100) / 100}`);

  return (
    <Box sx={{ border: `1px solid ${colors.border}`, borderRadius: '6px', p: 1.25, backgroundColor: 'rgba(0,0,0,0.12)' }}>
      <Typography sx={{ ...fieldLabelSx, mb: 0.75, color: colors.text, fontWeight: 600 }}>{title}</Typography>
      <Typography sx={{ fontSize: '0.68rem', color: colors.textFaint, mb: 1 }}>{subtitle}</Typography>
      <Stack spacing={1}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography sx={fieldLabelSx}>Labels</Typography>
          <Box sx={{ width: 150 }}>
            <Select
              label=""
              size="small"
              list={LABEL_STYLES}
              value={spec.labelStyle}
              onChange={(e: { target: { value: string } }) => onChange({ ...spec, labelStyle: e.target.value as GridDirectionSpec['labelStyle'] })}
            />
          </Box>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography sx={fieldLabelSx}>Definition</Typography>
          <Box sx={{ width: 150 }}>
            <Select
              label=""
              size="small"
              list={GRID_MODES}
              value={spec.mode}
              onChange={(e: { target: { value: string } }) => onChange({ ...spec, mode: e.target.value as GridDirectionSpec['mode'] })}
            />
          </Box>
        </Box>

        {spec.mode === 'equal' ? (
          <Box sx={{ display: 'flex', gap: 1 }}>
            {([
              ['Start', 'start'],
              ['Spacing', 'spacing'],
              ['Lines', 'count'],
            ] as const).map(([label, field]) => (
              <Box key={field} sx={{ flex: 1 }}>
                <Typography sx={{ ...fieldLabelSx, mb: 0.25 }}>{label}</Typography>
                <input
                  type="number"
                  value={spec[field]}
                  onChange={(e) => onChange({ ...spec, [field]: num(e.target.value) })}
                  style={INLINE_INPUT_SX}
                />
              </Box>
            ))}
          </Box>
        ) : (
          <Box>
            <Typography sx={{ ...fieldLabelSx, mb: 0.25 }}>Coordinates (comma separated, m)</Typography>
            <input
              type="text"
              value={coordsText}
              placeholder="0, 6, 12.5, 18"
              onChange={(e) => applyCoords(e.target.value)}
              style={{ ...INLINE_INPUT_SX, textAlign: 'left' }}
            />
          </Box>
        )}

        <Typography sx={{ fontSize: '0.68rem', color: colors.textFaint, fontFamily: '"Consolas", "Roboto Mono", ui-monospace, monospace' }}>
          {preview.length ? preview.join(' · ') : 'No lines'}
        </Typography>
      </Stack>
    </Box>
  );
}

/**
 * Grid system dialog (SAP2000/ETABS-style axis grids).
 *
 * Creates or edits a `GridSystem`: two families of axis lines declared by
 * X and Y direction (label style, equal spacing or a custom coordinate list),
 * plus the line extension past the grid bounds and the labelled end bubbles.
 */
const AddOrEdit = observer(({ open, onClose, grid }: AddOrEditProps) => {
  const model = useModel();

  const [name, setName] = useState('Grid 1');
  const [x, setX] = useState<GridDirectionSpec>(defaultSpec('letters', 6, 4));
  const [y, setY] = useState<GridDirectionSpec>(defaultSpec('numbers', 5, 3));
  const [extension, setExtension] = useState(3);
  const [showBubbles, setShowBubbles] = useState(true);

  // Prefill the form each time the dialog opens (new vs. edit).
  useEffect(() => {
    if (!open) return;
    if (grid) {
      setName(grid.name);
      setX({ ...grid.x, coords: [...grid.x.coords] });
      setY({ ...grid.y, coords: [...grid.y.coords] });
      setExtension(grid.extension);
      setShowBubbles(grid.showBubbles);
    } else {
      setName(`Grid ${(model?.grids?.length || 0) + 1}`);
      setX(defaultSpec('letters', 6, 4));
      setY(defaultSpec('numbers', 5, 3));
      setExtension(3);
      setShowBubbles(true);
    }
  }, [open, grid, model]);

  const valid = specValid(x) && specValid(y) && extension >= 0;

  const handleSave = () => {
    if (!model || !valid) return;
    const def: GridSystemDef = {
      id: grid?.id,
      name: name.trim() || 'Grid 1',
      x,
      y,
      extension: num(extension),
      showBubbles,
    };
    if (grid) {
      grid.applyDef(def);
    } else {
      new GridSystem(model, def).createOrUpdate();
    }
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" draggable title={grid ? 'Edit Grid' : 'New Grid'}
      actions={null}>
      <Stack spacing={1.5}>
        <Box>
          <Typography sx={fieldLabelSx}>Name</Typography>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Grid name"
            style={{ ...INLINE_INPUT_SX, textAlign: 'left' }}
          />
        </Box>

        <DirectionEditor
          title="Direction X"
          subtitle="Lines at successive x coordinates, running parallel to the Z axis."
          spec={x}
          onChange={setX}
        />

        <DirectionEditor
          title="Direction Y"
          subtitle="Lines at successive z coordinates, running parallel to the X axis."
          spec={y}
          onChange={setY}
        />

        <Box sx={{ display: 'flex', gap: 1 }}>
          <Box sx={{ flex: 1 }}>
            <Typography sx={fieldLabelSx}>Extend past grid (m)</Typography>
            <input
              type="number"
              value={extension}
              onChange={(e) => setExtension(num(e.target.value))}
              style={INLINE_INPUT_SX}
            />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography sx={fieldLabelSx}>End bubbles</Typography>
            <Select
              label=""
              size="small"
              list={[{ id: 'show', name: 'Show' }, { id: 'hide', name: 'Hide' }]}
              value={showBubbles ? 'show' : 'hide'}
              onChange={(e: { target: { value: string } }) => setShowBubbles(e.target.value === 'show')}
            />
          </Box>
        </Box>

        <Button variant="contained" size="small" disabled={!valid} onClick={handleSave}>
          {grid ? 'Save changes' : 'Create grid'}
        </Button>
      </Stack>
    </Dialog>
  );
});

export default AddOrEdit;