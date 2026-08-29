import React from 'react';
import { Menu, MenuItem, ListItemIcon, ListItemText, Divider } from '@mui/material';
import { Delete as DeleteIcon, OpenWith as MoveIcon } from '@mui/icons-material';
import { useModel } from '../../model/Context';
import { observer } from 'mobx-react-lite';

const ContextMenu = observer(() => {
  const model = useModel();

  if (!model || !model.contextMenu.visible || model.isLocked) return null;

  const { visible, x, y } = model.contextMenu;

  const handleClose = () => {
    model.closeContextMenu();
  };

  const selectedNodes = model.selector.selected.filter(item => {
    let type = item.object.userData?.type;
    if (!type && item.object.parent) {
      type = item.object.parent.userData?.type;
    }
    return type === 'node';
  });

  const handleDelete = () => {
    if (selectedNodes.length > 0) {
      const nodesToDelete = selectedNodes.map(sel => 
        model.nodes.find(n => n.id === sel.object.userData?.id || n.id === sel.object.parent?.userData?.id)
      ).filter(n => n !== undefined);

      nodesToDelete.forEach(node => node?.delete());
      model.selector.clear();
      model.updatePointerCoords(new MouseEvent('pointermove')); // trigger refresh
    }
    handleClose();
  };

  const handleTransform = () => {
    model.openDialog('move');
    handleClose();
  };

  if (selectedNodes.length === 0) {
      // Don't show if no nodes are selected (per requirements)
      return null;
  }

  return (
    <Menu
      open={visible}
      onClose={handleClose}
      onContextMenu={(e) => {
        e.preventDefault();
      }}
      anchorReference="anchorPosition"
      anchorPosition={{ top: y, left: x }}
      sx={{
        '& .MuiPaper-root': {
          backgroundColor: '#2d2d2d',
          color: '#ffffff',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.5)',
          minWidth: '180px',
        },
      }}
    >
      <MenuItem onClick={handleTransform} sx={{ '&:hover': { backgroundColor: '#3f3f3f' } }}>
        <ListItemIcon sx={{ color: '#e0e0e0', minWidth: '36px' }}>
          <MoveIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="Transform Node(s)" primaryTypographyProps={{ fontSize: '0.85rem' }} />
      </MenuItem>
      
      <Divider sx={{ borderColor: '#404040' }} />
      
      <MenuItem onClick={handleDelete} sx={{ '&:hover': { backgroundColor: '#ff4d4f' } }}>
        <ListItemIcon sx={{ color: '#ff7875', minWidth: '36px' }}>
          <DeleteIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="Delete Node(s)" primaryTypographyProps={{ fontSize: '0.85rem', color: '#ff7875' }} />
      </MenuItem>
    </Menu>
  );
});

export default ContextMenu;
