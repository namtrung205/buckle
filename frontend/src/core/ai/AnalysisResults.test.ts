import assert from 'node:assert/strict'
import test from 'node:test'
import { AnalysisRunStore } from './AnalysisResults.ts'
import type { AnalysisOutput } from '../../contracts/structuralModel.ts'

const output = (): AnalysisOutput => ({
  nodes: [{ id: 1, x: 0, y: 0, z: 0, displacements: { ux: .003, uy: .004, uz: 0 } }],
  members: [{ id: 12, stations: Array.from({ length: 41 }, (_, i) => ({ coord: [i / 40, 0, 0], values: { N: i === 19 ? -999 : 1, Smax: i === 19 ? 200 : 0 } })) }],
  reactions: [{ id: 1, x: 0, y: 0, z: 0, Fx: 0, Fy: 0, Fz: 10, Mx: 0, My: 0, Mz: 0 }],
})
const fixture = () => { const store = new AnalysisRunStore(); const run = store.add({ revision: 3, hash: 'abc', input: {}, output: output() }); return { store, run } }

test('raw extrema include an interior peak that render resampling can miss, with units and station', () => {
  const { store } = fixture()
  const summary = store.summary(undefined, 3, 'abc')
  const n = summary.extrema['members/N/kN/member local axes'].absoluteMax
  assert.equal(n.value, -999); assert.equal(n.station, 19); assert.equal(n.entityId, 12)
  assert.equal(summary.extrema['nodes/displacement/m/global Z-up'].max.value, .005)
  assert.equal(summary.extrema['members/Smax/MPa/member local axes'].max.value, 200)
  assert.equal(store.summary(undefined, 3, 'different-project').stale, true)
})

test('all rows are retrievable through paging, and mutating outputs never changes archive', () => {
  const { store, run } = fixture()
  run.output.nodes[0].displacements.ux = 1000
  const rows: unknown[] = []; let offset: number | null = 0
  while (offset !== null) { const page = store.query({ collection: 'members', component: 'N', offset, limit: 7 }, 3); rows.push(...page.rows); offset = page.nextOffset }
  assert.equal(rows.length, 41)
  assert.equal(store.query({ collection: 'nodes', component: 'ux' }, 3).rows[0].value, .003)
  const page = store.query({ collection: 'nodes', component: 'ux' }, 3); page.rows[0].value = 88
  assert.equal(store.query({ collection: 'nodes', component: 'ux' }, 3).rows[0].value, .003)
})

test('thresholds require explicit units and return no_data instead of passing missing results', () => {
  const { store } = fixture()
  const args = { collection: 'nodes', component: 'displacement', threshold: .004, unit: 'm' }
  assert.equal(store.checkThreshold(args, 3).status, 'exceeded')
  assert.throws(() => store.checkThreshold({ ...args, unit: 'mm' }, 3), /unit/)
  assert.equal(store.checkThreshold({ ...args, ids: [999] }, 3).status, 'no_data')
})

test('equilibrium uses N to kN conversion and moment arms; missing inputs never pass', () => {
  const store = new AnalysisRunStore()
  const raw = { ...output(), nodal_loads: { '1': [0, 0, -10000, 0, 0, 0] }, supported_nodes: { '1': 1 } }
  raw.nodes[0].x = 2; raw.reactions[0].x = 2
  store.add({ revision: 1, hash: 'h', input: {}, output: raw })
  const result = store.equilibrium({ forceTolerance: .001, momentTolerance: .001 }, 1)
  assert.equal(result.status, 'within_tolerance')
  assert.deepEqual('residual' in result ? result.residual : null, [0, 0, 0, 0, 0, 0])
  assert.equal('applied' in result ? result.applied[4] : null, 20)
  const { store: incomplete } = fixture()
  assert.equal(incomplete.equilibrium({}, 3).status, 'incomplete')
})

test('reports and comparisons retain baseline provenance and exact values', () => {
  const { store, run } = fixture()
  const next = output(); next.members[0].stations![19].values!.N = -500
  const candidate = store.add({ revision: 4, hash: 'def', input: {}, output: next })
  const report = store.report(run.id, 4)
  assert.match(report.markdown, /Historical result/); assert.match(report.markdown, /-999/)
  const change = store.compare(run.id, candidate.id).changes.find(row => row.component === 'members/N/kN/member local axes')!
  assert.equal(change.deltaAbsolute, -499)
})
