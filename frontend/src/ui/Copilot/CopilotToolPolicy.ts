const providerPreviewTools = new Set([
  'create_material', 'create_section',
  'move_nodes', 'update_members', 'change_section', 'change_material',
  'transform_entities', 'update_entity_properties',
  'create_grid', 'create_portal_frame', 'create_frame_array', 'create_truss',
  'create_warehouse', 'create_tower', 'update_parametric_object', 'generate_parametric',
])

/** Collection words small models emit as roles/collections; normalized to canonical plural collections. */
const collectionWords: Readonly<Record<string, string>> = {
  node: 'nodes', nodes: 'nodes', material: 'materials', materials: 'materials',
  section: 'sections', sections: 'sections', member: 'members', members: 'members',
  shell: 'shells', shells: 'shells', load: 'loads', loads: 'loads',
  boundarycondition: 'boundaryConditions', boundaryconditions: 'boundaryConditions',
  grid: 'grids', grids: 'grids', level: 'levels', levels: 'levels',
  group: 'groups', groups: 'groups', parametricobject: 'parametricObjects', parametricobjects: 'parametricObjects',
}

/** Flattened/singular keys invented by small models, mapped to documented query_entities filter keys. */
const queryFilterAliases: Readonly<Record<string, string>> = {
  semanticrole: 'semanticRoles', semanticroles: 'semanticRoles', role: 'semanticRoles', roles: 'semanticRoles',
  materialid: 'materialIds', materialids: 'materialIds', material: 'materialIds',
  sectionid: 'sectionIds', sectionids: 'sectionIds', section: 'sectionIds',
  groupid: 'groupIds', groupids: 'groupIds', group: 'groupIds',
  levelid: 'levelIds', levelids: 'levelIds', level: 'levelIds', floor: 'levelIds', storey: 'levelIds',
  gridid: 'gridIds', gridids: 'gridIds', grid: 'gridIds',
  type: 'types', types: 'types',
  name: 'nameContains', namecontains: 'nameContains', names: 'names',
  id: 'ids', ids: 'ids',
  length: 'length', inselection: 'inSelection', hidden: 'hidden',
}

const idFilters = new Set(['ids', 'materialIds', 'sectionIds', 'groupIds', 'levelIds', 'gridIds'])

const asItemArray = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : [value])

const coerceIdArray = (value: unknown): number[] | undefined => {
  const values = asItemArray(value)
    .filter((item): item is number => typeof item === 'number' && Number.isSafeInteger(item) && item >= 1)
  return values.length ? [...new Set(values)] : undefined
}

const coerceStringArray = (value: unknown): string[] | undefined => {
  const values = asItemArray(value).filter((item): item is string => typeof item === 'string' && item.trim() !== '')
  return values.length ? values : undefined
}

const coerceLengthFilter = (value: unknown): Record<string, number> | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return { gte: value, lte: value }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const bounds = value as Record<string, unknown>
  const result: Record<string, number> = {}
  for (const bound of ['lt', 'lte', 'gt', 'gte'] as const) {
    const numeric = bounds[bound]
    if (typeof numeric === 'number' && Number.isFinite(numeric)) result[bound] = numeric
  }
  if (typeof bounds.min === 'number' && Number.isFinite(bounds.min) && result.gte === undefined) result.gte = bounds.min
  if (typeof bounds.max === 'number' && Number.isFinite(bounds.max) && result.lte === undefined) result.lte = bounds.max
  return Object.keys(result).length ? result : undefined
}
const resolveRoleValue = (value: unknown): { roles: string[]; collection?: string } => {
  const roles: string[] = []
  let collection: string | undefined
  for (const item of asItemArray(value)) {
    if (typeof item !== 'string' || !item.trim()) continue
    const mapped = collectionWords[item.trim().toLowerCase()]
    if (mapped) collection = mapped
    else roles.push(item)
  }
  return { roles, collection }
}

const mergeStringValues = (existing: unknown, additions: readonly string[]): string[] => [
  ...new Set([
    ...(Array.isArray(existing) ? existing.filter((item): item is string => typeof item === 'string') : []),
    ...additions,
  ]),
]

/** query_entities tolerates flattened/singular arguments from small local models (read-only tool). */
const normalizeQueryEntities = (args: Readonly<Record<string, unknown>>): Record<string, unknown> => {
  const normalized: Record<string, unknown> = {}
  const filter: Record<string, unknown> = args.filter !== null && typeof args.filter === 'object' && !Array.isArray(args.filter)
    ? { ...(args.filter as Record<string, unknown>) }
    : {}
  for (const [key, value] of Object.entries(args)) {
    if (key === 'collection') {
      normalized.collection = typeof value === 'string' ? collectionWords[value.trim().toLowerCase()] ?? value : value
      continue
    }
    if (key === 'limit') {
      normalized.limit = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value
      continue
    }
    if (key === 'filter') continue
    const filterKey = queryFilterAliases[key.toLowerCase()]
    if (!filterKey) continue
    if (filterKey === 'semanticRoles') {
      const { roles, collection } = resolveRoleValue(value)
      if (collection && normalized.collection === undefined) normalized.collection = collection
      if (roles.length) filter.semanticRoles = mergeStringValues(filter.semanticRoles, roles)
      continue
    }
    if (filterKey === 'length') {
      const length = coerceLengthFilter(value)
      if (length) filter.length = length
      continue
    }
    if (filterKey === 'nameContains') {
      const name = typeof value === 'string' && value.trim() ? value
        : Array.isArray(value) ? value.find((item): item is string => typeof item === 'string' && item.trim() !== '') : undefined
      if (name) filter.nameContains = name
      continue
    }
    if (filterKey === 'inSelection' || filterKey === 'hidden') {
      if (typeof value === 'boolean') filter[filterKey] = value
      continue
    }
    if (idFilters.has(filterKey)) {
      const ids = coerceIdArray(value)
      if (ids) filter[filterKey] = ids
      continue
    }
    const values = coerceStringArray(value)
    if (values) filter[filterKey] = values
  }
  if (filter.semanticRoles !== undefined && normalized.collection === undefined) normalized.collection = 'members'
  if (!Object.keys(filter).length) return normalized
  return { ...normalized, filter }
}
/** get_nearby_nodes accepts point/position/center aliases for the required point vector. */
const normalizeNearbyNodes = (args: Readonly<Record<string, unknown>>): Record<string, unknown> => {
  const normalized: Record<string, unknown> = { ...args }
  if (normalized.point === undefined) {
    const candidate = normalized.position ?? normalized.center ?? normalized.origin
    if (Array.isArray(candidate) && candidate.length === 3 && candidate.every(item => typeof item === 'number' && Number.isFinite(item))) {
      normalized.point = candidate
    }
  }
  delete normalized.position
  delete normalized.center
  delete normalized.origin
  return normalized
}

const queryNormalizers: Readonly<Record<string, (args: Readonly<Record<string, unknown>>) => Record<string, unknown>>> = {
  query_entities: normalizeQueryEntities,
  get_nearby_nodes: normalizeNearbyNodes,
}

/** Provider-authored structural edits are proposals; only the Apply UI may commit them.
 *  Read-only queries additionally tolerate the flattened argument shapes small local models emit. */
export const safeProviderToolArguments = (tool: string, args: Readonly<Record<string, unknown>>) => {
  const normalized = queryNormalizers[tool]?.(args) ?? { ...args }
  return providerPreviewTools.has(tool) ? { ...normalized, preview: true } : normalized
}
