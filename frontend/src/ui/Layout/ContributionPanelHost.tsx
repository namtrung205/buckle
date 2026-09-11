import { Box, IconButton, Typography } from '@mui/material';
import { Close as CloseIcon, Extension as ExtensionIcon } from '@mui/icons-material';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useContributions } from '../../model/Context';
import { colors } from '../../theme';
import { PanelRpcBridge, brokerRpcHandlers } from '../../core/plugins/PanelRpcBridge';
import { pluginSessions } from '../../core/plugins/PluginSessionRegistry';
import { pluginStorage } from '../../core/plugins/PluginStorage';

/** Render an already-authorized rich panel in an origin-opaque iframe and, when
 *  the owning plugin session is live, attach the host-side RPC bridge (Goal 4):
 *  the sandboxed panel can only reach the closed method table through its
 *  owner's broker — every call still passes the broker's permission gate. */
const ContributionPanelHost = () => {
  const contributions = useContributions();
  useSyncExternalStore(contributions.subscribe, contributions.getSnapshot, contributions.getSnapshot);
  const panel = contributions.getActivePanel();
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const session = panel ? pluginSessions.resolveByPrefix(panel.id) : undefined;
    const frame = frameRef.current;
    if (!panel || !session || !frame?.contentWindow) return;
    const bridge = new PanelRpcBridge({
      panel: frame.contentWindow,
      handlers: brokerRpcHandlers(session, pluginStorage),
      subscribe: listener => {
        window.addEventListener('message', listener);
        return () => window.removeEventListener('message', listener);
      },
      onViolation: (code, message) => console.warn(`[plugin panel] ${code}: ${message}`),
    });
    return () => bridge.close();
  }, [panel?.id]);

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
        ref={frameRef}
        sx={{ flex: 1, width: '100%', border: 0, backgroundColor: colors.surface }}
      />
    </Box>
  );
};

export default ContributionPanelHost;
