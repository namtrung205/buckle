import { ReactNode, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Box } from '@mui/material';
import { colors } from '../../theme';
import { useModel } from '../../model/Context';
import TopBar from './TopBar';
import LeftBar from './LeftBar';
import RightPanel from './RightPanel';
import BottomBar from '../BottomBar';
import Legend from '../Results/Components/Legend/Legend';
import FpsOverlay from './FpsOverlay';
import StatusBar from './StatusBar';
import ContextMenu from './ContextMenu';
import CopilotPanel from '../Copilot/CopilotPanel';
import ContributionPanelHost from './ContributionPanelHost';
import SampleWindLoad from '../../extensions/sampleWindLoad';
import SampleDrawMember from '../../extensions/sampleDrawMember';
import SampleParametricTruss from '../../extensions/sampleParametricTruss';
import PluginSecurityCenter from './PluginSecurityCenter';

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
      {/* Built-in sample extension — contributes its own ribbon tab/button and
          dock panel through the contribution registry without touching TopBar. */}
      <SampleWindLoad />
      <SampleDrawMember />
      <SampleParametricTruss />
      {/* Goal 6: live plugin audit, metrics and the emergency kill switch. */}
      <PluginSecurityCenter />

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

          {/* Contour legend floating over the viewer — colour bar + min/max and
              the members that carry them (display-only, no pointer events) */}
          <Legend />

          {/* FPS readout (Settings → View → Show FPS) */}
          <FpsOverlay />
        </Box>

        {/* Right dock panel — inline properties for the focused entity, Results, or Draw */}
        {(model?.hasFocus() || model?.activeDialog === 'results' || model?.activeDialog === 'reactions' || model?.activeDialog === 'draw') && <RightPanel />}
        <ContributionPanelHost />
      </Box>

      {/* Bottom Status Bar */}
      <StatusBar />
      <ContextMenu />
      {model && <CopilotPanel />}
    </Box>
  );
});

export default Layout;
