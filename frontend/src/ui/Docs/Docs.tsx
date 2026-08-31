import { useState } from 'react';
import { colors, fontFamily } from '../../theme';
import {
  Box,
  Tabs,
  Tab,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Typography,
} from '@mui/material';
import Draggable from 'react-draggable';
import { Close } from '@mui/icons-material';
import Benchmarks from './Benchmarks/Benchmarks';
import Help from './Help/Help';

interface DocsProps {
  open: boolean;
  onClose: () => void;
}

function DraggablePaper(props: any) {
  return (
    <Draggable
      handle="#draggable-dialog-title"
      cancel={'[class*="MuiDialogContent-root"]'}
      defaultPosition={{ x: 0, y: 0 }}
    >
      <Paper {...props} />
    </Draggable>
  );
}

const Docs = ({ open, onClose }: DocsProps) => {
  const [currentTab, setCurrentTab] = useState(0);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setCurrentTab(newValue);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      hideBackdrop
      disableEnforceFocus
      disableAutoFocus
      PaperComponent={DraggablePaper}
      PaperProps={{
        sx: {
          backgroundColor: colors.surface,
          borderRadius: '8px',
          border: '1px solid ' + colors.border,
          boxShadow: '0 4px 8px rgba(0, 0, 0, 0.15)',
          width: '400px',
          maxWidth: '400px',
          maxHeight: '50vh',
          pointerEvents: 'auto',
          position: 'fixed',
          top: '126px',
          left: '300px',
          margin: 0,
        },
      }}
      sx={{
        pointerEvents: 'none',
        '& .MuiDialog-container': {
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
          padding: 0,
        },
        '& .MuiPaper-root': {
          pointerEvents: 'auto',
          position: 'fixed !important',
          top: '135px !important',
          left: '300px !important',
          margin: 0,
          width: '400px !important',
          maxWidth: '400px !important',
        },
      }}
    >
      <DialogTitle
        id="draggable-dialog-title"
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: colors.surface,
          borderBottom: '1px solid ' + colors.border,
          py: 1,
          px: 2,
          cursor: 'move',
        }}
      >
        <Typography
          sx={{
            color: colors.text,
            fontSize: '0.9rem',
            fontWeight: 400,
            fontFamily,
          }}
        >
          Documentation
        </Typography>
        <IconButton
          onClick={onClose}
          size="small"
          sx={{
            color: colors.textDim,
            '&:hover': {
              color: colors.text,
              backgroundColor: colors.hover,
            },
          }}
        >
          <Close fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ p: 0, backgroundColor: colors.surface, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: 'calc(80vh - 60px)' }}>
        <Box
          sx={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: colors.surface,
          }}
        >
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
                  color: colors.textDim,
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
              <Tab label="Benchmarks" />
              <Tab label="Help" />
            </Tabs>
          </Box>

          {/* Tab Content */}
          <Box sx={{ flex: 1, overflow: 'auto' }}>
            {currentTab === 0 && <Benchmarks />}
            {currentTab === 1 && <Help />}
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
};

export default Docs;
