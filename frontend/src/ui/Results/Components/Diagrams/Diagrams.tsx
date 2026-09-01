import { ChangeEvent, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Slider,
  Switch,
  Typography,
} from '@mui/material';
import { observer } from 'mobx-react-lite';
import { useModel } from '../../../../model/Context';
import { DEFLECTION_TYPE, DIAGRAM_TYPES } from '../../../../model/PostProcessing/PostProcessing';
import Legend from '../Legend/Legend';
import SummaryTable from '../SummaryTable/SummaryTable';
import StationTable from '../StationTable/StationTable';
import { UI, SecTitle } from '../ui';

interface DiagramsProps {
  variant: 'forces' | 'deformation';
}

/**
 * Forces / Deformation tab of the Results dock panel. Both variants share the
 * member filter, legend and summary tables;the forces variant additionally
 * exposes the N..Mz radios + ribbon/hatch toggles, whilethe deformation variant
 * exposes the exaggeration slider + reference-line toggle.Apply pushes the current
 * selection to the viewer post-processing.
 */
const Diagrams = observer(({ variant }: DiagramsProps) => {
  const model = useModel();
  const post = model.postProcessing;
  const isDefl = variant === 'deformation';
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
  const [scale, setScale] = useState<number>(1);
  const [deflScale, setDeflScale] = useState<number>(5);
  const [forceType, setForceType] = useState<string | null>(
    post.activeType && !isDefl && post.activeType !== DEFLECTION_TYPE ? post.activeType : null,
  );

  const applyForce = (type: string | null) => {
    if (!type) return;
    // Result visualizations are exclusive: applying a diagram clears the reactions
    model.reactionViz.dispose();
    post.scaleMultiplier = scale;
    post.showDiagram(type, selectedMembers);
    // Forces render on the member centreline - hide the solid section; contour paints the
    // centreline with the colormap (hiding the neutral grey line), otherwise keep it
    model.visibility.showOrHideSections(false);
    model.visibility.showOrHideMembers(!post.showContour);
    model.visibility.showOrHideLoads(false);
  };

  const applyDeformation = () => {
    // Result visualizations are exclusive: applying the deflected shape clears the reactions
    model.reactionViz.dispose();
    post.deflectionMultiplier = deflScale;
    post.showContour = true;
    post.showRibbon = true;
    post.showDeflectedShape(selectedMembers);
    model.visibility.showOrHideLoads(false);
    model.visibility.showOrHideSections(post.showContour);
  };

  const renderActive = () => {
    if (isDefl) applyDeformation();
    else if (post.activeType) applyForce(post.activeType);
  };

  const handleToggle = (key: 'showRibbon' | 'showHatch' | 'showContour' | 'showLabels' | 'showRefLine') =>
    (event: ChangeEvent<HTMLInputElement>) => {
      post[key] = event.target.checked;
      if (key === 'showContour') {
        // Forces contour paints the centreline (sections stay hidden); deformation keeps the solid
        if (isDefl) model.visibility.showOrHideSections(post.showContour);
        else {
          model.visibility.showOrHideSections(false);
          model.visibility.showOrHideMembers(!post.showContour);
        }
      }
      renderActive();
    };

  const switchSx = {
    '& .MuiSwitch-switchBase': { color: UI.dim },
    '& .MuiSwitch-switchBase.Mui-checked': { color: UI.accent },
  } as const;

  return (
    <Box>
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
        >
          {model.members?.map((member: any) => (
            <MenuItem key={member.id} value={member.id}>
              <Checkbox checked={selectedMembers.indexOf(member.id) > -1} size="small" sx={{ color: UI.dim, '&.Mui-checked': { color: UI.accent } }} />
              {member.label || `Member ${member.id}`}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {!isDefl && (
        <>
          <Box sx={{ mt: 2 }}><SecTitle>Result type</SecTitle></Box>
          <RadioGroup
            value={forceType ?? ''}
            onChange={(e) => setForceType(e.target.value)}
            sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', rowGap: 0.25 }}
          >
            {DIAGRAM_TYPES.map((type) => (
              <FormControlLabel
                key={type}
                value={type}
                control={<Radio size="small" sx={{ color: UI.dim, '&.Mui-checked': { color: UI.accent } }} />}
                label={<Typography sx={{ fontSize: '0.78rem', color: UI.text, fontFamily: UI.mono }}>{type}</Typography>}
                sx={{ margin: 0 }}
              />
            ))}
          </RadioGroup>
        </>
      )}

      {!isDefl && (
        <Box sx={{ mt: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography sx={{ fontFamily: UI.mono, fontSize: '11px', color: UI.dim }}>Diagram scale</Typography>
            <Typography sx={{ fontFamily: UI.mono, fontSize: '11px', fontWeight: 700, color: UI.text }}>×{scale.toFixed(1)}</Typography>
          </Box>
          <Slider
            value={scale}
            onChange={(_, v) => setScale(v as number)}
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
            min={1} max={100} step={1} size="small"
            sx={{ color: UI.accent }}
          />
        </Box>
      )}

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

      <Legend />
      {post.activeType && (
        <Box sx={{ mt: 1.5 }}>
          <SummaryTable />
          <StationTable memberIds={selectedMembers} />
        </Box>
      )}

      <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
        {isDefl ? (
          <Button variant="contained" size="small" onClick={applyDeformation} sx={{ fontFamily: UI.mono, textTransform: 'none', px: 3, backgroundColor: UI.panel, color: UI.text, border: `1px solid ${UI.borderDark}`, boxShadow: 'none', '&:hover': { backgroundColor: UI.panel2, boxShadow: 'none' } }}>
            Apply
          </Button>
        ) : (
          <Button
            variant="contained"
            size="small"
            disabled={!forceType}
            onClick={() => applyForce(forceType)}
            sx={{
              fontFamily: UI.mono,
              textTransform: 'none', px: 3,
              backgroundColor: UI.panel, color: UI.text,
              border: `1px solid ${UI.borderDark}`,
              boxShadow: 'none',
              '&:hover': { backgroundColor: UI.panel2, boxShadow: 'none' },
              '&.Mui-disabled': { color: UI.dim, backgroundColor: UI.panel },
            }}
          >
            Apply
          </Button>
        )}
      </Box>
    </Box>
  );
});

export default Diagrams;