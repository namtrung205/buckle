import React, { useState, memo } from 'react';
import {
  Grid,
  Typography
} from '@mui/material'

import TextField from '../../../../components/TextField';
import { fieldLabelSx } from '../../../../theme';

const HollowCircularSection = ({section, setSection, handleChange}) => {

  return(
    <Grid container alignItems='center' spacing={2} justifyContent='space-between'>
      <Grid item xs={6} md={6}>
        <Typography
          variant="body2"
          sx={fieldLabelSx}
        >
          Diameter (mm)
        </Typography>
      </Grid>
      <Grid item xs={6} md={6}>
        <TextField
          value={section.diameter}
          name="diameter"
          onChange={handleChange}
          type="number"
        />
      </Grid>

      <Grid item xs={6} md={6}>
        <Typography
          variant="body2"
          sx={fieldLabelSx}
        >
          Thickness (mm)
        </Typography>
      </Grid>
      <Grid item xs={6} md={6}>
        <TextField
          value={section.thickness}
          name="thickness"
          onChange={handleChange}
          type="number"
        />
      </Grid>
    </Grid>
  )
}

export default HollowCircularSection
