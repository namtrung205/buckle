import { Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, Paper } from '@mui/material';
import { observer } from 'mobx-react-lite';
import { useModel } from '../../../../model/Context';
import { DIAGRAM_TYPES } from '../../../../model/PostProcessing/PostProcessing';

const TYPE_TITLES: Record<string, string> = {
  N: 'N [kN]',
  Vy: 'Vy [kN]',
  Vz: 'Vz [kN]',
  T: 'T [kN]',
  My: 'My [kNm]',
  Mz: 'Mz [kNm]',
};

const fmt = (v: number) => {
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(3);
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
    if (found) rows.push({ label: TYPE_TITLES[type], max: fmt(max), min: fmt(min) });
  }

  // Peak displacement magnitude
  let maxDefl = 0;
  for (const member of members) {
    const stations = member.stations?.length
      ? member.stations
      : (member.node_efforts ?? []).map((node: any) => ({
        values: Object.fromEntries(
          Object.entries(node.efforts ?? {}).map(([k, e]: [string, any]) => [
            k,
            e.value,
          ])
        ),
        coord: node.coord,
        displaced: node.efforts?.[Object.keys(node.efforts ?? {})[0]]?.displaced_positions,
      }));
    for (const s of stations) {
      if (!s.coord || !s.displaced) continue;
      const mag = Math.sqrt(
        (s.displaced[0] - s.coord[0]) ** 2 +
        (s.displaced[1] - s.coord[1]) ** 2 +
        (s.displaced[2] - s.coord[2]) ** 2
      ) / 1e-5;
      if (mag > maxDefl) maxDefl = mag;
    }
  }
  if (maxDefl > 0) {
    rows.push({ label: 'Deflection max [mm]', max: fmt(maxDefl * 1000), min: '—' });
  }

  if (rows.length === 0) return null;

  return (
    <Box sx={{ mb: 1 }}>
      <Typography variant="subtitle2">Summary</Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 180 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Quantity</TableCell>
              <TableCell align="right">Max</TableCell>
              <TableCell align="right">Min</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell sx={{ py: 0.25 }}>{row.label}</TableCell>
                <TableCell align="right" sx={{ py: 0.25 }}>{row.max}</TableCell>
                <TableCell align="right" sx={{ py: 0.25 }}>{row.min}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
});

export default SummaryTable;
