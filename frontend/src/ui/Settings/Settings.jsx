import React, { memo, useState } from 'react';
import {
  Box,
  Typography,
  FormControlLabel,
  Grid,
  Select,
  MenuItem,
  FormControl,
  Checkbox
} from '@mui/material';
import { useModel } from '../../model/Context';
import { colors } from '../../theme';
import Dialog from '../../components/Dialog/Dialog';
import GridHelper from './GridHelper/GridHelper';
import { observer } from 'mobx-react-lite';

const Settings = ({open, onClose}) => {
  const model = useModel()
  const [selectedType, setSelectedType] = useState('Visibility');

  const snapOptions = {
    grid : { label : 'Grid' , value : 'onGrid' , enabled : true },
    nodes : { label : 'Nodes' , value : 'onNode', enabled : false }
  }

  const visibilityOptions = {
    nodes : { label: 'Nodes', value: 'nodes' },
    nodeLabels : { label: 'Node Labels', value: 'nodeLabels' },
    members : { label: 'Members', value: 'members'},
    memberLabels : { label: 'Member Labels', value: 'memberLabels', },
    sections: { label: 'Sections', value: 'sections' },
    loads: { label: 'Loads', value: 'loads' },
    releases: { label: 'Releases', value: 'releases' },
    grids: { label: 'Grids', value: 'grids' },
    levels: { label: 'Levels', value: 'levels' }
  }

  // Settings → View — viewer HUD/appearance toggles (kept separate from the
  // model-entity Visibility group above).
  const viewOptions = {
    showFps : { label: 'Show FPS', value: 'showFps' },
  }

  const handleChangeSnap = (e) => {
    const {name, checked} = e.target
    switch (name) {
      case 'nodes':
        model.snapper.toggleOnNode()
        break;
      case 'grid':
        model.snapper.toggleOnGrid()
        break;
      default:
        break;
    }
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

  const handleTypeChange = (event) => {
    setSelectedType(event.target.value);
  };

  const handleRenderMode = (event) => model.setRenderMode(event.target.value)
  const handleQualityProfile = (event) => model.setQualityProfile(event.target.value)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth={false}
      draggable
      title='Settings'
    >
      <Box sx={{ mb: 2, width: '250px' }}>
        <FormControl size="small" sx={{ width: '100%' }}>
          <Select
            value={selectedType}
            onChange={handleTypeChange}
            size="small"
            sx={{
              height: '32px',
              fontSize: '0.875rem',
              '& .MuiSelect-select': {
                py: 0,
                px: '12px',
              },
            }}
          >
            <MenuItem value="Visibility">Visibility</MenuItem>
            <MenuItem value="Grid">Grid</MenuItem>
            <MenuItem value="View">View</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {selectedType === 'Visibility' && (
        <Box>
          {Object.keys(visibilityOptions).map((key) => {
            const option = visibilityOptions[key];
            return (
              <Grid container alignItems="center" justifyContent="space-between" key={key}>
                <Grid item xs={6}>
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                    {option.label}
                  </Typography>
                </Grid>
                <Grid item xs={6} sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={model?.visibility[key] || false}
                        onChange={(e) => handleChangeVisibility(e)}
                        size="small"
                        name={option.value}
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
          })}
        </Box>
      )}

      {selectedType === 'Grid' && <GridHelper />}

      {selectedType === 'View' && (
        <Box>
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
          {Object.keys(viewOptions).map((key) => {
            const option = viewOptions[key];
            return (
              <Grid container alignItems="center" justifyContent="space-between" key={key}>
                <Grid item xs={6}>
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                    {option.label}
                  </Typography>
                </Grid>
                <Grid item xs={6} sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={model?.[key] || false}
                        onChange={(e) => handleChangeView(e)}
                        size="small"
                        name={option.value}
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
          })}
        </Box>
      )}
    </Dialog>
  );
}

export default observer(Settings)
