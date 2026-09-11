import { Box, IconButton, Typography } from '@mui/material';
import { Close as CloseIcon, Extension as ExtensionIcon } from '@mui/icons-material';
import { useSyncExternalStore } from 'react';
import { useContributions } from '../../model/Context';
import { colors } from '../../theme';

/** Render an already-authorized rich panel in an origin-opaque iframe. */
const ContributionPanelHost = () => {
  const contributions = useContributions();
  useSyncExternalStore(contributions.subscribe, contributions.getSnapshot, contributions.getSnapshot);
  const panel = contributions.getActivePanel();
  if (!panel) return null;

  return (
    <Box
      data-contribution-panel={panel.id}
      sx={{
        width: 360, minWidth: 280, height: '100%', display: 'flex', flexDirection: 'column',
        borderLeft: `1px solid ${colors.border}`, backgroundColor: colors.surface, overflow: 'hidden',
      }}
    >
      <Box sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        px: 1.5, py: 0.75, borderBottom: `1px solid ${colors.divider}`,
      }}>
        <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '0.82rem', fontWeight: 600, color: colors.text }}>
          <ExtensionIcon sx={{ fontSize: 16, color: colors.accentSoft }} />
          {panel.title}
        </Typography>
        <IconButton
          size="small"
          aria-label={`Close ${panel.title}`}
          onClick={() => contributions.closePanel(panel.id)}
          sx={{ color: colors.textDim, '&:hover': { color: colors.text, backgroundColor: colors.hover } }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box
        component="iframe"
        title={panel.title}
        src={panel.entry}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        sx={{ flex: 1, width: '100%', border: 0, backgroundColor: colors.surface }}
      />
    </Box>
  );
};

export default ContributionPanelHost;
