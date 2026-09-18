import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Box, Typography, IconButton, TextField, Button, Tooltip, Menu, MenuItem, ListItemIcon, ListItemText } from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  Checklist as SelectionSetIcon,
  CreateNewFolder as NewFolderIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Check as ConfirmIcon,
  Close as CancelIcon,
  Polyline as MemberIcon,
  GridView as ShellIcon,
  PlaylistRemove as RemoveFromSetIcon,
  Visibility as ShowIcon,
  VisibilityOff as HideIcon,
  CenterFocusStrong as IsolateIcon,
  ZoomIn as ZoomIcon,
  SelectAll as SelectAllIcon,
} from '@mui/icons-material';
import { colors, fontFamily } from '../../theme';
import { useModel } from '../../model/Context';
import type { EntityReference, SelectionSetKind, SelectionSetRecord } from '../../core/structural';

interface SelectionSetsProps {
  /** Disabled while the analysis results lock is active. */
  disabled?: boolean;
}

type PendingCreate = { kind: SelectionSetKind; parentId: number | null } | null;

export type ContextMenuItem = {
  label: string;
  icon: React.ReactNode;
  action: () => void;
  danger?: boolean;
};

/** Navisworks-style selection-set tree: folders and leaf sets nested without a
 *  depth limit. Only members and shells live inside a set (enforced by the
 *  canonical StructuralDocument validation). */
const SelectionSets = observer(({ disabled = false }: SelectionSetsProps) => {
  const model = useModel();
  const [pending, setPending] = useState<PendingCreate>(null);
  const [draftName, setDraftName] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  /** Drag & drop: move a folder/set under another folder (or to the root). */
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  // Keep assign buttons reactive to viewport member/shell picks.
  void model.workspaceSelectionRevision;
  const selection = model.workspaceContext.getCommandState().selection;
  const assignableCount = selection.filter(ref => ref.collection === 'members' || ref.collection === 'shells').length;

  const roots = model.selectionSetChildren(null);

  const give = (value: string) => setDraftName(value);

  /** Open the floating context menu at the pointer (stopPropagation so the row
   *  click handlers don't fire on right-click). */
  const openContextMenu = (event: React.MouseEvent, items: ContextMenuItem[]) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, items });
  };

  const closeContextMenu = () => setContextMenu(null);

  const beginCreate = (kind: SelectionSetKind, parentId: number | null) => {
    setPending({ kind, parentId });
    setDraftName(kind === 'folder' ? 'New Folder' : 'New Selection Set');
  };

  const confirmCreate = () => {
    if (!pending) return;
    model.createSelectionSet(draftName, pending.kind, pending.parentId);
    setPending(null);
    setDraftName('');
  };

  const cancelCreate = () => {
    setPending(null);
    setDraftName('');
  };

  /** True when `candidateId` is `id` itself or lives anywhere inside its subtree
   *  (dropping there would create a cycle the document would reject). */
  const isSelfOrDescendant = (id: number, candidateId: number): boolean => {
    if (id === candidateId) return true;
    const visit = (parentId: number): boolean =>
      model.selectionSetChildren(parentId).some(
        child => child.id === candidateId || (child.kind === 'folder' && visit(child.id)),
      );
    return visit(id);
  };

  /** Re-parent a node via drag & drop (no-op when the parent didn't change). */
  const moveNode = (id: number, parentId: number | null) => {
    if (parentId !== null && isSelfOrDescendant(id, parentId)) return;
    const current = model.structuralDocument.selectionSets.get(id);
    if (!current || current.parentId === parentId) return;
    model.updateSelectionSet(id, { parentId });
  };

  const nodeProps = {
    disabled,
    pending,
    draftName,
    onDraftNameChange: give,
    onConfirmCreate: confirmCreate,
    onCancelCreate: cancelCreate,
    beginCreate,
    assignableCount,
    openContextMenu,
    dragId,
    dragOverId,
    setDragId,
    setDragOverId,
    moveNode,
  };

  return (
    <Box sx={{ px: 1, py: 1 }}>
      {/* Toolbar */}
      <Box sx={{ display: 'flex', gap: 0.5, mb: 1, alignItems: 'center' }}>
        <Button
          size="small"
          variant="outlined"
          disabled={disabled}
          startIcon={<NewFolderIcon sx={{ fontSize: 14 }} />}
          onClick={() => beginCreate('folder', null)}
        >
          Folder
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={disabled}
          startIcon={<SelectionSetIcon sx={{ fontSize: 14 }} />}
          onClick={() => beginCreate('set', null)}
        >
          Selection Set
        </Button>
      </Box>
      <Typography
        sx={{ fontSize: '0.7rem', color: colors.textFaint, fontStyle: 'italic', mb: 1, fontFamily }}
      >
        Select members / shells in the viewport, then use a set&rsquo;s &ldquo;assign&rdquo; action.
      </Typography>

      {pending && pending.parentId === null && (
        <CreateRow
          kind={pending.kind}
          value={draftName}
          onChange={setDraftName}
          onConfirm={confirmCreate}
          onCancel={cancelCreate}
          depth={0}
        />
      )}

      {roots.length === 0 && !pending && (
        <Box sx={{ px: 2, pl: 6, py: 0.8 }}>
          <Typography sx={{ fontSize: '0.7rem', color: colors.textFaint, fontStyle: 'italic', fontFamily }}>
            No selection sets yet&hellip;
          </Typography>
        </Box>
      )}

      <Box
        flex={1}
        minHeight={24}
        onDragOver={(e) => {
          if (dragId === null) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDragOverId(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragId !== null) moveNode(dragId, null);
          setDragId(null);
          setDragOverId(null);
        }}
      >
        {roots.map(node => (
          <SelectionSetNode
            key={node.id}
            node={node}
            depth={0}
            {...nodeProps}
          />
        ))}
      </Box>

      {/* Floating context menu (right-click on folder / set / entity rows) */}
      <Menu
        open={contextMenu !== null}
        onClose={closeContextMenu}
        onContextMenu={(event) => event.preventDefault()}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.y, left: contextMenu.x } : undefined}
        sx={{
          '& .MuiPaper-root': {
            backgroundColor: colors.surface,
            color: colors.text,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
            minWidth: '210px',
            py: 0.5,
          },
        }}
      >
        {contextMenu?.items.map(item => (
          <MenuItem
            key={item.label}
            onClick={() => { item.action(); closeContextMenu(); }}
            sx={{
              minHeight: 30,
              '&:hover': item.danger ? { backgroundColor: 'rgba(229, 72, 77, 0.18)' } : {},
            }}
          >
            <ListItemIcon sx={{ color: item.danger ? colors.danger : colors.text, minWidth: '30px' }}>{item.icon}</ListItemIcon>
            <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: '0.8rem', color: item.danger ? colors.danger : undefined }} />
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
});
interface CreateRowProps {
  kind: SelectionSetKind;
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  depth: number;
}

const CreateRow = ({ kind, value, onChange, onConfirm, onCancel, depth }: CreateRowProps) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 2, pl: 6 + depth * 1.5, py: 0.75 }}>
    {kind === 'folder'
      ? <FolderIcon sx={{ fontSize: 16, color: colors.accentSoft }} />
      : <SelectionSetIcon sx={{ fontSize: 16, color: colors.secondary }} />}
    <TextField
      size="small"
      autoFocus
      value={value}
      onChange={event => onChange(event.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') onConfirm();
        if (e.key === 'Escape') onCancel();
      }}
      sx={{ flex: 1, '& .MuiInputBase-input': { py: 0.25, px: 0.75, fontSize: '0.75rem', color: colors.text } }}
    />
    <IconButton size="small" title="Create" onClick={onConfirm} sx={{ padding: '2px', color: colors.success, '&:hover': { color: colors.success } }}>
      <ConfirmIcon sx={{ fontSize: 16 }} />
    </IconButton>
    <IconButton size="small" title="Cancel" onClick={onCancel} sx={{ padding: '2px', color: colors.textDim, '&:hover': { color: colors.text } }}>
      <CancelIcon sx={{ fontSize: 16 }} />
    </IconButton>
  </Box>
);
interface SelectionSetNodeProps {
  node: SelectionSetRecord;
  depth: number;
  disabled: boolean;
  pending: PendingCreate;
  draftName: string;
  onDraftNameChange: (value: string) => void;
  onConfirmCreate: () => void;
  onCancelCreate: () => void;
  beginCreate: (kind: SelectionSetKind, parentId: number | null) => void;
  assignableCount: number;
  openContextMenu: (event: React.MouseEvent, items: ContextMenuItem[]) => void;
  dragId: number | null;
  dragOverId: number | null;
  setDragId: React.Dispatch<React.SetStateAction<number | null>>;
  setDragOverId: React.Dispatch<React.SetStateAction<number | null>>;
  moveNode: (id: number, parentId: number | null) => void;
}

const SelectionSetNode = observer(({
  node,
  depth,
  disabled,
  pending,
  draftName,
  onDraftNameChange,
  onConfirmCreate,
  onCancelCreate,
  beginCreate,
  assignableCount,
  openContextMenu,
  dragId,
  dragOverId,
  setDragId,
  setDragOverId,
  moveNode,
}: SelectionSetNodeProps) => {
  const model = useModel();
  const [expanded, setExpanded] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(node.name);

  const isFolder = node.kind === 'folder';
  const children = isFolder ? model.selectionSetChildren(node.id) : [];
  const expandable = isFolder || node.entityRefs.length > 0;
  const showChildren = expandable && (expanded || (pending?.parentId === node.id));

  /** Pass-through props (drag state + handlers + shared UI state) for child nodes. */
  const nodeDragProps = {
    disabled, pending, draftName, onDraftNameChange, onConfirmCreate, onCancelCreate,
    beginCreate, assignableCount, openContextMenu,
    dragId, dragOverId, setDragId, setDragOverId, moveNode,
  };

  const commitRename = () => {
    const name = nameDraft.trim();
    if (name && name !== node.name) model.updateSelectionSet(node.id, { name });
    setRenaming(false);
  };

  const assignRefs = () => {
    const refs = model.workspaceContext.getCommandState().selection
      .filter(ref => ref.collection === 'members' || ref.collection === 'shells');
    model.assignSelectionToSelectionSet(node.id, refs);
  };

  /** Members/shells this row affects: folder → recursive subtree; set → itself. */
  const scopeRefs = isFolder ? model.selectionSetSubtreeRefs(node.id) : node.entityRefs;

  const nodeMenuItems = (): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      {
        label: isFolder ? 'Select all in folder' : 'Select set',
        icon: <SelectAllIcon sx={{ fontSize: 16 }} />,
        action: () => { if (isFolder) model.selectSelectionSetSubtree(node.id); else model.selectFromSelectionSet(node.id); },
      },
      {
        label: 'Show',
        icon: <ShowIcon sx={{ fontSize: 16 }} />,
        action: () => model.setRefsHidden(scopeRefs, false),
      },
      {
        label: 'Hide',
        icon: <HideIcon sx={{ fontSize: 16 }} />,
        action: () => model.setRefsHidden(scopeRefs, true),
      },
      {
        label: 'Isolate (hide others)',
        icon: <IsolateIcon sx={{ fontSize: 16 }} />,
        action: () => model.isolateRefs(scopeRefs),
      },
      {
        label: 'Zoom to',
        icon: <ZoomIcon sx={{ fontSize: 16 }} />,
        action: () => model.zoomToRefs(scopeRefs),
      },
    ];
    if (isFolder) {
      items.push({
        label: 'New selection set here',
        icon: <SelectionSetIcon sx={{ fontSize: 16 }} />,
        action: () => beginCreate('set', node.id),
      });
      items.push({
        label: 'New subfolder',
        icon: <NewFolderIcon sx={{ fontSize: 16 }} />,
        action: () => beginCreate('folder', node.id),
      });
    }
    items.push({
      label: 'Rename',
      icon: <EditIcon sx={{ fontSize: 16 }} />,
      action: () => { setNameDraft(node.name); setRenaming(true); },
    });
    items.push({
      label: isFolder ? 'Delete folder (with contents)' : 'Delete selection set',
      icon: <DeleteIcon sx={{ fontSize: 16 }} />,
      danger: true,
      action: () => { if (window.confirm(`Delete ${isFolder ? 'folder' : 'selection set'} “${node.name}”?`)) model.deleteSelectionSet(node.id); },
    });
    return items;
  };

  return (
    <Box>
      {/* Row */}
      <Box
        draggable={!disabled && !renaming}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          // Firefox refuses to start a drag with an empty dataTransfer
          e.dataTransfer.setData('text/plain', String(node.id));
          setDragId(node.id);
        }}
        onDragEnd={() => { setDragId(null); setDragOverId(null); }}
        onDragOver={(e) => {
          if (dragId === null || dragId === node.id || !isFolder) return;
          e.preventDefault(); // allow drop
          e.stopPropagation(); // don't let the root drop-zone clear the highlight
          e.dataTransfer.dropEffect = 'move';
          setDragOverId(node.id);
        }}
        onDragLeave={() => setDragOverId(current => (current === node.id ? null : current))}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation(); // don't let the root drop-zone move the node back to root
          if (dragId !== null && isFolder) moveNode(dragId, node.id);
          setDragId(null);
          setDragOverId(null);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onContextMenu={(event) => openContextMenu(event, nodeMenuItems())}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2,
          pl: 6 + depth * 1.5,
          py: 1,
          cursor: 'pointer',
          backgroundColor: dragOverId === node.id ? 'rgba(74, 144, 226, 0.18)' : 'transparent',
          outline: dragOverId === node.id ? `1px dashed ${colors.accent}` : 'none',
          outlineOffset: '-1px',
          '&:hover': { backgroundColor: colors.hover },
        }}
      >
        <Box
          onClick={() => {
            if (isFolder) model.selectSelectionSetSubtree(node.id);
            else model.selectFromSelectionSet(node.id);
          }}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, flex: 1 }}
        >
          {expandable ? (
            <Box
              onClick={(e) => { e.stopPropagation(); setExpanded(prev => !prev); }}
              sx={{ display: 'flex', alignItems: 'center', minWidth: 20, cursor: 'pointer' }}
            >
              {showChildren
                ? <ExpandMoreIcon sx={{ fontSize: 18, color: colors.textDim }} />
                : <ChevronRightIcon sx={{ fontSize: 18, color: colors.textDim }} />}
            </Box>
          ) : <Box sx={{ minWidth: 20 }} />}
          {isFolder
            ? (showChildren
              ? <FolderOpenIcon sx={{ fontSize: 18, color: colors.accentSoft }} />
              : <FolderIcon sx={{ fontSize: 18, color: colors.accentSoft }} />)
            : <SelectionSetIcon sx={{ fontSize: 18, color: colors.secondary }} />}

          {renaming ? (
            <TextField
              size="small"
              autoFocus
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenaming(false);
              }}
              onBlur={commitRename}
              sx={{ flex: 1, '& .MuiInputBase-input': { py: 0.25, px: 0.75, fontSize: '0.75rem', color: colors.text } }}
            />
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, overflow: 'hidden' }}>
              <Typography
                sx={{
                  fontSize: '0.75rem',
                  color: isFolder ? colors.text : colors.textDim,
                  fontWeight: isFolder ? 600 : 500,
                  fontFamily,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {node.name}
              </Typography>
              {!isFolder && (
                <Typography
                  sx={{
                    fontSize: '0.6rem',
                    color: colors.textFaint,
                    fontFamily: '"Consolas", "Roboto Mono", ui-monospace, monospace',
                    flexShrink: 0,
                  }}
                >
                  {node.entityRefs.length}
                </Typography>
              )}
            </Box>
          )}
        </Box>
{/* Hover actions (always mounted; hidden via visibility so the row doesn't jump) */}
        <Box sx={{ display: 'flex', gap: 0.25, flexShrink: 0, visibility: hovered ? 'visible' : 'hidden' }}>
            {isFolder ? (
              <>
                <Tooltip title="New selection set here">
                  <span>
                    <IconButton
                      size="small"
                      disabled={disabled}
                      onClick={(e) => { e.stopPropagation(); beginCreate('set', node.id); setExpanded(true); }}
                      sx={{ padding: '1px', color: colors.textDim, '&:hover': { color: colors.text }, '&.Mui-disabled': { color: colors.textFaint } }}
                    >
                      <SelectionSetIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="New subfolder">
                  <span>
                    <IconButton
                      size="small"
                      disabled={disabled}
                      onClick={(e) => { e.stopPropagation(); beginCreate('folder', node.id); setExpanded(true); }}
                      sx={{ padding: '1px', color: colors.textDim, '&:hover': { color: colors.text }, '&.Mui-disabled': { color: colors.textFaint } }}
                    >
                      <NewFolderIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </span>
                </Tooltip>
              </>
            ) : (
              <Tooltip title={assignableCount
                ? `Assign ${assignableCount} selected member/shell`
                : 'Select members / shells in the viewport first'}>
                <span>
                  <IconButton
                    size="small"
                    disabled={disabled || assignableCount === 0}
                    onClick={(e) => { e.stopPropagation(); assignRefs(); }}
                    sx={{ padding: '1px', color: colors.accentSoft, '&:hover': { color: colors.accent }, '&.Mui-disabled': { color: colors.textFaint } }}
                  >
                    <SelectionSetIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </span>
              </Tooltip>
            )}
            <IconButton
              size="small"
              disabled={disabled}
              title="Rename"
              onClick={(e) => { e.stopPropagation(); setNameDraft(node.name); setRenaming(true); }}
              sx={{ padding: '1px', color: colors.textDim, '&:hover': { color: colors.text }, '&.Mui-disabled': { color: colors.textFaint } }}
            >
              <EditIcon sx={{ fontSize: 14 }} />
            </IconButton>
            <IconButton
              size="small"
              disabled={disabled}
              title={isFolder ? 'Delete folder and everything inside' : 'Delete selection set'}
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Delete ${isFolder ? 'folder' : 'selection set'} “${node.name}”?`)) {
                  model.deleteSelectionSet(node.id);
                }
              }}
              sx={{ padding: '1px', color: colors.danger, '&:hover': { color: colors.danger }, '&.Mui-disabled': { color: colors.textFaint } }}
            >
              <DeleteIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>
      </Box>

      {/* Children: sub-folders/sets for folders, entity list for sets */}
      {showChildren && (
        <>
          {isFolder && pending && pending.parentId === node.id && (
            <CreateRow
              kind={pending.kind}
              value={draftName}
              onChange={onDraftNameChange}
              onConfirm={onConfirmCreate}
              onCancel={onCancelCreate}
              depth={depth + 1}
            />
          )}
          {isFolder && children.map(child => (
            <SelectionSetNode
              key={child.id}
              node={child}
              depth={depth + 1}
              {...nodeDragProps}
            />
          ))}
          {!isFolder && node.entityRefs.map(ref => (
            <SelectionSetEntityRow
              key={`${ref.collection}:${ref.id}`}
              setId={node.id}
              entityRef={ref}
              depth={depth + 1}
              disabled={disabled}
              openContextMenu={openContextMenu}
            />
          ))}
        </>
      )}
    </Box>
  );
});

interface SelectionSetEntityRowProps {
  setId: number;
  entityRef: EntityReference;
  depth: number;
  disabled: boolean;
  openContextMenu: (event: React.MouseEvent, items: ContextMenuItem[]) => void;
}

/** Leaf row inside a selection set: a member or shell stored in the set.
 *  Click selects it in the viewport; hover offers Remove-from-set; a right-click
 *  opens Show / Hide / Isolate / Zoom-to. */
const SelectionSetEntityRow = ({ setId, entityRef: ref, depth, disabled, openContextMenu }: SelectionSetEntityRowProps) => {
  const model = useModel();
  const [hovered, setHovered] = useState(false);

  const isMember = ref.collection === 'members';
  const member = isMember ? model.structuralDocument.members.get(ref.id) : undefined;
  const shell = !isMember ? model.structuralDocument.shells.get(ref.id) : undefined;
  const label = isMember
    ? (member?.label || `Member ${ref.id}`)
    : (shell?.name || `Shell ${ref.id}`);

  const entityMenuItems = (): ContextMenuItem[] => [
    {
      label: 'Show',
      icon: <ShowIcon sx={{ fontSize: 16 }} />,
      action: () => model.setRefsHidden([ref], false),
    },
    {
      label: 'Hide',
      icon: <HideIcon sx={{ fontSize: 16 }} />,
      action: () => model.setRefsHidden([ref], true),
    },
    {
      label: 'Isolate (hide others)',
      icon: <IsolateIcon sx={{ fontSize: 16 }} />,
      action: () => model.isolateRefs([ref]),
    },
    {
      label: 'Zoom to',
      icon: <ZoomIcon sx={{ fontSize: 16 }} />,
      action: () => model.zoomToRefs([ref]),
    },
    {
      label: 'Remove from set',
      icon: <RemoveFromSetIcon sx={{ fontSize: 16 }} />,
      danger: true,
      action: () => model.removeEntityFromSelectionSet(setId, ref),
    },
  ];

  return (
    <Box
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(event) => openContextMenu(event, entityMenuItems())}
      onClick={() => model.selectEntity(ref)}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 2,
        pl: 6 + (depth + 1) * 1.5,
        py: 0.8,
        cursor: 'pointer',
        '&:hover': { backgroundColor: colors.hover },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, flex: 1 }}>
        <Box sx={{ minWidth: 20 }} />
        {isMember
          ? <MemberIcon sx={{ fontSize: 16, color: colors.textDim }} />
          : <ShellIcon sx={{ fontSize: 16, color: colors.textDim }} />}
        <Typography
          sx={{
            fontSize: '0.7rem',
            color: colors.textFaint,
            fontFamily,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {label}
        </Typography>
      </Box>
      {/* Always mounted; hidden via visibility so the row doesn't shift on hover */}
      <Box sx={{ visibility: hovered ? 'visible' : 'hidden' }}>
        <Tooltip title="Remove from set">
          <span>
            <IconButton
              size="small"
              disabled={disabled}
              onClick={(e) => { e.stopPropagation(); model.removeEntityFromSelectionSet(setId, ref); }}
              sx={{ padding: '1px', color: colors.danger, '&:hover': { color: colors.danger }, '&.Mui-disabled': { color: colors.textFaint } }}
            >
              <RemoveFromSetIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
};

export default SelectionSets;