import React, { ReactNode } from 'react';
import {
  Dialog as MuiDialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Typography,
  DialogProps as MuiDialogProps
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import Draggable from 'react-draggable';
import Paper from '@mui/material/Paper';
import { colors, fontFamily } from '../../theme';

interface DialogProps extends Omit<MuiDialogProps, 'title'> {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | false;
  fullWidth?: boolean;
  draggable?: boolean;
  hideBackdrop?: boolean;
  disableEnforceFocus?: boolean;
  disableAutoFocus?: boolean;
  disableRestoreFocus?: boolean;
}

function DraggablePaper(props: any) {
  return (
    <Draggable
      handle="#draggable-dialog-title"
      cancel={'[class*="MuiDialogContent-root"]'}
    >
      <Paper {...props} />
    </Draggable>
  );
}

const Dialog: React.FC<DialogProps> = ({
  open,
  onClose,
  title,
  children,
  actions,
  maxWidth = 'xs',
  fullWidth = true,
  draggable = false,
  hideBackdrop = false,
  disableEnforceFocus = false,
  disableAutoFocus = false,
  disableRestoreFocus = false,
  ...rest
}) => {
  const PaperComponent = draggable ? DraggablePaper : undefined;

  return (
    <MuiDialog
      open={open}
      onClose={onClose}
      maxWidth={maxWidth}
      fullWidth={fullWidth}
      PaperComponent={PaperComponent}
      hideBackdrop={hideBackdrop}
      disableEnforceFocus={disableEnforceFocus}
      disableAutoFocus={disableAutoFocus}
      disableRestoreFocus={disableRestoreFocus}
      sx={{
        pointerEvents: 'none',
        '& .MuiDialog-container': {
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
          padding: 0,
        },
        '& .MuiPaper-root': {
          pointerEvents: 'auto',
        },
      }}
      PaperProps={{
        sx: {
          backgroundColor: colors.surface,
          borderRadius: '8px',
          border: `1px solid ${colors.border}`,
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
          overflow: 'hidden',
          color: colors.text,
          maxHeight: '80vh',
          overflowY: 'auto',
          position: 'fixed',
          top: '50px',
          right: '0px',
        }
      }}
      {...rest}
    >
      {title && (
        <DialogTitle
          id={draggable ? "draggable-dialog-title" : undefined}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: colors.surface,
            borderBottom: `1px solid ${colors.border}`,
            py: 1,
            px: 2,
            cursor: draggable ? 'move' : 'default',
            pointerEvents: 'auto',
            m: 0,
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
            {title}
          </Typography>
          <IconButton
            aria-label="close"
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
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
      )}
      <DialogContent sx={{ p: 2, backgroundColor: colors.surface, pointerEvents: 'auto' }}>
        {children}
      </DialogContent>
      {actions && (
        <DialogActions sx={{ pointerEvents: 'auto', p: 2, backgroundColor: colors.surface, borderTop: `1px solid ${colors.border}` }}>
          {actions}
        </DialogActions>
      )}
    </MuiDialog>
  );
};

export default Dialog;
