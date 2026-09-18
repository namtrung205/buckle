import type { EntityId, EntityReference } from '../../core/structural/index.ts'

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
  readonly hiddenEntityRefs = new Set<string>()
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

  getCommandState() {
    const selection: EntityReference[] = [
      ...[...this.selectedNodeIds].map(id => ({ collection: 'nodes' as const, id })),
      ...[...this.selectedMemberIds].map(id => ({ collection: 'members' as const, id })),
      ...[...this.selectedShellIds].map(id => ({ collection: 'shells' as const, id })),
    ]
    const hidden = [...this.hiddenEntityRefs].map(key => {
      const [collection, rawId] = key.split(':')
      return { collection: collection as EntityReference['collection'], id: Number(rawId) }
    })
    return { selection, hidden }
  }

  applyCommandState(state: { selection: readonly EntityReference[]; hidden: readonly EntityReference[] }) {
    this.clearSelection()
    for (const ref of state.selection) {
      if (ref.collection === 'nodes') this.selectedNodeIds.add(ref.id)
      if (ref.collection === 'members') this.selectedMemberIds.add(ref.id)
      if (ref.collection === 'shells') this.selectedShellIds.add(ref.id)
    }
    this.hiddenEntityRefs.clear()
    for (const ref of state.hidden) this.hiddenEntityRefs.add(`${ref.collection}:${ref.id}`)
  }

  reset() {
    this.clearSelection()
    this.hiddenEntityRefs.clear()
    this.hovered = null
    this.focused = null
    this.activeTool = null
    this.draft = null
  }
}
