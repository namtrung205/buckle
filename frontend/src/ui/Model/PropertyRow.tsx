import React from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import {
  Apps as ProfileIcon,
  Edit as EditIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { colors } from '../../theme';

/**
 * A single editable property row, mirroring Stabileo's ElementDetails pattern:
 *
 *   [label]   [inline select / value]  [⊞] [✎] [+]
 *
 * The three icon buttons attach to the value: open the picker (⊞), edit the
 * current value (✎), or create a new one (+). This little cluster is the
 * hallmark of Stabileo's property panel and is kept consistent everywhere a
 * Material or Section is assigned.
 */
export interface PropertyRowActionHandlers {
  onPick?: () => void;
  onEdit?: () => void;
  onNew?: () => void;
}

interface PropertyRowProps {
  label: string;
  /** The inline select element (or a read-only value node). */
  children: React.ReactNode;
  handlers?: PropertyRowActionHandlers;
  /** Tooltip hints for the three buttons, in order: pick / edit / new. */
  titles?: { pick?: string; edit?: string; new?: string };
  disabled?: boolean;
}

const ICON_BTN_SX = {
  padding: '2px',
  minWidth: 0,
  width: 22,
  height: 22,
  color: colors.textDim,
  backgroundColor: colors.surfaceAlt,
  border: `1px solid ${colors.border}`,
  borderRadius: '3px',
  '&:hover': { backgroundColor: colors.hover, color: colors.text },
  '&.Mui-disabled': { color: colors.textFaint },
};

const PropertyRow: React.FC<PropertyRowProps> = ({ label, children, handlers, titles, disabled = false }) => {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: 0.5 }}>
      <Typography sx={{ fontSize: '0.8rem', color: colors.textDim, minWidth: 74, flexShrink: 0 }}>{label}</Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
      {handlers && (
        <Box sx={{ display: 'flex', gap: 0.25, flexShrink: 0 }}>
          {handlers.onPick && (
            <IconButton size="small" disabled={disabled} onClick={handlers.onPick} title={titles?.pick ?? 'Choose from catalogue'} sx={{ ...ICON_BTN_SX, color: colors.accentSoft }}>
              <ProfileIcon sx={{ fontSize: 15 }} />
            </IconButton>
          )}
          {handlers.onEdit && (
            <IconButton size="small" disabled={disabled} onClick={handlers.onEdit} title={titles?.edit ?? 'Edit'} sx={ICON_BTN_SX}>
              <EditIcon sx={{ fontSize: 15 }} />
            </IconButton>
          )}
          {handlers.onNew && (
            <IconButton size="small" disabled={disabled} onClick={handlers.onNew} title={titles?.new ?? 'New'} sx={ICON_BTN_SX}>
              <AddIcon sx={{ fontSize: 15 }} />
            </IconButton>
          )}
        </Box>
      )}
    </Box>
  );
};

export default PropertyRow;