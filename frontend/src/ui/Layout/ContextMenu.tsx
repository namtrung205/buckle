import { Menu, MenuItem, ListItemIcon, ListItemText } from '@mui/material';
import {
  Delete as DeleteIcon,
  OpenWith as MoveIcon,
  Lock as SupportIcon,
  TrendingDown as LoadIcon,
  Edit as EditIcon,
  ContentCopy as CopyIcon,
  VisibilityOff as HideIcon,
  ZoomIn as ZoomIcon,
} from '@mui/icons-material';
import { useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { toast } from 'react-toastify';
import { useContributions, useModel } from '../../model/Context';
import {
  matchesPredicates,
  type ContributionBundle,
  type ContributionHostState,
  type ContributionIcon,
} from '../../core/plugins';
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

type BuiltinContextAction =
  | 'editNodes' | 'moveNodes' | 'loadNodes' | 'supportNodes' | 'zoom' | 'deleteNodes'
  | 'editMembers' | 'loadMembers' | 'copyMembers' | 'hideMembers' | 'deleteMembers'
  | 'loadShells' | 'deleteShells';

const builtinOwner = { kind: 'builtin', id: 'buckle.context-menu', version: '0.0.2' } as const;

const builtinContextMenuBundle = (invoke: (action: BuiltinContextAction) => void): ContributionBundle => {
  const command = (id: BuiltinContextAction, title: string) => ({
    id: `builtin.context.${id}`,
    title,
    execute: () => invoke(id),
  });
  const icon = (name: string): ContributionIcon => ({ kind: 'host', name });
  const node = ['modelUnlocked', 'selectionModeNode', 'hasNodeSelection'] as const;
  const member = ['modelUnlocked', 'selectionModeMember', 'hasMemberSelection'] as const;
  const shell = ['modelUnlocked', 'selectionModeShell', 'hasShellSelection'] as const;
  return {
    commands: [
      command('editNodes', 'Edit node(s)'), command('moveNodes', 'Move node(s)'),
      command('loadNodes', 'Add nodal load'), command('supportNodes', 'Add support'),
      command('zoom', 'Zoom to selected'), command('deleteNodes', 'Delete node(s)'),
      command('editMembers', 'Edit element(s)'), command('loadMembers', 'Add member load'),
      command('copyMembers', 'Copy element(s)'), command('hideMembers', 'Hide element(s)'),
      command('deleteMembers', 'Delete element(s)'), command('loadShells', 'Add pressure load'),
      command('deleteShells', 'Delete shell(s)'),
    ],
    contextMenus: [
      { id: 'builtin.context.node.edit', commandId: 'builtin.context.editNodes', label: 'Edit node(s)', order: 10, icon: icon('edit'), visibleWhen: node },
      { id: 'builtin.context.node.move', commandId: 'builtin.context.moveNodes', label: 'Move node(s)', order: 20, icon: icon('move'), visibleWhen: node },
      { id: 'builtin.context.node.load', commandId: 'builtin.context.loadNodes', label: 'Add nodal load', order: 30, icon: icon('load'), visibleWhen: node },
      { id: 'builtin.context.node.support', commandId: 'builtin.context.supportNodes', label: 'Add support', order: 40, icon: icon('support'), visibleWhen: node },
      { id: 'builtin.context.node.zoom', commandId: 'builtin.context.zoom', label: 'Zoom to selected', order: 50, icon: icon('zoom'), visibleWhen: node },
      { id: 'builtin.context.node.delete', commandId: 'builtin.context.deleteNodes', label: 'Delete node(s)', order: 60, icon: icon('delete'), danger: true, visibleWhen: node },
      { id: 'builtin.context.member.edit', commandId: 'builtin.context.editMembers', label: 'Edit element(s)', order: 10, icon: icon('edit'), visibleWhen: member },
      { id: 'builtin.context.member.load', commandId: 'builtin.context.loadMembers', label: 'Add member load', order: 20, icon: icon('load'), visibleWhen: member },
      { id: 'builtin.context.member.copy', commandId: 'builtin.context.copyMembers', label: 'Copy element(s)', order: 30, icon: icon('copy'), visibleWhen: member },
      { id: 'builtin.context.member.hide', commandId: 'builtin.context.hideMembers', label: 'Hide element(s)', order: 40, icon: icon('hide'), visibleWhen: member },
      { id: 'builtin.context.member.zoom', commandId: 'builtin.context.zoom', label: 'Zoom fit selected', order: 50, icon: icon('zoom'), visibleWhen: member },
      { id: 'builtin.context.member.delete', commandId: 'builtin.context.deleteMembers', label: 'Delete element(s)', order: 60, icon: icon('delete'), danger: true, visibleWhen: member },
      { id: 'builtin.context.shell.load', commandId: 'builtin.context.loadShells', label: 'Add pressure load', order: 10, icon: icon('load'), visibleWhen: shell },
      { id: 'builtin.context.shell.zoom', commandId: 'builtin.context.zoom', label: 'Zoom fit selected', order: 20, icon: icon('zoom'), visibleWhen: shell },
      { id: 'builtin.context.shell.delete', commandId: 'builtin.context.deleteShells', label: 'Delete shell(s)', order: 30, icon: icon('delete'), danger: true, visibleWhen: shell },
    ],
  };
};

const hostIcon = (name: string): ReactNode => {
  switch (name) {
    case 'edit': return <EditIcon fontSize="small" />;
    case 'move': return <MoveIcon fontSize="small" />;
    case 'load': return <LoadIcon fontSize="small" />;
    case 'support': return <SupportIcon fontSize="small" />;
    case 'copy': return <CopyIcon fontSize="small" />;
    case 'hide': return <HideIcon fontSize="small" />;
    case 'zoom': return <ZoomIcon fontSize="small" />;
    case 'delete': return <DeleteIcon fontSize="small" />;
    default: return null;
  }
};

/** Context actions are scoped by host state and contributed through the same
 * owner-aware registry as the ribbon. */
const ContextMenu = observer(() => {
  const model = useModel();
  const contributions = useContributions();
  const actionsRef = useRef<Partial<Record<BuiltinContextAction, () => void>>>({});

  const nodeIds = model?.selectedNodeIds ?? [];
  const memberIds = model?.selectedMemberIds ?? [];
  const shellIds = model?.selectedShellIds ?? [];
  actionsRef.current = {
    editNodes: () => model?.focusNode(nodeIds[0]),
    moveNodes: () => { model?.openDialog('move'); },
    loadNodes: () => model?.addNodalLoadToNodes(nodeIds),
    supportNodes: () => model?.addSupportToNodes(nodeIds),
    zoom: () => model?.zoomToSelected(),
    deleteNodes: () => model?.deleteSelectedNodes(),
    editMembers: () => model?.editMembers(memberIds),
    loadMembers: () => model?.addLinearLoadToMembers(memberIds),
    copyMembers: () => { model?.openDialog('copy'); },
    hideMembers: () => model?.hideSelectedMembers(),
    deleteMembers: () => model?.deleteSelectedMembers(),
    loadShells: () => model?.addPressureLoadToShells(shellIds),
    deleteShells: () => model?.deleteSelectedShells(),
  };

  useLayoutEffect(() => contributions.register(
    builtinOwner,
    builtinContextMenuBundle(action => actionsRef.current[action]?.()),
  ), [contributions]);
  useSyncExternalStore(contributions.subscribe, contributions.getSnapshot, contributions.getSnapshot);

  if (!model || !model.contextMenu.visible) return null;
  const { visible, x, y } = model.contextMenu;
  const state: ContributionHostState = {
    modelLocked: model.isLocked,
    modelUnlocked: !model.isLocked,
    hasResults: !!model.output,
    hasSelection: nodeIds.length + memberIds.length + shellIds.length > 0,
    hasNodeSelection: nodeIds.length > 0,
    hasMemberSelection: memberIds.length > 0,
    hasShellSelection: shellIds.length > 0,
    selectionModeNode: model.selectionMode === 'node',
    selectionModeMember: model.selectionMode === 'element1d',
    selectionModeShell: model.selectionMode === 'shell2d',
  };
  const close = () => model.closeContextMenu();
  const entries = contributions.listContextMenus()
    .filter(entry => matchesPredicates(entry.visibleWhen, state));

  return (
    <Menu
      open={visible}
      onClose={close}
      onContextMenu={(event) => event.preventDefault()}
      anchorReference="anchorPosition"
      anchorPosition={{ top: y, left: x }}
      sx={menuPaperSx}
    >
      {entries.map(entry => (
        <MenuItem
          key={`${entry.owner.id}:${entry.id}`}
          disabled={!matchesPredicates(entry.enabledWhen, state)}
          onClick={() => {
            close();
            void contributions.invokeCommand(entry.commandId).catch(error => {
              toast.error(error instanceof Error ? error.message : String(error));
            });
          }}
          sx={entry.danger ? dangerRowSx : rowSx}
        >
          <ListItemIcon sx={{ color: entry.danger ? colors.danger : colors.text, minWidth: '32px' }}>
            {entry.icon?.kind === 'host' ? hostIcon(entry.icon.name) : null}
          </ListItemIcon>
          <ListItemText
            primary={entry.label}
            primaryTypographyProps={{ fontSize: '0.85rem', color: entry.danger ? colors.danger : undefined }}
          />
        </MenuItem>
      ))}
    </Menu>
  );
});

export default ContextMenu;
