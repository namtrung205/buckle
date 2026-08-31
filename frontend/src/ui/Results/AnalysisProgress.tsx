import { Box, Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import { observer } from 'mobx-react-lite';
import { useModel } from '../../model/Context';
import { useEffect, useRef } from 'react';
import { Prompt } from '../../types';
import { colors } from '../../theme';

interface AnalysisProgressProps {
  open: boolean;
  onClose: () => void;
  onViewResults: () => void;
}

const AnalysisProgress = observer(({ open, onClose, onViewResults }: AnalysisProgressProps) => {
  const model = useModel();
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as new logs appear
  useEffect(() => {
    if (open && model) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [model?.console.prompts.length, open]);

  if (!model) return null;

  return (
    <Dialog 
      open={open} 
      maxWidth="md" 
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: colors.surface,
          color: colors.text,
          border: `1px solid ${colors.border}`,
        }
      }}
    >
      <DialogTitle sx={{ borderBottom: `1px solid ${colors.border}`, pb: 2 }}>
        Analysis Progress
        {!model.console.isFinished && (
          <Typography component="span" sx={{ ml: 2, fontSize: '0.9rem', color: colors.accentSoft, fontStyle: 'italic' }}>
            Calculation in progress...
          </Typography>
        )}
      </DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        <Box 
          sx={{ 
            height: '400px', 
            backgroundColor: colors.bg, 
            p: 2, 
            overflowY: 'auto',
            fontFamily: 'monospace',
            display: 'flex',
            flexDirection: 'column',
            gap: 0.5
          }}
        >
          {model.console.prompts.map((line: Prompt, index: number) => (
            <Typography key={index} sx={{ fontSize: '0.85rem', color: line.message.includes('ERROR') ? colors.danger : colors.textDim, fontFamily: 'monospace' }}>
              {line.message}
            </Typography>
          ))}
          <div ref={logsEndRef} />
        </Box>
      </DialogContent>
      <DialogActions sx={{ borderTop: `1px solid ${colors.border}`, p: 2 }}>
        <Button 
          onClick={onClose} 
          color="inherit"
        >
          Close
        </Button>
        <Button 
          onClick={onViewResults} 
          variant="contained" 
          disabled={!model.console.isFinished}
          sx={{ 
            '&.Mui-disabled': {
              backgroundColor: colors.surfaceAlt,
              color: colors.textFaint
            }
          }}
        >
          View Results
        </Button>
      </DialogActions>
    </Dialog>
  );
});

export default AnalysisProgress;
