import { Box } from '@mui/material';
import {
  DataGrid,
  GridColDef,
  GridRowsProp,
} from '@mui/x-data-grid';
import { useModel } from '../../../../model/Context';
import { UI } from '../ui';

interface DisplacementData {
  id: number;
  x: number;
  y: number;
  z: number;
  displacements: {
    ux: number;
    uy: number;
    uz: number;
    rx: number;
    ry: number;
    rz: number;
  };
}

interface DisplacementsProps {
  data?: DisplacementData[];
}

const Displacements = () => {
  const model = useModel()

  const rows: GridRowsProp = model.output?.nodes?.map((item : DisplacementData) => ({
    label : model.nodes.find((node: any) => node.id === item.id)?.name || '',
    id: item.id,
    x: item.x,
    y: item.y,
    z: item.z,
    ux: item.displacements.ux,
    uy: item.displacements.uy,
    uz: item.displacements.uz,
    rx: item.displacements.rx,
    ry: item.displacements.ry,
    rz: item.displacements.rz,
  }));

  const columns: GridColDef[] = [
    {
      field: 'label',
      headerName: 'Node',
      width: 100,
      type: 'number',
    },
    {
      field: 'x',
      headerName: 'X (m)',
      width: 80,
      type: 'number',
    },
    {
      field: 'y',
      headerName: 'Y (m)',
      width: 80,
      type: 'number',
    },
    {
      field: 'z',
      headerName: 'Z (m)',
      width: 80,
      type: 'number',
    },
    {
      field: 'ux',
      headerName: 'Ux (m)',
      width: 100,
      type: 'number',
      valueFormatter: (value: number) => value?.toFixed(5) || '0',
    },
    {
      field: 'uy',
      headerName: 'Uy (m)',
      width: 100,
      type: 'number',
      valueFormatter: (value: number) => value?.toFixed(5) || '0',
    },
    {
      field: 'uz',
      headerName: 'Uz (m)',
      width: 100,
      type: 'number',
      valueFormatter: (value: number) => value?.toFixed(5) || '0',
    },
    {
      field: 'rx',
      headerName: 'Rx (rad)',
      width: 100,
      type: 'number',
      valueFormatter: (value: number) => value?.toFixed(5) || '0',
    },
    {
      field: 'ry',
      headerName: 'Ry (rad)',
      width: 100,
      type: 'number',
      valueFormatter: (value: number) => value?.toFixed(5) || '0',
    },
    {
      field: 'rz',
      headerName: 'Rz (rad)',
      width: 100,
      type: 'number',
      valueFormatter: (value: number) => value?.toFixed(5) || '0',
    },
  ];

  return (
    <Box sx={{ height: '420px', width: '100%' }}>
      <DataGrid
        rows={rows}
        columns={columns}
        disableRowSelectionOnClick
        disableColumnSelector
        disableColumnFilter
        disableColumnMenu
        hideFooterSelectedRowCount
        pagination
        pageSizeOptions={[10, 25, 50, 100]}
        initialState={{
          pagination: {
            paginationModel: {
              pageSize: 10,
            },
          },
        }}
        localeText={{
          MuiTablePagination: {
            labelRowsPerPage: 'Nodes per page',
          },
        }}
        sx={{
          height: '420px',
          width: '100%',
          backgroundColor: UI.panel,
          border: `1px solid ${UI.border}`,
          color: UI.text,
          '& .MuiDataGrid-virtualScroller': {
            overflowX: 'hidden !important',
          },
          '& .MuiDataGrid-virtualScrollerContent': {
            overflowX: 'hidden !important',
          },
          '& .MuiDataGrid-main': {
            backgroundColor: UI.panel,
          },
          '& .MuiDataGrid-columnHeaders': {
            backgroundColor: `${UI.panel2} !important`,
            borderBottom: `1px solid ${UI.border}`,
            color: UI.text,
            fontSize: '0.7rem',
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            fontFamily: UI.sans,
          },
          '& .MuiDataGrid-columnHeader': {
            backgroundColor: `${UI.panel2} !important`,
            borderRight: `1px solid ${UI.border}`,
            color: `${UI.text} !important`,
            '&:last-child': {
              borderRight: 'none',
            },
            '&:focus': {
              backgroundColor: `${UI.panel2} !important`,
            },
            '&:focus-within': {
              backgroundColor: `${UI.panel2} !important`,
            },
          },
          '& .MuiDataGrid-columnSeparator': {
            color: UI.border,
          },
          '& .MuiDataGrid-columnHeaderTitle': {
            color: `${UI.text} !important`,
            fontWeight: 700,
          },
          '& .MuiDataGrid-cell': {
            color: UI.text,
            fontSize: '0.72rem',
            fontFamily: UI.mono,
            borderBottom: `1px solid ${UI.border}`,
            borderRight: `1px solid ${UI.border}`,
            '&:focus': {
              outline: 'none',
            },
            '&:focus-within': {
              outline: 'none',
            },
          },
          '& .MuiDataGrid-row': {
            backgroundColor: UI.panel,
            '&:nth-of-type(even)': {
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
            },
            '&:hover': {
              backgroundColor: 'rgba(74, 144, 226, 0.10) !important',
            },
            '&.Mui-selected': {
              backgroundColor: 'rgba(74, 144, 226, 0.18) !important',
              '&:hover': {
                backgroundColor: 'rgba(74, 144, 226, 0.18) !important',
              },
            },
          },
          '& .MuiDataGrid-footerContainer': {
            borderTop: `1px solid ${UI.border}`,
            backgroundColor: UI.panel2,
            color: UI.text,
            overflow: 'hidden',
            overflowX: 'hidden',
          },
          '& .MuiTablePagination-root': {
            color: UI.text,
            fontSize: '0.72rem',
            fontWeight: 500,
            fontFamily: UI.sans,
            overflow: 'hidden',
            overflowX: 'hidden',
            width: '100%',
          },
          '& .MuiIconButton-root': {
            color: UI.dim,
            '&:hover': {
              backgroundColor: 'rgba(74, 144, 226, 0.15)',
              color: UI.text,
            },
          },
          '& .MuiDataGrid-selectedRowCount': {
            color: UI.text,
            fontWeight: 500,
          },
          '& .MuiDataGrid-scrollbar': {
            '& .MuiDataGrid-scrollbar--vertical': {
              '& .MuiDataGrid-scrollbar--thumb': {
                backgroundColor: UI.borderDark,
                '&:hover': {
                  backgroundColor: UI.dim,
                },
              },
            },
            '& .MuiDataGrid-scrollbar--horizontal': {
              '& .MuiDataGrid-scrollbar--thumb': {
                backgroundColor: UI.borderDark,
                '&:hover': {
                  backgroundColor: UI.dim,
                },
              },
            },
          },
          '& ::-webkit-scrollbar': {
            width: '12px',
            height: '12px',
          },
          '& ::-webkit-scrollbar-track': {
            backgroundColor: UI.panel2,
          },
          '& ::-webkit-scrollbar-thumb': {
            backgroundColor: UI.borderDark,
            borderRadius: '6px',
            '&:hover': {
              backgroundColor: UI.dim,
            },
          },
        }}
      />
    </Box>
  );
};

export default Displacements;
