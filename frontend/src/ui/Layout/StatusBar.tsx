import { Box, Typography, Chip } from '@mui/material';
import { FiberManualRecord as DotIcon } from '@mui/icons-material';
import { useModel } from '../../model/Context';
import { observer } from 'mobx-react-lite';

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

  return (
    <Box
      sx={{
        height: '42px',
        backgroundColor: '#2d2d2d',
        borderTop: '2px solid #1e1e1e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 3,
        fontSize: '0.75rem',
        boxShadow: '0 -1px 3px rgba(0, 0, 0, 0.3)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        {(nodesCount > 0 || membersCount > 0) && (
          <>
            <Typography sx={{ fontSize: '0.75rem', color: '#a0a0a0', fontWeight: 500 }}>
              S E L E C T I O N :
            </Typography>
            {nodesCount > 0 && (
              <Typography sx={{ fontSize: '0.75rem', color: '#ffb300', fontWeight: 500, fontFamily: '"Inter", sans-serif' }}>
                {nodesCount} Node{nodesCount > 1 ? 's' : ''}
              </Typography>
            )}
            {membersCount > 0 && (
              <Typography sx={{ fontSize: '0.75rem', color: '#4fc3f7', fontWeight: 500, fontFamily: '"Inter", sans-serif' }}>
                {membersCount} Member{membersCount > 1 ? 's' : ''}
              </Typography>
            )}
          </>
        )}
      </Box>

      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>
        <Typography
          sx={{
            fontSize: '0.75rem',
            color: '#ffffff',
            fontWeight: 500,
            fontFamily: '"Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          }}
        >
          X: {model?.pointerCoords.x.toFixed(2)} Y: {model?.pointerCoords.y.toFixed(2)} Z: {model?.pointerCoords.z.toFixed(2)}
        </Typography>
      </Box>
    </Box>
  );
};

export default observer(StatusBar);

