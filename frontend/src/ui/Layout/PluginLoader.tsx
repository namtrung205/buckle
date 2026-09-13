import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Autocomplete, Box, Button, Chip, IconButton, TextField, Typography } from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, Extension as ExtensionIcon } from '@mui/icons-material';
import { toast } from 'react-toastify';
import { colors } from '../../theme';
import { useContributions, useModel } from '../../model/Context';
import {
  createPluginCommandBroker,
  launchBundledPlugin,
  parseWorkerFile,
  parseZipBundle,
  PluginLoadError,
  PLUGIN_SURFACE_PERMISSIONS,
} from '../../core/plugins';
import { PLUGIN_PERMISSIONS } from '../../core/structural/CommandPolicy';
import type { PluginLaunchDeps, PluginSessionPermission } from '../../core/plugins';
import { pluginSessions } from '../../core/plugins/PluginSessionRegistry';
import { pluginStorage } from '../../core/plugins/PluginStorage';
import { pluginAudit } from '../../core/plugins/PluginAudit';
import { pluginKillSwitch } from '../../core/plugins/PluginAudit';
import type { WorkerLike } from '../../core/plugins/WorkerRuntime';
import Dialog from '../../components/Dialog/Dialog';
import PluginSecurityCenter from './PluginSecurityCenter';

/**
 * Load an external plugin bundle straight from the client —
 * a `.zip` package (manifest + worker/panel files) or a single compiled
 * `.js`/`.mjs` worker file. Nothing persists across reloads; every launch is
 * audited and can be stopped in one click. The sandbox runtimes, broker gates
 * and RPC budgets are the exact ones used by the built-in samples.
 */

type LoadedEntry = Readonly<{
  id: string;
  name: string;
  version: string;
  source: string;
  worker: boolean;
  panels: number;
  stop: () => void;
}>;

const permissionOptions: PluginSessionPermission[] = [...new Set([...PLUGIN_SURFACE_PERMISSIONS, ...PLUGIN_PERMISSIONS])];

interface PluginLoaderProps {
  open: boolean;
  onClose: () => void;
}

const PluginLoader = ({ open, onClose }: PluginLoaderProps) => {
  const model = useModel();
  const contributions = useContributions();
  const [loaded, setLoaded] = useState<LoadedEntry[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [jsGrants, setJsGrants] = useState<PluginSessionPermission[]>([]);
  const killSwitch = useSyncExternalStore(pluginKillSwitch.subscribe, () => pluginKillSwitch.snapshot, () => pluginKillSwitch.snapshot);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  useEffect(() => {
    if (!killSwitch.engaged || loaded.length === 0) return;
    for (const entry of loaded) entry.stop();
    setLoaded([]);
    setLog(prev => [...prev.slice(-39), 'All plugins stopped by the kill switch']);
  }, [killSwitch.engaged, loaded]);

  useEffect(() => () => {
    for (const entry of loadedRef.current) entry.stop();
  }, []);

  const pushLog = useCallback((line: string) => {
    setLog(prev => [...prev.slice(-39), line]);
  }, []);

  const deps: PluginLaunchDeps | null = useMemo(() => {
    if (!model) return null;
    const notify = (message: string, kind: 'info' | 'success' | 'error') => {
      if (kind === 'error') toast.error(message, { position: 'bottom-right', autoClose: 4000 });
      else if (kind === 'success') toast.success(message, { position: 'bottom-right', autoClose: 3000 });
      else toast.info(message, { position: 'bottom-right', autoClose: 3000 });
    };
    return {
      storage: pluginStorage,
      createSession: manifest => createPluginCommandBroker(
        {
          ...model.pluginCommandServices(),
          events: model.pluginEventBus(),
          notify,
          hasPanel: id => contributions.listPanels().some(panel => panel.id === id),
          openPanel: id => contributions.openPanel(id),
        },
        { kind: 'plugin', id: manifest.id, version: manifest.version },
        manifest.permissions ?? [],
      ),
      spawnWorker: (bytes: Uint8Array): WorkerLike => {
        const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
        let worker: Worker;
        try {
          worker = new Worker(url, { type: 'module' });
        } catch (error) {
          URL.revokeObjectURL(url);
          throw error;
        }
        return {
          postMessage: message => worker.postMessage(message),
          terminate: () => { worker.terminate(); URL.revokeObjectURL(url); },
          addEventListener: (type, listener) => worker.addEventListener(type, listener),
          removeEventListener: (type, listener) => worker.removeEventListener(type, listener),
        };
      },
      createPanelUrl: (bytes: Uint8Array): string => URL.createObjectURL(new Blob([bytes], { type: 'text/html' })),
      revokeUrl: url => URL.revokeObjectURL(url),
      register: (owner, bundle) => contributions.register(owner, bundle),
      setSession: (id, session) => pluginSessions.set(id, session),
      openPanel: id => contributions.openPanel(id),
      notify,
      audit: (id, action, detail) => pluginAudit.record(id, action, detail),
    };
  }, [model, contributions]);

  const activate = async (
    bytes: Uint8Array,
    filename: string,
    kind: 'zip' | 'worker',
    grants?: readonly PluginSessionPermission[],
  ) => {
    if (!deps) return;
    if (pluginKillSwitch.snapshot.engaged) {
      pushLog(`Rejected ${filename} — release the kill switch before installing plugins`);
      return;
    }
    setBusy(true);
    try {
      const bundled = kind === 'zip' ? parseZipBundle(bytes, filename) : parseWorkerFile(filename, bytes, grants);
      const id = bundled.manifest.id;
      const existing = loaded.find(entry => entry.id === id);
      if (existing) {
        existing.stop();
        setLoaded(prev => prev.filter(entry => entry.id !== id));
      }
      const handle = await launchBundledPlugin(bundled, deps);
      if (pluginKillSwitch.snapshot.engaged) {
        handle.stop();
        throw new PluginLoadError('KILL_SWITCH_ENGAGED', 'plugin activation was stopped by the kill switch');
      }
      setLoaded(prev => [...prev, {
        id,
        name: bundled.manifest.name,
        version: bundled.manifest.version,
        source: bundled.source,
        worker: Boolean(bundled.manifest.entrypoints?.worker),
        panels: bundled.manifest.contributions?.panels?.length ?? 0,
        stop: handle.stop,
      }]);
      pushLog(`Loaded ${id}@${bundled.manifest.version} (${bundled.source})`);
    } catch (error) {
      pushLog(error instanceof PluginLoadError
        ? `Rejected ${filename} — ${error.code}: ${error.message}`
        : `Rejected ${filename} — ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const pickFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,.js,.mjs';
    input.style.display = 'none';
    input.onchange = (event) => {
      input.remove();
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      void file.arrayBuffer().then(buffer =>
        activate(new Uint8Array(buffer), file.name, /\.zip$/i.test(file.name) ? 'zip' : 'worker', jsGrants))
        .catch(error => pushLog(`Could not read ${file.name}: ${error instanceof Error ? error.message : String(error)}`));
    };
    document.body.appendChild(input);
    input.click();
  };

  return (
    <Dialog open={open} onClose={onClose} title="Manage plugins" maxWidth="sm"
      PaperProps={{ sx: { width: 560, maxWidth: 'calc(100vw - 32px)' } }}>
    <Box data-plugin-loader sx={{ overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderBottom: `1px solid ${colors.divider}` }}>
        <ExtensionIcon sx={{ fontSize: 16, color: colors.accentSoft }} />
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: colors.text, flex: 1 }}>Plugin loader</Typography>
        <Button size="small" variant="contained" onClick={pickFile} disabled={busy || killSwitch.engaged || !deps} sx={{ minWidth: 0, px: 1, fontSize: '0.65rem' }}>
          <AddIcon sx={{ fontSize: 14, mr: 0.5 }} /> Install
        </Button>
      </Box>

      <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${colors.divider}` }}>
        <Typography sx={{ fontSize: '0.7rem', color: colors.textDim, mb: 0.75 }}>
          Permissions for single-file JS only. ZIP bundles declare permissions in their manifest.
        </Typography>
        <Autocomplete multiple size="small" options={permissionOptions} value={jsGrants}
          onChange={(_, value) => setJsGrants(value)}
          renderInput={params => <TextField {...params} label="JS permissions" placeholder={jsGrants.length ? '' : 'No host access'} />}
          sx={{ '& .MuiInputBase-root': { color: colors.text }, '& .MuiInputLabel-root': { color: colors.textDim } }}
        />
      </Box>

      <Box sx={{ px: 1.5, py: 0.75, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {loaded.length === 0 && (
          <Typography sx={{ fontSize: '0.72rem', color: colors.textDim }}>
            Install a .zip bundle with buckle.plugin.json, or a compiled .js/.mjs Worker. Plugins run for this session only.
          </Typography>
        )}
        {loaded.map(entry => (
          <Box key={entry.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip size="small" label={`${entry.name} ${entry.version}`} variant="outlined"
              sx={{ fontSize: '0.65rem', height: 20, flex: 1, justifyContent: 'flex-start' }} />
            <Typography sx={{ fontSize: '0.62rem', color: colors.textDim, whiteSpace: 'nowrap' }}>
              {entry.worker ? 'worker' : ''}{entry.panels ? ` +${entry.panels}p` : ''}
            </Typography>
            <IconButton size="small" aria-label={`Unload ${entry.name}`}
              onClick={() => {
                entry.stop();
                setLoaded(prev => prev.filter(item => item.id !== entry.id));
                pushLog(`Unloaded ${entry.id}`);
              }}
              sx={{ color: colors.textDim, '&:hover': { color: '#e57373' } }}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        ))}
      </Box>

      {log.length > 0 && (
        <>
          <Box sx={{ px: 1.5, py: 1, borderTop: `1px solid ${colors.divider}` }}>
            <Typography sx={{ fontSize: '0.68rem', color: colors.textDim }}>Log</Typography>
          </Box>
          <Box sx={{ maxHeight: 120, overflowY: 'auto', px: 1.5, pb: 1 }}>
            {log.map((line, index) => (
              <Typography key={`${index}-${line}`} sx={{ fontSize: '0.62rem', color: colors.textDim, lineHeight: 1.5 }}>
                {line}
              </Typography>
            ))}
          </Box>
        </>
      )}
      <PluginSecurityCenter />
    </Box>
    </Dialog>
  );
};

export default PluginLoader;
