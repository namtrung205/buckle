import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  MenuItem,
  Stack,
  Button,
  FormControl,
  Chip,
  Checkbox,
  FormControlLabel,
  FormHelperText,
  SelectChangeEvent,
  Tabs,
  Tab,
  Select as MUISelect,
} from '@mui/material';
import { Save as SaveIcon } from '@mui/icons-material';
import { observer } from 'mobx-react-lite';
import { colors, fieldLabelSx } from '../../../theme';
import Dialog from '../../../components/Dialog/Dialog';
import { useModel } from '../../../model/Context';
import BoundaryCondition from '../../../model/BoundaryCondition/BoundaryCondition';
import TextField from '../../../components/TextField/TextField';
import Elastic from './Elastic';
import Select from '../../../components/Select/';

// Per-DOF restraint list (Midas-Civil style). Order matches the hexagon
// support symbol: translations first (Dx, Dy, Dz), then rotations (Rx, Ry, Rz).
const restraintDefs = [
  { key: 'dx', label: 'Dx' },
  { key: 'dy', label: 'Dy' },
  { key: 'dz', label: 'Dz' },
  { key: 'rx', label: 'Rx' },
  { key: 'ry', label: 'Ry' },
  { key: 'rz', label: 'Rz' },
] as const;

type RestraintKey = typeof restraintDefs[number]['key'];

interface AddOrEditProps {
  open: boolean;
  onClose: () => void;
  selectedBoundaryCondition?: BoundaryCondition | null;
}

const AddOrEdit = observer(({ open, onClose, selectedBoundaryCondition = null }: AddOrEditProps) => {
  const model = useModel();
  const [currentTab, setCurrentTab] = useState(0);
  
  const [bc, setBc] = useState({
    id: null as number | null,
    name: '',
    type: 'fixed' as 'fixed' | 'pinned' | 'roller' | 'roller-x' | 'roller-y' | 'custom' | 'elastic',
    targets: [] as number[],
    rotation: '0',
    dx: '0',
    dy: '0',
    dz: '0',
    rx: '0',
    ry: '0',
    rz: '0',
    fix_dx: false,
    fix_dy: false,
    fix_dz: false,
    fix_rx: false,
    fix_ry: false,
    fix_rz: false,
  });
  const [targetsError, setTargetsError] = useState(false);

  useEffect(() => {
    if (!open) return;

    if (selectedBoundaryCondition) {
      const isElastic = selectedBoundaryCondition.type === 'elastic';
      setCurrentTab(isElastic ? 1 : 0);
      setBc({
        id: selectedBoundaryCondition.id,
        name: selectedBoundaryCondition.name || '',
        type: selectedBoundaryCondition.type,
        targets: selectedBoundaryCondition.targets || [],
        rotation: String(selectedBoundaryCondition.rotation || 0),
        dx: String(selectedBoundaryCondition.dx ?? '0'),
        dy: String(selectedBoundaryCondition.dy ?? '0'),
        dz: String(selectedBoundaryCondition.dz ?? '0'),
        rx: String(selectedBoundaryCondition.rx ?? '0'),
        ry: String(selectedBoundaryCondition.ry ?? '0'),
        rz: String(selectedBoundaryCondition.rz ?? '0'),
        fix_dx: false,
        fix_dy: false,
        fix_dz: false,
        fix_rx: false,
        fix_ry: false,
        fix_rz: false,
      });
    } else {
      reset();
      setCurrentTab(0);
      // Pre-assign the support to the nodes currently selected in the viewport
      const selectedNodeIds = model?.selector.selected
        .map((item) => {
          if (item.object.userData?.type === 'node') return item.object.userData?.id;
          if (item.object.parent?.userData?.type === 'node') return item.object.parent?.userData?.id;
          return undefined;
        })
        .filter((id): id is number => typeof id === 'number') || [];
      setBc((prev) => ({
        ...prev,
        targets: Array.from(new Set(selectedNodeIds)),
        // Default to the Fixed preset (all DOFs restrained)
        dx: '1', dy: '1', dz: '1', rx: '1', ry: '1', rz: '1',
      }));
    }
  }, [open, selectedBoundaryCondition]);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setCurrentTab(newValue);
    if (newValue === 0) {
      // Rigid tab - switch back from elastic with the Fixed restraint preset
      if (bc.type === 'elastic') {
        setBc({ ...bc, type: 'fixed', dx: '1', dy: '1', dz: '1', rx: '1', ry: '1', rz: '1' });
      }
    } else {
      // Elastic tab - set type to elastic
      setBc({ ...bc, type: 'elastic' });
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setBc({ ...bc, [name]: value });
  };

  const handleElasticChange = (field: string, value: string) => {
    setBc({ ...bc, [field]: value });
  };

  const handleFixedChange = (field: string, fixed: boolean) => {
    const fixedField = `fix_${field}`;
    if (fixed) {
      setBc((prev) => ({ ...prev, [fixedField]: true, [field]: '1e10' }));
    } else {
      setBc((prev) => ({ ...prev, [fixedField]: false, [field]: '0' }));
    }
  };

  const handleTargetsChange = (event: SelectChangeEvent<typeof bc.targets>) => {
    const { value } = event.target;
    const next =
      typeof value === 'string'
        ? value
            .split(',')
            .map((item) => Number(item.trim()))
            .filter((n) => !Number.isNaN(n))
        : (value as number[]);
    setTargetsError(false);
    setBc((prev) => ({ ...prev, targets: next }));
  };

  // Quick presets — mirror the restraint flag sets of BoundaryCondition.createOrUpdate
  const applyRestraintPreset = (preset: string) => {
    const flags: Record<string, string> = {
      fixed: '111111', // Dx Dy Dz Rx Ry Rz
      pinned: '111100', // Rx restrained to prevent torsional mechanism
      roller: '011100', // Vertical + out-of-plane restraint, free horizontal
    };
    const f = flags[preset];
    setBc((prev) => ({
      ...prev,
      type: preset as any,
      dx: f ? f[0] : prev.dx,
      dy: f ? f[1] : prev.dy,
      dz: f ? f[2] : prev.dz,
      rx: f ? f[3] : prev.rx,
      ry: f ? f[4] : prev.ry,
      rz: f ? f[5] : prev.rz,
    }));
  };

  // Individual DOF toggle — any manual change turns the support into Custom
  const handleRestraintChange = (field: RestraintKey, checked: boolean) => {
    setBc((prev) => ({ ...prev, type: 'custom', [field]: checked ? '1' : '0' }));
  };

  const getTargetLabel = (id: number) => {
    if (!model) return `Node ${id}`;
    const node = model.nodes.find((n) => n.id === id);
    return node?.name || `Node ${id}`;
  };

  const reset = () => {
    setBc({
      id: null,
      name: '',
      type: 'fixed',
      targets: [],
      rotation: '0',
      dx: '0',
      dy: '0',
      dz: '0',
      rx: '0',
      ry: '0',
      rz: '0',
      fix_dx: false,
      fix_dy: false,
      fix_dz: false,
      fix_rx: false,
      fix_ry: false,
      fix_rz: false,
    });
  };

  const handleSave = () => {
    if (!model) return;

    // A support must reference at least one node
    if (!bc.targets.length) {
      setTargetsError(true);
      return;
    }

    const id = selectedBoundaryCondition?.id || Math.floor(Math.random() * 0x7FFFFFFF);
    const rotation = Number(bc.rotation) || 0;

    const boundaryConditionData: any = {
      id,
      name: bc.name || `Support ${model.boundaryConditions.length + 1}`,
      type: bc.type,
      targets: bc.targets,
      rotation,
    };

    // Add elastic properties if type is elastic
    if (bc.type === 'elastic') {
      boundaryConditionData.dx = Number(bc.dx) || 0;
      boundaryConditionData.dy = Number(bc.dy) || 0;
      boundaryConditionData.dz = Number(bc.dz) || 0;
      boundaryConditionData.rx = Number(bc.rx) || 0;
      boundaryConditionData.ry = Number(bc.ry) || 0;
      boundaryConditionData.rz = Number(bc.rz) || 0;
    } else {
      // Per-DOF restraints from the Midas-style DOF list (1 = restrained)
      boundaryConditionData.dx = bc.dx === '1' ? 1 : 0;
      boundaryConditionData.dy = bc.dy === '1' ? 1 : 0;
      boundaryConditionData.dz = bc.dz === '1' ? 1 : 0;
      boundaryConditionData.rx = bc.rx === '1' ? 1 : 0;
      boundaryConditionData.ry = bc.ry === '1' ? 1 : 0;
      boundaryConditionData.rz = bc.rz === '1' ? 1 : 0;
    }

    if (selectedBoundaryCondition) {
      Object.assign(selectedBoundaryCondition, boundaryConditionData);
      selectedBoundaryCondition.createOrUpdate();
    } else {
      const newBC = new BoundaryCondition(model, boundaryConditionData as any);
      newBC.createOrUpdate();
    }

    reset();
    onClose();
  };

  const handleCancel = () => {
    reset();
    onClose();
  };

  const actions = (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <Button
        variant="outlined"
        color="inherit"
        size="small"
        onClick={handleCancel}
      >
        Cancel
      </Button>
      <Button
        variant="contained"
        size="small"
        onClick={handleSave}
        startIcon={<SaveIcon sx={{ fontSize: '0.875rem' }} />}
      >
        Save
      </Button>
    </Box>
  );

  // Get node options for targets
  const nodeOptions = model?.nodes.map((node) => ({
    value: node.id,
    label: node.name || `Node ${node.id}`,
  })) || [];

  // Get type options for rigid support types
  const types = [
    { id: 'fixed', name: 'Fixed' },
    { id: 'pinned', name: 'Pinned' },
    { id: 'roller', name: 'Roller' },
    { id: 'custom', name: 'Custom' },
  ];

  return (
    <Dialog
      open={open}
      onClose={handleCancel}
      maxWidth="xs"
      fullWidth={false}
      draggable
      title={selectedBoundaryCondition ? 'Edit Support' : 'Add Support'}
      actions={actions}
    >
        <Stack spacing={0}>
          {/* Tabs */}
          <Box sx={{ borderBottom: '1px solid ' + colors.border, backgroundColor: colors.surface }}>
            <Tabs
              value={currentTab}
              onChange={handleTabChange}
              sx={{
                minHeight: 'auto',
                '& .MuiTab-root': {
                  minHeight: 'auto',
                  padding: '8px 16px',
                  fontSize: '0.75rem',
                  textTransform: 'none',
                  fontWeight: 500,
                  color: colors.text,
                  '&.Mui-selected': {
                    color: colors.text,
                    fontWeight: 600,
                  },
                },
                '& .MuiTabs-indicator': {
                  backgroundColor: colors.accent,
                  height: 2,
                },
              }}
            >
              <Tab label="Rigid" />
              <Tab label="Elastic" />
            </Tabs>
          </Box>

          <Box sx={{ p: 2 }}>
            <Stack spacing={1.5}>
              {/* Name */}
              <Box>
                <Typography
                  sx={fieldLabelSx}
                >
                  Name
                </Typography>
                <TextField
                  value={bc.name}
                  onChange={handleChange}
                  name="name"
                  placeholder="Support name"
                  fullWidth
                />
              </Box>

              {/* Targets */}
              <Box>
                <Typography
                  sx={fieldLabelSx}
                >
                  Nodes
                </Typography>
                <FormControl fullWidth size="small" error={targetsError}>
                  <MUISelect
                    multiple
                    value={bc.targets}
                    onChange={handleTargetsChange}
                    size="small"
                    fullWidth
                    renderValue={(selected) => {
                      const values = selected as number[];
                      if (!values.length) return 'Select nodes';
                      return (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                          {values.map((id) => (
                            <Chip
                              key={id}
                              label={getTargetLabel(id)}
                              size="small"
                              sx={{
                                backgroundColor: colors.surfaceAlt,
                                color: colors.text,
                                '& .MuiChip-deleteIcon': {
                                  color: colors.text,
                                  '&:hover': {
                                    color: colors.danger,
                                  },
                                },
                              }}
                            />
                          ))}
                        </Box>
                      );
                    }}
                    sx={{
                      backgroundColor: colors.surfaceAlt,
                      fontSize: '0.875rem',
                      '& .MuiOutlinedInput-notchedOutline': {
                        borderColor: colors.border,
                      },
                      '&:hover .MuiOutlinedInput-notchedOutline': {
                        borderColor: colors.borderDark,
                      },
                      '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                        borderColor: colors.accent,
                      },
                      '& .MuiSelect-select': {
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 0.5,
                        minHeight: '32px',
                        alignItems: 'center',
                        color: colors.text,
                      },
                    }}
                    MenuProps={{
                      PaperProps: {
                        sx: {
                          backgroundColor: colors.surface,
                          border: '1px solid ' + colors.border,
                          maxHeight: 300,
                          '& .MuiMenuItem-root': {
                            fontSize: '0.85rem',
                            color: colors.text,
                            '&:hover': {
                              backgroundColor: colors.hover,
                            },
                            '&.Mui-selected': {
                              backgroundColor: colors.active,
                            },
                          },
                        },
                      },
                    }}
                  >
                    {nodeOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </MUISelect>
                  {targetsError && (
                    <FormHelperText>Select at least one node</FormHelperText>
                  )}
                </FormControl>
              </Box>

              {/* Tab-specific content */}
              {currentTab === 0 ? (
                // Rigid tab
                <>
                  {/* Type (quick presets) */}
                  <Box>
                    <Typography
                      sx={fieldLabelSx}
                    >
                      Type
                    </Typography>
                    <Select
                      label={''}
                      list={types}
                      value={bc.type === 'elastic' ? 'fixed' : bc.type}
                      onChange={(e: any) => applyRestraintPreset(e.target.value)}
                      size="small"
                    />
                  </Box>

                  {/* Per-DOF restraints (Midas-Civil style DOF list) */}
                  <Box>
                    <Typography
                      sx={fieldLabelSx}
                    >
                      Restraints
                    </Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', rowGap: 0.25, columnGap: 1 }}>
                      {restraintDefs.map((def) => (
                        <FormControlLabel
                          key={def.key}
                          control={
                            <Checkbox
                              checked={bc[def.key] === '1'}
                              onChange={(e) => handleRestraintChange(def.key, e.target.checked)}
                              size="small"
                              sx={{ color: colors.textDim, p: 0.25, '&.Mui-checked': { color: colors.accent } }}
                            />
                          }
                          label={def.label}
                          sx={{
                            m: 0,
                            '& .MuiFormControlLabel-label': { fontSize: '0.75rem', color: colors.text },
                          }}
                        />
                      ))}
                    </Box>
                    <Typography sx={{ fontSize: '0.65rem', color: colors.textFaint, mt: 0.5 }}>
                      Checked = restrained (green sector) — Unchecked = free (red sector)
                    </Typography>
                  </Box>

                  {/* Rotation */}
                  <Box>
                    <Typography
                      sx={fieldLabelSx}
                    >
                      Rotation
                    </Typography>
                    <TextField
                      value={bc.rotation}
                      onChange={handleChange}
                      name="rotation"
                      placeholder="0"
                      fullWidth
                    />
                  </Box>
                </>
              ) : (
                // Elastic tab
                <>
                  <Elastic
                    bc={bc}
                    onChange={handleElasticChange}
                    onFixedChange={handleFixedChange}
                  />
                </>
              )}
            </Stack>
          </Box>
        </Stack>
    </Dialog>
  );
});

export default AddOrEdit;

