import type { AiToolDefinition } from './types.ts'
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, required })
const run = { analysisRunId: { type: 'string', description: 'Omit to use the latest analysis run.' } }
const filters = { ...run, collection: { type: 'string', enum: ['nodes', 'members', 'reactions'] },
  ids: { type: 'array', items: { type: 'integer', minimum: 1 } }, component: { type: 'string' } }
export const ANALYSIS_TOOLS: AiToolDefinition[] = [
  { name: 'show_result_view', kind: 'mutation', description: 'Show a diagram or deformed shape for the current analysis and highlight members. Historical runs cannot be drawn on a changed model.', inputSchema: object({ ...run,
    component: { type: 'string', enum: ['N', 'Vy', 'Vz', 'T', 'My', 'Mz', 'Smax', 'Sabs', 'SvonM', 'deformation', 'reactions'] },
    memberIds: { type: 'array', items: { type: 'integer', minimum: 1 } } }, ['component']) },
  { name: 'unlock_analysis_results', kind: 'mutation', description: 'Return to editing after analysis; the current result is archived and remains queryable. Use before an explicitly requested edit-and-rerun workflow.', inputSchema: object({}) },
  { name: 'check_result_equilibrium', kind: 'query', description: 'Compute global force/moment balance of the applied solver nodal loads and reactions. Reports incomplete data and does not certify load-input completeness or design compliance.', inputSchema: object({ ...run,
    forceTolerance: { type: 'number', minimum: 0 }, momentTolerance: { type: 'number', minimum: 0 } }) },
  { name: 'list_analysis_runs', kind: 'query', description: 'List archived raw solver runs with revision and snapshot hash.', inputSchema: object({}) },
  { name: 'get_analysis_summary', kind: 'query', description: 'Read exact raw-sample extrema, units, locations and stale-result status. No render resampling.', inputSchema: object(run) },
  { name: 'query_analysis_results', kind: 'query', description: 'Read raw node displacement, member station forces/displacements or support reactions. Follow nextOffset for all data; no total result cap.', inputSchema: object({ ...filters,
    absoluteAbove: { type: 'number', minimum: 0 }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1 } }) },
  { name: 'check_result_threshold', kind: 'query', description: 'Check a user-specified absolute response threshold in the explicit result unit; not a design-code or relative deflection check.', inputSchema: object({ ...filters,
    threshold: { type: 'number', exclusiveMinimum: 0 }, unit: { type: 'string' } }, ['collection', 'component', 'threshold', 'unit']) },
  { name: 'compare_analysis_runs', kind: 'query', description: 'Compare raw-sample absolute maxima between baseline and candidate runs, including locations. Verify load/input equivalence.', inputSchema: object({ baselineId: { type: 'string' }, candidateId: { type: 'string' } }, ['baselineId', 'candidateId']) },
  { name: 'create_analysis_report', kind: 'query', description: 'Produce a Markdown results report with exact values and provenance from an archived solver run.', inputSchema: object(run) },
  { name: 'run_analysis', kind: 'mutation', description: 'Run the structural solver on the current model snapshot and archive the output. Waits for completion. Available in Agent and Modeling.', inputSchema: object({}) },
]
