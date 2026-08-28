import { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Select,
  MenuItem,
  FormControl,
  FormControlLabel,
  Checkbox,
  Slider,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Collapse,
} from '@mui/material';
import { observer } from 'mobx-react-lite';
import { useModel } from '../../../../model/Context';
import Legend from '../Legend/Legend';
import SummaryTable from '../SummaryTable/SummaryTable';
import StationTable from '../StationTable/StationTable';
import { DIAGRAM_TYPES, DEFLECTION_TYPE } from '../../../../model/PostProcessing/PostProcessing';

const TYPE_LABELS: Record<string, string> = {
  N: 'N (kN)',
  Vy: 'Vy (kN)',
  Vz: 'Vz (kN)',
  T: 'T (kNm)',
  My: 'My (kNm)',
  Mz: 'Mz (kNm)',
  defl: 'Chuyển vị',
};

const Diagrams = observer(() => {
  const model = useModel();
  const post = model.postProcessing;
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
  const [scale, setScale] = useState<number>(1);
  const [deflScale, setDeflScale] = useState<number>(100);

  const isDefl = post.activeType === DEFLECTION_TYPE;

  const renderActive = () => {
    if (!post.activeType) return;
    if (isDefl) {
      post.deflectionMultiplier = deflScale;
      post.showDeflectedShape(selectedMembers);
    } else {
      post.scaleMultiplier = scale;
      post.showDiagram(post.activeType, selectedMembers);
    }
    // Auto-hide loads; keep the section solids visible when the contour mode is on
    model.visibility.showOrHideLoads(false);
    model.visibility.showOrHideSections(post.showContour);
  };

  const handleModeChange = (_event: any, value: string | null) => {
    if (!value) {
      post.dispose();
      return;
    }
    if (value === DEFLECTION_TYPE) {
      post.deflectionMultiplier = deflScale;
      post.showContour = true;
      post.showRibbon = true;
      post.showDeflectedShape(selectedMembers);
    } else {
      post.scaleMultiplier = scale;
      post.showDiagram(value, selectedMembers);
    }
    model.visibility.showOrHideLoads(false);
    model.visibility.showOrHideSections(post.showContour);
  };

  const handleToggle = (key: 'showRibbon' | 'showHatch' | 'showContour' | 'showLabels' | 'showRefLine') =>
    (event: any) => {
      post[key] = event.target.checked;
      renderActive();
    };

  return (
    <Box sx={{ mt: 2, mb: 2, width: '340px' }}>
      <Typography variant="subtitle2">Select members</Typography>
      <FormControl fullWidth size="small">
        <Select
          multiple
          value={selectedMembers}
          onChange={(e) => setSelectedMembers(e.target.value as number[])}
          renderValue={(selected) => (selected as number[]).map(id => model.members.find(m => m.id === id)?.label || id).join(', ')}
          sx={{
            backgroundColor: '#ffffff',
            fontSize: '0.875rem',
            '& .MuiOutlinedInput-notchedOutline': { borderColor: '#b0b0b0' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#999999' },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#666666' },
            '& .MuiSelect-select': { py: 1, fontSize: '0.875rem', color: '#333' },
          }}
          MenuProps={{
            PaperProps: {
              sx: {
                backgroundColor: '#ffffff',
                border: '1px solid #b0b0b0',
                maxHeight: 300,
              }
            }
          }}
        >
          {model.members?.map((member: any) => (
            <MenuItem key={member.id} value={member.id}>
              <Checkbox checked={selectedMembers.indexOf(member.id) > -1} size="small" sx={{ color: '#666', '&.Mui-checked': { color: '#4a90e2' } }} />
              {member.label || `Member ${member.id}`}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Typography variant="subtitle2" sx={{ mt: 2 }}>Result type</Typography>
      <ToggleButtonGroup
        value={post.activeType}
        exclusive
        onChange={handleModeChange}
        size="small"
        fullWidth
        sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}
      >
        {[...DIAGRAM_TYPES, DEFLECTION_TYPE].map((type) => (
          <ToggleButton
            key={type}
            value={type}
            sx={{
              py: 0.5,
              fontSize: '0.75rem',
              textTransform: 'none',
              '&.Mui-selected': { backgroundColor: '#4a90e2', color: '#fff', '&:hover': { backgroundColor: '#3a7bc8' } },
            }}
          >
            {TYPE_LABELS[type]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {!isDefl && post.activeType && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="body2">Diagram scale ×{scale.toFixed(1)}</Typography>
          <Slider
            value={scale}
            onChange={(_, v) => setScale(v as number)}
            onChangeCommitted={renderActive}
            min={0.2}
            max={3}
            step={0.1}
            size="small"
            valueLabelDisplay="auto"
          />
        </Box>
      )}

      {isDefl && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="body2">Exaggeration ×{deflScale}</Typography>
          <Slider
            value={deflScale}
            onChange={(_, v) => setDeflScale(v as number)}
            onChangeCommitted={renderActive}
            min={10}
            max={1000}
            step={10}
            size="small"
            valueLabelDisplay="auto"
          />
        </Box>
      )}

      {post.activeType && (
        <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          {!isDefl && (
            <>
              <FormControlLabel control={<Switch size="small" checked={post.showRibbon} onChange={handleToggle('showRibbon')} />} label={<Typography variant="body2">Filled ribbon</Typography>} sx={{ margin: 0 }} />
              <FormControlLabel control={<Switch size="small" checked={post.showHatch} onChange={handleToggle('showHatch')} />} label={<Typography variant="body2">Hatch lines</Typography>} sx={{ margin: 0 }} />
            </>
          )}
          <FormControlLabel control={<Switch size="small" checked={post.showContour} onChange={handleToggle('showContour')} />} label={<Typography variant="body2">Contour trên thanh</Typography>} sx={{ margin: 0 }} />
          <FormControlLabel control={<Switch size="small" checked={post.showLabels} onChange={handleToggle('showLabels')} />} label={<Typography variant="body2">Max / Min labels</Typography>} sx={{ margin: 0 }} />
          {isDefl && (
            <FormControlLabel control={<Switch size="small" checked={post.showRefLine} onChange={handleToggle('showRefLine')} />} label={<Typography variant="body2">Reference line (dashed)</Typography>} sx={{ margin: 0 }} />
          )}
        </Box>
      )}

      <Legend />

      {post.activeType && (
        <Box sx={{ mt: 1.5 }}>
          <SummaryTable />
          <StationTable memberIds={selectedMembers} />
        </Box>
      )}

      <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
        <Button
          variant="contained"
          size="small"
          onClick={renderActive}
          sx={{
            backgroundColor: '#ffffff',
            color: '#333',
            border: '1px solid #b0b0b0',
            '&:hover': { backgroundColor: '#f0f0f0' },
          }}
        >
          Apply
        </Button>
      </Box>
    </Box>
  );
});

export default Diagrams;
