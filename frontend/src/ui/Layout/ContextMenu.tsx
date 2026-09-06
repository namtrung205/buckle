import { Menu, MenuItem, ListItemIcon, ListItemText } from '@mui/material';
import {
  Delete as DeleteIcon,
  OpenWith as MoveIcon,
  Lock as SupportIcon,
  TrendingDown as LoadIcon,
  Edit as EditIcon,
  ContentCopy as CopyIcon,
  VisibilityOff as HideIcon,
} from '@mui/icons-material';
import { useModel } from '../../model/Context';
import { observer } from 'mobx-react-lite';
import { colors } from '../../theme';

const menuPaperSx = {
  '& .MuiPaper-root': {
    backgroundColor: colors.surface,
    color: colors.text,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
    minWidth: '190px',
    py: 0.5,
  },
} as const;

const rowSx = { minHeight: 34 } as const;
const dangerRowSx = { ...rowSx, '&:hover': { backgroundColor: 'rgba(229, 72, 77, 0.18)' } } as const;

/** Context actions are intentionally scoped by Select Mode. This avoids mixed
 * Node/Element menus and makes dense overlapping structural models predictable. */
const ContextMenu = observer(() => {
  const model = useModel();
  if (!model || !model.contextMenu.visible || model.isLocked) return null;

  const { visible, x, y } = model.contextMenu;
  const nodeIds = model.selectedNodeIds;
  const memberIds = model.selectedMemberIds;
  const shellIds = model.selectedShellIds;

  const close = () => model.closeContextMenu();
  const action = (callback: () => void) => () => { callback(); close(); };
  const item = (label: string, icon: React.ReactNode, callback: () => void, danger = false) => (
    <MenuItem key={label} onClick={action(callback)} sx={danger ? dangerRowSx : rowSx}>
      <ListItemIcon sx={{ color: danger ? colors.danger : colors.text, minWidth: '32px' }}>{icon}</ListItemIcon>
      <ListItemText primary={label} primaryTypographyProps={{ fontSize: '0.85rem', color: danger ? colors.danger : undefined }} />
    </MenuItem>
  );

  return (
    <Menu
      open={visible}
      onClose={close}
      onContextMenu={(event) => event.preventDefault()}
      anchorReference="anchorPosition"
      anchorPosition={{ top: y, left: x }}
      sx={menuPaperSx}
    >
      {model.selectionMode === 'node' && nodeIds.length > 0 && [
        item('Edit node(s)', <EditIcon fontSize="small" />, () => model.focusNode(nodeIds[0])),
        item('Move node(s)', <MoveIcon fontSize="small" />, () => model.openDialog('move')),
        item('Add nodal load', <LoadIcon fontSize="small" />, () => model.addNodalLoadToNodes(nodeIds)),
        item('Add support', <SupportIcon fontSize="small" />, () => model.addSupportToNodes(nodeIds)),
        item('Delete node(s)', <DeleteIcon fontSize="small" />, model.deleteSelectedNodes, true),
      ]}

      {model.selectionMode === 'element1d' && memberIds.length > 0 && [
        item('Edit element(s)', <EditIcon fontSize="small" />, () => model.editMembers(memberIds)),
        item('Add member load', <LoadIcon fontSize="small" />, () => model.addLinearLoadToMembers(memberIds)),
        item('Copy element(s)', <CopyIcon fontSize="small" />, () => model.openDialog('copy')),
        item('Hide element(s)', <HideIcon fontSize="small" />, model.hideSelectedMembers),
        item('Delete element(s)', <DeleteIcon fontSize="small" />, model.deleteSelectedMembers, true),
      ]}

      {model.selectionMode === 'shell2d' && shellIds.length > 0 && [
        item('Add pressure load', <LoadIcon fontSize="small" />, () => model.addPressureLoadToShells(shellIds)),
        item('Delete shell(s)', <DeleteIcon fontSize="small" />, model.deleteSelectedShells, true),
      ]}
    </Menu>
  );
});

export default ContextMenu;
