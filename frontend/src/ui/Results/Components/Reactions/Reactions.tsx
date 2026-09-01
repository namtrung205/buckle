import { Box, Button, FormControlLabel, IconButton, Switch, Typography } from '@mui/material';
import { observer } from 'mobx-react-lite';
import CloseIcon from '@mui/icons-material/Close';
import { useModel } from '../../../../model/Context';
import { REACTION_COMPONENTS } from '../../../../model/PostProcessing/ReactionViz';
import { colors, fontFamily } from '../../../../theme';
import { UI, SecTitle } from '../ui';

interface ReactionsProps {
  open: boolean;
  onClose: () => void;
}

const switchSx = {
  '& .MuiSwitch-switchBase': { color: UI.dim },
  '& .MuiSwitch-switchBase.Mui-checked': { color: UI.accent },
} as const;

/**
 * Support reactions dock panel - docked to the left edge of the viewer instead
 * of a floating dialog: check the components to render (Fx..Mz), toggle the
 * value pills, then hit Apply to draw them on the model, Midas-Civil style.
 *
 * The header close button (✕) hides the panel (model.closeDialog(); the
 * "Reactions" ribbon button re-opens it.
 */
const Reactions = observer(({ open, onClose }: ReactionsProps) => {
  const model = useModel();

  // The viewer provider starts with a null model (the Model singleton is
  // created in an effect after the first paint) - bail out like
  // AnalysisProgress does until it becomes available.
  if (!model) return null;
  // Dock panel: hidden until the ribbon "Reactions" button opens it
  if (!open) return null;

  const reactionViz = model.reactionViz;
  const hasReactions = (model.output?.reactions ?? []).length > 0;

  return (
    <Box
      sx={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 300,
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'auto',
        backgroundColor: colors.surface,
        borderRight: `1px solid ${colors.border}`,
        boxShadow: '4px 0 16px rgba(0, 0, 0, 0.35)',
      }}
    >
      {/* Header + close */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          px: 1.5,
          py: 1,
          borderBottom: `1px solid ${colors.border}`,
          backgroundColor: colors.surface,
        }}
      >
        <Typography
          sx={{
            color: colors.text,
            fontSize: '0.85rem',
            fontWeight: 600,
            fontFamily,
          }}
        >
          Support Reactions
        </Typography>
        <IconButton
          aria-label="close"
          onClick={onClose}
          size="small"
          sx={{
            color: colors.textDim,
            '&:hover': { color: colors.text, backgroundColor: colors.hover },
          }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Scrollable settings body */}
      <Box sx={{ p: 2, overflowY: 'auto', flex: 1 }}>
        <Box sx={{ width: '320px' }}>
        <SecTitle>Visualization</SecTitle>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', rowGap: 0.25, mb: 0.75 }}>
          {REACTION_COMPONENTS.map((comp) => (
            <FormControlLabel
              key={comp}
              control={
                <Switch
                  size="small"
                  checked={reactionViz.show[comp]}
                  onChange={() => reactionViz.toggleComponent(comp)}
                  sx={switchSx}
                />
              }
              label={<Typography sx={{ fontSize: '0.78rem', color: UI.text }}>{comp}</Typography>}
              sx={{ margin: 0 }}
            />
          ))}
        </Box>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={reactionViz.showLabels}
              onChange={(e) => reactionViz.setShowLabels(e.target.checked)}
              sx={switchSx}
            />
          }
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
            onClick={() => reactionViz.apply()}
            sx={{
              fontFamily: UI.mono, textTransform: 'none', px: 3,
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
      </Box>
    </Box>
  );
});

export default Reactions;
