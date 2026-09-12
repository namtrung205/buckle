import { useCallback, useMemo, useState } from 'react';
import { Box, Button, Chip, IconButton, Typography } from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, Extension as ExtensionIcon, Science as ScienceIcon } from '@mui/icons-material';
import { toast } from 'react-toastify';
import { colors } from '../../theme';
import { useContributions, useModel } from '../../model/Context';
import {
  createPluginCommandBroker,
  launchBundledPlugin,
  parseWorkerFile,
  parseZipBundle,
  PluginLoadError,
} from '../../core/plugins';
import type { PluginLaunchDeps, PluginSessionPermission } from '../../core/plugins';
import { pluginSessions } from '../../core/plugins/PluginSessionRegistry';
import { pluginStorage } from '../../core/plugins/PluginStorage';
import { pluginAudit } from '../../core/plugins/PluginAudit';
import type { WorkerLike } from '../../core/plugins/WorkerRuntime';

/**
 * Developer preview: load an external plugin bundle straight from the client —
 * a `.zip` package (manifest + worker/panel files) or a single compiled
 * `.js`/`.mjs` worker file. Nothing persists across reloads; every launch is
 * audited and can be stopped in one click. The sandbox runtimes, broker gates
 * and RPC budgets are the exact ones used by the built-in samples.
 */

const DEMO_WORKER_SOURCE = `
"use strict";
var V = 1, nextId = 0, pending = new Map();
self.onmessage = function (event) {
  var msg = event.data;
  if (msg && msg.v === V && msg.id && pending.has(msg.id)) {
    var entry = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg.value);
    else entry.reject(new Error((msg.error && msg.error.message) || "rpc error"));
  }
};
function call(method, params) {
  return new Promise(function (resolve, reject) {
    var id = "demo-" + (++nextId);
    pending.set(id, { resolve: resolve, reject: reject });
    self.postMessage(params === undefined ? { v: V, id: id, method: method } : { v: V, id: id, method: method, params: params });
  });
}
call("model.query").then(function (snapshot) {
  var count = function (kind) { return Array.isArray(snapshot && snapshot[kind]) ? snapshot[kind].length : 0; };
  return call("ui.notify", { message: "Demo worker: " + count("nodes") + " nodes, " + count("members") + " members, " + count("loads") + " loads", kind: "success" });
}).catch(function (error) {
  return call("ui.notify", { message: "Demo worker failed: " + (error && error.message), kind: "error" }).catch(function () {});
});
`.trim();

type LoadedEntry = Readonly<{
  id: string;
  name: string;
  version: string;
  source: string;
  worker: boolean;
  panels: number;
  stop: () => void;
}>;

const PluginLoader = () => {
  const model = useModel();
  const contributions = useContributions();
  const [loaded, setLoaded] = useState<LoadedEntry[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

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
        return new Worker(url, { type: 'module' }) as unknown as WorkerLike;
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
        activate(new Uint8Array(buffer), file.name, /\.zip$/i.test(file.name) ? 'zip' : 'worker'));
    };
    document.body.appendChild(input);
    input.click();
  };

  const loadDemo = () => {
    void activate(new TextEncoder().encode(DEMO_WORKER_SOURCE), 'demo-worker.js', 'worker', ['model.read', 'ui.notify']);
  };

  return (
    <Box
      data-plugin-loader
      sx={{
        position: 'fixed', left: 12, bottom: 12, zIndex: 1300,
        width: 300, maxHeight: 340, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 1.5,
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderBottom: `1px solid ${colors.divider}` }}>
        <ExtensionIcon sx={{ fontSize: 16, color: colors.accentSoft }} />
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: colors.text, flex: 1 }}>Plugin loader</Typography>
        <Button size="small" variant="outlined" color="primary" onClick={loadDemo} disabled={busy} sx={{ minWidth: 0, px: 1, fontSize: '0.65rem' }}>
          <ScienceIcon sx={{ fontSize: 14, mr: 0.5 }} /> Demo
        </Button>
        <Button size="small" variant="contained" onClick={pickFile} disabled={busy} sx={{ minWidth: 0, px: 1, fontSize: '0.65rem' }}>
          <AddIcon sx={{ fontSize: 14, mr: 0.5 }} /> Install
        </Button>
      </Box>

      <Box sx={{ px: 1.5, py: 0.75, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {loaded.length === 0 && (
          <Typography sx={{ fontSize: '0.72rem', color: colors.textDim }}>
            Upload a .zip bundle or a compiled worker .js to run it in the sandbox.
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
          <Box sx={{ flex: 1, overflowY: 'auto', px: 1.5, pb: 1 }}>
            {log.map((line, index) => (
              <Typography key={`${index}-${line}`} sx={{ fontSize: '0.62rem', color: colors.textDim, lineHeight: 1.5 }}>
                {line}
              </Typography>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
};

export default PluginLoader;