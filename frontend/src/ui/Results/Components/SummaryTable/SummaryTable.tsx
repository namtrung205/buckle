import { Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import { observer } from 'mobx-react-lite';
import { useModel } from '../../../../model/Context';
import { DIAGRAM_TYPES, STRESS_TYPES } from '../../../../model/PostProcessing/PostProcessing';
import { UI, fmtValue, SecTitle } from '../ui';

// Quantities are unit-less here — the unit reference lives in the status bar.
// Stress rows are labelled σ in MPa (derived by the backend).
const TYPE_TITLES: Record<string, string> = {
  N: 'N',
  Vy: 'Vy',
  Vz: 'Vz',
  T: 'T',
  My: 'My',
  Mz: 'Mz',
  Smax: 'σ max (signed)',
  Sabs: '|σ| max',
  SvonM: 'σ VM',
};

/** Summary of max/min internal forces and peak deflection across the analysed members. */
const SummaryTable = observer(() => {
  const model = useModel();
  const output = model.output;
  if (!output?.members?.length) return null;

  const members: any[] = output.members;
  const rows: { label: string; max: string; min: string }[] = [];

  for (const type of DIAGRAM_TYPES) {
    let max = -Infinity;
    let min = Infinity;
    let found = false;
    for (const member of members) {
      const values: number[] = [];
      if (member.stations?.length) {
        for (const s of member.stations) if (s.values?.[type] !== undefined) values.push(s.values[type]);
      } else {
        for (const node of member.node_efforts ?? []) {
          const effort = node.efforts?.[type];
          if (effort) values.push(effort.value);
        }
      }
      for (const v of values) {
        found = true;
        if (v > max) max = v;
        if (v < min) min = v;
      }
    }
    if (found) rows.push({ label: TYPE_TITLES[type], max: fmtValue(max), min: fmtValue(min) });
  }

  for (const type of STRESS_TYPES) {
    let max = -Infinity;
    let min = Infinity;
    let found = false;
    for (const member of members) {
      const values: number[] = [];
      if (member.stations?.length) {
        for (const s of member.stations) if (s.values?.[type] !== undefined) values.push(s.values[type]);
      } else {
        for (const node of member.node_efforts ?? []) {
          const effort = node.efforts?.[type];
          if (effort) values.push(effort.value);
        }
      }
      for (const v of values) {
        found = true;
        if (v > max) max = v;
        if (v < min) min = v;
      }
    }
    if (found) rows.push({ label: TYPE_TITLES[type], max: fmtValue(max), min: fmtValue(min) });
  }

  // Peak displacement magnitude (real nodal displacements of the analysis)
  let maxDefl = 0;
  for (const node of model.output?.nodes ?? []) {
    const d = node.displacements;
    if (!d) continue;
    // OpenSees axes (X, Y, Z) = model (x, z, y)
    const mag = Math.sqrt((d.ux ?? 0) ** 2 + (d.uz ?? 0) ** 2 + (d.uy ?? 0) ** 2);
    if (mag > maxDefl) maxDefl = mag;
  }
  if (maxDefl > 0) {
    rows.push({ label: 'Δ max', max: fmtValue(maxDefl * 1000), min: '—' });
  }

  if (rows.length === 0) return null;

  const headCellSx = {
    fontFamily: UI.mono, fontSize: '10.5px', color: UI.dim, py: 0.5,
    backgroundColor: UI.panel2, borderBottom: `1px solid ${UI.border}`, fontWeight: 600,
  } as const;

  return (
    <Box sx={{ mb: 1 }}>
      <SecTitle>Summary</SecTitle>
      <TableContainer
        sx={{ maxHeight: 180, border: `1px solid ${UI.border}`, borderRadius: 1.5, backgroundColor: UI.panel }}
      >
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={headCellSx}>Quantity</TableCell>
              <TableCell align="right" sx={headCellSx}>Max</TableCell>
              <TableCell align="right" sx={headCellSx}>Min</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.label} sx={{ '&:nth-of-type(even)': { backgroundColor: UI.panel2 } }}>
                <TableCell sx={{ py: 0.4, fontFamily: UI.mono, fontSize: '11px', color: UI.dim, borderBottom: 'none' }}>
                  {row.label}
                </TableCell>
                <TableCell align="right" sx={{ py: 0.4, fontFamily: UI.mono, fontSize: '11px', fontWeight: 700, color: UI.text, borderBottom: 'none' }}>
                  {row.max}
                </TableCell>
                <TableCell align="right" sx={{ py: 0.4, fontFamily: UI.mono, fontSize: '11px', color: UI.text, borderBottom: 'none' }}>
                  {row.min}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
});

export default SummaryTable;
