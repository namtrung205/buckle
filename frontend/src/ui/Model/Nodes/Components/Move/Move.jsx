import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Select as MUISelect,
  MenuItem,
  FormControl,
  IconButton,
  Stack,
  Grid,
  Chip,
} from '@mui/material';
import {
  Close,
  Save
} from '@mui/icons-material';
import { useModel } from '../../../../../model/Context';
import { observer } from 'mobx-react-lite';
import { colors, fontFamily } from '../../../../../theme';
import * as THREE from 'three'
import Node from '../../../../../model/Elements/Node/Node'
import Dialog from '../../../../../components/Dialog/Dialog';
import Select from '../../../../../components/Select';
import TextField from '../../../../../components/TextField';

const Move = ({
  open,
  onClose,
  selectedNode
}) => {
  const model = useModel()

  // useEffect(() => {
  //   console.log('selectedNodes',selectedNodes)
  //   if(selectedNode) {
  //     setNode(selectedNode)
  //     setSelectedNodes([selectedNode.id])
  //   }
  // },[selectedNode])

  const [node, setNode] = useState({
    id : '',
    name : '', 
    x : 0,
    y : 0,
    z : 0 
  })

  const [vector, setVector] = useState({
    x : 0 , 
    y : 0,
    z : 0, 
  })

  const [editMode, setEditMode] = useState('move')

  const [repetitions, setRepetitions] = useState(1)
  
  const [selectedNodes, setSelectedNodes] = useState([])

  // Auto-populate nodes từ viewport selection khi dialog mở
  useEffect(() => {
    if (!open) return;
    const viewportSelected = model?.selector?.selected
      .map(sel => {
        let type = sel.object.userData?.type;
        let id = sel.object.userData?.id;
        if (!type && sel.object.parent) {
          type = sel.object.parent.userData?.type;
          id = sel.object.parent.userData?.id;
        }
        return type === 'node' ? id : null;
      })
      .filter(id => id != null) ?? [];
    setSelectedNodes(viewportSelected);
    // Reset translation vector khi mở dialog mới
    setVector({ x: 0, y: 0, z: 0 });
    setRepetitions(1);
  }, [open]);

  const handleChange = (e) => {
    const {name, value} = e.target
    console.log('vector',value)
    setVector({
      ...vector, 
      [name] : value
    })
  }

  const handleChangeEditMode = (e) => {
    console.log('EDIT mode', e.target.value)
    setEditMode(e.target.value)
  }

  const handleNodeSelection = (event) => {
    const { target: { value } } = event;
    setSelectedNodes(value)
  }

  const handleSave = () => {
    
    selectedNodes.forEach((nodeId) => {
      const node = model.nodes.find((el) => el.id === nodeId);
      if (!node) return;

      const { x, y, z } = node;
      let position
      switch (editMode) {
        case 'move':
          position = new THREE.Vector3(
            x + Number(vector.x) * repetitions,
            y + Number(vector.y) * repetitions, 
            z + Number(vector.z) * repetitions
          );
          node.update(position);
          break;
        case 'copy':
          for(let i = 0 ; i < repetitions; i ++){
            
            position = new THREE.Vector3(
              x + Number(vector.x) * (i + 1 ),
              y + Number(vector.y) * (i + 1 ), 
              z + Number(vector.z) * (i + 1 )
            );

            const newNode  = new Node(position)
            newNode.model = model
            newNode.create()
            model.nodes.push(newNode)
          }
          break;
        default:
          break;
      }
    });
  }

  const reset = () => {
    setVector({
      x : 0,
      y : 0,
      z : 0
    })
  }

  // Edit mode options
  const editModeOptions = [
    { id: 'move', name: 'Move' },
    { id: 'copy', name: 'Copy' },
  ];

  return(
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth={false}
      hideBackdrop
      disableEnforceFocus
      disableAutoFocus
      draggable
      title="Move Nodes"
    >
        <Stack spacing={2} sx={{ width: '280px' }}>
          {/* Node Selection Section */}
          <Box sx={{ width: '100%' }}>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 500,
                color: colors.textDim,
                fontSize: '0.8rem',
                fontFamily,
                mb: 1,
                width: '100%'
              }}
            >
              Nodes selection : 
            </Typography>
            <Box sx={{ width: '100%' }}>
              <FormControl size="small" fullWidth>
                <MUISelect
                  multiple
                  value={selectedNodes}
                  onChange={handleNodeSelection}
                  sx={{
                    width: '100%',
                    backgroundColor: colors.surfaceAlt,
                    color: colors.textDim,
                    fontSize: '0.875rem',
                    fontFamily,
                    '& .MuiOutlinedInput-notchedOutline': {
                      borderColor: colors.border,
                    },
                    '&:hover .MuiOutlinedInput-notchedOutline': {
                      borderColor: colors.borderDark,
                    },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                      borderColor: colors.accent,
                    },
                    '& .MuiSelect-icon': {
                      color: colors.textDim,
                    },
                    '& .MuiSelect-select': {
                      py: 1,
                      fontSize: '0.875rem',
                      fontFamily,
                      color: colors.textDim
                    }
                  }}
                  MenuProps={{
                    PaperProps: {
                      sx: {
                        backgroundColor: colors.surfaceAlt,
                        border: '1px solid ' + colors.border,
                        '& .MuiMenuItem-root': {
                          fontSize: '0.875rem',
                          color: colors.text,
                          '&:hover': {
                            backgroundColor: colors.hover,
                          },
                          '&.Mui-selected': {
                            backgroundColor: colors.surfaceAlt,
                          },
                        },
                      }
                    }
                  }}
                  renderValue={(selected) => {
                      return (
                        <Box sx={{ 
                          display: 'flex',
                          width: '100%', 
                          flexWrap: 'wrap', 
                          gap: 0.5,
                          border: '0px solid transparent',
                          borderRadius: '4px',
                          minHeight: '80px'
                        }}>
                        {selected.map((id) => {
                          const node = model?.nodes.find(n => n.id === id)
                          return (
                            <Chip
                              key={id}
                              label={node?.name || `Node ${id}`}
                              size="small"
                              sx={{ 
                                height: 24,
                                backgroundColor: colors.surfaceAlt,
                                color: colors.text,
                                marginTop:'0.5rem',
                                '& .MuiChip-deleteIcon': {
                                  color: colors.textDim,
                                  '&:hover': {
                                    color: colors.text
                                  }
                                }
                              }}
                            />
                          )
                        })}
                      </Box>
                    )
                  }}
                >
                  {model?.nodes?.map((node) => (
                    <MenuItem key={node.id} value={node.id}>
                      {node.name || `Node ${node.id}`}
                    </MenuItem>
                  ))}
                </MUISelect>
              </FormControl>
            </Box>
          </Box>

          <Box sx={{ width: '100%' }}>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 500,
                color: colors.textDim,
                fontSize: '0.875rem',
                fontFamily,
                mb: 1.5
              }}
            >
              Translation (m)
            </Typography>
            <Box sx={{ 
              width: '100%',
              border: '1px solid ' + colors.border,
              borderRadius: '4px',
              p: 2
            }}>
              <Stack spacing={1} sx={{ width: '100%', m: 0 }}>
                <Grid container spacing={2} alignItems="center" sx={{ m: 0 }}>
                    <Grid item xs={4}>
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 500,
                          color: colors.textDim,
                          fontSize: '0.8rem',
                          fontFamily,
                        }}
                      >
                        dX
                      </Typography>
                    </Grid>
                    <Grid item xs={8}>
                      <Box sx={{ pr: 1 }}>
                        <TextField 
                           value={vector.x}
                           onChange={handleChange}
                           name={"x"}
                           placeholder=""
                           size="small"
                           fullWidth
                        />
                      </Box>
                    </Grid>
                  </Grid>

                  <Grid container spacing={2} alignItems="center">
                    <Grid item xs={4}>
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 500,
                          color: colors.textDim,
                          fontSize: '0.8rem',
                          fontFamily,
                        }}
                      >
                        dY
                      </Typography>
                    </Grid>
                    <Grid item xs={8}>
                      <Box sx={{ pr: 1 }}>
                        <TextField 
                           value={vector.z}
                           onChange={handleChange}
                           name={"z"}
                           placeholder=""
                           size="small"
                           fullWidth
                        />
                      </Box>
                    </Grid>
                  </Grid>

                  <Grid container spacing={2} alignItems="center">
                    <Grid item xs={4}>
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 500,
                          color: colors.textDim,
                          fontSize: '0.8rem',
                          fontFamily,
                        }}
                      >
                        dZ
                      </Typography>
                    </Grid>
                    <Grid item xs={8}>
                      <Box sx={{ pr: 1 }}>
                        <TextField 
                           value={vector.y}
                           onChange={handleChange}
                           name={"y"}
                           placeholder=""
                           size="small"
                           fullWidth
                        />
                      </Box>
                    </Grid>
                  </Grid>

                  <Grid container spacing={2} alignItems="center">
                    <Grid item xs={4}>
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 500,
                          color: colors.textDim,
                          fontSize: '0.8rem',
                          fontFamily,
                        }}
                      >
                        Edit mode
                      </Typography>
                    </Grid>
                    <Grid item xs={8}>
                      <Box sx={{ pr: 1 }}>
                        <Select
                          list={editModeOptions}
                          value={editMode}
                          onChange={handleChangeEditMode}
                          size="small"
                        />
                      </Box>
                    </Grid>
                  </Grid>

                  <Grid container spacing={2} alignItems="center">
                    <Grid item xs={4}>
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 500,
                          color: colors.textDim,
                          fontSize: '0.8rem',
                          fontFamily,
                        }}
                      >
                        Repetitions
                      </Typography>
                    </Grid>
                    <Grid item xs={8}>
                      <Box sx={{ pr: 1 }}>
                        <TextField 
                          value={repetitions}
                          onChange={(e) => setRepetitions( Number(e.target.value)) }
                          name="repetitions"
                          placeholder=""
                          size="small"
                          fullWidth
                        />
                      </Box>
                    </Grid>
                  </Grid>
                </Stack>
            </Box>
          </Box>

          {/* Delete and Save buttons */}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', width: '100%', mt: 1 }}>       
            <IconButton
              onClick={handleSave}
              size="small"
              sx={{
                color: colors.text,
                '&:hover': {
                  color: colors.text,
                  backgroundColor: colors.hover,
                },
              }}
            >
              <Save fontSize="small" />
            </IconButton>
          </Box>
        </Stack>
    </Dialog>
  )
}

export default observer(Move)