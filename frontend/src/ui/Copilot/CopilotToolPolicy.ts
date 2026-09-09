const providerPreviewTools = new Set([
  'move_nodes', 'update_members', 'change_section', 'change_material',
  'transform_entities', 'update_entity_properties',
])

/** Provider-authored structural edits are proposals; only the Apply UI may commit them. */
export const safeProviderToolArguments = (tool: string, args: Readonly<Record<string, unknown>>) =>
  providerPreviewTools.has(tool) ? { ...args, preview: true } : { ...args }
