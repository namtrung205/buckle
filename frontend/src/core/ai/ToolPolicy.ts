import type { CommandTransactionOperation, EntityReference } from '../structural/index.ts'
import type { AiMode, AiToolDefinition, ToolPreview } from './types.ts'

const workspaceTools = new Set(['set_selection', 'hide_entities', 'show_entities'])
const editTools = new Set(['move_nodes', 'update_members', 'change_section', 'change_material', 'transform_entities', 'update_entity_properties', 'delete_entities'])
const modelingTools = new Set(['create_nodes', 'create_members', ...editTools, ...workspaceTools, 'execute_transaction', 'preview_transaction', 'undo_last_ai_change'])
export const PARAMETRIC_MUTATION_TOOLS = [
  'create_grid', 'create_portal_frame', 'create_frame_array', 'create_truss',
  'create_warehouse', 'create_tower', 'update_parametric_object', 'generate_parametric',
] as const
const generateTools = new Set([...workspaceTools, 'preview_transaction', 'undo_last_ai_change', ...PARAMETRIC_MUTATION_TOOLS])

export const isToolAllowed = (mode: AiMode, tool: AiToolDefinition) => {
  if (tool.kind === 'query') return true
  if (mode === 'Inspect') return false
  if (mode === 'Edit') return editTools.has(tool.name) || workspaceTools.has(tool.name) || tool.name === 'preview_transaction' || tool.name === 'undo_last_ai_change'
  if (mode === 'Modeling') return modelingTools.has(tool.name)
  if (mode === 'Generate') return generateTools.has(tool.name)
  return true
}

export const assertSelectionScope = (mode: AiMode, toolName: string, targetRefs: readonly EntityReference[], selection: readonly EntityReference[]) => {
  if (mode !== 'Edit' || !editTools.has(toolName)) return
  const selected = new Set(selection.map(ref => `${ref.collection}:${ref.id}`))
  const outside = targetRefs.find(ref => !selected.has(`${ref.collection}:${ref.id}`))
  if (outside) throw new Error(`Edit mode cannot mutate unselected entity ${outside.collection}:${outside.id}`)
}

export const classifyOperations = (operations: readonly CommandTransactionOperation[]): ToolPreview => {
  let created = 0; let updated = 0; let deleted = 0; let destructive = false
  for (const operation of operations) {
    const payload = operation.payload as Record<string, unknown>
    const batch = Object.values(payload).find(value => Array.isArray(value)) as unknown[] | undefined
    const count = batch?.length ?? 0
    if (operation.type.startsWith('Delete') || operation.type === 'ClearModel' || operation.type === 'ImportModel') {
      deleted += count || 1; destructive = true
    } else if (operation.type.startsWith('Create') && !operation.type.startsWith('CreateOrUpdate')) created += count
    else if (operation.type === 'MoveNodes' || operation.type === 'UpdateMembers') updated += count
    else if (operation.type === 'SetSelection' || operation.type === 'HideEntities' || operation.type === 'ShowEntities') updated += count
    else updated += count
  }
  const affected = created + updated + deleted
  const risk = destructive || affected > 1000 ? 'high' : affected > 100 ? 'medium' : 'low'
  return { created, updated, deleted, affected, risk, requiresApproval: destructive }
}
