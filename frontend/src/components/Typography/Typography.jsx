import { Typography as MuiTypography } from '@mui/material';
import { colors, fontFamily } from '../../theme';

const Typography = ({ children, sx = {}, ...props }) => {
  return (
    <MuiTypography
      sx={{
        fontSize: '0.75rem',
        color: colors.textDim,
        mb: 0.5,
        fontWeight: 500,
        fontFamily,
        ...sx,
      }}
      {...props}
    >
      {children}
    </MuiTypography>
  );
};

export default Typography;
