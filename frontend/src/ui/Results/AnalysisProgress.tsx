import { Box, Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import { observer } from 'mobx-react-lite';
import { useModel } from '../../model/Context';
import { useEffect, useRef } from 'react';
import { Prompt } from '../../types';

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
          bgcolor: '#2d2d2d',
          color: '#e0e0e0',
          border: '1px solid #404040',
        }
      }}
    >
      <DialogTitle sx={{ borderBottom: '1px solid #404040', pb: 2 }}>
        Analysis Progress
        {!model.console.isFinished && (
          <Typography component="span" sx={{ ml: 2, fontSize: '0.9rem', color: '#90caf9', fontStyle: 'italic' }}>
            Calculation in progress...
          </Typography>
        )}
      </DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        <Box 
          sx={{ 
            height: '400px', 
            bgcolor: '#1e1e1e', 
            p: 2, 
            overflowY: 'auto',
            fontFamily: 'monospace',
            display: 'flex',
            flexDirection: 'column',
            gap: 0.5
          }}
        >
          {model.console.prompts.map((line: Prompt, index: number) => (
            <Typography key={index} sx={{ fontSize: '0.85rem', color: line.message.includes('ERROR') ? '#f44336' : '#a0a0a0', fontFamily: 'monospace' }}>
              {line.message}
            </Typography>
          ))}
          <div ref={logsEndRef} />
        </Box>
      </DialogContent>
      <DialogActions sx={{ borderTop: '1px solid #404040', p: 2 }}>
        <Button 
          onClick={onClose} 
          sx={{ color: '#a0a0a0' }}
        >
          Close
        </Button>
        <Button 
          onClick={onViewResults} 
          variant="contained" 
          disabled={!model.console.isFinished}
          sx={{ 
            bgcolor: '#1976d2',
            '&:hover': { bgcolor: '#115293' },
            '&.Mui-disabled': {
              bgcolor: '#3d3d3d',
              color: '#666'
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
