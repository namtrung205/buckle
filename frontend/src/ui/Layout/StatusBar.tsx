import { Box, Typography } from '@mui/material';
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
  
  const selectedMeshes = model?.selector.selected || [];
  let nodesCount = 0;
  let membersCount = 0;

  selectedMeshes.forEach(item => {
    let type = item.object.userData?.type;
    if (!type && item.object.parent) {
      type = item.object.parent.userData?.type;
    }
    if (type === 'node') nodesCount++;
    if (type === 'elasticBeamColumn') membersCount++;
  });

  // Highlight the unit matching the active results diagram (if any)
  const activeType: string | null = model?.postProcessing?.activeType ?? null;

  return (
    <Box
      sx={{
        height: '24px',
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

        {(nodesCount > 0 || membersCount > 0) && (
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
          </>
        )}
      </Box>

      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>
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

