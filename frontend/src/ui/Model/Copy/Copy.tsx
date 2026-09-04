import { useState, useEffect } from 'react';
import { Box, Stack, Typography, Button } from '@mui/material';
import { Save as SaveIcon } from '@mui/icons-material';
import { useModel } from '../../../model/Context';
import { colors, fontFamily } from '../../../theme';
import { observer } from 'mobx-react-lite';
import TextField from '../../../components/TextField';
import Dialog from '../../../components/Dialog/Dialog';
import { CopyTool } from '../../../model';

interface CopyProps {
  open: boolean;
  onClose: () => void;
}

const Copy = observer(({ open, onClose }: CopyProps) => {
  const model = useModel();
  const [repeat, setRepeat] = useState('1');

  const handleRepeat = (event: any) => {
    const { value } = event.target;
    setRepeat(value);
  };

  const handleCopy = () => {
    let currentTool = model.toolsController.getCurrentTool()
    let toolUuid = currentTool?.uuid
    if (toolUuid !== 'Copy') {
      currentTool?.stop()
    
      model.toolsController.activate('copy');
      const copyTool = model.toolsController.getCurrentTool() as CopyTool;
      copyTool.setRepeat(Number(repeat));
    }else{
      currentTool?.start()
    }
  };

  const handleClose = () => {
    const currentTool = model.toolsController.getCurrentTool();
    currentTool?.stop();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="xs"
      fullWidth={false}
      draggable
      title="Copy"
    >
      <Stack spacing={1.5}>
        <Box>
          <Typography
            sx={{
              fontSize: '0.75rem',
              color: colors.textDim,
              mb: 0.5,
              fontWeight: 500,
              fontFamily,
            }}
          >
            Repeat
          </Typography>
          <TextField
            value={repeat}
            onChange={handleRepeat}
            name="repeat"
            placeholder="Number of copies"
            fullWidth
          />
        </Box>
        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
          <Button
            variant="outlined"
            color="inherit"
            size="small"
            onClick={handleClose}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={handleCopy}
            startIcon={<SaveIcon sx={{ fontSize: '0.875rem' }} />}
          >
            Start
          </Button>
        </Box>
      </Stack>
    </Dialog>
  );
});

export default Copy;
