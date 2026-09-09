const providerPreviewTools = new Set([
  'move_nodes', 'update_members', 'change_section', 'change_material',
  'transform_entities', 'update_entity_properties',
  'create_grid', 'create_portal_frame', 'create_frame_array', 'create_truss',
  'create_warehouse', 'create_tower', 'update_parametric_object', 'generate_parametric',
])

/** Provider-authored structural edits are proposals; only the Apply UI may commit them. */
export const safeProviderToolArguments = (tool: string, args: Readonly<Record<string, unknown>>) =>
  providerPreviewTools.has(tool) ? { ...args, preview: true } : { ...args }
