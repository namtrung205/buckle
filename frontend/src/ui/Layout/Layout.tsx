import { ReactNode, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Box } from '@mui/material';
import { colors } from '../../theme';
import { useModel } from '../../model/Context';
import TopBar from './TopBar';
import LeftBar from './LeftBar';
import RightPanel from './RightPanel';
import BottomBar from '../BottomBar';
import StatusBar from './StatusBar';
import ContextMenu from './ContextMenu';

interface LayoutProps {
  children: ReactNode;
}

const Layout = observer(({ children }: LayoutProps) => {
  const [isLeftBarCollapsed, setIsLeftBarCollapsed] = useState(false);
  const model = useModel();

  const handleMenuClick = () => {
    setIsLeftBarCollapsed(!isLeftBarCollapsed);
  };

  return (
    <Box
      sx={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: colors.bg,
      }}
    >
      {/* Top Bar (Ribbon) */}
      <TopBar onMenuClick={handleMenuClick} />

      {/* Main content area with left bar */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        {/* Left Bar */}
        <LeftBar isCollapsed={isLeftBarCollapsed} />

        {/* Content area - AutoCAD-style dark blue-black background for the viewer */}
        <Box
          sx={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            backgroundColor: colors.bg,
          }}
        >
          {children}

          {/* Floating centered bottom toolbar (Zoom / Pan / Orbit / Select) */}
          <BottomBar />
        </Box>

        {/* Right dock panel — inline properties for the focused entity, Results, or Draw */}
        {(model?.hasFocus() || model?.activeDialog === 'results' || model?.activeDialog === 'reactions' || model?.activeDialog === 'draw') && <RightPanel />}
      </Box>

      {/* Bottom Status Bar */}
      <StatusBar />
      <ContextMenu />
    </Box>
  );
});

export default Layout;