import { useEffect, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { observer } from 'mobx-react-lite';
import { useModel } from '../../../model/Context';
import Dialog from '../../../components/Dialog/Dialog';
import Select from '../../../components/Select';
import { colors, fieldLabelSx } from '../../../theme';
import { Level } from '../../../types';

interface AddOrEditProps {
  open: boolean;
  onClose: () => void;
  /** Level to edit, or null to create a new one (Revit-style, based on an existing level + offset). */
  level: Level | null;
}

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

/**
 * Level dialog — create / edit a Revit-style level datum.
 *
 * New levels are created "based on" an existing level with an offset (Revit
 * default behaviour). The elevation is always shown and editable directly too.
 */
const AddOrEdit = observer(({ open, onClose, level }: AddOrEditProps) => {
  const model = useModel();
  const [name, setName] = useState('');
  const [value, setValue] = useState(0);
  const [baseValue, setBaseValue] = useState<number | null>(null);
  const [offset, setOffset] = useState(3);

  const levels = model?.levels ?? [];

  // Prefill whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    if (level) {
      setName(level.label);
      setValue(level.value);
      setBaseValue(null);
      setOffset(3);
    } else {
      const base = levels[levels.length - 1] ?? { value: 0, label: '0' };
      setBaseValue(base.value);
      setName(`Level ${levels.length + 1}`);
      setValue(base.value + 3);
      setOffset(3);
    }
  }, [open, level]); // eslint-disable-line react-hooks/exhaustive-deps

  const setFromOffset = (ofs: number) => {
    setOffset(ofs);
    if (baseValue != null) setValue(baseValue + ofs);
  };

  const setFromValue = (v: number) => {
    setValue(v);
    if (baseValue != null) setOffset(v - baseValue);
  };

  const duplicate = levels.some(
    (l) => l.value === value && !(level && l.value === level.value && l.label === level.label),
  );

  const valid = name.trim() !== '' && !duplicate;

  const handleSave = () => {
    if (!model || !valid) return;
    if (level) {
      model.updateLevel(level.value, { value: num(value), label: name.trim() });
    } else {
      model.addLevel({ value: num(value), label: name.trim() || `Level ${levels.length + 1}` });
    }
    onClose();
  };

  const baseOptions = levels.map((l) => ({ id: l.value, name: `${l.label}  (${l.value})` }));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" draggable title={level ? 'Edit Level' : 'New Level'}
      actions={null}>
      <Stack spacing={1.5}>
        <Box>
          <Typography sx={fieldLabelSx}>Name</Typography>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Level 2"
            style={{ ...INLINE_INPUT_SX, textAlign: 'left' }}
          />
        </Box>

        {!level && (
          <Box>
            <Typography sx={fieldLabelSx}>Based on level</Typography>
            <Select
              label=""
              size="small"
              list={baseOptions}
              value={baseValue}
              onChange={(e: { target: { value: string } }) => {
                const v = Number(e.target.value);
                setBaseValue(v);
                setValue(v + num(offset));
              }}
            />
            <Typography sx={{ fontSize: '0.66rem', color: colors.textFaint, mt: 0.5 }}>
              Revit style: the new level is placed an offset above the base level.
            </Typography>
          </Box>
        )}

        {!level && (
          <Box>
            <Typography sx={fieldLabelSx}>Offset from base (m)</Typography>
            <input
              type="number"
              value={offset}
              onChange={(e) => setFromOffset(num(e.target.value))}
              style={INLINE_INPUT_SX}
            />
          </Box>
        )}

        <Box>
          <Typography sx={fieldLabelSx}>Elevation (m)</Typography>
          <input
            type="number"
            value={value}
            onChange={(e) => setFromValue(num(e.target.value))}
            style={INLINE_INPUT_SX}
          />
          {duplicate && (
            <Typography sx={{ fontSize: '0.68rem', color: colors.danger, mt: 0.5 }}>
              A level already exists at this elevation.
            </Typography>
          )}
        </Box>

        <Button variant="contained" size="small" disabled={!valid} onClick={handleSave}>
          {level ? 'Save changes' : 'Create level'}
        </Button>
      </Stack>
    </Dialog>
  );
});

export default AddOrEdit;