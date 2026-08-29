import { useState } from 'react';
import {
  Box,
  Button,
  Collapse,
  FormControl,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Paper,
} from '@mui/material';
import { useModel } from '../../../../model/Context';

interface StationTableProps {
  memberIds: number[];
}

const fmt = (v: number | undefined) => {
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(2);
  if (a >= 0.001) return v.toFixed(3);
  return v.toFixed(4);
};

/** Raw station values table for a selected member (from the backend `stations` payload). */
const StationTable = ({ memberIds }: StationTableProps) => {
  const model = useModel();
  const [open, setOpen] = useState(false);
  const members: any[] = model.output?.members ?? [];
  const [memberId, setMemberId] = useState<number | null>(null);

  const availableIds = members.map(m => m.id);
  const effectiveId =
    memberId !== null && availableIds.includes(memberId)
      ? memberId
      : (memberIds.find(id => availableIds.includes(id)) ?? availableIds[0] ?? null);

  if (availableIds.length === 0) return null;

  const member = members.find(m => m.id === effectiveId);
  const hasStations = !!member?.stations?.length;

  // Thin out very long station lists for readability
  const stations: any[] = member?.stations ?? [];
  const step = Math.max(1, Math.ceil(stations.length / 50));
  let rows: any[] = hasStations ? stations.filter((_, i) => i % step === 0 || i === stations.length - 1) : [];
  if (rows.length > 0) {
    // Project each station coordinate onto the member axis to get its arc position s
    const p0 = stations[0].coord;
    const p1 = stations[stations.length - 1].coord;
    const axis = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const axisLength = Math.sqrt(axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2) || 1;
    const axisUnit = axis.map(a => a / axisLength);
    rows = rows.map(s => ({
      ...s,
      s: (s.coord[0] - p0[0]) * axisUnit[0] + (s.coord[1] - p0[1]) * axisUnit[1] + (s.coord[2] - p0[2]) * axisUnit[2],
    }));
  }

  const totalLength = member?.stations?.length
    ? Math.sqrt(
      (member.stations[member.stations.length - 1].coord[0] - member.stations[0].coord[0]) ** 2 +
      (member.stations[member.stations.length - 1].coord[1] - member.stations[0].coord[1]) ** 2 +
      (member.stations[member.stations.length - 1].coord[2] - member.stations[0].coord[2]) ** 2
    )
    : null;

  return (
    <Box>
      <Button size="small" onClick={() => setOpen(!open)} sx={{ px: 1, textTransform: 'none' }}>
        {open ? '▾' : '▸'} Station values
      </Button>
      <Collapse in={open}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 0.5 }}>
          <FormControl size="small" fullWidth>
            <Select
              value={effectiveId ?? ''}
              onChange={(e) => setMemberId(Number(e.target.value))}
              sx={{ fontSize: '0.8rem' }}
            >
              {members.map((m: any) => (
                <MenuItem key={m.id} value={m.id}>{m.label || `Member ${m.id}`}</MenuItem>
              ))}
            </Select>
          </FormControl>
          {totalLength !== null && (
            <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>L = {fmt(totalLength)}</Typography>
          )}
        </Box>
        {!hasStations && (
          <Typography variant="caption" sx={{ color: '#888' }}>
            No intermediate stations — run a new analysis to enable this table.
          </Typography>
        )}
        {hasStations && (
          <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 220 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ py: 0.25 }}>s</TableCell>
                  <TableCell align="right" sx={{ py: 0.25 }}>N</TableCell>
                  <TableCell align="right" sx={{ py: 0.25 }}>Vy</TableCell>
                  <TableCell align="right" sx={{ py: 0.25 }}>Vz</TableCell>
                  <TableCell align="right" sx={{ py: 0.25 }}>T</TableCell>
                  <TableCell align="right" sx={{ py: 0.25 }}>My</TableCell>
                  <TableCell align="right" sx={{ py: 0.25 }}>Mz</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((s, index) => (
                  <TableRow key={index}>
                    <TableCell sx={{ py: 0.25 }}>{fmt(s.s)}</TableCell>
                    <TableCell align="right" sx={{ py: 0.25 }}>{fmt(s.values?.N)}</TableCell>
                    <TableCell align="right" sx={{ py: 0.25 }}>{fmt(s.values?.Vy)}</TableCell>
                    <TableCell align="right" sx={{ py: 0.25 }}>{fmt(s.values?.Vz)}</TableCell>
                    <TableCell align="right" sx={{ py: 0.25 }}>{fmt(s.values?.T)}</TableCell>
                    <TableCell align="right" sx={{ py: 0.25 }}>{fmt(s.values?.My)}</TableCell>
                    <TableCell align="right" sx={{ py: 0.25 }}>{fmt(s.values?.Mz)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Collapse>
    </Box>
  );
};

export default StationTable;
