import { observer } from 'mobx-react-lite';
import { Box } from '@mui/material';
import { useModel } from '../../model/Context';
import { UI } from '../Results/Components/ui';

/**
 * On-screen FPS readout over the 3D viewer. Reads Model.fps, which the render
 * loop refreshes ~2×/s (Settings → View → Show FPS). Pure display — pointer
 * events pass through so orbit / pan / zoom keep working.
 */
const FpsOverlay = observer(() => {
  const model = useModel();
  if (!model || !model.showFps) return null;

  const low = model.fps > 0 && model.fps < 30;

  return (
    <Box
      sx={{
        position: 'absolute',
        top: 10,
        left: 10,
        zIndex: 45,
        px: 1,
        py: 0.4,
        borderRadius: 1,
        backgroundColor: 'rgba(33, 40, 48, 0.78)',
        border: '1px solid rgba(90, 100, 114, 0.45)',
        color: low ? UI.red : UI.text,
        fontFamily: UI.mono,
        fontSize: '11px',
        fontWeight: 600,
        lineHeight: 1.2,
        letterSpacing: '0.04em',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      FPS {model.fps > 0 ? model.fps : '–'}
    </Box>
  );
});

export default FpsOverlay;
