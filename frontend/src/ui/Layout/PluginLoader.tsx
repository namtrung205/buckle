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
  summarizePermissions,
} from '../../core/plugins';
import { PLUGIN_PERMISSIONS } from '../../core/structural/CommandPolicy';
import type { BundledPlugin, PluginLaunchDeps, PluginSessionPermission } from '../../core/plugins';
import { pluginSessions } from '../../core/plugins/PluginSessionRegistry';
import { pluginStorage } from '../../core/plugins/PluginStorage';
import { pluginAudit } from '../../core/plugins/PluginAudit';
import { pluginKillSwitch } from '../../core/plugins/PluginAudit';
import type { WorkerLike } from '../../core/plugins/WorkerRuntime';
import { spawnSandboxedPluginWorker } from '../../core/plugins/SandboxedPluginWorker';
import { hardenPluginPanelHtml } from '../../core/plugins/PanelHtmlSecurity';
import { verifyBundleSignature } from '../../../packages/plugin-sdk/src/signature';
import type { VerifiedBundleSignature } from '../../../packages/plugin-sdk/src/signature';
import { InstalledBundleManager } from '../../core/plugins/InstalledBundleManager';
import type { InstalledBundleView } from '../../core/plugins/InstalledBundleManager';
import { browserPluginInstallStore } from '../../core/plugins/PluginInstallStore';
import { browserPublisherRevocations } from '../../core/plugins/PublisherRevocations';
import Dialog from '../../components/Dialog/Dialog';
import PluginSecurityCenter from './PluginSecurityCenter';

/**
 * Load an external plugin bundle straight from the client —
 * a `.zip` package (manifest + worker/panel files) or a single compiled
 * `.js`/`.mjs` worker file. Reviewed ZIPs persist in IndexedDB; a single JS
 * file remains a session-only developer convenience.
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

type PendingBundle = Readonly<{ bundle: BundledPlugin; zip?: Uint8Array; publisher?: VerifiedBundleSignature }>;

const permissionOptions: PluginSessionPermission[] = [...new Set([...PLUGIN_SURFACE_PERMISSIONS, ...PLUGIN_PERMISSIONS])];

interface PluginLoaderProps {
  open: boolean;
  onClose: () => void;
}

const PluginLoader = ({ open, onClose }: PluginLoaderProps) => {
  const model = useModel();
  const contributions = useContributions();
  const [loaded, setLoaded] = useState<LoadedEntry[]>([]);
  const [installed, setInstalled] = useState<readonly InstalledBundleView[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingBundle | null>(null);
  const [jsGrants, setJsGrants] = useState<PluginSessionPermission[]>([]);
  const killSwitch = useSyncExternalStore(pluginKillSwitch.subscribe, () => pluginKillSwitch.snapshot, () => pluginKillSwitch.snapshot);
  const loadedRef = useRef(loaded);
  const managerRef = useRef<InstalledBundleManager | null>(null);
  loadedRef.current = loaded;

  useEffect(() => () => {
    for (const entry of loadedRef.current) entry.stop();
  }, []);

  const pushLog = useCallback((line: string) => {
    setLog(prev => [...prev.slice(-39), line]);
  }, []);

  useEffect(() => {
    if (!killSwitch.engaged || (loaded.length === 0 && installed.every(entry => !entry.enabled))) return;
    for (const entry of loaded) entry.stop();
    setLoaded([]);
    void managerRef.current?.disableAll().catch(error => pushLog(`Could not save disabled plugins: ${String(error)}`));
    setLog(prev => [...prev.slice(-39), 'All plugins stopped by the kill switch']);
  }, [killSwitch.engaged, loaded, installed, pushLog]);

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
      spawnWorker: (bytes: Uint8Array): WorkerLike => spawnSandboxedPluginWorker(bytes),
      createPanelUrl: (bytes: Uint8Array): string => URL.createObjectURL(new Blob([
        hardenPluginPanelHtml(new TextDecoder().decode(bytes)),
      ], { type: 'text/html' })),
      revokeUrl: url => URL.revokeObjectURL(url),
      register: (owner, bundle) => contributions.register(owner, bundle),
      setSession: (id, session) => pluginSessions.set(id, session),
      openPanel: id => contributions.openPanel(id),
      notify,
      audit: (id, action, detail) => pluginAudit.record(id, action, detail),
    };
  }, [model, contributions]);

  useEffect(() => {
    if (!deps) return;
    const manager = new InstalledBundleManager({
      store: browserPluginInstallStore,
      publishers: browserPublisherRevocations,
      deps,
      onChange: setInstalled,
      onFailure: message => pushLog(`Plugin disabled during restore: ${message}`),
    });
    managerRef.current = manager;
    setBusy(true);
    void manager.restore().catch(error => pushLog(`Could not read installed plugins: ${String(error)}`))
      .finally(() => setBusy(false));
    return () => {
      manager.dispose();
      if (managerRef.current === manager) managerRef.current = null;
    };
  }, [deps, pushLog]);

  const installZip = async (zip: Uint8Array, source: string) => {
    const manager = managerRef.current;
    if (!manager) { pushLog('Plugin manager is not ready'); return; }
    setBusy(true);
    try {
      await manager.install(zip, source);
      pushLog(`Installed ${source}`);
    } catch (error) {
      pushLog(`Could not install ${source}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const changeInstalled = async (id: string, action: 'enable' | 'disable' | 'uninstall' | 'release' | 'blockPublisher' | 'releasePublisher') => {
    const manager = managerRef.current;
    if (!manager) return;
    setBusy(true);
    try {
      await manager[action](id);
      pushLog(`${action} ${id}`);
    } catch (error) {
      pushLog(`Could not ${action} ${id}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const activate = async (bundled: BundledPlugin) => {
    if (!deps) return;
    if (pluginKillSwitch.snapshot.engaged) {
      pushLog(`Rejected ${bundled.source} — release the kill switch before installing plugins`);
      return;
    }
    setBusy(true);
    try {
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
        ? `Rejected ${bundled.source} — ${error.code}: ${error.message}`
        : `Rejected ${bundled.source} — ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const pickFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,.js,.mjs';
    input.style.display = 'none';
    input.oncancel = () => input.remove();
    input.onchange = (event) => {
      input.remove();
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      void file.arrayBuffer().then(async buffer => {
        const bytes = new Uint8Array(buffer);
        if (/\.zip$/i.test(file.name)) {
          const bundle = parseZipBundle(bytes, file.name);
          const publisher = await verifyBundleSignature(bundle);
          setPending({ bundle, zip: bytes, publisher });
        } else setPending({ bundle: parseWorkerFile(file.name, bytes, jsGrants) });
      })
        .catch(error => pushLog(`Could not load ${file.name}: ${error instanceof Error ? error.message : String(error)}`));
    };
    document.body.appendChild(input);
    input.click();
  };

  return (<>
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
        {loaded.length === 0 && installed.length === 0 && (
          <Typography sx={{ fontSize: '0.72rem', color: colors.textDim }}>
            Install a .zip bundle with buckle.plugin.json. Reviewed ZIPs are restored after reload; single JS files run for this session only.
          </Typography>
        )}
        {installed.map(entry => (
          <Box key={entry.id} sx={{ display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip size="small" label={`${entry.name} ${entry.version}`} variant="outlined"
              sx={{ fontSize: '0.65rem', height: 20, flex: 1, justifyContent: 'flex-start' }} />
            <Typography sx={{ fontSize: '0.62rem', color: entry.failure ? '#e57373' : colors.textDim }}
              title={entry.failure ?? entry.source}>
              {entry.quarantined ? 'quarantined' : entry.failure ? 'failed' : entry.enabled ? 'enabled' : 'disabled'}
            </Typography>
            <Button size="small" disabled={busy || entry.revoked || (killSwitch.engaged && !entry.enabled)}
              onClick={() => void changeInstalled(entry.id, entry.quarantined ? 'release' : entry.enabled ? 'disable' : 'enable')}
              sx={{ minWidth: 0, fontSize: '0.65rem' }}>{entry.quarantined ? 'Release' : entry.enabled ? 'Disable' : 'Enable'}</Button>
            {entry.publisherKeySha256 && <Button size="small" disabled={busy}
              title={`Publisher key SHA-256: ${entry.publisherKeySha256}`}
              onClick={() => void changeInstalled(entry.id, entry.revoked ? 'releasePublisher' : 'blockPublisher')}
              sx={{ minWidth: 0, fontSize: '0.62rem' }}>{entry.revoked ? 'Unblock key' : 'Block key'}</Button>}
            <IconButton size="small" disabled={busy} aria-label={`Uninstall ${entry.name}`}
              onClick={() => void changeInstalled(entry.id, 'uninstall')}
              sx={{ color: colors.textDim, '&:hover': { color: '#e57373' } }}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
          {entry.failure && <Typography sx={{ fontSize: '0.62rem', color: '#e57373', px: 0.5 }}>
            {entry.failure}
          </Typography>}
          {entry.revoked && !entry.failure && <Typography sx={{ fontSize: '0.62rem', color: '#e57373', px: 0.5 }}>
            Publisher key blocked on this device.
          </Typography>}
          </Box>
        ))}
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
        {installed.length > 0 && <Typography sx={{ fontSize: '0.65rem', color: colors.textDim, mt: 0.5 }}>
          Updates keep plugin data. Uninstall clears data in the current workspace; previously saved project files retain their copy until saved again.
        </Typography>}
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
    <Dialog open={pending !== null} onClose={() => setPending(null)} title="Review plugin" maxWidth="xs"
      actions={<>
        <Button onClick={() => setPending(null)}>Cancel</Button>
        <Button variant="contained" disabled={busy || killSwitch.engaged} onClick={() => {
          if (!pending) return;
          const selected = pending;
          setPending(null);
          if (selected.zip) void installZip(selected.zip, selected.bundle.source);
          else void activate(selected.bundle);
        }}>{pending?.zip ? 'Install plugin' : 'Run for this session'}</Button>
      </>}>
      {pending && <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <Typography sx={{ color: colors.text, fontWeight: 600 }}>{pending.bundle.manifest.name} {pending.bundle.manifest.version}</Typography>
        <Typography sx={{ color: colors.textDim, fontSize: '0.75rem' }}>
          ID: {pending.bundle.manifest.id} · API v{pending.bundle.manifest.apiVersion} · {pending.bundle.source}
        </Typography>
        {pending.zip && <Typography sx={{ color: pending.publisher?.status === 'signed' ? colors.text : '#e57373', fontSize: '0.72rem', overflowWrap: 'anywhere' }}>
          {pending.publisher?.status === 'signed'
            ? `Ed25519 publisher key SHA-256: ${pending.publisher.keySha256}. Updates must use this key.`
            : 'Unsigned local ZIP: publisher identity cannot be verified.'}
        </Typography>}
        <Typography sx={{ color: colors.text, fontSize: '0.8rem' }}>Requested permissions</Typography>
        {(pending.bundle.manifest.permissions ?? []).length === 0 &&
          <Typography sx={{ color: colors.textDim, fontSize: '0.75rem' }}>No host permissions requested.</Typography>}
        {summarizePermissions(pending.bundle.manifest.permissions ?? []).map(info =>
          <Box key={info.permission}>
            <Typography sx={{ color: colors.text, fontSize: '0.75rem', fontWeight: 600 }}>{info.label}</Typography>
            <Typography sx={{ color: colors.textDim, fontSize: '0.7rem' }}>{info.description}</Typography>
          </Box>)}
        <Typography sx={{ color: colors.textDim, fontSize: '0.72rem' }}>
          {pending.zip
            ? 'This ZIP will run now and after reload while enabled. Install only files you trust.'
            : 'This JS file runs for this session. Run only files you trust.'}
        </Typography>
      </Box>}
    </Dialog>
  </>);
};

export default PluginLoader;
