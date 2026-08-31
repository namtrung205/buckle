import { useState, MouseEvent } from 'react';
import {
  Box,
  IconButton,
  Tooltip,
  Divider,
  Menu,
  MenuItem,
} from '@mui/material';
import {
  ZoomIn,
  FitScreen,
  Crop54,
  KeyboardArrowDown,
  PanTool,
  ThreeDRotation,
  Mouse,
  Check,
} from '@mui/icons-material';
import { observer } from 'mobx-react-lite';
import { useModel } from '../../model/Context';
import { colors } from '../../theme';
import { NavTool, ZoomMode } from '../../types';

interface ZoomOption {
  mode: ZoomMode;
  label: string;
  title: string;
  Icon: typeof ZoomIn;
}

const ZOOM_OPTIONS: ZoomOption[] = [
  { mode: 'fit', label: 'Zoom Fit', title: 'Fit the whole model into the viewport', Icon: FitScreen },
  { mode: 'window', label: 'Zoom Window', title: 'Drag a window to zoom into that region', Icon: Crop54 },
  { mode: 'drag', label: 'Drag up / down', title: 'Drag the left button up / down to zoom continuously', Icon: ZoomIn },
];

const zoomOption = (mode: ZoomMode): ZoomOption =>
  ZOOM_OPTIONS.find(option => option.mode === mode) ?? ZOOM_OPTIONS[0];

const activeStyle = (active: boolean) => ({
  color: active ? colors.text : colors.text,
  width: 30,
  height: 30,
  borderRadius: 1.5,
  backgroundColor: active ? colors.accent : 'transparent',
  '&:hover': {
    bgcolor: active ? colors.accentHover : colors.hover,
  },
});

/**
 * Bottom navigation bar with two panels:
 *  - Panel 1 "Navigate": Zoom (split button: fit / window / drag), Pan, Orbit
 *  - Panel 2 "Select"  : mouse selection (pick + window selection)
 */
const BottomBar = observer(() => {
  const model = useModel();
  const [zoomAnchor, setZoomAnchor] = useState<null | HTMLElement>(null);

  // model is null on the very first render (provided by Viewer via Model.getInstance())
  if (!model) return null;

  const navTool = model.navTool;
  const zoomMode = model.zoomTool.mode;
  const zoom = zoomOption(zoomMode);
  const isActive = (tool: NavTool) => navTool === tool;

  const selectNavTool = (tool: NavTool) => {
    model.setNavTool(tool);
  };

  const handleZoomClick = () => {
    if (navTool === 'zoom') {
      // Re-trigger the active zoom sub-tool (re-fits for "fit", re-arms drag/window)
      model.zoomTool.start();
    } else {
      model.setNavTool('zoom');
    }
  };

  const handleZoomMenuClose = () => {
    setZoomAnchor(null);
  };

  const handleZoomModeSelect = (mode: ZoomMode) => {
    model.zoomTool.setMode(mode);
    setZoomAnchor(null);
    // Activate zoom tool if it was not active — otherwise setMode re-arms it.
    if (navTool !== 'zoom') {
      model.setNavTool('zoom');
    }
  };

  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1200,
        pointerEvents: 'none',
      }}
    >
      <Box
        sx={{
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1,
          py: 0.5,
          backgroundColor: 'rgba(45, 45, 45, 0.92)',
          backdropFilter: 'blur(4px)',
          borderRadius: '18px',
          border: '1px solid ' + colors.border,
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
        }}
      >
        <Tooltip title="Select — click to pick objects, drag to window-select">
          <IconButton onClick={() => selectNavTool('select')} sx={activeStyle(isActive('select'))}>
            <Mouse sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>

        <Divider orientation="vertical" flexItem sx={{ bgcolor: colors.border, mx: 0.5 }} />

        {/* Zoom split button */}
        <Tooltip title={`Zoom — ${zoom.title}`}>
          <IconButton onClick={handleZoomClick} sx={activeStyle(isActive('zoom'))}>
            <zoom.Icon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Zoom options">
          <IconButton
            onClick={(event: MouseEvent<HTMLElement>) => setZoomAnchor(event.currentTarget)}
            size="small"
            sx={{
              color: colors.text,
              width: 16,
              height: 30,
              p: 0,
              mr: 0.5,
              borderRadius: 1.5,
              '&:hover': { bgcolor: colors.hover },
            }}
          >
            <KeyboardArrowDown sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
        <Menu
          anchorEl={zoomAnchor}
          open={Boolean(zoomAnchor)}
          onClose={handleZoomMenuClose}
          anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
          transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          slotProps={{
            paper: {
              sx: {
                backgroundColor: colors.surface,
                color: colors.text,
                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.5)',
                minWidth: '64px',
              },
            },
          }}
        >
          {ZOOM_OPTIONS.map(option => (
            <MenuItem
              key={option.mode}
              selected={zoomMode === option.mode}
              onClick={() => handleZoomModeSelect(option.mode)}
              sx={{
                '&:hover': { backgroundColor: colors.hover },
                justifyContent: 'space-between',
                gap: 1,
              }}
            >
              <Tooltip title={option.title}>
                <option.Icon sx={{ fontSize: 18, color: colors.text }} />
              </Tooltip>
              {zoomMode === option.mode && <Check sx={{ color: colors.accent, fontSize: 16 }} />}
            </MenuItem>
          ))}
        </Menu>

        <Tooltip title="Pan — drag with the left button">
          <IconButton onClick={() => selectNavTool('pan')} sx={activeStyle(isActive('pan'))}>
            <PanTool sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Orbit — rotate the view in 3D">
          <IconButton onClick={() => selectNavTool('orbit')} sx={activeStyle(isActive('orbit'))}>
            <ThreeDRotation sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
});

export default BottomBar;