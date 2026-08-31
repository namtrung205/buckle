import React, { useState, useEffect, memo } from 'react';
import {
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Button,
  Stack,
  Grid,
  Dialog,
  Paper,
  Chip,
  Switch,
  FormControlLabel
} from '@mui/material';
import {
  Close,
  Check,
  Delete,
  Save,
  Layers,
  Add
} from '@mui/icons-material';
import { useModel } from '../../../model/Context';
import { colors } from '../../../theme';
import { observer } from 'mobx-react-lite';
import TextField from '../../../components/TextField/TextField';

// Memoized PaperComponent to prevent re-renders
const PaperComponent = memo(({ children }) => (
  <Paper
    sx={{
      position: 'fixed',
      left: '352px', 
      top: '20px',
      m: 0,
      width: 300,
      backgroundColor: colors.surface,
      borderRadius: '8px',
      border: '1px solid ' + colors.border,
      boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
      zIndex: 1004,
    }}
  >
    {children}
  </Paper>
));

const Levels = ({ 
  open,
  onClose,
  selectedLevel,
  setSelectedLevel
}) => {
  const [level, setLevel] = useState({
    value: 0,
    label: ''
  });

  const model = useModel();

  useEffect(() => {
    if (selectedLevel) {
      console.log('selectedLevel', selectedLevel);
      setLevel(selectedLevel);
    }
  }, [selectedLevel]);

 

  const handleChange = (e) => {
    const {name , value } = event.target
    setLevel({
      ...level, 
      [name] : name === 'value' ? Number(value) : value
    })
  }

  const handleDelete = () => {
    const index = model.levels.findIndex(l => l.value === level.value);
    if (index !== -1) {
      model.levels.splice(index, 1);
      reset();
      onClose();
    }
  };

  const handleSave = () => {
    
    const currentLevels = model.levels.map((level) => level.value)

    if(currentLevels.includes(level.value)) return 

    model.levels.push(level)

    reset()
    onClose()
  };

  const reset = () => {
    setLevel({
      value: 0,
      label: ''
    });

    setSelectedLevel(null)

  };


  return (
    <Dialog
      open={open}
      PaperComponent={PaperComponent}
      hideBackdrop
      disableEnforceFocus
      disableAutoFocus
      disableRestoreFocus
      sx={{
        pointerEvents: 'none',
        '& .MuiPaper-root': {
          pointerEvents: 'auto'
        }
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: colors.surface,
          borderBottom: '1px solid ' + colors.border,
          py: 1,
          px: 2
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
          <TextField
            value={level.label}
            onChange={handleChange}
            name={'label'}
            size="small"
            variant="outlined"
            placeholder="Name"
            sx={{
              flex: 1,
              '& .MuiOutlinedInput-root': {
                fontSize: '0.875rem',
                '& fieldset': {
                  borderColor: colors.border,
                },
                '&:hover fieldset': {
                  borderColor: colors.borderDark,
                },
                '&.Mui-focused fieldset': {
                  borderColor: colors.accent,
                }
              },
              '& .MuiInputBase-input': {
                color: colors.text,
                fontWeight: 500
              }
            }}
          />
        </Box>
        <IconButton
          onClick={() => {
            reset();
            onClose();
          }}
          size="small"
          sx={{
            color: colors.textDim,
            '&:hover': {
              backgroundColor: colors.hover
            }
          }}
        >
          <Close fontSize="small" />
        </IconButton>
      </DialogTitle>
      
      <DialogContent>
        <Stack spacing={2}>
          {/* Level Value */}
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={4}>
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 500,
                  color: colors.text,
                  fontSize: '0.8rem'
                }}
              >
                Elevation
              </Typography>
            </Grid>
            <Grid item xs={8}>
              <TextField
                value={level.value}
                onChange={handleChange}
                name={'value'}
              />
            </Grid>
          </Grid>

          {/* Action Buttons */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <IconButton
              onClick={handleDelete}
              size="small"
              sx={{
                color: colors.textDim,
                '&:hover': {
                  color: colors.danger,
                  backgroundColor: colors.hover
                }
              }}
            >
              <Delete fontSize="small" />
            </IconButton>
            
            <IconButton
              onClick={handleSave}
              size="small"
              sx={{
                color: colors.textDim,
                '&:hover': {
                  color: colors.accent,
                  backgroundColor: colors.hover
                }
              }}
            >
              <Save fontSize="small" />
            </IconButton>
          </Box>
        </Stack>
      </DialogContent>
    </Dialog>
  );
};

export default observer(Levels);
