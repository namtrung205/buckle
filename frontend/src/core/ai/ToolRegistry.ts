import type { AiToolDefinition, JsonSchema } from './types.ts'

const collections = ['nodes', 'materials', 'sections', 'members', 'shells', 'loads', 'boundaryConditions', 'grids', 'levels', 'groups', 'parametricObjects'] as const
const object = (properties: Record<string, unknown>, required: readonly string[] = []): JsonSchema => ({
  type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}),
})
const array = (items: unknown, maxItems = 10_000) => ({ type: 'array', items, maxItems })
const batch = (items: unknown) => ({ ...array(items), minItems: 1 })
const ids = array({ type: 'integer', minimum: 1 })
const ref = object({ collection: { type: 'string', enum: collections }, id: { type: 'integer', minimum: 1 } }, ['collection', 'id'])
const vector = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }

const definitions: AiToolDefinition[] = [
  { name: 'get_model_summary', kind: 'query', description: 'Return exact model counts, revision, hash and units.', inputSchema: object({}) },
  { name: 'get_selection', kind: 'query', description: 'Return selected and hidden entity references.', inputSchema: object({}) },
  { name: 'get_entities', kind: 'query', description: 'Read entities by collection and optional IDs.', inputSchema: object({ collection: { type: 'string', enum: collections }, ids }, ['collection']) },
  { name: 'query_entities', kind: 'query', description: 'Filter entities using exact stored and computed properties.', inputSchema: object({
    collection: { type: 'string', enum: collections }, limit: { type: 'integer', minimum: 1, maximum: 10_000 },
    filter: object({
      ids, nameContains: { type: 'string' }, semanticRoles: array({ type: 'string' }), sectionIds: ids, materialIds: ids,
      length: object({ lt: { type: 'number' }, lte: { type: 'number' }, gt: { type: 'number' }, gte: { type: 'number' } }),
      position: object({
        x: object({ min: { type: 'number' }, max: { type: 'number' } }),
        y: object({ min: { type: 'number' }, max: { type: 'number' } }),
        z: object({ min: { type: 'number' }, max: { type: 'number' } }),
      }),
    }),
  }, ['collection']) },
  { name: 'get_connected_entities', kind: 'query', description: 'Traverse node/member/section/material connectivity.', inputSchema: object({ entities: array(ref) }, ['entities']) },
  { name: 'get_nearby_nodes', kind: 'query', description: 'Find nodes within a radius of a Z-up metre coordinate.', inputSchema: object({ point: vector, radius: { type: 'number', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 10_000 } }, ['point', 'radius']) },
  { name: 'get_sections', kind: 'query', description: 'Return all section catalogue records.', inputSchema: object({ ids }) },
  { name: 'get_materials', kind: 'query', description: 'Return all material catalogue records.', inputSchema: object({ ids }) },
  { name: 'validate_model', kind: 'query', description: 'Validate topology and return deterministic warnings.', inputSchema: object({}) },
  { name: 'create_nodes', kind: 'mutation', description: 'Create a batch of nodes.', inputSchema: object({ nodes: batch(object({ id: { type: 'integer', minimum: 1 }, alias: { type: 'string' }, name: { type: 'string' }, position: vector }, ['position'])) }, ['nodes']) },
  { name: 'create_members', kind: 'mutation', description: 'Create a batch of straight members.', inputSchema: object({ members: batch(object({ id: { type: 'integer', minimum: 1 }, alias: { type: 'string' }, label: { type: 'string' }, nodeI: {}, nodeJ: {}, sectionId: {} }, ['nodeI', 'nodeJ', 'sectionId'])) }, ['members']) },
  { name: 'move_nodes', kind: 'mutation', description: 'Move existing nodes in one batch.', inputSchema: object({ nodes: batch(object({ id: { type: 'integer', minimum: 1 }, position: vector, name: { type: 'string' } }, ['id', 'position'])) }, ['nodes']) },
  { name: 'update_members', kind: 'mutation', description: 'Patch existing members in one batch.', inputSchema: object({ members: batch(object({ id: { type: 'integer', minimum: 1 }, patch: { type: 'object' } }, ['id', 'patch'])) }, ['members']) },
  { name: 'change_section', kind: 'mutation', description: 'Assign one section to a member batch.', inputSchema: object({ memberIds: batch({ type: 'integer', minimum: 1 }), sectionId: { type: 'integer', minimum: 1 } }, ['memberIds', 'sectionId']) },
  { name: 'delete_entities', kind: 'mutation', description: 'Delete entity batches; destructive and approval-gated.', inputSchema: object({ entities: batch(ref), cascade: { type: 'boolean' }, approvalToken: { type: 'string' } }, ['entities']) },
  { name: 'set_selection', kind: 'mutation', description: 'Replace viewport selection.', inputSchema: object({ entities: array(ref) }, ['entities']) },
  { name: 'hide_entities', kind: 'mutation', description: 'Hide entity batches.', inputSchema: object({ entities: array(ref) }, ['entities']) },
  { name: 'show_entities', kind: 'mutation', description: 'Show entity batches.', inputSchema: object({ entities: array(ref) }, ['entities']) },
  { name: 'execute_transaction', kind: 'mutation', description: 'Execute canonical operations atomically.', inputSchema: object({ operations: batch({ type: 'object' }), approvalToken: { type: 'string' } }, ['operations']) },
  { name: 'preview_transaction', kind: 'mutation', description: 'Validate canonical operations without committing.', inputSchema: object({ operations: batch({ type: 'object' }) }, ['operations']) },
  { name: 'undo_last_ai_change', kind: 'mutation', description: 'Undo only this executor session’s latest AI mutation.', inputSchema: object({ undoToken: { type: 'string' } }, ['undoToken']) },
  { name: 'generate_parametric', kind: 'mutation', description: 'Create or regenerate a registered high-level parametric object.', inputSchema: object({ kind: { type: 'string' }, parameters: { type: 'object' }, objectId: { type: 'integer', minimum: 1 }, preview: { type: 'boolean' }, approvalToken: { type: 'string' } }, ['kind', 'parameters']) },
]

export class AiToolRegistry {
  private readonly byName = new Map(definitions.map(definition => [definition.name, definition]))

  list(): readonly AiToolDefinition[] { return definitions }
  get(name: string) { return this.byName.get(name) }

  /** OpenAI-compatible function tool representation. */
  toOpenAiTools(names?: readonly string[]) {
    return this.select(names).map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }))
  }

  /** Anthropic-compatible tool representation. */
  toAnthropicTools(names?: readonly string[]) {
    return this.select(names).map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }))
  }

  private select(names?: readonly string[]) {
    if (!names) return definitions
    const allowed = new Set(names)
    return definitions.filter(tool => allowed.has(tool.name))
  }
}

export const AI_TOOL_DEFINITIONS = definitions
