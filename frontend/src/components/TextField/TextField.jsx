import React from 'react'
import { TextField as MuiTextField } from '@mui/material'

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
          fontFamily: '"Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          backgroundColor: '#ffffff !important',
          borderRadius: '4px',
          '& fieldset': {
            borderColor: '#444',
          },
          '&.Mui-focused fieldset': {
            borderColor: '#03a9f4',
          },
        },
        '& .MuiInputLabel-root': {
          color: '#aaa',
          fontSize: '0.875rem',
          transform: 'translate(14px, 9px) scale(1)',
          '&.MuiInputLabel-shrink': {
            transform: 'translate(14px, -8px) scale(0.75)',
            color: '#f6ffc1ff',
            backgroundColor: '#2d2d2d', // Match dialog bg for the notch area
            padding: '0 4px',
          },
        },
        '& .MuiInputBase-input': {
          backgroundColor: '#ffffff !important',
          color: '#333333 !important',
          textAlign: 'left !important',
          padding: '8px 12px !important',
          height: '38px',
          boxSizing: 'border-box',
          '&::placeholder': {
            color: '#999999 !important',
            opacity: 1,
          },
        }
      }}
      {...props}
    />
  )
}
