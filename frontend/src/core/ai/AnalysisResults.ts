import type { AnalysisOutput, AnalysisStation } from '../../contracts/structuralModel.ts'

export type AnalysisRun = {
  id: string; revision: number; hash: string; completedAt: string
  output: AnalysisOutput; input: unknown
}
export type ResultRow = {
  entityId: number; collection: 'nodes' | 'members' | 'reactions'
  component: string; value: number; unit: string; frame: string
  station?: number; coordinate?: number[]
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const unitFor = (component: string) => /^(ux|uy|uz|displacement)$/.test(component) ? 'm'
  : /^(rx|ry|rz)$/.test(component) ? 'rad'
    : /^(M|T)/.test(component) ? 'kN·m' : /^(N|V|F)/.test(component) ? 'kN' : /^S(max|abs|vonM)$/.test(component) ? 'MPa' : 'unknown'

/** Raw solver stations, never the resampled Float32 render texture. */
export const analysisRows = (output: AnalysisOutput): ResultRow[] => {
  const rows: ResultRow[] = []
  const add = (collection: ResultRow['collection'], entityId: number, values: Record<string, unknown>, frame: string, extra: Partial<ResultRow> = {}) => {
    for (const [component, value] of Object.entries(values)) if (finite(value)) rows.push({ collection, entityId, component, value, unit: unitFor(component), frame, ...extra })
  }
  for (const node of output.nodes ?? []) {
    const d = node.displacements
    if (!d) continue
    add('nodes', node.id, d, 'global Z-up')
    if ([d.ux, d.uy, d.uz].every(finite)) add('nodes', node.id, { displacement: Math.hypot(d.ux, d.uy, d.uz) }, 'global Z-up')
  }
  for (const reaction of output.reactions ?? []) {
    const { Fx, Fy, Fz, Mx, My, Mz } = reaction
    add('reactions', reaction.id, { Fx, Fy, Fz, Mx, My, Mz }, 'global Z-up')
  }
  for (const member of output.members ?? []) {
    const stations = member.stations?.length ? member.stations : member.node_efforts ?? []
    stations.forEach((station: AnalysisStation, index: number) => {
      const extra = { station: index, coordinate: station.coord }
      const values = { ...station.values }
      for (const [component, effort] of Object.entries(station.efforts ?? {})) {
        values[component] = typeof effort === 'number' ? effort : effort.value
      }
      for (const [component, value] of Object.entries(values)) if (finite(value)) {
        const effort = station.efforts?.[component] as { unit?: string } | undefined
        add('members', member.id, { [component]: value }, 'member local axes', { ...extra, unit: effort?.unit ?? unitFor(component) })
      }
    })
    for (const [index, station] of (member.displacement_stations ?? []).entries()) {
      add('members', member.id, station.disp ?? {}, 'global Z-up', { station: index, coordinate: station.coord })
    }
  }
  return rows
}

export class AnalysisRunStore {
  private readonly runs = new Map<string, AnalysisRun>()
  private readonly rows = new Map<string, ResultRow[]>()
  latestId?: string

  add(input: Omit<AnalysisRun, 'id' | 'completedAt'>): AnalysisRun {
    const run = { ...structuredClone(input), id: crypto.randomUUID(), completedAt: new Date().toISOString() }
    this.runs.set(run.id, run)
    this.rows.set(run.id, analysisRows(run.output))
    this.latestId = run.id
    return structuredClone(run)
  }

  restore(run: AnalysisRun) {
    if (!run.id || !run.output || !Number.isInteger(run.revision)) throw new Error('Invalid analysis archive')
    if (this.runs.has(run.id)) return
    this.runs.set(run.id, structuredClone(run)); this.rows.set(run.id, analysisRows(run.output))
    if (!this.latestId || this.require(this.latestId).completedAt < run.completedAt) this.latestId = run.id
  }

  private require(id = this.latestId) {
    const run = id ? this.runs.get(id) : undefined
    if (!run) throw new Error('No analysis result found. Run analysis first or select an existing analysisRunId.')
    return run
  }
  list() { return [...this.runs.values()].map(run => ({
    id: run.id, revision: run.revision, hash: run.hash, completedAt: run.completedAt,
  })) }
  snapshot(id?: string) { return structuredClone(this.require(id)) }

  query(args: Record<string, unknown>, currentRevision: number, currentHash?: string) {
    const run = this.require(args.analysisRunId as string | undefined)
    const collection = args.collection as ResultRow['collection'] | undefined
    const ids = args.ids as number[] | undefined
    const component = args.component as string | undefined
    const rows = this.rows.get(run.id)!.filter(row => (!collection || row.collection === collection)
      && (!ids || ids.includes(row.entityId)) && (!component || row.component === component)
      && (!finite(args.absoluteAbove) || Math.abs(row.value) > args.absoluteAbove))
    const offset = Number(args.offset ?? 0); const limit = Number(args.limit ?? 100)
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) throw new Error('offset and limit must be non-negative/positive integers')
    const page = rows.slice(offset, offset + limit)
    return { analysisRunId: run.id, revision: run.revision, snapshotHash: run.hash, stale: (run.revision !== currentRevision || (currentHash !== undefined && run.hash !== currentHash)),
      total: rows.length, nextOffset: offset + page.length < rows.length ? offset + page.length : null, rows: structuredClone(page) }
  }

  summary(id: string | undefined, currentRevision: number, currentHash?: string) {
    const run = this.require(id)
    const groups = new Map<string, { min: ResultRow; max: ResultRow; absoluteMax: ResultRow; count: number }>()
    for (const row of this.rows.get(run.id)!) {
      const key = `${row.collection}/${row.component}/${row.unit}/${row.frame}`
      const group = groups.get(key)
      if (!group) groups.set(key, { min: row, max: row, absoluteMax: row, count: 1 })
      else {
        group.count++
        if (row.value < group.min.value) group.min = row
        if (row.value > group.max.value) group.max = row
        if (Math.abs(row.value) > Math.abs(group.absoluteMax.value)) group.absoluteMax = row
      }
    }
    return structuredClone({ analysisRunId: run.id, revision: run.revision, snapshotHash: run.hash,
      completedAt: run.completedAt, stale: (run.revision !== currentRevision || (currentHash !== undefined && run.hash !== currentHash)),
      counts: { nodes: run.output.nodes.length, members: run.output.members.length, reactions: run.output.reactions.length },
      method: 'Extrema over available raw solver samples; not continuous extrema between stations. Single solved load state; no invented load combinations.',
      warnings: ['Convergence alone does not establish design-code compliance.', 'Missing and non-finite values are excluded, never replaced by zero.'],
      extrema: Object.fromEntries(groups) })
  }

  checkThreshold(args: Record<string, unknown>, currentRevision: number, currentHash?: string) {
    if (!finite(args.threshold) || args.threshold <= 0) throw new Error('An explicit positive threshold in the component unit is required')
    if (typeof args.component !== 'string' || typeof args.collection !== 'string' || typeof args.unit !== 'string') throw new Error('collection, component and unit are required')
    const run = this.require(args.analysisRunId as string | undefined)
    const rows = this.rows.get(run.id)!.filter(row => row.collection === args.collection && row.component === args.component
      && (!Array.isArray(args.ids) || args.ids.includes(row.entityId)))
    if (rows.some(row => row.unit !== args.unit)) throw new Error('Threshold unit differs from the result unit')
    const worst = rows.reduce<ResultRow | null>((a, b) => !a || Math.abs(b.value) > Math.abs(a.value) ? b : a, null)
    return { analysisRunId: run.id, revision: run.revision, stale: (run.revision !== currentRevision || (currentHash !== undefined && run.hash !== currentHash)),
      criterion: `abs(${args.component}) <= ${args.threshold} ${args.unit}`, checkedSamples: rows.length,
      status: rows.length === 0 ? 'no_data' : rows.some(row => Math.abs(row.value) > Number(args.threshold)) ? 'exceeded' : 'within_threshold',
      worst: structuredClone(worst), meaning: 'User-specified absolute response threshold only; not a design-code, relative deflection or drift check.' }
  }

  compare(baselineId: string, candidateId: string) {
    const baseline = this.summary(baselineId, this.require(baselineId).revision)
    const candidate = this.summary(candidateId, this.require(candidateId).revision)
    const keys = new Set([...Object.keys(baseline.extrema), ...Object.keys(candidate.extrema)])
    return { baselineId, candidateId, baselineHash: baseline.snapshotHash, candidateHash: candidate.snapshotHash,
      method: 'Compare absolute raw-sample maxima by component; locations may change. Check input loads and topology before attributing improvements.',
      changes: [...keys].map(component => {
        const before = baseline.extrema[component]?.absoluteMax; const after = candidate.extrema[component]?.absoluteMax
        return { component, before, after, deltaAbsolute: before && after ? Math.abs(after.value) - Math.abs(before.value) : null }
      }) }
  }

  equilibrium(args: Record<string, unknown>, currentRevision: number, currentHash?: string) {
    const run = this.require(args.analysisRunId as string | undefined)
    const raw = run.output as AnalysisOutput & { nodal_loads?: Record<string, number[]>; supported_nodes?: Record<string, unknown> }
    const context = { analysisRunId: run.id, revision: run.revision, snapshotHash: run.hash,
      stale: run.revision !== currentRevision || (currentHash !== undefined && run.hash !== currentHash),
      frame: 'global Z-up', origin: [0, 0, 0], forceUnit: 'kN', momentUnit: 'kN·m' }
    const incomplete = (reason: string) => ({ ...context, status: 'incomplete', reason })
    if (!raw.nodal_loads || !raw.supported_nodes) return incomplete('Applied solver nodal-load or support manifest is unavailable')
    if (!raw.reactions.length || Object.keys(raw.supported_nodes).some(id => !raw.reactions.some(row => row.id === Number(id)))) return incomplete('Support reactions are missing')
    const applied = [0, 0, 0, 0, 0, 0]; const reactions = [0, 0, 0, 0, 0, 0]
    const add = (sum: number[], position: number[], values: number[]) => {
      const [x, y, z] = position; const [fx, fy, fz, mx, my, mz] = values
      const wrench = [fx, fy, fz, mx + y * fz - z * fy, my + z * fx - x * fz, mz + x * fy - y * fx]
      wrench.forEach((value, index) => { sum[index] += value })
    }
    for (const [id, load] of Object.entries(raw.nodal_loads)) {
      const node = raw.nodes.find(node => node.id === Number(id))
      if (!node || ![node.x, node.y, node.z].every(finite) || load.length !== 6 || !load.every(finite)) return incomplete(`Missing coordinate/load data for solver node ${id}`)
      add(applied, [node.x, node.y, node.z], load.map(value => value / 1000))
    }
    for (const reaction of raw.reactions) {
      const values = [reaction.Fx, reaction.Fy, reaction.Fz, reaction.Mx, reaction.My, reaction.Mz]
      if (![reaction.x, reaction.y, reaction.z, ...values].every(finite)) return incomplete(`Reaction ${reaction.id} is incomplete`)
      add(reactions, [reaction.x, reaction.y, reaction.z], values as number[])
    }
    const residual = applied.map((value, index) => value + reactions[index])
    const hasTolerance = finite(args.forceTolerance) && args.forceTolerance >= 0 && finite(args.momentTolerance) && args.momentTolerance >= 0
    return { ...context, applied, reactions, residual, components: ['Fx', 'Fy', 'Fz', 'Mx', 'My', 'Mz'],
      status: !hasTolerance ? 'calculated' : residual.every((value, index) => Math.abs(value) <= Number(index < 3 ? args.forceTolerance : args.momentTolerance)) ? 'within_tolerance' : 'outside_tolerance',
      forceTolerance: args.forceTolerance, momentTolerance: args.momentTolerance,
      limitation: 'Balances recorded applied loads only; this does not prove that every requested load was applied. Reactions may be rounded by the solver.' }
  }

  report(id: string | undefined, revision: number, currentHash?: string) {
    const summary = this.summary(id, revision, currentHash)
    const escape = (s: string) => s.replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ')
    const lines = ['# Analysis results', '', `Run: ${summary.analysisRunId}`, `Revision: ${summary.revision} · Hash: ${summary.snapshotHash}`, '',
      summary.stale ? '**Historical result: the model has changed.**' : 'Result matches the current model revision.', '',
      '| Result | Absolute maximum | Unit | Entity | Station index |', '| --- | ---: | --- | ---: | ---: |']
    for (const [key, { absoluteMax: row }] of Object.entries(summary.extrema)) lines.push(`| ${escape(key)} | ${row.value} | ${escape(row.unit)} | ${row.entityId} | ${row.station ?? '—'} |`)
    lines.push('', summary.method, '', ...summary.warnings.map(warning => `- ${warning}`))
    return { analysisRunId: summary.analysisRunId, markdown: lines.join('\n') }
  }
}
