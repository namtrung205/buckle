import { useSyncExternalStore } from 'react';
import { Box, Button, Chip, Divider, Typography } from '@mui/material';
import { Security as SecurityIcon, Warning as WarningIcon } from '@mui/icons-material';
import { colors } from '../../theme';
import { pluginAudit, pluginKillSwitch } from '../../core/plugins';
import type { PluginAuditEntry, KillSwitchState } from '../../core/plugins';

/**
 * Goal 6 security surface: emergency kill switch control, live audit viewer
 * and runtime metrics for plugin activity. Reads the app-wide audit/kill
 * switch singletons through `useSyncExternalStore` — the manager writes, this
 * renders.
 */

const AUDIT_PREVIEW = 8;

const actionTone: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  install: 'info', enable: 'success', disable: 'default', uninstall: 'default',
  crash: 'warning', quarantine: 'error', enableBlocked: 'warning',
  killSwitchEngaged: 'error', killSwitchReleased: 'success', revoked: 'error',
  release: 'success',
};

const entryLabel = (entry: PluginAuditEntry) =>
  `${entry.pluginId} — ${entry.action}${entry.detail ? ` (${entry.detail})` : ''}`;

const PluginSecurityCenter = () => {
  const auditEntries = useSyncExternalStore(pluginAudit.subscribe, pluginAudit.list, pluginAudit.list);
  const killSwitch: KillSwitchState = useSyncExternalStore(pluginKillSwitch.subscribe, () => pluginKillSwitch.snapshot, () => pluginKillSwitch.snapshot);

  const metrics = auditEntries.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.action] = (acc[entry.action] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Box
      data-plugin-security-center
      sx={{
        position: 'fixed', right: 12, bottom: 12, zIndex: 1300,
        width: 300, maxHeight: 380, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 1.5,
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderBottom: `1px solid ${colors.divider}` }}>
        <SecurityIcon sx={{ fontSize: 16, color: colors.accentSoft }} />
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: colors.text, flex: 1 }}>Plugin security</Typography>
        {killSwitch.engaged ? (
          <Button size="small" variant="outlined" color="success" onClick={() => pluginKillSwitch.release()}>
            Release
          </Button>
        ) : (
          <Button size="small" variant="outlined" color="error" onClick={() => pluginKillSwitch.engage('user request')}>
            Kill switch
          </Button>
        )}
      </Box>

      {killSwitch.engaged && (
        <Box sx={{ px: 1.5, py: 1, display: 'flex', gap: 1, alignItems: 'center', backgroundColor: 'rgba(200,60,60,0.12)' }}>
          <WarningIcon sx={{ fontSize: 16, color: '#e57373' }} />
          <Typography sx={{ fontSize: '0.72rem', color: '#e57373' }}>
            Kill switch engaged — all plugin sessions stopped{killSwitch.reason ? `: ${killSwitch.reason}` : ''}
          </Typography>
        </Box>
      )}

      <Box sx={{ px: 1.5, py: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {Object.keys(metrics).length === 0 && (
          <Typography sx={{ fontSize: '0.72rem', color: colors.textDim }}>No plugin activity yet.</Typography>
        )}
        {Object.entries(metrics).map(([action, count]) => (
          <Chip key={action} size="small" label={`${action}: ${count}`} variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />
        ))}
      </Box>

      <Divider />
      <Box sx={{ flex: 1, overflowY: 'auto', px: 1.5, py: 1 }}>
        {auditEntries.slice(-AUDIT_PREVIEW).reverse().map((entry, index) => (
          <Box key={`${entry.at}-${index}`} sx={{ py: 0.4, borderBottom: index < AUDIT_PREVIEW - 1 ? `1px solid ${colors.divider}` : 'none' }}>
            <Chip size="small" label={entry.action} color={actionTone[entry.action] ?? 'default'} sx={{ fontSize: '0.6rem', height: 16, mr: 1 }} />
            <Typography component="span" sx={{ fontSize: '0.7rem', color: colors.text }}>{entryLabel(entry)}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default PluginSecurityCenter;
