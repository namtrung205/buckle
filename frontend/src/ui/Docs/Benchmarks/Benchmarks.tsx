import { useState, useEffect } from 'react';
import { colors, fontFamily } from '../../../theme';
import {
  Box,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemText,
  CircularProgress,
  Alert,
  IconButton,
  Tooltip,
  ListItemSecondaryAction,
} from '@mui/material';
import { GetApp as ImportIcon } from '@mui/icons-material';
import axios from 'axios';
import { observer } from 'mobx-react-lite';
import { useModel } from '../../../model/Context';
import { toast } from 'react-toastify';
import { buildModelOnjson } from '../../../helpers';

const { VITE_BACKEND_SERVER } = import.meta.env;

interface BenchmarkMetadata {
  id: string;
  label: string;
  description: string;
}

const Benchmarks = observer(() => {
  const model = useModel();
  const [benchmarks, setBenchmarks] = useState<BenchmarkMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async (benchmarkId: string) => {
    try {
      const benchmarkUrl = `${VITE_BACKEND_SERVER}/benchmark/${benchmarkId}`;
      await buildModelOnjson(model, benchmarkUrl);
      toast.success('Benchmark loaded successfully!', {
        position: "bottom-right",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
      });
    } catch (err) {
      console.error('Error importing benchmark:', err);
      toast.error(
        err instanceof Error
          ? err.message || 'Failed to import benchmark'
          : 'Failed to import benchmark',
        {
          position: "bottom-right",
          autoClose: 4000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
        }
      );
    }
  };

  useEffect(() => {
    const fetchBenchmarks = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await axios.get<BenchmarkMetadata[]>(`${VITE_BACKEND_SERVER}/benchmarks`);
        setBenchmarks(response.data);
      } catch (err) {
        console.error('Error fetching benchmarks:', err);
        setError(
          axios.isAxiosError(err)
            ? err.message || 'Failed to fetch benchmarks'
            : 'Failed to fetch benchmarks'
        );
      } finally {
        setLoading(false);
      }
    };

    fetchBenchmarks();
  }, []);

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: colors.surface,
        p: 3,
      }}
    >
      <Typography
        sx={{
          fontSize: '1.25rem',
          fontWeight: 600,
          color: colors.text,
          mb: 2,
          fontFamily,
        }}
      >
        Benchmarks
      </Typography>

      {loading && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            flex: 1,
          }}
        >
          <CircularProgress size={40} sx={{ color: colors.textDim }} />
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {!loading && !error && benchmarks.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No benchmarks available.
        </Alert>
      )}

      {!loading && !error && benchmarks.length > 0 && (
    
          <List sx={{ p: 0 }}>
            {benchmarks.map((benchmark, index) => (
              <ListItem
                key={benchmark.id}
                sx={{
                  borderBottom: index < benchmarks.length - 1 ? '1px solid ' + colors.borderDark : 'none',
                  '&:hover': {
                    backgroundColor: colors.hover,
                  },
                }}
              >
                <ListItemText
                  primary={
                    <Typography
                      sx={{
                        fontSize: '0.9rem',
                        fontWeight: 600,
                        color: colors.text,
                        fontFamily,
                        mb: 0.5,
                      }}
                    >
                      {benchmark.label}
                    </Typography>
                  }
                  secondary={
                    <Typography
                      sx={{
                        fontSize: '0.8rem',
                        color: colors.textDim,
                        fontFamily,
                      }}
                    >
                      {benchmark.description}
                    </Typography>
                  }
                />
                <ListItemSecondaryAction>
                  <Tooltip title="Import">
                    <IconButton
                      edge="end"
                      size="small"
                      onClick={() => handleImport(benchmark.id)}
                      sx={{
                        color: colors.textDim,
                        '&:hover': {
                          color: colors.text,
                          backgroundColor: colors.hover,
                        },
                      }}
                    >
                      <ImportIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Tooltip>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>

      )}
    </Box>
  );
});

export default Benchmarks;
