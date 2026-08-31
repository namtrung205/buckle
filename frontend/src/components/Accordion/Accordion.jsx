import React from 'react';
import {
  Accordion as MuiAccordion,
  AccordionSummary,
  AccordionDetails,
  Typography
} from '@mui/material';
import { ExpandMore } from '@mui/icons-material';
import { colors } from '../../theme';

const Accordion = ({
  title,
  children,
  defaultExpanded = false,
  sx = {},
  titleSx = {},
  contentSx = {},
  ...props
}) => {
  return (
    <MuiAccordion
      defaultExpanded={defaultExpanded}
      sx={{
        mt: 1,
        width: '100%',
        boxShadow: 'none',
        backgroundColor: colors.surface,
        ...sx
      }}
      {...props}
    >
      <AccordionSummary
        expandIcon={<ExpandMore sx={{ color: colors.textDim }} />}
        sx={{
          backgroundColor: colors.surface,
          width: '100%',
          padding: 0,
          minHeight: '36px',
          '&.Mui-expanded': {
            minHeight: '36px',
          },
          '& .MuiAccordionSummary-content': {
            margin: '0px 0',
            width: '100%',
            '&.Mui-expanded': {
              margin: '0px 0',
            }
          },
          ...titleSx
        }}
      >
        <Typography
          variant="body2"
          sx={{
            fontWeight: 500,
            color: colors.textDim,
            fontSize: '0.8rem',
            width: '100%'
          }}
        >
          {title}
        </Typography>
      </AccordionSummary>
      <AccordionDetails
        sx={{
          padding: 0,
          backgroundColor: colors.surface,
          ...contentSx
        }}
      >
        {children}
      </AccordionDetails>
    </MuiAccordion>
  );
};

export default Accordion;
