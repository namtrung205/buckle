import { Box, Button, FormControlLabel, Switch, Typography } from '@mui/material';
import { observer } from 'mobx-react-lite';
import { useModel } from '../../../../model/Context';
import { REACTION_COMPONENTS } from '../../../../model/PostProcessing/ReactionViz';
import { UI, SecTitle } from '../ui';

const switchSx = {
  '& .MuiSwitch-switchBase': { color: UI.dim },
  '& .MuiSwitch-switchBase.Mui-checked': { color: UI.accent },
} as const;

/**
 * Reactions tab of the Results dock panel: check the components to render
 * (Fx..Mz), togglethe value pills, then hit Apply to draw them on the model.
 */
const Reactions = observer(() => {
  const model = useModel();

  // The viewer provider starts with a null model (the Model singleton is
  // created in an effect after the first paint) - bail out like
  // AnalysisProgress does until it becomes available.
  if (!model) return null;
  const reactionViz = model.reactionViz;
  const hasReactions = (model.output?.reactions ?? []).length > 0;

  return (
    <Box>
      <SecTitle>Visualization</SecTitle>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', rowGap: 0.25, mb:  0.75 }}>
        {REACTION_COMPONENTS.map((comp) => (
          <FormControlLabel
            key={comp}
            control={<Switch size="small" checked={reactionViz.show[comp]} onChange={() => reactionViz.toggleComponent(comp)} sx={switchSx} />}
            label={<Typography sx={{ fontSize: '0.78rem', color: UI.text }}>{comp}</Typography>}
            sx={{ margin: 0 }}
          />
        ))}
      </Box>
      <FormControlLabel
        control={<Switch size="small" checked={reactionViz.showLabels} onChange={(e) => reactionViz.setShowLabels(e.target.checked)} sx={switchSx} />}
        label={<Typography sx={{ fontSize: '0.78rem', color: UI.text }}>Value</Typography>}
        sx={{ margin: 0 }}
      />

      {!hasReactions && (
        <Typography sx={{ mt: 1, fontFamily: UI.mono, fontSize: '10.5px', color: UI.dim }}>
          No analysis results - run an analysis first.
        </Typography>
      )}

      <Box sx={{ mt: 1.5, display: 'flex', justifyContent: 'center' }}>
        <Button
          variant="contained"
          size="small"
          disabled={!hasReactions}
          onClick={() => {
            // Result visualizations are exclusive: applying reactions clears
            // any force diagram / deflected shape on screen
            model.postProcessing.dispose();
            reactionViz.apply();
          }}
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
      </Box>
    </Box>
  );
});

export default Reactions;