import React from 'react';
import { colors, fontFamily } from '../../../theme';
import {
  Box,
  Typography,
  Link,
} from '@mui/material';
import { Email, LinkedIn } from '@mui/icons-material';

const Help = () => {
  return (
    <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: colors.surface, p: 3 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography
          variant="body2"
          sx={{
            color: colors.text,
            fontSize: '0.875rem',
            fontFamily,
            lineHeight: 1.6,
            mb: 1,
          }}
        >
          If you encounter any bugs or issues, please feel free to contact me via email or LinkedIn. 
          It would be helpful if you could forward the JSON file that can be downloaded using the "Save" button, 
          as this will help me reproduce and fix the issue more quickly.
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: '1rem' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Email sx={{ color: colors.textDim, fontSize: '1.25rem' }} />
            <Link
              href="mailto:barcelosenge@gmail.com"
              sx={{
                color: colors.text,
                textDecoration: 'none',
                fontSize: '0.875rem',
                fontFamily,
                '&:hover': {
                  color: colors.textDim,
                  textDecoration: 'underline',
                },
              }}
            >
              barcelosenge@gmail.com
            </Link>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <LinkedIn sx={{ color: colors.textDim, fontSize: '1.25rem' }} />
            <Link
              href="https://www.linkedin.com/in/igor-barcelos/"
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                color: colors.text,
                textDecoration: 'none',
                fontSize: '0.875rem',
                fontFamily,
                '&:hover': {
                  color: colors.textDim,
                  textDecoration: 'underline',
                },
              }}
            >
              LinkedIn
            </Link>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default Help;

