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
  console.log('MODEL VISI', model?.visibility)
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
    loads: { label: 'Loads', value: 'loads' }
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
      default:
        break;
    }
  }

  const handleTypeChange = (event) => {
    setSelectedType(event.target.value);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth={false}
      draggable
      hideBackdrop
      disableEnforceFocus
      disableAutoFocus
      disableRestoreFocus
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
    </Dialog>
  );
}

export default observer(Settings)
