import React, { useState } from 'react';
import { Box, Typography, Link, Dialog, IconButton } from '@mui/material';
import { InfoOutlined, Close } from '@mui/icons-material';
import Tutorials from '../Tutorials/Tutorials';
import { colors } from '../../theme';

const NewHere = () => {
  const [open, setOpen] = useState(false);

  const handleOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);

  return (
    <>
      <Box
        sx={{
          position: 'fixed',
          top: 16,
          right: 120,
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          color: colors.text,
          padding: '12px 20px',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          zIndex: 1000,
          border: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        <InfoOutlined sx={{ fontSize: 20, color: colors.accent }} />
        <Typography
          variant="body2"
          sx={{
            fontSize: '14px',
            fontWeight: 400,
          }}
        >
          {/* New Here ?{' '} */}
          <Link
            component="button"
            onClick={handleOpen}
            sx={{
              color: colors.accent,
              textDecoration: 'none',
              fontWeight: 500,
              cursor: 'pointer',
              border: 'none',
              background: 'none',
              font: 'inherit',
              '&:hover': {
                textDecoration: 'underline',
              },
            }}
          >
            Tutorials
          </Link>
        </Typography>
      </Box>

      <Dialog
        open={open}
        onClose={handleClose}
        maxWidth={false}
        PaperProps={{
          sx: {
            backgroundColor: colors.bg,
            maxWidth: '90vw',
            maxHeight: '90vh',
            width: '1200px',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            position: 'relative',
          },
        }}
      >
        <IconButton
          onClick={handleClose}
          sx={{
            position: 'absolute',
            right: 16,
            top: 16,
            color: colors.text,
            zIndex: 1,
            '&:hover': {
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
            },
          }}
        >
          <Close />
        </IconButton>
        <Tutorials />
      </Dialog>
    </>
  );
};

export default NewHere;

