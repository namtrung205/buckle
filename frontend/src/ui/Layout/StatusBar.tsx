import { Box, MenuItem, Select, Typography } from '@mui/material';
import { useModel } from '../../model/Context';
import { observer } from 'mobx-react-lite';
import { colors, fontFamily } from '../../theme';

/**
 * Global unit system — the single place units are referenced.
 * Every value displayed elsewhere (tags, legend, tables) is a plain number.
 */
const UNIT_ITEMS: { label: string; unit: string; diagramTypes?: string[] }[] = [
  { label: 'Length', unit: 'm' },
  { label: 'Force', unit: 'kN', diagramTypes: ['N', 'Vy', 'Vz', 'T'] },
  { label: 'Moment', unit: 'kNm', diagramTypes: ['My', 'Mz'] },
  { label: 'Displacement', unit: 'mm', diagramTypes: ['defl'] },
  { label: 'Rotation', unit: 'rad' },
];

const StatusBar = () => {
  const model = useModel();
  
  const nodesCount = model?.selectedNodeIds.length ?? 0;
  const membersCount = model?.selectedMemberIds.length ?? 0;
  const shellsCount = model?.selectedShellIds.length ?? 0;

  // Highlight the unit matching the active results diagram (if any)
  const activeType: string | null = model?.postProcessing?.activeType ?? null;

  return (
    <Box
      sx={{
        height: '28px',
        backgroundColor: colors.surface,
        borderTop: '1px solid ' + colors.border,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 2,
        fontSize: '0.7rem',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography sx={{ fontSize: '0.7rem', color: colors.textDim, fontWeight: 500 }}>
            U N I T S :
          </Typography>
          {UNIT_ITEMS.map(item => {
            const isActive = activeType != null && !!item.diagramTypes?.includes(activeType);
            const color = isActive ? colors.accent : colors.textDim;
            return (
              <Typography
                key={item.label}
                sx={{ fontSize: '0.7rem', color, fontWeight: isActive ? 700 : 500, fontFamily }}
              >
                {item.label}: <Box component="span" sx={{ color: isActive ? colors.accent : colors.text }}>{item.unit}</Box>
              </Typography>
            );
          })}
        </Box>

        {(nodesCount > 0 || membersCount > 0 || shellsCount > 0) && (
          <>
            <Typography sx={{ fontSize: '0.7rem', color: colors.textDim, fontWeight: 500 }}>
              S E L E C T I O N :
            </Typography>
            {nodesCount > 0 && (
              <Typography sx={{ fontSize: '0.7rem', color: colors.secondary, fontWeight: 500, fontFamily }}>
                {nodesCount} Node{nodesCount > 1 ? 's' : ''}
              </Typography>
            )}
            {membersCount > 0 && (
              <Typography sx={{ fontSize: '0.7rem', color: colors.accent, fontWeight: 500, fontFamily }}>
                {membersCount} Member{membersCount > 1 ? 's' : ''}
              </Typography>
            )}
            {shellsCount > 0 && (
              <Typography sx={{ fontSize: '0.7rem', color: colors.secondary, fontWeight: 500, fontFamily }}>
                {shellsCount} Shell{shellsCount > 1 ? 's' : ''}
              </Typography>
            )}
          </>
        )}
      </Box>

      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Typography sx={{ fontSize: '0.7rem', color: colors.textDim, fontWeight: 500 }}>
          SELECT MODE:
        </Typography>
        <Select
          value={model?.selectionMode ?? 'element1d'}
          onChange={(event) => model?.setSelectionMode(event.target.value as 'node' | 'element1d' | 'shell2d')}
          variant="standard"
          disableUnderline
          inputProps={{ 'aria-label': 'Select mode' }}
          sx={{
            minWidth: 92,
            height: 22,
            color: colors.text,
            fontSize: '0.7rem',
            fontFamily,
            '& .MuiSelect-select': { py: 0, pr: '22px !important' },
            '& .MuiSvgIcon-root': { color: colors.textDim, fontSize: 16 },
          }}
        >
          <MenuItem value="node">Node</MenuItem>
          <MenuItem value="element1d">Element (1D)</MenuItem>
          <MenuItem value="shell2d">Shell (2D)</MenuItem>
        </Select>
        <Typography
          sx={{
            fontSize: '0.7rem',
            color: colors.text,
            fontWeight: 500,
            fontFamily,
          }}
        >
          X: {model?.pointerCoords.x.toFixed(2)} Y: {model?.pointerCoords.y.toFixed(2)} Z: {model?.pointerCoords.z.toFixed(2)}
        </Typography>
      </Box>
    </Box>
  );
};

export default observer(StatusBar);

