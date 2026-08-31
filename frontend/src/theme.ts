import { createTheme } from '@mui/material/styles';

/**
 * Standard UI palette — mirrored from the Results dialog
 * (see frontend/src/ui/Results/Components/ui.tsx).
 *
 * Every dialog, panel, input and button must use these tokens
 * so the whole app stays visually consistent.
 */
export const colors = {
  bg: '#0f131a',
  surface: '#343b45', // dialogs / panels
  surfaceAlt: '#3d4552', // inputs, list rows, chip background
  hover: '#414b58', // hover surfaces
  active: '#4a5462', // active/selected surfaces
  border: '#4a5462', // panel borders
  borderDark: '#5a6472', // input borders / hover borders
  divider: '#2c333d', // subtle separators
  text: '#e8edf3',
  textDim: '#a8b3c1',
  textFaint: '#7c8794',
  accent: '#4a90e2',
  accentSoft: '#a8c7ec',
  accentHover: '#3a7cc4',
  secondary: '#ffcf87',
  danger: '#e5484d',
  success: '#46a758',
} as const;

export const fontFamily =
  '"Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/** Shared sx for the small field labels above inputs inside dialogs. */
export const fieldLabelSx = {
  fontSize: '0.75rem',
  color: colors.textDim,
  mb: 0.5,
  fontWeight: 500,
  fontFamily,
} as const;

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: colors.accent,
      light: colors.accentSoft,
      dark: colors.accentHover,
      contrastText: '#ffffff',
    },
    secondary: {
      main: colors.secondary,
      light: '#ffe1b8',
      dark: '#e0a95e',
      contrastText: colors.bg,
    },
    background: { default: colors.bg, paper: colors.surface },
    text: { primary: colors.text, secondary: colors.textDim, disabled: colors.textFaint },
    divider: colors.border,
    success: { main: colors.success },
    warning: { main: colors.secondary },
    error: { main: colors.danger },
    info: { main: colors.accent },
  },
  typography: { fontFamily },
  shape: { borderRadius: 8 },
  components: {
    // Buttons — dialog action buttons (Cancel / Save / ...) rely on these
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: 6,
          boxShadow: 'none',
        },
        sizeSmall: {
          minHeight: 28,
          padding: '4px 12px',
          fontSize: '0.75rem',
        },
        containedPrimary: {
          backgroundColor: colors.accent,
          color: '#ffffff',
          '&:hover': { backgroundColor: colors.accentHover },
        },
        outlined: {
          borderColor: colors.borderDark,
          color: colors.textDim,
          '&:hover': {
            borderColor: colors.borderDark,
            backgroundColor: colors.hover,
            color: colors.text,
          },
        },
        outlinedInherit: {
          borderColor: colors.border,
          color: colors.textDim,
          '&:hover': {
            borderColor: colors.borderDark,
            backgroundColor: colors.hover,
            color: colors.text,
          },
        },
        textInherit: {
          color: colors.textDim,
          '&:hover': { backgroundColor: colors.hover, color: colors.text },
        },
      },
    },
    // Tabs — BoundaryConditions, WarehouseWizard, Docs, ...
    MuiTabs: {
      styleOverrides: {
        indicator: { backgroundColor: colors.accent, height: 2 },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          fontSize: '0.75rem',
          minHeight: 34,
          color: colors.textFaint,
          '&.Mui-selected': { color: colors.accentSoft },
        },
      },
    },
    // Outlined inputs (TextField / Select / raw MUISelect)
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: colors.surfaceAlt,
          '& fieldset': { borderColor: colors.border },
          '&:hover fieldset': { borderColor: colors.borderDark },
          '&.Mui-focused fieldset': { borderColor: colors.accent },
        },
        input: { color: colors.text },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          color: colors.textFaint,
          '&.Mui-focused': { color: colors.accentSoft },
        },
      },
    },
    // Dropdown menus (Selects, context menus, zoom menu)
    MuiMenu: {
      styleOverrides: {
        paper: {
          backgroundColor: colors.surface,
          border: `1px solid ${colors.border}`,
          backgroundImage: 'none',
        },
        list: { padding: '4px 0' },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontSize: '0.8rem',
          color: colors.text,
          '&:hover': { backgroundColor: colors.hover },
          '&.Mui-selected': { backgroundColor: colors.active },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          backgroundColor: colors.surfaceAlt,
          color: colors.text,
          borderRadius: 4,
          fontSize: '0.75rem',
        },
      },
    },
    MuiCheckbox: {
      styleOverrides: {
        root: {
          color: colors.textDim,
          '&.Mui-checked': { color: colors.accent },
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: colors.bg,
          border: `1px solid ${colors.border}`,
          color: colors.text,
          fontSize: '0.7rem',
        },
      },
    },
  },
});

export default theme;