import { useState } from 'react';
import {
  Box,
  Button,
  Select,
  MenuItem,
  FormControl,
  Checkbox,
  Slider,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  FormControlLabel,
  Typography,
} from '@mui/material';
import { observer } from 'mobx-react-lite';
import { useModel } from '../../../../model/Context';
import Legend from '../Legend/Legend';
import SummaryTable from '../SummaryTable/SummaryTable';
import StationTable from '../StationTable/StationTable';
import { DIAGRAM_TYPES, DEFLECTION_TYPE } from '../../../../model/PostProcessing/PostProcessing';
import { UI, SecTitle } from '../ui';

const TYPE_LABELS: Record<string, string> = {
  N: 'N', Vy: 'Vy', Vz: 'Vz', T: 'T', My: 'My', Mz: 'Mz', defl: 'Chuyển vị',
};

const Diagrams = observer(() => {
  const model = useModel();
  const post = model.postProcessing;
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
  const [scale, setScale] = useState<number>(1);
  const [deflScale, setDeflScale] = useState<number>(100);

  const isDefl = post.activeType === DEFLECTION_TYPE;

  const applyView = (type: string | null) => {
    if (!type) {
      post.dispose();
      return;
    }
    if (type === DEFLECTION_TYPE) {
      post.deflectionMultiplier = deflScale;
      post.showContour = true;
      post.showRibbon = true;
      post.showDeflectedShape(selectedMembers);
    } else {
      post.scaleMultiplier = scale;
      post.showDiagram(type, selectedMembers);
    }
    model.visibility.showOrHideLoads(false);
    model.visibility.showOrHideSections(post.showContour);
  };

  const renderActive = () => applyView(post.activeType);

  const handleModeChange = (_event: any, value: string | null) => {
    setSelectedMembers(selectedMembers); // keep selection across mode switches
    applyView(value);
  };

  const handleToggle = (key: 'showRibbon' | 'showHatch' | 'showContour' | 'showLabels' | 'showRefLine') =>
    (event: any) => {
      post[key] = event.target.checked;
      if (key === 'showContour') model.visibility.showOrHideSections(post.showContour);
      renderActive();
    };

  const switchSx = {
    '& .MuiSwitch-switchBase': { color: UI.dim },
    '& .MuiSwitch-switchBase.Mui-checked': { color: UI.accent },
  } as const;

  return (
    <Box sx={{ mt: 2, mb: 2, width: '340px' }}>
      <SecTitle>Members</SecTitle>
      <FormControl fullWidth size="small">
        <Select
          multiple
          value={selectedMembers}
          onChange={(e) => setSelectedMembers(e.target.value as number[])}
          renderValue={(selected) => (selected as number[]).map(id => model.members.find((m: any) => m.id === id)?.label || id).join(', ')}
          sx={{
            backgroundColor: UI.panel,
            fontSize: '0.8rem',
            fontFamily: UI.mono,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: UI.borderDark },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: UI.dim },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: UI.accent },
            '& .MuiSelect-select': { py: 0.9, color: UI.text },
          }}
          MenuProps={{
            PaperProps: {
              sx: {
                backgroundColor: UI.panel,
                border: `1px solid ${UI.border}`,
                maxHeight: 300,
                '& .MuiMenuItem-root': { fontFamily: UI.mono, fontSize: '0.8rem', color: UI.text },
              },
            },
          }}
        >
          {model.members?.map((member: any) => (
            <MenuItem key={member.id} value={member.id}>
              <Checkbox checked={selectedMembers.indexOf(member.id) > -1} size="small" sx={{ color: UI.dim, '&.Mui-checked': { color: UI.accent } }} />
              {member.label || `Member ${member.id}`}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Box sx={{ mt: 2 }}><SecTitle>Result type</SecTitle></Box>
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
              py: 0.5, px: 1, flex: '1 1 30%',
              fontSize: '0.72rem', fontFamily: UI.mono, textTransform: 'none',
              color: UI.text, borderColor: UI.borderDark,
              '&:hover': { backgroundColor: UI.panel2 },
              '&.Mui-selected': {
                backgroundColor: UI.accent, color: '#fff',
                '&:hover': { backgroundColor: UI.accentDark },
              },
            }}
          >
            {TYPE_LABELS[type]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {!isDefl && post.activeType && (
        <Box sx={{ mt: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography sx={{ fontFamily: UI.mono, fontSize: '11px', color: UI.dim }}>Diagram scale</Typography>
            <Typography sx={{ fontFamily: UI.mono, fontSize: '11px', fontWeight: 700, color: UI.text }}>×{scale.toFixed(1)}</Typography>
          </Box>
          <Slider
            value={scale}
            onChange={(_, v) => setScale(v as number)}
            onChangeCommitted={renderActive}
            min={0.2} max={3} step={0.1} size="small"
            sx={{ color: UI.accent }}
          />
        </Box>
      )}

      {isDefl && (
        <Box sx={{ mt: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography sx={{ fontFamily: UI.mono, fontSize: '11px', color: UI.dim }}>Exaggeration</Typography>
            <Typography sx={{ fontFamily: UI.mono, fontSize: '11px', fontWeight: 700, color: UI.text }}>×{deflScale}</Typography>
          </Box>
          <Slider
            value={deflScale}
            onChange={(_, v) => setDeflScale(v as number)}
            onChangeCommitted={renderActive}
            min={10} max={1000} step={10} size="small"
            sx={{ color: UI.accent }}
          />
        </Box>
      )}

      {post.activeType && (
        <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          {!isDefl && (
            <>
              <FormControlLabel control={<Switch size="small" checked={post.showRibbon} onChange={handleToggle('showRibbon')} sx={switchSx} />} label={<Typography sx={{ fontSize: '0.78rem', color: UI.text }}>Filled ribbon</Typography>} sx={{ margin: 0 }} />
              <FormControlLabel control={<Switch size="small" checked={post.showHatch} onChange={handleToggle('showHatch')} sx={switchSx} />} label={<Typography sx={{ fontSize: '0.78rem', color: UI.text }}>Hatch lines</Typography>} sx={{ margin: 0 }} />
            </>
          )}
          <FormControlLabel control={<Switch size="small" checked={post.showContour} onChange={handleToggle('showContour')} sx={switchSx} />} label={<Typography sx={{ fontSize: '0.78rem', color: UI.text }}>Contour trên thanh</Typography>} sx={{ margin: 0 }} />
          <FormControlLabel control={<Switch size="small" checked={post.showLabels} onChange={handleToggle('showLabels')} sx={switchSx} />} label={<Typography sx={{ fontSize: '0.78rem', color: UI.text }}>Max / Min tags</Typography>} sx={{ margin: 0 }} />
          {isDefl && (
            <FormControlLabel control={<Switch size="small" checked={post.showRefLine} onChange={handleToggle('showRefLine')} sx={switchSx} />} label={<Typography sx={{ fontSize: '0.78rem', color: UI.text }}>Reference line (dashed)</Typography>} sx={{ margin: 0 }} />
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
            fontFamily: UI.mono, textTransform: 'none', px: 3,
            backgroundColor: UI.panel, color: UI.text,
            border: `1px solid ${UI.borderDark}`,
            boxShadow: 'none',
            '&:hover': { backgroundColor: UI.panel2, boxShadow: 'none' },
          }}
        >
          Apply
        </Button>
      </Box>
    </Box>
  );
});

export default Diagrams;
