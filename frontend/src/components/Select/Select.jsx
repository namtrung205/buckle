import {
  Select as MuiSelect,
  MenuItem,
} from '@mui/material';
import { colors } from '../../theme';

const truncateText = (text, maxLength = 20) => {
  if (text.length <= maxLength) return text;
  const start = text.substring(0, 10);
  const end = text.substring(text.length - 7);
  return `${start}...${end}`;
};

const Select = ({ onChange, list, value, label, size = 'small' }) => {
  return (
    <MuiSelect
      label={label}
      value={value}
      onChange={onChange}
      size={size}
      fullWidth
      sx={{
        height: '32px',
        fontSize: '0.875rem',
        backgroundColor: colors.surfaceAlt,
        '& .MuiSelect-select': {
          py: 0,
          px: '12px',
          fontSize: '0.875rem',
          color: colors.text,
          height: '32px',
          display: 'flex',
          alignItems: 'center',
        },
      }}
    >
      {list?.map((item, index) => (
        <MenuItem key={index} value={item.id}>
          {truncateText(item.name)}
        </MenuItem>
      ))}
    </MuiSelect>
  )
}

export default Select;