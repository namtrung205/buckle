import { useState, useEffect } from 'react';
import React from 'react';
import {
  Box,
  Button,
  Typography,
  Stack,
} from '@mui/material';
import {
  Save as SaveIcon,
  OpenWith as MoveIcon,
} from '@mui/icons-material';
import { observer } from 'mobx-react-lite';
import { useModel } from '../../../model/Context';
import Dialog from '../../../components/Dialog/Dialog';
import Node from '../../../model/Elements/Node/Node';
import Move from './Components/Move/Move';
import TextField from '../../../components/TextField/TextField';
import { fieldLabelSx } from '../../../theme';
import { COMMAND_SCHEMA_VERSION } from '../../../core/structural';

interface NodesProps {
  open: boolean;
  onClose: () => void;
  selectedNode?: Node | null;
}



const AddOrEdit = observer(({ open, onClose, selectedNode }: NodesProps) => {
  const model = useModel();
  const [node, setNode] = useState({
    name: '',
    x: '0',
    y: '0',
    z: '0',
  });

  useEffect(() => {
    if (open) {
      if (selectedNode) {
        setNode({
          name: selectedNode.name || '',
          x: selectedNode.x.toString(),
          y: selectedNode.y.toString(),
          z: selectedNode.z.toString(),
        });
      } else {
        setNode({
          name: '',
          x: '0',
          y: '0',
          z: '0',
        });
      }
    }
  }, [open, selectedNode]);

  const handleSave = () => {
    // Form/Three.js is Y-up; command records use canonical engineering Z-up.
    const position = [Number(node.x), Number(node.z), Number(node.y)] as const;

    if (selectedNode) {
      model.executeCommand({
        commandId: crypto.randomUUID(),
        type: 'MoveNodes',
        schemaVersion: COMMAND_SCHEMA_VERSION,
        modelRevision: model.structuralDocument.revision,
        payload: { nodes: [{ id: selectedNode.id, position, name: node.name || selectedNode.name }] },
        source: 'ui',
      });
    } else {
      const name = node.name || `Node ${(model.nodes?.length || 0) + 1}`;
      model.executeCommand({
        commandId: crypto.randomUUID(),
        type: 'CreateNodes',
        schemaVersion: COMMAND_SCHEMA_VERSION,
        modelRevision: model.structuralDocument.revision,
        payload: { nodes: [{ name, position }] },
        source: 'ui',
      });
    }
    onClose();
  };

  const handleCancel = () => {
    onClose();
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setNode({
      ...node,
      [name]: value,
    });
  };

  const actions = (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <Button
        variant="outlined"
        color="inherit"
        size="small"
        onClick={handleCancel}
      >
        Cancel
      </Button>
      <Button
        variant="contained"
        size="small"
        onClick={handleSave}
        startIcon={<SaveIcon sx={{ fontSize: '0.875rem' }} />}
      >
        {selectedNode ? 'Save' : 'Add'}
      </Button>
    </Box>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth={false}
      draggable
      title={selectedNode ? 'Edit Node' : 'Add Node'}
      actions={actions}
    >
        <Stack spacing={1.5}>
          <Box>
            <Typography sx={fieldLabelSx}>
              Name
            </Typography>
            <TextField
              name="name"
              value={node.name}
              onChange={handleChange}
              placeholder="Node name"
              fullWidth
            />
          </Box>
          <Box>
            <Typography sx={fieldLabelSx}>
              X (m)
            </Typography>
            <TextField
              name="x"
              value={node.x}
              onChange={handleChange}
              placeholder="X"
              fullWidth
            />
          </Box>
          <Box>
            <Typography sx={fieldLabelSx}>
              Y (m)
            </Typography>
            <TextField
              name="z"
              value={node.z}
              onChange={handleChange}
              placeholder="Y"
              fullWidth
            />
          </Box>
          <Box>
            <Typography sx={fieldLabelSx}>
              Z (m)
            </Typography>
            <TextField
              name="y"
              value={node.y}
              onChange={handleChange}
              placeholder="Z"
              fullWidth
            />
          </Box>
        </Stack>
    </Dialog>
  );
});

export default AddOrEdit;
