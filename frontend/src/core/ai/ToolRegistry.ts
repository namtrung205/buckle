import { ENTITY_COLLECTIONS } from '../structural/types.ts'
import { ENTITY_SCHEMAS } from './EntitySchemas.ts'
import { ANALYSIS_TOOLS } from './AnalysisTools.ts'
import type { AiToolDefinition, JsonSchema } from './types.ts'

const collections = ENTITY_COLLECTIONS
const object = (properties: Record<string, unknown>, required: readonly string[] = []): JsonSchema => ({
  type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}),
})
const array = (items: unknown) => ({ type: 'array', items })
const batch = (items: unknown) => ({ ...array(items), minItems: 1 })
const ids = array({ type: 'integer', minimum: 1 })
const ref = object({ collection: { type: 'string', enum: collections }, id: { type: 'integer', minimum: 1 } }, ['collection', 'id'])
const vector = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }
const engineeringLength = { oneOf: [{ type: 'number' }, { type: 'string' }], description: 'Length as canonical metres or an explicit value such as 6000 mm, 6 m, 20 ft.' }
const engineeringAngle = { oneOf: [{ type: 'number' }, { type: 'string' }], description: 'Angle in degrees or an explicit value such as 15 deg or 0.26 rad.' }
const engineeringStress = { oneOf: [{ type: 'number' }, { type: 'string' }], description: 'Stress/modulus as canonical Pa or an explicit value such as 210 GPa or 355 MPa.' }
const engineeringDensity = { oneOf: [{ type: 'number' }, { type: 'string' }], description: 'Density as canonical kg/m3 or an explicit value such as 7850 kg/m3 or 7.85 t/m3.' }
const engineeringVector = { type: 'array', items: engineeringLength, minItems: 3, maxItems: 3 }
const generationControl = { preview: { type: 'boolean' }, approvalToken: { type: 'string' } }

const definitions: AiToolDefinition[] = [
  ...ANALYSIS_TOOLS,
  { name: 'get_command_catalogue', kind: 'query', description: 'Discover all canonical transaction operation payloads, entity record schemas and editable property names. Use before advanced create/edit/transaction operations. All dimensions are SI.', inputSchema: object({}) },
  { name: 'create_entities', kind: 'mutation', description: 'Create canonical entity batches including shells, loads, supports, grids, levels, groups and selection sets. Get record shapes from get_command_catalogue. Existing IDs are rejected.', inputSchema: object({ collection: { type: 'string', enum: Object.keys(ENTITY_SCHEMAS) }, records: batch({ type: 'object' }), preview: { type: 'boolean' } }, ['collection', 'records']) },
  { name: 'get_model_summary', kind: 'query', description: 'Return exact model counts, revision, hash and units.', inputSchema: object({}) },
  { name: 'get_selection', kind: 'query', description: 'Return selected and hidden entity references.', inputSchema: object({}) },
  { name: 'resolve_targets', kind: 'query', description: 'Resolve selection or the latest AI-created/updated entity set without relying on chat text.', inputSchema: object({
    source: { type: 'string', enum: ['selection', 'hidden', 'last_created', 'last_updated', 'last_affected', 'alias'] },
    alias: { type: 'string' },
    collection: { type: 'string', enum: collections }, semanticRoles: array({ type: 'string' }),
    expect: { type: 'string', enum: ['any', 'one_or_more', 'exactly_one'] },
  }, ['source']) },
  { name: 'remember_targets', kind: 'query', description: 'Store an exact existing entity set under a conversation-scoped alias for later reference resolution.', inputSchema: object({
    alias: { type: 'string' }, entities: array(ref),
  }, ['alias', 'entities']) },
  { name: 'get_entities', kind: 'query', description: 'Read entities by collection and optional IDs.', inputSchema: object({ collection: { type: 'string', enum: collections }, ids }, ['collection']) },
  { name: 'query_entities', kind: 'query', description: 'Filter exact model entities by ID, type, name, semantic role, group, level, grid, connectivity, workspace state, material, section or coordinate.', inputSchema: object({
    collection: { type: 'string', enum: collections }, limit: { type: 'integer', minimum: 1 },
    filter: object({
      ids, names: array({ type: 'string' }), nameContains: { type: 'string' }, types: array({ type: 'string' }),
      semanticRoles: array({ type: 'string' }), sectionIds: ids, materialIds: ids,
      groupIds: ids, levelIds: ids, gridIds: ids, connectedTo: array(ref),
      inSelection: { type: 'boolean' }, hidden: { type: 'boolean' },
      length: object({ lt: { type: 'number' }, lte: { type: 'number' }, gt: { type: 'number' }, gte: { type: 'number' } }),
      position: object({
        x: object({ min: { type: 'number' }, max: { type: 'number' } }),
        y: object({ min: { type: 'number' }, max: { type: 'number' } }),
        z: object({ min: { type: 'number' }, max: { type: 'number' } }),
      }),
    }),
  }, ['collection']) },
  { name: 'get_connected_entities', kind: 'query', description: 'Traverse node/member/section/material connectivity.', inputSchema: object({ entities: array(ref) }, ['entities']) },
  { name: 'get_nearby_nodes', kind: 'query', description: 'Find nodes within a radius of a Z-up metre coordinate.', inputSchema: object({ point: vector, radius: { type: 'number', minimum: 0 }, limit: { type: 'integer', minimum: 1 } }, ['point', 'radius']) },
  { name: 'get_sections', kind: 'query', description: 'Return all section catalogue records.', inputSchema: object({ ids }) },
  { name: 'get_materials', kind: 'query', description: 'Return all material catalogue records.', inputSchema: object({ ids }) },
  { name: 'get_parametric_templates', kind: 'query', description: 'Return the versioned parametric template catalogue, published defaults and Vietnamese/English engineering vocabulary.', inputSchema: object({ kind: { type: 'string' } }) },
  { name: 'validate_model', kind: 'query', description: 'Validate topology and return deterministic warnings.', inputSchema: object({}) },
  { name: 'create_material', kind: 'mutation', description: 'Create one structural material. E and strengths accept Pa/MPa/GPa; density accepts kg/m3 or t/m3. Provider calls are previewed before apply.', inputSchema: object({
    name: { type: 'string' }, category: { type: 'string' }, code: { type: 'string' }, grade: { type: 'string' }, preset: { type: 'string' },
    E: engineeringStress, nu: { type: 'number', minimum: -0.999, maximum: 0.499 }, rho: engineeringDensity,
    alpha: { oneOf: [{ type: 'number' }, { type: 'string' }], description: 'Thermal expansion coefficient as canonical 1/K or a value such as 12e-6 /K.' },
    fy: engineeringStress, fc: engineeringStress, fu: engineeringStress, ft: engineeringStress,
    metadata: { type: 'object' }, ...generationControl,
  }, ['name', 'E', 'nu']) },
  { name: 'create_section', kind: 'mutation', description: 'Create one structural section using SI dimensions or explicit units such as 500 mm. The referenced material must already exist. Provider calls are previewed before apply.', inputSchema: object({
    name: { type: 'string' }, type: { type: 'string', enum: ['I', 'Rectangular', 'Circular', 'HollowCircular', 'RectangularHollow', 'Channel', 'Angle', 'Tee', 'IPN', 'UPN'] },
    materialId: { type: 'integer', minimum: 1 }, depth: engineeringLength, height: engineeringLength, width: engineeringLength,
    tw: engineeringLength, tf: engineeringLength, diameter: engineeringLength, thickness: engineeringLength, r: engineeringLength, ri: engineeringLength,
    properties: { type: 'object', description: 'Optional canonical section properties such as A, Iy, Iz and Jxx.' }, metadata: { type: 'object' }, ...generationControl,
  }, ['name', 'type', 'materialId']) },
  { name: 'create_nodes', kind: 'mutation', description: 'Create a batch of nodes.', inputSchema: object({ nodes: batch(object({ id: { type: 'integer', minimum: 1 }, alias: { type: 'string' }, name: { type: 'string' }, position: vector }, ['position'])) }, ['nodes']) },
  { name: 'create_members', kind: 'mutation', description: 'Create a batch of straight members.', inputSchema: object({ members: batch(object({ id: { type: 'integer', minimum: 1 }, alias: { type: 'string' }, label: { type: 'string' }, nodeI: {}, nodeJ: {}, sectionId: {} }, ['nodeI', 'nodeJ', 'sectionId'])) }, ['members']) },
  { name: 'move_nodes', kind: 'mutation', description: 'Move existing nodes in one batch. Provider calls are previewed before apply.', inputSchema: object({ nodes: batch(object({ id: { type: 'integer', minimum: 1 }, position: vector, name: { type: 'string' } }, ['id', 'position'])), preview: { type: 'boolean' } }, ['nodes']) },
  { name: 'update_members', kind: 'mutation', description: 'Patch existing members in one batch. Provider calls are previewed before apply.', inputSchema: object({ members: batch(object({ id: { type: 'integer', minimum: 1 }, patch: { type: 'object' } }, ['id', 'patch'])), preview: { type: 'boolean' } }, ['members']) },
  { name: 'change_section', kind: 'mutation', description: 'Assign one section to a member batch. Provider calls are previewed before apply.', inputSchema: object({ memberIds: batch({ type: 'integer', minimum: 1 }), sectionId: { type: 'integer', minimum: 1 }, preview: { type: 'boolean' } }, ['memberIds', 'sectionId']) },
  { name: 'change_material', kind: 'mutation', description: 'Assign a material to members by reusing or creating equivalent sections in one transaction. Set preview=true before apply.', inputSchema: object({ memberIds: batch({ type: 'integer', minimum: 1 }), materialId: { type: 'integer', minimum: 1 }, preview: { type: 'boolean' } }, ['memberIds', 'materialId', 'preview']) },
  { name: 'transform_entities', kind: 'mutation', description: 'Move, rotate, mirror, copy or array a node/member/shell set in one transaction. Set preview=true before apply.', inputSchema: object({
    entities: batch(ref), operation: { type: 'string', enum: ['move', 'rotate', 'mirror', 'copy', 'array'] },
    translation: vector, origin: vector, axis: { type: 'string', enum: ['x', 'y', 'z'] },
    angleDegrees: { type: 'number' }, copies: { type: 'integer', minimum: 1 }, preview: { type: 'boolean' },
  }, ['entities', 'operation', 'preview']) },
  { name: 'update_entity_properties', kind: 'mutation', description: 'Patch a batch of same-collection entities, including release, load, support and metadata fields, in one transaction. Set preview=true before apply.', inputSchema: object({
    collection: { type: 'string', enum: collections }, ids: batch({ type: 'integer', minimum: 1 }), patch: { type: 'object' }, preview: { type: 'boolean' },
  }, ['collection', 'ids', 'patch', 'preview']) },
  { name: 'delete_entities', kind: 'mutation', description: 'Delete entity batches; destructive and approval-gated.', inputSchema: object({ entities: batch(ref), cascade: { type: 'boolean' }, approvalToken: { type: 'string' } }, ['entities']) },
  { name: 'set_selection', kind: 'mutation', description: 'Replace viewport selection.', inputSchema: object({ entities: array(ref) }, ['entities']) },
  { name: 'hide_entities', kind: 'mutation', description: 'Hide entity batches.', inputSchema: object({ entities: array(ref) }, ['entities']) },
  { name: 'show_entities', kind: 'mutation', description: 'Show entity batches.', inputSchema: object({ entities: array(ref) }, ['entities']) },
  { name: 'execute_transaction', kind: 'mutation', description: 'Execute canonical operations atomically.', inputSchema: object({ operations: batch({ type: 'object' }), approvalToken: { type: 'string' } }, ['operations']) },
  { name: 'preview_transaction', kind: 'mutation', description: 'Validate canonical operations without committing.', inputSchema: object({ operations: batch({ type: 'object' }) }, ['operations']) },
  { name: 'undo_last_ai_change', kind: 'mutation', description: 'Undo only this executor session’s latest AI mutation.', inputSchema: object({ undoToken: { type: 'string' } }, ['undoToken']) },
  { name: 'create_grid', kind: 'mutation', description: 'Create an orthogonal grid with explicit X/Y bay spacings. Published defaults are 6 m by 6 m.', inputSchema: object({
    name: { type: 'string' }, xSpacings: array(engineeringLength), ySpacings: array(engineeringLength), ...generationControl,
  }) },
  { name: 'create_portal_frame', kind: 'mutation', description: 'Create one pitched portal frame. Defaults: width 20 m, height 6 m, pitch 15 deg; sectionId defaults to the first catalogue section.', inputSchema: object({
    width: engineeringLength, height: engineeringLength, pitch: engineeringAngle, sectionId: { type: 'integer', minimum: 1 }, origin: engineeringVector, ...generationControl,
  }) },
  { name: 'create_frame_array', kind: 'mutation', description: 'Create an array of portal frames. Prefer baySpacing; numBays is also accepted. Defaults: 20 x 60 x 6 m, 6 m bays, 15 deg pitch.', inputSchema: object({
    width: engineeringLength, length: engineeringLength, height: engineeringLength, pitch: engineeringAngle,
    baySpacing: engineeringLength, numBays: { type: 'integer', minimum: 1 }, sectionId: { type: 'integer', minimum: 1 }, longitudinalSectionId: { type: 'integer', minimum: 1 }, origin: engineeringVector, ...generationControl,
  }) },
  { name: 'create_truss', kind: 'mutation', description: 'Create a deterministic pitched roof truss. Defaults: span 20 m, height 3 m and 8 panels.', inputSchema: object({
    span: engineeringLength, height: engineeringLength, panelCount: { type: 'integer', minimum: 2 }, sectionId: { type: 'integer', minimum: 1 }, origin: engineeringVector, ...generationControl,
  }) },
  { name: 'create_warehouse', kind: 'mutation', description: 'Create one complete parametric warehouse in one transaction. Understands nhịp/width, chiều dài/length, cao mép mái/height and bước khung/baySpacing. Defaults are published in the warehouse template and always reported in preview.', inputSchema: object({
    width: engineeringLength, length: engineeringLength, height: engineeringLength, pitch: engineeringAngle,
    baySpacing: engineeringLength, numBays: { type: 'integer', minimum: 1 }, numPurlins: { type: 'integer', minimum: 1 }, sectionId: { type: 'integer', minimum: 1 },
    columnSectionId: { type: 'integer', minimum: 1 }, rafterSectionId: { type: 'integer', minimum: 1 }, secondarySectionId: { type: 'integer', minimum: 1 }, bracingSectionId: { type: 'integer', minimum: 1 },
    hasBracing: { type: 'boolean' }, addSelfWeight: { type: 'boolean' }, addWindLoad: { type: 'boolean' }, windMagnitude: { type: 'number' },
    addSnowLoad: { type: 'boolean' }, snowMagnitude: { type: 'number' }, addMembrane: { type: 'boolean' }, membraneThickness: engineeringLength,
    windOnRoof: { type: 'boolean' }, windOnSideWalls: { type: 'boolean' }, windOnEndWalls: { type: 'boolean' }, snowOnRoof: { type: 'boolean' }, ...generationControl,
  }) },
  { name: 'create_tower', kind: 'mutation', description: 'Create a lattice transmission tower. Defaults: 36 m body, 4 m peak, 8 m base, 3 m top and 9 panels.', inputSchema: object({
    circuit: { type: 'string', enum: ['single', 'double'] }, bodyHeight: engineeringLength, peakHeight: engineeringLength,
    baseWidth: engineeringLength, topWidth: engineeringLength, panelCount: { type: 'integer', minimum: 1 }, straightPanels: { type: 'integer', minimum: 0 },
    taper: { type: 'string', enum: ['linear', 'step'] }, armCount: { type: 'integer', minimum: 0, maximum: 3 }, armLength: engineeringLength,
    armDrop: engineeringLength, armSpacing: engineeringLength, legSectionId: { type: 'integer', minimum: 1 }, braceSectionId: { type: 'integer', minimum: 1 },
    autoSupports: { type: 'boolean' }, supportKind: { type: 'string', enum: ['pinned', 'fixed'] }, autoLoads: { type: 'boolean' }, windForce: { type: 'number' }, gravity: { type: 'number' }, ...generationControl,
  }) },
  { name: 'update_parametric_object', kind: 'mutation', description: 'Update/regenerate an existing parametric object while preserving semantic-role IDs. Supply only changed parameters; for example {length:"72 m"}.', inputSchema: object({
    objectId: { type: 'integer', minimum: 1 }, parameters: { type: 'object' }, ...generationControl,
  }, ['objectId', 'parameters']) },
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
