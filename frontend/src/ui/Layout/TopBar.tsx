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
} from '@mui/icons-material';
import { useState } from 'react';
import Settings from '../Settings/Settings';
import Move from '../Model/Nodes/Components/Move/Move';
import Docs from '../Docs/Docs';
import AddOrEditSection from '../Model/Sections/AddOrEdit';
import AddOrEditMaterial from '../Model/Materials/AddOrEdit';
import { observer } from 'mobx-react-lite';
import { useModel } from '../../model/Context';
import axios from 'axios';
import Node from '../../model/Elements/Node/Node';
import ElasticBeamColumnClass from '../../model/Elements/ElasticBeamColumn/ElasticBeamColumn';
import Shell from '../../model/Elements/Shell/Shell';
import { exportModelJson, buildModelFromJson } from '../../helpers';
import * as THREE from 'three';
import { toast } from 'react-toastify';
import Copy from '../Model/Copy';
import WarehouseWizard from '../Model/Generator/WarehouseWizard';
import AnalysisProgress from '../Results/AnalysisProgress';
import Dialog from '../../components/Dialog/Dialog';

const { VITE_BACKEND_SERVER } = import.meta.env;
const APP_VERSION = '0.0.2';

interface TopBarProps {
  onMenuClick?: () => void;
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

const TopBar = observer(({ onMenuClick }: TopBarProps) => {
  const model = useModel();
  
  // model is null on the first render (Viewer provides it only after Model.getInstance() resolves)
  const isLocked = model?.isLocked ?? false;
  const hasResults = !!model?.output;
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
    copy: activeDialog === 'copy',
    warehouseWizard: activeDialog === 'warehouseWizard',
    analysisProgress: activeDialog === 'analysisProgress',
  };
  const [tool, setTool] = useState('')
  const [confirmUnlock, setConfirmUnlock] = useState(false)
  const [activeTab, setActiveTab] = useState<string>('model')
  const toolName = model?.toolsController.getCurrentToolName()
  
  const handleToolChange = (newTool: string) => {
    // Stop the current tool before switching
    const currentTool = model.toolsController.getCurrentTool();
    currentTool?.stop()
    setTool(newTool);
  };

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
      const data = exportModelJson(model);

      const res = await axios.post(`${VITE_BACKEND_SERVER}/analysis`, data);
      console.log('RES', res);
      model.output = res.data.output;
      model.reactionViz.apply();
      model.lockResults();
      
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
      const errorMessage = axios.isAxiosError(error) && error.response?.data?.message 
        ? error.response.data.message 
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
    // Export through the single source of truth: converts the three.js (Y-up)
    // scene to the Z-up JSON/OpenSees schema at this boundary only. The file
    // can be re-uploaded (Z-up -> three.js) or sent straight to the backend.
    const modelData = exportModelJson(model);

    const dataStr = JSON.stringify(modelData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fem-model-${new Date().toISOString().split('T')[0]}.json`;
    
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

  const buildOnJson = (jsonData: any) => {
    model.isLocked = false; // loading a new model returns to editing mode
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
            <Tab value="file" label="File" />
            <Tab value="model" label="Model" />
            <Tab value="view" label="View" />
            <Tab value="analysis" label="Analysis" />
            <Tab value="result" label="Result" />
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
        {activeTab === 'file' && (
          <RibbonPanel label="File">
            <RibbonButton title="Open" label="Open" onClick={upload} icon={<OpenIcon sx={{ fontSize: 15 }} />} />
            <RibbonButton title="Save" label="Save" onClick={download} icon={<SaveIcon sx={{ fontSize: 15 }} />} />
          </RibbonPanel>
        )}
        {activeTab === 'model' && (
          <>
            <RibbonPanel label="Define">
              <RibbonButton title="Materials" label="Materials" onClick={() => open('materials')} disabled={isLocked} iconImage={{ src: '/construction.png', alt: 'Materials', size: 15 }} />
              <RibbonButton title="Sections" label="Sections" onClick={() => open('sections')} disabled={isLocked} iconImage={{ src: '/sections.png', alt: 'Sections', size: 15 }} />
            </RibbonPanel>
            <RibbonPanel label="Assign">
              <RibbonButton title="New Load" label="Loads" onClick={() => model?.addNewLoad()} disabled={isLocked} iconImage={{ src: '/loads.png', alt: 'Loads', size: 15 }} />
              <RibbonButton title="New Support" label="Supports" onClick={() => model?.addNewSupport()} disabled={isLocked} iconImage={{ src: '/supports.png', alt: 'Supports', size: 15 }} />
            </RibbonPanel>
            <RibbonPanel label="Modify">
              <RibbonButton title="Draw" label="Draw" onClick={() => open('draw')} disabled={isLocked} iconImage={{ src: '/pencil.png', alt: 'Draw', size: 15 }} />
              <RibbonButton title="Move" label="Move" onClick={() => open('move')} disabled={isLocked} icon={<MoveIcon sx={{ fontSize: 15 }} />} />
            </RibbonPanel>
            <RibbonPanel label="Generate">
              <RibbonButton title="Warehouse generator" label="Warehouse" onClick={() => open('warehouseWizard')} disabled={isLocked} iconImage={{ src: '/warehouse.png', alt: 'Generator', size: 15 }} />
            </RibbonPanel>
          </>
        )}
        {activeTab === 'view' && (
          <RibbonPanel label="View">
            <RibbonButton title="Settings" label="Settings" onClick={() => open('settings')} iconImage={{ src: '/engrenage.png', alt: 'Settings', size: 15 }} />
          </RibbonPanel>
        )}
        {activeTab === 'result' && (
          <RibbonPanel label="Results">
            <RibbonButton title="View results" label="Results" onClick={() => open('results')} iconImage={{ src: '/growth.png', alt: 'Results', size: 15 }} />
            <RibbonButton
              title="View support reactions"
              label="Reactions"
              onClick={() => open('reactions')}
              iconImage={{ src: '/supports.png', alt: 'Reactions', size: 15 }}
              disabled={!hasResults}
            />
            <RibbonButton
              title="Download analysis results"
              label="Download"
              onClick={downloadResults}
              icon={<DownloadIcon sx={{ fontSize: 15 }} />}
              disabled={!hasResults}
            />
          </RibbonPanel>
        )}
        {activeTab === 'analysis' && (
          <>
            <RibbonPanel label="Solve">
              <RibbonButton title="Run Analysis" label="Run" onClick={runAnalysis} iconImage={{ src: '/run.png', alt: 'Run', size: 15 }} />
              <RibbonButton
                title={isLocked ? 'Unlock — clear results and edit the model' : 'Model unlocked'}
                label={isLocked ? 'Locked' : 'Unlocked'}
                onClick={() => { if (model && isLocked) setConfirmUnlock(true); }}
                icon={isLocked ? <LockIcon sx={{ fontSize: 15 }} /> : <LockOpenIcon sx={{ fontSize: 15 }} />}
                active={isLocked}
                disabled={!isLocked && !hasResults}
              />
            </RibbonPanel>
          </>
        )}
      </Box>

      <Settings open={dialogs.settings} onClose={close} />
            <Move open={dialogs.move} onClose={close} selectedNode={null} />
      <Docs open={dialogs.docs} onClose={close} />
      <AddOrEditSection open={dialogs.sections} onClose={close} section={null} />
      <AddOrEditMaterial open={dialogs.materials} onClose={close} selectedMaterial={null} />
      <Copy open={dialogs.copy} onClose={close} />
      <WarehouseWizard open={dialogs.warehouseWizard} onClose={close} />
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

