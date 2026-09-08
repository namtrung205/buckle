import type { EntityId } from '../../core/structural/index.ts'

export type WorkspaceEntityKind = 'node' | 'member' | 'shell' | 'load' | 'boundaryCondition'
export type WorkspaceEntityRef = Readonly<{ kind: WorkspaceEntityKind; id: EntityId }>

/**
 * Non-persisted editor state. Nothing here is included in model hashes,
 * exports, analysis snapshots, or AI engineering context unless requested.
 */
export class WorkspaceContext {
  readonly selectedNodeIds = new Set<EntityId>()
  readonly selectedMemberIds = new Set<EntityId>()
  readonly selectedShellIds = new Set<EntityId>()
  hovered: WorkspaceEntityRef | null = null
  focused: WorkspaceEntityRef | null = null
  activeView = 'model'
  activeTool: string | null = null
  draft: unknown = null

  clearSelection() {
    this.selectedNodeIds.clear()
    this.selectedMemberIds.clear()
    this.selectedShellIds.clear()
  }

  reset() {
    this.clearSelection()
    this.hovered = null
    this.focused = null
    this.activeTool = null
    this.draft = null
  }
}
