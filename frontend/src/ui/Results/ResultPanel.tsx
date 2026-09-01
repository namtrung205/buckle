import { useState } from 'react';
import { Box, IconButton, Tab, Tabs, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { observer } from 'mobx-react-lite';
import { useModel } from '../../model/Context';
import { colors, fontFamily } from '../../theme';
import Reactions from './Components/Reactions/Reactions';
import Diagrams from './Components/Diagrams/Diagrams';

interface ResultPanelProps {
  onClose: () => void;
}

/**
 * Results dock panel (left edge of the viewer) with 3 tabs: Reactions,
 * Forces (internal force diagrams N..Mz) and Deformation (deflected shape).
 * Replaces the old floating 'Results' / 'Reactions' dialogs;the ribbon buttons
 * open this panel on the matching tab (Results → Forces, Reactions → Reactions).
 */
const ResultPanel = observer(({ onClose }: ResultPanelProps) => {
  const model = useModel();

  // Tab 0 = Reactions, tab 1 = Forces, tab 2 = Deformation. The initial
  // tab follows the ribbon button that opened the panel.
  const [tab, setTab] = useState<number>(model?.activeDialog === 'reactions' ? 0 : 1);

  return (
    <Box
      sx={{
        position: 'absolute',
        left:  0,
        top:  0,
        bottom:  0,
        width:  380,
        zIndex:  40,
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'auto',
        backgroundColor: colors.surface,
        borderRight: `1px solid ${colors.border}`,
        boxShadow: '4px 0 16px rgba(0, 0, 0, 0.35)',
      }}
    >
      {/* Header + close */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink:  0, px:  1.5, py:  1, borderBottom: `1px solid ${colors.border}`, backgroundColor: colors.surface }}>
        <Typography sx={{ color: colors.text, fontSize: '0.85rem', fontWeight: 600, fontFamily }}>
          Results
        </Typography>
        <IconButton aria-label="close" onClick={onClose} size="small" sx={{ color: colors.textDim, '&:hover': { color: colors.text, backgroundColor: colors.hover } }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Tab bar */}
      <Tabs
        value={tab}
        onChange={(_e, value) => setTab(value as number)}
        variant="fullWidth"
        sx={{
          minHeight: 36,
          flexShrink: 0,
          borderBottom: `1px solid ${colors.border}`,
          backgroundColor: colors.surface,
          '& .MuiTab-root': {
            minHeight: 36,
            fontSize: '0.75rem',
            textTransform: 'none',
            fontFamily,
            color: colors.textFaint,
            '&.Mui-selected': { color: colors.accentSoft },
          },
          '& .MuiTabs-indicator': { backgroundColor: colors.accent, height: 2 },
        }}
      >
        <Tab label="Reactions" />
        <Tab label="Forces" />
        <Tab label="Deformation" />
      </Tabs>

      {/* Scrollable tab body */}
      <Box sx={{ p: 2, overflowY: 'auto', flex:  1 }}>
        {tab === 0 && <Reactions />}
        {tab === 1 && <Diagrams variant="forces" />}
        {tab === 2 && <Diagrams variant="deformation" />}
      </Box>
    </Box>
  );
});

export default ResultPanel;