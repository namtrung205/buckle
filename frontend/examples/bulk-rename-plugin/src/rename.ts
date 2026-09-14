import type { PluginEntityReference, PluginModelSnapshot } from '@buckle/plugin-sdk'

export type RenameKind = 'nodes' | 'elements'
export type RenameScope = 'selected' | 'all'
export type RenameOptions = Readonly<{
  kind: RenameKind
  scope: RenameScope
  prefix: string
  suffix: string
}>
export type RenameRow = Readonly<{
  collection: 'nodes' | 'members' | 'shells'
  id: number
  before: string
  after: string
  record: Record<string, unknown>
}>

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null

export function planRename(
  snapshot: PluginModelSnapshot,
  selection: readonly PluginEntityReference[],
  options: RenameOptions,
): RenameRow[] {
  if (!options.prefix && !options.suffix) return []
  const selected = new Set(selection.map(ref => `${ref.collection}:${ref.id}`))
  const collections = options.kind === 'nodes'
    ? ['nodes'] as const
    : ['members', 'shells'] as const
  const rows: RenameRow[] = []

  for (const collection of collections) {
    for (const raw of snapshot[collection]) {
      const record = asRecord(raw)
      if (!record || typeof record.id !== 'number') continue
      if (options.scope === 'selected' && !selected.has(`${collection}:${record.id}`)) continue
      const field = collection === 'members' ? 'label' : 'name'
      const before = typeof record[field] === 'string' && record[field].trim()
        ? record[field] as string
        : `${collection === 'nodes' ? 'Node' : collection === 'members' ? 'Member' : 'Shell'} ${record.id}`
      const after = `${options.prefix}${before}${options.suffix}`
      if (after !== record[field]) rows.push({ collection, id: record.id, before, after, record })
    }
  }
  return rows
}

export function renameCommand(rows: readonly RenameRow[]): Record<string, unknown> {
  const nodes = rows.filter(row => row.collection === 'nodes').map(row => ({
    id: row.id,
    position: row.record.position,
    name: row.after,
  }))
  const members = rows.filter(row => row.collection === 'members').map(row => ({
    id: row.id,
    patch: { label: row.after },
  }))
  const shells = rows.filter(row => row.collection === 'shells').map(row => ({
    ...row.record,
    name: row.after,
  }))
  const operations: Record<string, unknown>[] = []
  if (nodes.length) operations.push({ type: 'MoveNodes', payload: { nodes } })
  if (members.length) operations.push({ type: 'UpdateMembers', payload: { members } })
  if (shells.length) operations.push({ type: 'CreateOrUpdateShells', payload: { shells } })
  return { type: 'Transaction', payload: { operations } }
}
