import React, { useState } from 'react';
import {
  Box,
  Typography,
  FormControlLabel,
  Grid,
  Select,
  MenuItem,
  FormControl,
  Checkbox,
  Tabs,
  Tab
} from '@mui/material';
import { useModel } from '../../model/Context';
import { colors } from '../../theme';
import Dialog from '../../components/Dialog/Dialog';
import GridHelper from './GridHelper/GridHelper';
import { observer } from 'mobx-react-lite';

/** One label + checkbox row shared by every visibility/render tab. */
const ToggleRow = ({ label, checked, name, onChange }) => (
  <Grid container alignItems="center" justifyContent="space-between">
    <Grid item xs={6}>
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
        {label}
      </Typography>
    </Grid>
    <Grid item xs={6} sx={{ display: 'flex', justifyContent: 'flex-end' }}>
      <FormControlLabel
        control={
          <Checkbox
            checked={checked}
            onChange={onChange}
            size="small"
            name={name}
            sx={{
              color: colors.textDim,
              '&.Mui-checked': {
                color: colors.accent,
              },
            }}
          />
        }
        label=""
        sx={{ margin: 0 }}
      />
    </Grid>
  </Grid>
);

const Settings = ({open, onClose}) => {
  const model = useModel()
  const [tab, setTab] = useState(0);

  // Each model-entity family owns a tab so the old combobox + one long
  // checkbox list stays discoverable without hunting for a single toggle.
  const TABS = [
    { key: 'grid', label: 'Grid' },
    { key: 'node', label: 'Node' },
    { key: 'member', label: 'Member' },
    { key: 'boundary', label: 'Boundary' },
    { key: 'load', label: 'Load' },
    { key: 'level', label: 'Level' },
    { key: 'render', label: 'Render' },
  ];
  const activeTab = TABS[tab]?.key ?? 'grid';

  // Visibility rows shown on each entity tab (order = display order).
  const ENTITY_TAB_ROWS = {
    node: ['nodes', 'nodeLabels'],
    member: ['members', 'memberLabels', 'sections'],
    boundary: ['supports', 'releases'],
    // Load tab splits into master switch + the two sub-views so symbols and
    // numeric values can be toggled independently.
    load: ['loads', 'loadSymbols', 'loadValues'],
    level: ['grids', 'levels'],
  };

  const visibilityOptions = {
    nodes : { label: 'Nodes', value: 'nodes' },
    nodeLabels : { label: 'Node Labels', value: 'nodeLabels' },
    members : { label: 'Members', value: 'members'},
    memberLabels : { label: 'Member Labels', value: 'memberLabels', },
    sections: { label: 'Sections', value: 'sections' },
    loads: { label: 'Loads (master)', value: 'loads' },
    loadSymbols: { label: 'Load Symbols (arrows/bands)', value: 'loadSymbols' },
    loadValues: { label: 'Load Values (labels)', value: 'loadValues' },
    supports: { label: 'Supports', value: 'supports' },
    releases: { label: 'Releases', value: 'releases' },
    grids: { label: 'Grids', value: 'grids' },
    levels: { label: 'Levels', value: 'levels' }
  }

  // Settings → Render — viewer HUD/appearance toggles (kept separate from the
  // model-entity visibility groups above).
  const viewOptions = {
    showFps : { label: 'Show FPS', value: 'showFps' },
  }

  const handleChangeVisibility = (e) => {
    const {name, checked} = e.target
    
    switch (name) {
      case 'nodes':
        model.visibility.showOrHideNodes(checked)
        break;
      case 'nodeLabels' : 
        model.visibility.showOrHideNodeLabels(checked)
        break;
      case 'members':
        model.visibility.showOrHideMembers(checked)
        break;
      case 'memberLabels':
        model.visibility.showOrHideMemberLabels(checked)
        break;
      case 'sections':
        model.visibility.showOrHideSections(checked)
        break;
      case 'loads':
        model.visibility.showOrHideLoads(checked)
        break;
      case 'loadSymbols':
        model.visibility.showOrHideLoadSymbols(checked)
        break;
      case 'loadValues':
        model.visibility.showOrHideLoadValues(checked)
        break;
      case 'supports':
        model.visibility.showOrHideSupports(checked)
        break;
      case 'releases':
        model.visibility.showOrHideReleases(checked)
        break;
      case 'grids':
        model.visibility.showOrHideGrids(checked)
        break;
      case 'levels':
        model.visibility.showOrHideLevels(checked)
        break;
      default:
        break;
    }
  }

  const handleChangeView = (e) => {
    const {name, checked} = e.target

    switch (name) {
      case 'showFps':
        model.showFps = checked
        break;
      default:
        break;
    }
  }

  const handleRenderMode = (event) => model.setRenderMode(event.target.value)
  const handleQualityProfile = (event) => model.setQualityProfile(event.target.value)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth={false}
      draggable
      title='Settings'
      // Fixed frame: size never changes when switching tabs — content that
      // overflows scrolls inside the body instead of resizing the dialog.
      PaperProps={{ sx: { width: 440, height: 500, maxWidth: 'calc(100vw - 32px)' } }}
    >
      <Tabs
        value={tab}
        onChange={(event, next) => setTab(next)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          mb: 1.5,
          minHeight: 32,
          '& .MuiTab-root': { minHeight: 32, py: 0.5, px: 1.25, fontSize: '0.75rem', textTransform: 'none' },
          '& .MuiTabs-indicator': { backgroundColor: colors.accent },
        }}
      >
        {TABS.map((entry, index) => (
          <Tab key={entry.key} label={entry.label} value={index} disableRipple />
        ))}
      </Tabs>

      {ENTITY_TAB_ROWS[activeTab] && (
        <Box sx={{ width: '320px' }}>
          {ENTITY_TAB_ROWS[activeTab].map((key) => (
            <ToggleRow
              key={key}
              label={visibilityOptions[key].label}
              checked={model?.visibility[key] || false}
              name={visibilityOptions[key].value}
              onChange={handleChangeVisibility}
            />
          ))}
        </Box>
      )}

      {activeTab === 'grid' && <GridHelper />}

      {activeTab === 'render' && (
        <Box sx={{ width: '320px' }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 500, mb: 0.5 }}>Render Mode</Typography>
          <FormControl size="small" sx={{ width: '100%', mb: 1.5 }}>
            <Select value={model.renderMode} onChange={handleRenderMode} aria-label="Render Mode">
              <MenuItem value="centerline-only">Centerline only</MenuItem>
              <MenuItem value="thin-shell">Thin shell</MenuItem>
              <MenuItem value="solid-extrude">Solid extrude</MenuItem>
            </Select>
          </FormControl>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 500, mb: 0.5 }}>Quality Profile</Typography>
          <FormControl size="small" sx={{ width: '100%', mb: 1.5 }}>
            <Select value={model.qualityProfile} onChange={handleQualityProfile} aria-label="Quality Profile">
              <MenuItem value="low">Low</MenuItem>
              <MenuItem value="balanced">Balanced</MenuItem>
              <MenuItem value="high">High</MenuItem>
              <MenuItem value="custom">Custom</MenuItem>
            </Select>
          </FormControl>
<Typography sx={{ fontSize: '0.75rem', fontWeight: 500, mb: 0.5 }}>Background</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5, mb: 1.5 }}>
            {[
              { label: 'Dark blue-black', value: '#212830' },
              { label: 'Midnight', value: '#0f131a' },
              { label: 'Black', value: '#000000' },
              { label: 'White', value: '#ffffff' },
              { label: 'Light grey', value: '#ced4da' },
            ].map((swatch) => (
              <Box
                key={swatch.value}
                onClick={() => model.setViewerBackground(swatch.value)}
                title={swatch.label}
                sx={{
                  width: 22, height: 22, borderRadius: '4px', cursor: 'pointer',
                  border: `2px solid ${model.viewerBackground.toLowerCase() === swatch.value ? colors.accent : colors.border}`,
                  backgroundColor: swatch.value,
                }}
              />
            ))}
          </Box>
          {Object.keys(viewOptions).map((key) => (
            <ToggleRow
              key={key}
              label={viewOptions[key].label}
              checked={model?.[key] || false}
              name={viewOptions[key].value}
              onChange={handleChangeView}
            />
          ))}
        </Box>
      )}
    </Dialog>
  );
}

export default observer(Settings)
