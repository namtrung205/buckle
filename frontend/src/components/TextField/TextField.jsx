import React from 'react'
import { TextField as MuiTextField } from '@mui/material'
import { colors, fontFamily } from '../../theme';

export default function TextField({ value, onChange, name, placeholder, type = 'text', size = 'small', fullWidth = true, ...props }) {
  return (
    <MuiTextField
      value={value}
      onChange={onChange}
      variant="outlined"
      name={name}
      placeholder={placeholder}
      type={type}
      size={size}
      fullWidth={fullWidth}
      sx={{
        '& .MuiOutlinedInput-root': {
          height: '38px',
          fontSize: '0.875rem',
          fontFamily,
          backgroundColor: colors.surfaceAlt,
          borderRadius: '6px',
        },
        '& .MuiInputLabel-root': {
          fontSize: '0.875rem',
          transform: 'translate(14px, 9px) scale(1)',
          '&.MuiInputLabel-shrink': {
            transform: 'translate(14px, -8px) scale(0.75)',
            color: colors.textFaint,
          },
        },
        '& .MuiInputBase-input': {
          color: colors.text,
          textAlign: 'left !important',
          padding: '8px 12px !important',
          height: '38px',
          boxSizing: 'border-box',
          '&::placeholder': {
            color: colors.textFaint,
            opacity: 1,
          },
        }
      }}
      {...props}
    />
  )
}
