import { useRef, useState } from 'react';
import { Menu, MenuItem, ListItemIcon, ListItemText, Box } from '@mui/material';
import {
  Delete as DeleteIcon,
  OpenWith as MoveIcon,
  Lock as SupportIcon,
  TrendingDown as LoadIcon,
  Edit as EditIcon,
  ChevronRight as ChevronRightIcon,
  Room as NodeIcon,
  CallSplit as ElementIcon,
} from '@mui/icons-material';
import { useModel } from '../../model/Context';
import { observer } from 'mobx-react-lite';
import { colors } from '../../theme';

type Submenu = 'Node' | 'Element' | null;

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

/**
 * Traditional desktop-style context menu with nested submenus:
 *   Node    > Move / Add Load / Add Support / Delete
 *   Element > Edit / Add Load / Delete
 * Hovering a row opens its submenu right next to it; moving away closes it
 * (with a small delay so crossing the gap between menu and submenu is safe).
 */
const ContextMenu = observer(() => {
  const model = useModel();
  const [openSub, setOpenSub] = useState<Submenu>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mainMenuRef = useRef<HTMLDivElement | null>(null);

  if (!model || !model.contextMenu.visible || model.isLocked) return null;

  const { visible, x, y } = model.contextMenu;
  const selectedNodeIds = model.selectedNodeIds;
  const selectedMemberIds = model.selectedMemberIds;
  const hasNodes = selectedNodeIds.length > 0;
  const hasMembers = selectedMemberIds.length > 0;

  const handleClose = () => {
    setOpenSub(null);
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    model.closeContextMenu();
  };

  const openSubmenu = (which: Submenu) => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setOpenSub(which);
  };

  const closeSubmenuSoon = () => {
    if (openSub) leaveTimer.current = setTimeout(() => setOpenSub(null), 130);
  };

  // Node actions
  const deleteNodes = () => { model.deleteSelectedNodes(); handleClose(); };
  const moveNodes = () => { model.openDialog('move'); handleClose(); };
  const addNodeLoad = () => { model.addNodalLoadToNodes(selectedNodeIds); handleClose(); };
  const addNodeSupport = () => { model.addSupportToNodes(selectedNodeIds); handleClose(); };

  // Element actions
  const deleteMembers = () => { model.deleteSelectedMembers(); handleClose(); };
  const editMembers = () => { model.editMembers(selectedMemberIds); handleClose(); };
  const addMemberLoad = () => { model.addLinearLoadToMembers(selectedMemberIds); handleClose(); };

  // Position the submenu flush to the right edge of the main menu (flip to the
  // left when there is not enough room on screen).
  const submenuWidth = 180;
  const mainRect = mainMenuRef.current?.getBoundingClientRect();
  let subX = mainRect ? mainRect.right + 2 : x + 200;
  const subY = mainRect ? mainRect.top + 4 : y + 4;
  if (subX + submenuWidth > window.innerWidth) {
    subX = mainRect ? mainRect.left - submenuWidth - 2 : x - submenuWidth;
  }

  return (
    <>
      {/* Main menu: one row per entity type, each with a submenu arrow */}
      <Menu
        open={visible}
        onClose={handleClose}
        onContextMenu={(e) => e.preventDefault()}
        anchorReference="anchorPosition"
        anchorPosition={{ top: y, left: x }}
        sx={menuPaperSx}
      >
        <Box ref={mainMenuRef} sx={{ minWidth: '190px' }} onMouseLeave={closeSubmenuSoon}>
          <MenuItem
            onMouseEnter={() => openSubmenu('Node')}
            onClick={() => openSubmenu('Node')}
            disabled={!hasNodes}
            sx={{ ...rowSx, ...(openSub === 'Node' ? { backgroundColor: colors.hover } : {}) }}
          >
            <ListItemIcon sx={{ color: colors.text, minWidth: '32px' }}><NodeIcon fontSize="small" /></ListItemIcon>
            <ListItemText
              primary={`Node${hasNodes ? ` (${selectedNodeIds.length})` : ''}`}
              primaryTypographyProps={{ fontSize: '0.85rem' }}
            />
            <ChevronRightIcon fontSize="small" sx={{ color: colors.textDim }} />
          </MenuItem>
          <MenuItem
            onMouseEnter={() => openSubmenu('Element')}
            onClick={() => openSubmenu('Element')}
            disabled={!hasMembers}
            sx={{ ...rowSx, ...(openSub === 'Element' ? { backgroundColor: colors.hover } : {}) }}
          >
            <ListItemIcon sx={{ color: colors.text, minWidth: '32px' }}><ElementIcon fontSize="small" /></ListItemIcon>
            <ListItemText
              primary={`Element${hasMembers ? ` (${selectedMemberIds.length})` : ''}`}
              primaryTypographyProps={{ fontSize: '0.85rem' }}
            />
            <ChevronRightIcon fontSize="small" sx={{ color: colors.textDim }} />
          </MenuItem>
        </Box>
      </Menu>

      {/* Submenu — appears right next to the hovered row */}
      {(openSub === 'Node' || openSub === 'Element') && (
        <Menu
          open
          onClose={handleClose}
          onContextMenu={(e) => e.preventDefault()}
          anchorReference="anchorPosition"
          anchorPosition={{ top: subY, left: subX }}
          onMouseEnter={() => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }}
          onMouseLeave={closeSubmenuSoon}
          sx={menuPaperSx}
          disableAutoFocusItem
        >
          {openSub === 'Node' && (
            hasNodes ? (
              <>
                <MenuItem onClick={moveNodes} sx={rowSx}>
                  <ListItemIcon sx={{ color: colors.text, minWidth: '32px' }}><MoveIcon fontSize="small" /></ListItemIcon>
                  <ListItemText primary="Move" primaryTypographyProps={{ fontSize: '0.85rem' }} />
                </MenuItem>
                <MenuItem onClick={addNodeLoad} sx={rowSx}>
                  <ListItemIcon sx={{ color: colors.text, minWidth: '32px' }}><LoadIcon fontSize="small" /></ListItemIcon>
                  <ListItemText primary="Add Load" primaryTypographyProps={{ fontSize: '0.85rem' }} />
                </MenuItem>
                <MenuItem onClick={addNodeSupport} sx={rowSx}>
                  <ListItemIcon sx={{ color: colors.text, minWidth: '32px' }}><SupportIcon fontSize="small" /></ListItemIcon>
                  <ListItemText primary="Add Support" primaryTypographyProps={{ fontSize: '0.85rem' }} />
                </MenuItem>
                <MenuItem onClick={deleteNodes} sx={{ ...rowSx, '&:hover': { backgroundColor: 'rgba(229, 72, 77, 0.18)' } }}>
                  <ListItemIcon sx={{ color: colors.danger, minWidth: '32px' }}><DeleteIcon fontSize="small" /></ListItemIcon>
                  <ListItemText primary="Delete" primaryTypographyProps={{ fontSize: '0.85rem', color: colors.danger }} />
                </MenuItem>
              </>
            ) : (
              <Box sx={{ px: 1.5, py: 1, fontSize: '0.75rem', color: colors.textFaint }}>Chưa chọn node nào</Box>
            )
          )}
          {openSub === 'Element' && (
            hasMembers ? (
              <>
                <MenuItem onClick={editMembers} sx={rowSx}>
                  <ListItemIcon sx={{ color: colors.text, minWidth: '32px' }}><EditIcon fontSize="small" /></ListItemIcon>
                  <ListItemText primary="Edit element(s)" primaryTypographyProps={{ fontSize: '0.85rem' }} />
                </MenuItem>
                <MenuItem onClick={addMemberLoad} sx={rowSx}>
                  <ListItemIcon sx={{ color: colors.text, minWidth: '32px' }}><LoadIcon fontSize="small" /></ListItemIcon>
                  <ListItemText primary="Add Load" primaryTypographyProps={{ fontSize: '0.85rem' }} />
                </MenuItem>
                <MenuItem onClick={deleteMembers} sx={{ ...rowSx, '&:hover': { backgroundColor: 'rgba(229, 72, 77, 0.18)' } }}>
                  <ListItemIcon sx={{ color: colors.danger, minWidth: '32px' }}><DeleteIcon fontSize="small" /></ListItemIcon>
                  <ListItemText primary="Delete element(s)" primaryTypographyProps={{ fontSize: '0.85rem', color: colors.danger }} />
                </MenuItem>
              </>
            ) : (
              <Box sx={{ px: 1.5, py: 1, fontSize: '0.75rem', color: colors.textFaint }}>Chưa chọn element nào</Box>
            )
          )}
        </Menu>
      )}
    </>
  );
});

export default ContextMenu;
