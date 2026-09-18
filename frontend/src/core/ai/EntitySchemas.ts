import type { EntityCollection, CommandTransactionOperation } from '../structural/index.ts'
import type { JsonSchema } from './types.ts'
const number = { type: 'number' }; const text = { type: 'string' }
const id = { type: 'integer', minimum: 1 }
const ids = { type: 'array', items: id }
const vector = { type: 'array', items: number, minItems: 3, maxItems: 3 }
const metadata = { type: 'object' }
const refs = { type: 'array', items: { type: 'object', properties: { collection: text, id }, required: ['collection', 'id'] } }
const record = (properties: Record<string, unknown>, required: string[] = []): JsonSchema => ({
  type: 'object', additionalProperties: false, properties: { id, name: text, metadata, ...properties }, required,
})
/** Discoverable canonical record shapes, shared by creation and transaction guidance. */
export const ENTITY_SCHEMAS: Partial<Record<EntityCollection, JsonSchema>> = {
  nodes: record({ position: vector }, ['position']),
  members: record({ label: text, nodeI: id, nodeJ: id, sectionId: id, referenceAxis: vector, gammaDegrees: number, release: text }, ['nodeI', 'nodeJ', 'sectionId']),
  materials: record({ category: text, code: text, E: number, nu: number, rho: number, alpha: number, fy: number, fc: number, fu: number, ft: number, grade: text, preset: text }, ['name', 'E', 'nu']),
  sections: record({ type: text, materialId: id, depth: number, height: number, width: number, tw: number, tf: number, diameter: number, thickness: number, r: number, ri: number, properties: metadata }, ['name', 'type', 'materialId']),
  shells: record({ nodeIds: { ...ids, minItems: 4, maxItems: 4 }, thickness: number, materialId: id }, ['nodeIds', 'thickness', 'materialId']),
  loads: record({ type: { type: 'string', enum: ['nodal', 'linear', 'area', 'pressure'] }, targetIds: ids, value: vector, magnitude: number }, ['type', 'targetIds', 'value']),
  boundaryConditions: record({ type: { type: 'string', enum: ['fixed', 'pinned', 'roller', 'roller-x', 'roller-y', 'custom', 'elastic'] }, targetNodeIds: ids,
    dx: number, dy: number, dz: number, rx: number, ry: number, rz: number, rotationDegrees: number }, ['type', 'targetNodeIds', 'dx', 'dy', 'dz', 'rx', 'ry', 'rz']),
  grids: record({ kind: text, data: metadata }, ['name']),
  levels: record({ elevation: number }, ['name', 'elevation']),
  groups: record({ entityRefs: refs }, ['name', 'entityRefs']),
  selectionSets: record({ kind: { type: 'string', enum: ['folder', 'set'] }, parentId: { anyOf: [id, { type: 'null' }] }, entityRefs: refs }, ['name', 'kind', 'parentId', 'entityRefs']),
}
export const CREATE_OPERATION: Partial<Record<EntityCollection, CommandTransactionOperation['type']>> = {
  nodes: 'CreateNodes', members: 'CreateMembers', materials: 'CreateOrUpdateMaterials', sections: 'CreateOrUpdateSections',
  shells: 'CreateOrUpdateShells', loads: 'CreateOrUpdateLoads', boundaryConditions: 'CreateOrUpdateBoundaryConditions',
  grids: 'CreateOrUpdateGrids', levels: 'CreateOrUpdateLevels', groups: 'CreateOrUpdateGroups', selectionSets: 'CreateOrUpdateSelectionSets',
}
export const EDITABLE_PROPERTIES: Partial<Record<EntityCollection, readonly string[]>> = {
  nodes: ['name', 'position', 'metadata'], members: ['label', 'nodeI', 'nodeJ', 'sectionId', 'referenceAxis', 'gammaDegrees', 'release', 'metadata'],
  shells: ['name', 'nodeIds', 'thickness', 'materialId', 'metadata'],
  sections: ['name', 'type', 'materialId', 'depth', 'height', 'width', 'tw', 'tf', 'diameter', 'thickness', 'r', 'ri', 'properties', 'metadata'],
  materials: ['name', 'category', 'code', 'E', 'nu', 'rho', 'alpha', 'fy', 'fc', 'fu', 'ft', 'grade', 'preset', 'metadata'],
  loads: ['name', 'type', 'targetIds', 'value', 'magnitude', 'metadata'],
  boundaryConditions: ['name', 'type', 'targetNodeIds', 'dx', 'dy', 'dz', 'rx', 'ry', 'rz', 'rotationDegrees', 'metadata'],
  grids: ['name', 'kind', 'data', 'metadata'], levels: ['name', 'elevation', 'metadata'], groups: ['name', 'entityRefs', 'metadata'],
  selectionSets: ['name', 'kind', 'parentId', 'entityRefs', 'metadata'],
}
