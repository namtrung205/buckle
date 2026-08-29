import { Box } from '@mui/material';
import type { ReactNode } from 'react';

/**
 * Shared UI tokens for the Results panels — adapted from the visual language of
 * "Sample Visualize result.html" (mono values, uppercase section titles, accent divider)
 * but kept on the app's light theme.
 */
export const UI = {
  panel: '#f5f7fa',
  panel2: '#eceff4',
  border: '#d7dee7',
  borderDark: '#c3ccd8',
  text: '#1c2733',
  dim: '#64748b',
  accent: '#4a90e2',
  accentDark: '#3a7bc8',
  red: '#e5484d',
  blue: '#2f6fed',
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", "Cascadia Code", "Roboto Mono", monospace',
  sans: '-apple-system, "Segoe UI", Roboto, system-ui, sans-serif',
};

/** One shared number formatter for every Results value (tables, legend, tags). */
export const fmtValue = (v: number | undefined | null, dash = '—') => {
  if (v === undefined || v === null || Number.isNaN(v)) return dash;
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 100) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  if (a >= 0.001) return v.toFixed(4);
  return v.toFixed(6);
};

export const secTitleSx = {
  fontFamily: UI.mono,
  fontSize: '10.5px',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: UI.dim,
  mb: 0.75,
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  '&::after': { content: '""', flex: 1, height: '1px', backgroundColor: UI.border },
} as const;

/** Section title with a divider line, like `.sec-title` in the sample HTML. */
export const SecTitle = ({ children }: { children: ReactNode }) => (
  <Box sx={secTitleSx}>{children}</Box>
);
