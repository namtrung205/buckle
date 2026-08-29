import { ReactNode, useState } from 'react';
import { Box } from '@mui/material';
import TopBar from './TopBar';
import LeftBar from './LeftBar';
import BottomBar from '../BottomBar';
import StatusBar from './StatusBar';
import ContextMenu from './ContextMenu';

interface LayoutProps {
  children: ReactNode;
}

const Layout = ({ children }: LayoutProps) => {
  const [isLeftBarCollapsed, setIsLeftBarCollapsed] = useState(false);

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
        backgroundColor: '#f5f5f5',
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

        {/* Content area - White background for viewer */}
        <Box
          sx={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            backgroundColor: '#ffffff',
          }}
        >
          {children}

          {/* Floating centered bottom toolbar (Zoom / Pan / Orbit / Select) */}
          <BottomBar />
        </Box>
      </Box>

      {/* Bottom Status Bar */}
      <StatusBar />
      <ContextMenu />
    </Box>
  );
};

export default Layout;

