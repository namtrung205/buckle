import React from 'react';
import { colors } from '../../theme';
import { Backdrop, CircularProgress, Typography, Box } from '@mui/material';
import { Settings } from '@mui/icons-material';

const Loading = ({ 
  open = false,
  message = 'Loading...'
}) => {

  return (
    <Backdrop 
      open={open} 
      sx={{ 
        zIndex: 9999,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
      }}
    >
      <Box sx={{ textAlign: 'center' }}>
        <Settings 
          sx={{ 
            fontSize: 60, 
            color: colors.accent,
            animation: 'spin 2s linear infinite',
            '@keyframes spin': {
              '0%': {
                transform: 'rotate(0deg)',
              },
              '100%': {
                transform: 'rotate(360deg)',
              },
            }
          }} 
        />
        <Typography
          variant="h6"
          sx={{
            color: colors.text,
            mt: 2
          }}
        >
          {message}
        </Typography>
      </Box>
    </Backdrop>
  );
};

export default Loading;
