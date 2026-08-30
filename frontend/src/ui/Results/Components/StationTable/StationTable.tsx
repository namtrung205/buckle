import { useState } from 'react';
import {
  Box,
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
} from '@mui/material';
import { useModel } from '../../../../model/Context';
import { UI, fmtValue, SecTitle } from '../ui';

interface StationTableProps {
  memberIds: number[];
}

/** Raw station values for one member (backend `stations` payload), mono table like the sample. */
const StationTable = ({ memberIds }: StationTableProps) => {
  const model = useModel();
  const [open, setOpen] = useState(false);
  const [memberId, setMemberId] = useState<number | null>(null);
  const members: any[] = model.output?.members ?? [];

  const availableIds = members.map(m => m.id);
  const effectiveId =
    memberId !== null && availableIds.includes(memberId)
      ? memberId
      : (memberIds.find(id => availableIds.includes(id)) ?? availableIds[0] ?? null);

  if (availableIds.length === 0) return null;

  const member = members.find(m => m.id === effectiveId);
  const hasStations = !!member?.stations?.length;

  // Project each station onto the member axis to get the arc position s, thin long lists
  const stations: any[] = member?.stations ?? [];
  const step = Math.max(1, Math.ceil(stations.length / 50));
  let rows: any[] = hasStations ? stations.filter((_: any, i: number) => i % step === 0 || i === stations.length - 1) : [];
  if (rows.length > 0) {
    const p0 = stations[0].coord;
    const p1 = stations[stations.length - 1].coord;
    const axis = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const axisLength = Math.sqrt(axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2) || 1;
    rows = rows.map((s: any) => ({
      ...s,
      s: ((s.coord[0] - p0[0]) * axis[0] + (s.coord[1] - p0[1]) * axis[1] + (s.coord[2] - p0[2]) * axis[2]) / axisLength,
    }));
  }

  const headCellSx = {
    fontFamily: UI.mono, fontSize: '10.5px', color: UI.dim, py: 0.4, px: 0.75,
    backgroundColor: UI.panel2, borderBottom: `1px solid ${UI.border}`, fontWeight: 600,
  } as const;
  const cellSx = {
    py: 0.3, px: 0.75, fontFamily: UI.mono, fontSize: '11px', color: UI.text, borderBottom: 'none',
  } as const;

  return (
    <Box sx={{ mb: 1 }}>
      <Box
        onClick={() => setOpen(!open)}
        sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none', '&:hover': { opacity: 0.8 } }}
      >
        <SecTitle>{open ? '▾' : '▸'} Station values</SecTitle>
      </Box>
      <Collapse in={open}>
        <FormControl size="small" fullWidth sx={{ mb: 0.75 }}>
          <Select
            value={effectiveId ?? ''}
            onChange={(e) => setMemberId(Number(e.target.value))}
            sx={{
              backgroundColor: UI.panel, fontFamily: UI.mono, fontSize: '0.78rem',
              '& .MuiOutlinedInput-notchedOutline': { borderColor: UI.borderDark },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: UI.accent },
            }}
          >
            {members.map((m: any) => (
              <MenuItem key={m.id} value={m.id} sx={{ fontFamily: UI.mono, fontSize: '0.78rem' }}>
                {m.label || `Member ${m.id}`}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {!hasStations && (
          <Box sx={{ fontFamily: UI.mono, fontSize: '10.5px', color: UI.dim }}>
            No intermediate stations — run a new analysis to enable this table.
          </Box>
        )}
        {hasStations && (
          <TableContainer sx={{ maxHeight: 220, border: `1px solid ${UI.border}`, borderRadius: 1.5, backgroundColor: UI.panel }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={headCellSx}>s</TableCell>
                  {['N', 'Vy', 'Vz', 'T', 'My', 'Mz'].map(k => (
                    <TableCell key={k} align="right" sx={headCellSx}>{k}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((s: any, index: number) => (
                  <TableRow key={index} sx={{ '&:nth-of-type(even)': { backgroundColor: UI.panel2 } }}>
                    <TableCell sx={{ ...cellSx, color: UI.dim }}>{fmtValue(s.s)}</TableCell>
                    {['N', 'Vy', 'Vz', 'T', 'My', 'Mz'].map(k => (
                      <TableCell key={k} align="right" sx={cellSx}>{fmtValue(s.values?.[k])}</TableCell>
                    ))}
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
