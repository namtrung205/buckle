import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Box, Typography, IconButton, TextField, Button, Tooltip } from '@mui/material';
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
} from '@mui/icons-material';
import { colors, fontFamily } from '../../theme';
import { useModel } from '../../model/Context';
import type { SelectionSetKind, SelectionSetRecord } from '../../core/structural';

interface SelectionSetsProps {
  /** Disabled while the analysis results lock is active. */
  disabled?: boolean;
}

type PendingCreate = { kind: SelectionSetKind; parentId: number | null } | null;

/** Navisworks-style selection-set tree: folders and leaf sets nested without a
 *  depth limit. Only members and shells live inside a set (enforced by the
 *  canonical StructuralDocument validation). */
const SelectionSets = observer(({ disabled = false }: SelectionSetsProps) => {
  const model = useModel();
  const [pending, setPending] = useState<PendingCreate>(null);
  const [draftName, setDraftName] = useState('');

  // Keep assign buttons reactive to viewport member/shell picks.
  void model.workspaceSelectionRevision;
  const selection = model.workspaceContext.getCommandState().selection;
  const assignableCount = selection.filter(ref => ref.collection === 'members' || ref.collection === 'shells').length;

  const roots = model.selectionSetChildren(null);

  const give = (value: string) => setDraftName(value);

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

  const nodeProps = {
    disabled,
    pending,
    draftName,
    onDraftNameChange: give,
    onConfirmCreate: confirmCreate,
    onCancelCreate: cancelCreate,
    beginCreate,
    assignableCount,
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

      {roots.map(node => (
        <SelectionSetNode
          key={node.id}
          node={node}
          depth={0}
          {...nodeProps}
        />
      ))}
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
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 2, pl: 6 + depth * 1.5, py: 0.5 }}>
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
}: SelectionSetNodeProps) => {
  const model = useModel();
  const [expanded, setExpanded] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(node.name);

  const isFolder = node.kind === 'folder';
  const children = isFolder ? model.selectionSetChildren(node.id) : [];
  const showChildren = expanded || (pending?.parentId === node.id);

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

  return (
    <Box>
      {/* Row */}
      <Box
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2,
          pl: 6 + depth * 1.5,
          py: 0.7,
          cursor: 'pointer',
          '&:hover': { backgroundColor: colors.hover },
        }}
      >
        <Box
          onClick={() => { if (isFolder) setExpanded(prev => !prev); else model.selectFromSelectionSet(node.id); }}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, flex: 1 }}
        >
          {isFolder ? (
            <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 20 }}>
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
{/* Hover actions */}
        {hovered && (
          <Box sx={{ display: 'flex', gap: 0.25, flexShrink: 0 }}>
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
        )}
      </Box>

      {/* Children (folders only) */}
      {isFolder && showChildren && (
        <>
          {pending && pending.parentId === node.id && (
            <CreateRow
              kind={pending.kind}
              value={draftName}
              onChange={onDraftNameChange}
              onConfirm={onConfirmCreate}
              onCancel={onCancelCreate}
              depth={depth + 1}
            />
          )}
          {children.map(child => (
            <SelectionSetNode
              key={child.id}
              node={child}
              depth={depth + 1}
              disabled={disabled}
              pending={pending}
              draftName={draftName}
              onDraftNameChange={onDraftNameChange}
              onConfirmCreate={onConfirmCreate}
              onCancelCreate={onCancelCreate}
              beginCreate={beginCreate}
              assignableCount={assignableCount}
            />
          ))}
        </>
      )}
    </Box>
  );
});

export default SelectionSets;