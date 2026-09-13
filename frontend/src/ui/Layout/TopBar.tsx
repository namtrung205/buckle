import { Box, Typography, IconButton, Tooltip, Button, Tabs, Tab } from '@mui/material';
import { colors } from '../../theme';
import {
  Menu as MenuIcon,
  Save as SaveIcon,
  FolderOpen as OpenIcon,
  OpenWith as MoveIcon,
  Lock as LockIcon,
  LockOpen as LockOpenIcon,
  WarningAmber as WarningAmberIcon,
  Download as DownloadIcon,
  GridOn as GridOnIcon,
  Layers as LayersIcon,
  Height as HeightIcon,
  CellTower as CellTowerIcon,
  ZoomIn as ZoomInIcon,
  Extension as ExtensionIcon,
} from '@mui/icons-material';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import Settings from '../Settings/Settings';
import Move from '../Model/Nodes/Components/Move/Move';
import Docs from '../Docs/Docs';
import AddOrEditSection from '../Model/Sections/AddOrEdit';
import AddOrEditMaterial from '../Model/Materials/AddOrEdit';
import { observer } from 'mobx-react-lite';
import { useContributions, useModel } from '../../model/Context';
import { matchesPredicates, type ContributionBundle, type ContributionIcon, type HostPredicate } from '../../core/plugins';
import axios from 'axios';
import { runInAction } from 'mobx';
import { exportProjectJson, buildModelFromJson } from '../../helpers';
import { toast } from 'react-toastify';
import Copy from '../Model/Copy';
import AddOrEditGrid from '../Model/Grids/AddOrEdit';
import AddOrEditWorkPlane from '../Model/WorkPlane/AddOrEdit';
import AddOrEditLevel from '../Model/Levels/AddOrEdit';
import WarehouseWizard from '../Model/Generator/WarehouseWizard';
import TowerGeneratorDialog from '../Model/Tower/TowerGenerator';
import AnalysisProgress from '../Results/AnalysisProgress';
import Dialog from '../../components/Dialog/Dialog';

const { VITE_BACKEND_SERVER } = import.meta.env;
const APP_VERSION = '0.0.2';

type BuiltinRibbonAction =
  | 'open' | 'save' | 'materials' | 'sections' | 'loads' | 'supports'
  | 'draw' | 'move' | 'zoomSelected' | 'warehouse' | 'tower' | 'grid'
  | 'level' | 'workplane' | 'settings' | 'runAnalysis' | 'unlock'
  | 'results' | 'reactions' | 'downloadResults' | 'plugins';

const builtinOwner = { kind: 'builtin', id: 'buckle.ribbon', version: APP_VERSION } as const;

const builtinRibbonBundle = (invoke: (action: BuiltinRibbonAction) => void | Promise<void>): ContributionBundle => {
  const command = (id: BuiltinRibbonAction, title: string) => ({
    id: `builtin.${id}`,
    title,
    execute: () => invoke(id),
  });
  const asset = (src: string, alt: string): ContributionIcon => ({ kind: 'asset', src, alt, size: 15 });
  const host = (name: string): ContributionIcon => ({ kind: 'host', name });
  return {
    commands: [
      command('open', 'Open project'), command('save', 'Save project'),
      command('materials', 'Materials'), command('sections', 'Sections'),
      command('loads', 'New Load'), command('supports', 'New Support'),
      command('draw', 'Draw'), command('move', 'Move'), command('zoomSelected', 'Zoom to selected entities'),
      command('warehouse', 'Warehouse generator'), command('tower', 'Transmission tower generator (500 kV)'),
      command('grid', 'New structural grid'), command('level', 'New level datum'),
      command('workplane', 'Set the active drawing plane'), command('settings', 'Settings'),
      command('runAnalysis', 'Run Analysis'), command('unlock', 'Lock or unlock analysis results'),
      command('results', 'View results'), command('reactions', 'View support reactions'),
      command('downloadResults', 'Download analysis results'), command('plugins', 'Manage plugins'),
    ],
    ribbonTabs: [
      { id: 'file', label: 'File', order: 10 },
      { id: 'model', label: 'Model', order: 20 },
      { id: 'view', label: 'View', order: 30 },
      { id: 'analysis', label: 'Analysis', order: 40 },
      { id: 'result', label: 'Result', order: 50, enabledWhen: ['modelLocked', 'hasResults'] },
    ],
    ribbon: [
      { id: 'builtin.ribbon.open', tabId: 'file', groupId: 'file', groupLabel: 'File', commandId: 'builtin.open', label: 'Open', order: 10, icon: host('open') },
      { id: 'builtin.ribbon.save', tabId: 'file', groupId: 'file', groupLabel: 'File', commandId: 'builtin.save', label: 'Save', order: 20, icon: host('save') },
      { id: 'builtin.ribbon.plugins', tabId: 'file', groupId: 'plugins', groupLabel: 'Plugins', commandId: 'builtin.plugins', label: 'Manage plugins', title: 'Install and manage plugins', order: 10, icon: host('plugins') },
      { id: 'builtin.ribbon.materials', tabId: 'model', groupId: 'define', groupLabel: 'Define', groupOrder: 10, commandId: 'builtin.materials', label: 'Materials', order: 10, icon: asset('/construction.png', 'Materials'), enabledWhen: ['modelUnlocked'] },
      { id: 'builtin.ribbon.sections', tabId: 'model', groupId: 'define', groupLabel: 'Define', groupOrder: 10, commandId: 'builtin.sections', label: 'Sections', order: 20, icon: asset('/sections.png', 'Sections'), enabledWhen: ['modelUnlocked'] },
      { id: 'builtin.ribbon.loads', tabId: 'model', groupId: 'assign', groupLabel: 'Assign', groupOrder: 20, commandId: 'builtin.loads', label: 'Loads', order: 10, icon: asset('/loads.png', 'Loads'), enabledWhen: ['modelUnlocked'] },
      { id: 'builtin.ribbon.supports', tabId: 'model', groupId: 'assign', groupLabel: 'Assign', groupOrder: 20, commandId: 'builtin.supports', label: 'Supports', order: 20, icon: asset('/supports.png', 'Supports'), enabledWhen: ['modelUnlocked'] },
      { id: 'builtin.ribbon.draw', tabId: 'model', groupId: 'modify', groupLabel: 'Modify', groupOrder: 30, commandId: 'builtin.draw', label: 'Draw', order: 10, icon: asset('/pencil.png', 'Draw'), enabledWhen: ['modelUnlocked'] },
      { id: 'builtin.ribbon.move', tabId: 'model', groupId: 'modify', groupLabel: 'Modify', groupOrder: 30, commandId: 'builtin.move', label: 'Move', order: 20, icon: host('move'), enabledWhen: ['modelUnlocked'] },
      { id: 'builtin.ribbon.zoomSelected', tabId: 'model', groupId: 'modify', groupLabel: 'Modify', groupOrder: 30, commandId: 'builtin.zoomSelected', label: 'Zoom Sel', order: 30, icon: host('zoom'), enabledWhen: ['hasSelection'] },
      { id: 'builtin.ribbon.warehouse', tabId: 'model', groupId: 'generate', groupLabel: 'Generate', groupOrder: 40, commandId: 'builtin.warehouse', label: 'Warehouse', order: 10, icon: asset('/warehouse.png', 'Generator'), enabledWhen: ['modelUnlocked'] },
      { id: 'builtin.ribbon.tower', tabId: 'model', groupId: 'generate', groupLabel: 'Generate', groupOrder: 40, commandId: 'builtin.tower', label: 'Tower', order: 20, icon: host('tower'), enabledWhen: ['modelUnlocked'] },
      { id: 'builtin.ribbon.grid', tabId: 'model', groupId: 'system', groupLabel: 'System', groupOrder: 50, commandId: 'builtin.grid', label: 'Grid', order: 10, icon: host('grid'), enabledWhen: ['modelUnlocked'] },
      { id: 'builtin.ribbon.level', tabId: 'model', groupId: 'system', groupLabel: 'System', groupOrder: 50, commandId: 'builtin.level', label: 'Level', order: 20, icon: host('level'), enabledWhen: ['modelUnlocked'] },
      { id: 'builtin.ribbon.workplane', tabId: 'model', groupId: 'system', groupLabel: 'System', groupOrder: 50, commandId: 'builtin.workplane', label: 'Workplane', order: 30, icon: host('workplane'), enabledWhen: ['modelUnlocked'] },
      { id: 'builtin.ribbon.settings', tabId: 'view', groupId: 'view', groupLabel: 'View', commandId: 'builtin.settings', label: 'Settings', icon: asset('/engrenage.png', 'Settings') },
      { id: 'builtin.ribbon.runAnalysis', tabId: 'analysis', groupId: 'solve', groupLabel: 'Solve', commandId: 'builtin.runAnalysis', label: 'Run', order: 10, icon: asset('/run.png', 'Run') },
      { id: 'builtin.ribbon.unlock', tabId: 'analysis', groupId: 'solve', groupLabel: 'Solve', commandId: 'builtin.unlock', label: 'Unlocked', labelWhen: { modelLocked: 'Locked' }, title: 'Model unlocked', titleWhen: { modelLocked: 'Unlock — clear results and edit the model' }, order: 20, icon: host('lock'), enabledWhen: ['hasResults'], activeWhen: ['modelLocked'] },
      { id: 'builtin.ribbon.results', tabId: 'result', groupId: 'results', groupLabel: 'Results', commandId: 'builtin.results', label: 'Results', order: 10, icon: asset('/growth.png', 'Results'), enabledWhen: ['modelLocked', 'hasResults'] },
      { id: 'builtin.ribbon.reactions', tabId: 'result', groupId: 'results', groupLabel: 'Results', commandId: 'builtin.reactions', label: 'Reactions', order: 20, icon: asset('/supports.png', 'Reactions'), enabledWhen: ['modelLocked', 'hasResults'] },
      { id: 'builtin.ribbon.downloadResults', tabId: 'result', groupId: 'results', groupLabel: 'Results', commandId: 'builtin.downloadResults', label: 'Download', order: 30, icon: host('download'), enabledWhen: ['hasResults'] },
    ],
  };
};

interface TopBarProps {
  onMenuClick?: () => void;
  onPluginsClick?: () => void;
}

interface RibbonButtonProps {
  title: string;
  label: string;
  onClick: () => void;
  icon?: React.ReactElement;
  disabled?: boolean;
  active?: boolean;
  iconImage?: {
    src: string;
    alt: string;
    size?: number;
  };
}

/** Small ribbon button — icon + label, sized for the 3-row panel grids. */
const RibbonButton = ({ title, label, onClick, icon, iconImage, disabled, active }: RibbonButtonProps) => {
  return (
    <Tooltip title={title} enterDelay={400}>
      <Button
        variant="text"
        onClick={onClick}
        disabled={disabled}
        sx={{
          minWidth: 0,
          height: 22,
          justifyContent: 'flex-start',
          gap: 0.75,
          px: 0.75,
          py: 0,
          borderRadius: 1,
          color: colors.text,
          textTransform: 'none',
          backgroundColor: active ? colors.accent : 'transparent',
          '&:hover': {
            bgcolor: active ? colors.accentHover : colors.hover,
          },
          '&.Mui-disabled': {
            color: colors.textFaint,
          },
        }}
      >
        {iconImage ? (
          <Box
            component="img"
            src={iconImage.src}
            alt={iconImage.alt}
            sx={{
              width: iconImage.size || 15,
              height: iconImage.size || 15,
              objectFit: 'contain',
              filter: 'brightness(0) saturate(100%) invert(100%)',
            }}
          />
        ) : (
          <Box sx={{ display: 'flex', color: colors.text }}>
            {icon}
          </Box>
        )}
        <Typography sx={{ fontSize: '0.68rem', lineHeight: 1, whiteSpace: 'nowrap' }}>{label}</Typography>
      </Button>
    </Tooltip>
  );
};

/** Ribbon panel — small buttons laid out in a 3-row grid, panel name underneath. */
const RibbonPanel = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <Box
    sx={{
      display: 'flex',
      flexDirection: 'column',
      px: 1.5,
      borderRight: '1px solid ' + colors.border,
      '&:last-of-type': { borderRight: 'none' },
    }}
  >
    <Box
      sx={{
        display: 'grid',
        gridAutoFlow: 'column',
        gridTemplateRows: 'repeat(3, 22px)',
        gap: '0 6px',
        justifyContent: 'start',
        alignItems: 'stretch',
        flex: 1,
      }}
    >
      {children}
    </Box>
    <Typography
      sx={{
        fontSize: '0.6rem',
        color: colors.textDim,
        fontWeight: 600,
        mt: 0.4,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        textAlign: 'center',
      }}
    >
      {label}
    </Typography>
  </Box>
);

const hostIcon = (name: string, locked: boolean) => {
  const sx = { fontSize: 15 };
  switch (name) {
    case 'open': return <OpenIcon sx={sx} />;
    case 'save': return <SaveIcon sx={sx} />;
    case 'move': return <MoveIcon sx={sx} />;
    case 'zoom': return <ZoomInIcon sx={sx} />;
    case 'tower': return <CellTowerIcon sx={sx} />;
    case 'grid': return <GridOnIcon sx={sx} />;
    case 'level': return <HeightIcon sx={sx} />;
    case 'workplane': return <LayersIcon sx={sx} />;
    case 'download': return <DownloadIcon sx={sx} />;
    case 'plugins': return <ExtensionIcon sx={sx} />;
    case 'lock': return locked ? <LockIcon sx={sx} /> : <LockOpenIcon sx={sx} />;
    default: return null;
  }
};

const conditionalText = (
  fallback: string,
  variants: Partial<Record<HostPredicate, string>> | undefined,
  state: Readonly<Record<HostPredicate, boolean>>,
) => {
  if (!variants) return fallback;
  for (const predicate of Object.keys(variants) as HostPredicate[]) {
    if (state[predicate]) return variants[predicate] ?? fallback;
  }
  return fallback;
};

const TopBar = observer(({ onMenuClick, onPluginsClick }: TopBarProps) => {
  const model = useModel();
  const contributions = useContributions();
  const actionsRef = useRef<Partial<Record<BuiltinRibbonAction, () => void | Promise<void>>>>({});
  
  // model is null on the first render (Viewer provides it only after Model.getInstance() resolves)
  const isLocked = model?.isLocked ?? false;
  const hasResults = !!model?.output;
  // At least one node / member / shell is selected in the viewport.
  const hasSelection = ((model?.selectedNodeIds.length ?? 0) +
    (model?.selectedMemberIds.length ?? 0) +
    (model?.selectedShellIds.length ?? 0)) > 0;
  // Use model-level MobX state so ContextMenu and TopBar share the same dialog state
  const open = (dialog: string) => {
    const ok = model?.openDialog(dialog) ?? false;
    if (!ok) {
      toast.warning('Model is locked — unlock to edit', { position: 'bottom-right', autoClose: 2500 });
    }
  };
  const close = () => model?.closeDialog();
  const activeDialog = model?.activeDialog ?? null;
  const dialogs = {
    settings: activeDialog === 'settings',
    results: activeDialog === 'results',
    reactions: activeDialog === 'reactions',
    move: activeDialog === 'move',
    draw: activeDialog === 'draw',
    docs: activeDialog === 'docs',
    sections: activeDialog === 'sections',
    loads: activeDialog === 'loads',
    supports: activeDialog === 'supports',
    materials: activeDialog === 'materials',
    grids: activeDialog === 'grids',
    workplane: activeDialog === 'workplane',
    levels: activeDialog === 'levels',
    copy: activeDialog === 'copy',
    warehouseWizard: activeDialog === 'warehouseWizard',
    tower: activeDialog === 'tower',
    analysisProgress: activeDialog === 'analysisProgress',
  };
  const [confirmUnlock, setConfirmUnlock] = useState(false)
  const [activeTab, setActiveTab] = useState<string>('model')

  const runAnalysis = async () => {
    try {
      model.postProcessing.dispose();
      model.reactionViz.dispose();
      
      // Validate that required data is present
      if (!model.nodes || model.nodes.length === 0) {
        toast.error('Cannot run analysis: No nodes found. Please add at least one node.', {
          position: "bottom-right",
          autoClose: 4000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
        });
        return;
      }

      if (!model.members || model.members.length === 0) {
        toast.error('Cannot run analysis: No members found. Please add at least one member.', {
          position: "bottom-right",
          autoClose: 4000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
        });
        return;
      }

      if (!model.sections || model.sections.length === 0) {
        toast.error('Cannot run analysis: No sections found. Please add at least one section.', {
          position: "bottom-right",
          autoClose: 4000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
        });
        return;
      }
      
      model.console.clear();
      model.console.setFinished(false);
      open('analysisProgress');
      
      // Build the Z-up payload through the single source of truth. The whole
      // model (nodes, member vecxz, boundary conditions, load values, shells)
      // is converted from the three.js (Y-up) scene frame to the shared
      // JSON/OpenSees (Z-up) schema HERE, at this boundary only.
      const analysisSnapshot = model.createAnalysisSnapshot();
      const data = structuredClone(analysisSnapshot.model);

      const res = await axios.post(`${VITE_BACKEND_SERVER}/analysis`, data);
      model.reconcileStructuralDocument();
      if (model.structuralDocument.revision !== analysisSnapshot.revision) {
        throw new Error('Model changed while analysis was running; discard the stale result and run again.');
      }
      console.log('RES', res);
      model.output = res.data.output;
      model.analysisRevision = analysisSnapshot.revision;
      model.analysisSnapshotHash = analysisSnapshot.hash;
      model.reactionViz.apply();
      model.lockResults();
      // Jump straight to the results ribbon now that the model is locked.
      setActiveTab('result');
      
      model.console.setFinished(true);
      
      // Show success toast
      toast.success('Analysis completed successfully!', {
        position: "bottom-right",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
      });
    } catch (error) {
      console.error('Analysis error:', error);
      
      model.console.create({
        id: Date.now().toString(),
        message: 'ERROR: Analysis failed',
        timestamp: new Date(),
        type: 'ERROR'
      });
      model.console.setFinished(true);
      
      
      // Show error toast
      const responseError = axios.isAxiosError(error)
        ? error.response?.data?.detail ?? error.response?.data?.message
        : error instanceof Error
        ? error.message
        : undefined;
      const errorMessage = typeof responseError === 'string'
        ? responseError
        : responseError
        ? JSON.stringify(responseError)
        : 'Analysis failed. Please check your model and try again.';
      
      toast.error(errorMessage, {
        position: "bottom-right",
        autoClose: 4000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
      });
    }
  };

  const download = () => {
    // Export the full Buckle project: the Z-up JSON/OpenSees analysis transport
    // plus the organizational document collections (selection sets, groups,
    // parametric objects, grids, levels) that the transport omits. The saved
    // file can be re-opened unchanged or sent straight to the backend for
    // analysis (the transport subset is `model`).
    const modelData = exportProjectJson(model);

    const dataStr = JSON.stringify(modelData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `buckle-project-${new Date().toISOString().split('T')[0]}.json`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
    
    console.log('Model downloaded successfully');
  };

  // Download the analysis results exactly as returned by the backend
  // (nodal displacements + member internal forces) as a JSON file.
  const downloadResults = () => {
    if (!model.output) {
      toast.error('No analysis results available. Run the analysis first.', {
        position: "bottom-right",
        autoClose: 4000,
      });
      return;
    }

    const resultsData = {
      ...model.output,
      metadata: {
        exportDate: new Date().toISOString(),
        modelName: 'FEM Analysis Results',
        version: '1.0'
      }
    };

    const dataStr = JSON.stringify(resultsData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });

    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fem-results-${new Date().toISOString().split('T')[0]}.json`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);

    console.log('Analysis results downloaded successfully');
  };

  const upload = () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';
    
    fileInput.onchange = (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
            
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const jsonData = JSON.parse(e.target?.result as string);
          buildOnJson(jsonData);
        } catch (error) {
          console.error('Error parsing JSON file:', error);
          alert('Error: Invalid JSON file format');
        }
      };
      reader.readAsText(file);
    };
    
    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
  };

  const buildOnJson = (jsonData: Parameters<typeof buildModelFromJson>[1]) => {
    runInAction(() => { model.isLocked = false; }); // loading a new model returns to editing mode
    try {
      console.log('Loading model from JSON...', jsonData);
      // Reuse the single import path: converts the Z-up JSON schema to the
      // three.js (Y-up) scene frame (nodes, vecxz, BCs, loads, shells).
      buildModelFromJson(model, jsonData);
      toast.success('Model loaded successfully!', {
        position: "bottom-right",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
      });
    } catch (error) {
      console.error('Error loading model from JSON:', error);
      toast.error('Error loading model: ' + (error instanceof Error ? error.message : String(error)), {
        position: "bottom-right",
        autoClose: 4000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
      });
    }
  };

  actionsRef.current = {
    open: upload,
    save: download,
    materials: () => open('materials'),
    sections: () => open('sections'),
    loads: () => model?.addNewLoad(),
    supports: () => model?.addNewSupport(),
    draw: () => open('draw'),
    move: () => open('move'),
    zoomSelected: () => model?.zoomToSelected(),
    warehouse: () => open('warehouseWizard'),
    tower: () => open('tower'),
    grid: () => open('grids'),
    level: () => open('levels'),
    workplane: () => open('workplane'),
    settings: () => open('settings'),
    runAnalysis,
    unlock: () => { if (model && isLocked) setConfirmUnlock(true); },
    results: () => open('results'),
    reactions: () => open('reactions'),
    downloadResults,
    plugins: () => onPluginsClick?.(),
  };

  useLayoutEffect(() => contributions.register(
    builtinOwner,
    builtinRibbonBundle(action => actionsRef.current[action]?.()),
  ), [contributions]);

  useSyncExternalStore(
    contributions.subscribe,
    contributions.getSnapshot,
    contributions.getSnapshot,
  );
  const hostState: Readonly<Record<HostPredicate, boolean>> = {
    modelLocked: isLocked,
    modelUnlocked: !isLocked,
    hasResults,
    hasSelection,
    hasNodeSelection: (model?.selectedNodeIds.length ?? 0) > 0,
    hasMemberSelection: (model?.selectedMemberIds.length ?? 0) > 0,
    hasShellSelection: (model?.selectedShellIds.length ?? 0) > 0,
    selectionModeNode: model?.selectionMode === 'node',
    selectionModeMember: model?.selectionMode === 'element1d',
    selectionModeShell: model?.selectionMode === 'shell2d',
  };
  const ribbonTabs = contributions.listRibbonTabs()
    .filter(tab => matchesPredicates(tab.visibleWhen, hostState));
  const ribbonTabIds = ribbonTabs.map(tab => tab.id).join('|');
  useEffect(() => {
    const tabIds = ribbonTabIds ? ribbonTabIds.split('|') : [];
    if (tabIds.length && !tabIds.includes(activeTab)) {
      setActiveTab(tabIds.includes('model') ? 'model' : tabIds[0]);
    }
  }, [activeTab, ribbonTabIds]);

  const ribbonGroups = new Map<string, { label: string; items: ReturnType<typeof contributions.listRibbon> }>();
  for (const item of contributions.listRibbon(activeTab)) {
    if (!matchesPredicates(item.visibleWhen, hostState)) continue;
    const current = ribbonGroups.get(item.groupId);
    if (current) current.items.push(item);
    else ribbonGroups.set(item.groupId, { label: item.groupLabel, items: [item] });
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: colors.surface,
        borderBottom: '2px solid ' + colors.border,
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.3)',
      }}
    >
      {/* Tab strip */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 3,
          pt: 0.5,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
          {/* Hamburger Menu */}
          <IconButton
            onClick={onMenuClick}
            size="small"
            sx={{
              color: colors.text,
              mr: 1,
              '&:hover': {
                bgcolor: colors.hover,
              },
            }}
          >
            <MenuIcon sx={{ fontSize: 18 }} />
          </IconButton>
          <Tabs
            value={activeTab}
            onChange={(_, value: string) => setActiveTab(value)}
            sx={{
              minHeight: 28,
              flex: 1,
              '& .MuiTab-root': {
                minHeight: 28,
                py: 0.25,
                px: 2,
                fontSize: '0.75rem',
                textTransform: 'none',
                color: colors.textDim,
              },
              '& .MuiTab-root.Mui-selected': { color: colors.text },
              '& .MuiTabs-indicator': { backgroundColor: colors.accent, height: 2 },
            }}
          >
            {ribbonTabs.map(tab => (
              <Tab
                key={`${tab.owner.id}:${tab.id}`}
                value={tab.id}
                label={tab.label}
                disabled={!matchesPredicates(tab.enabledWhen, hostState)}
              />
            ))}
          </Tabs>
        </Box>
        <RibbonButton
          title="Docs"
          label="Docs"
          onClick={() => window.open('https://github.com/igor-barcelos/buckle', '_blank')}
          iconImage={{ src: '/github.png', alt: 'Docs', size: 15 }}
        />
      </Box>

      {/* Ribbon content — panels of small buttons for the active tab */}
      <Box sx={{ display: 'flex', alignItems: 'stretch', px: 3, pt: 0.5, pb: 1 }}>
        {[...ribbonGroups.entries()].map(([groupId, group]) => (
          <RibbonPanel key={`${activeTab}:${groupId}`} label={group.label}>
            {group.items.map(item => {
              const icon = item.icon;
              return (
                <RibbonButton
                  key={`${item.owner.id}:${item.id}`}
                  title={conditionalText(item.title ?? contributions.getCommand(item.commandId)?.title ?? item.label, item.titleWhen, hostState)}
                  label={conditionalText(item.label, item.labelWhen, hostState)}
                  onClick={() => {
                    void contributions.invokeCommand(item.commandId).catch(error => {
                      toast.error(error instanceof Error ? error.message : String(error));
                    });
                  }}
                  disabled={!matchesPredicates(item.enabledWhen, hostState)}
                  active={matchesPredicates(item.activeWhen, hostState) && !!item.activeWhen?.length}
                  iconImage={icon?.kind === 'asset' ? icon : undefined}
                  icon={icon?.kind === 'host' ? hostIcon(icon.name, isLocked) ?? undefined : undefined}
                />
              );
            })}
          </RibbonPanel>
        ))}
      </Box>

      <Settings open={dialogs.settings} onClose={close} />
            <Move open={dialogs.move} onClose={close} selectedNode={null} />
      <Docs open={dialogs.docs} onClose={close} />
      <AddOrEditSection open={dialogs.sections} onClose={close} section={null} />
      <AddOrEditMaterial open={dialogs.materials} onClose={close} selectedMaterial={null} />
      <AddOrEditGrid open={dialogs.grids} onClose={close} grid={null} />
      <AddOrEditWorkPlane open={dialogs.workplane} onClose={close} />
      <AddOrEditLevel open={dialogs.levels} onClose={close} level={null} />
      <Copy open={dialogs.copy} onClose={close} />
      <WarehouseWizard open={dialogs.warehouseWizard} onClose={close} />
      <TowerGeneratorDialog open={dialogs.tower} onClose={close} />
      <AnalysisProgress 
        open={dialogs.analysisProgress} 
        onClose={close} 
        onViewResults={() => open('results')} 
      />

      {/* Confirm dialog: unlock wipes all analysis results */}
      <Dialog
        open={confirmUnlock}
        onClose={() => setConfirmUnlock(false)}
        title="Unlock model"
        maxWidth="xs"
        actions={
          <>
            <Button onClick={() => setConfirmUnlock(false)} sx={{ color: colors.textDim }}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConfirmUnlock(false);
                model?.unlockResults();
                // Results are gone — leave the (now disabled) Result ribbon.
                setActiveTab((tab) => (tab === 'result' ? 'model' : tab));
                toast.info('Results cleared — model unlocked', { position: 'bottom-right', autoClose: 3000 });
              }}
              variant="contained"
              disableElevation
              color="error"
            >
              Unlock &amp; Delete Results
            </Button>
          </>
        }
      >
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
          <WarningAmberIcon sx={{ color: colors.secondary, mt: 0.3 }} />
          <Typography sx={{ color: colors.text, fontSize: '0.85rem', lineHeight: 1.55 }}>
            Unlocking will delete all analysis results — diagrams, contour colours, min/max tags,
            legend, summary and station data. You will need to re-run the analysis to view results again.
          </Typography>
        </Box>
      </Dialog>
    </Box>
  );
});

export default TopBar;

