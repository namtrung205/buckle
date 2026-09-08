import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalStringify } from '../../core/structural/index.ts'
import { generateFrameArrayGraph, generateGridGraph, generatePortalFrameGraph } from './BasicParametricGenerators.ts'
import { generateWarehouseGraph, type WarehouseParameters } from './WarehouseGenerator.ts'

const warehouse = (overrides: Partial<WarehouseParameters> = {}): WarehouseParameters => ({
  width: 20, length: 60, height: 6, pitch: 15, numBays: 5, numPurlins: 3,
  sectionId: 1, materialId: 1, sectionArea: 0.01, hasBracing: true,
  addSelfWeight: true, addWindLoad: true, windMagnitude: 1.2,
  addSnowLoad: true, snowMagnitude: 0.8, addMembrane: true, membraneThickness: 0.002,
  windOnRoof: true, windOnSideWalls: true, windOnEndWalls: true, snowOnRoof: true,
  ...overrides,
})

test('warehouse graph is deterministic at minimum and odd bay counts', () => {
  const minimum = warehouse({ numBays: 1, numPurlins: 1, hasBracing: true })
  assert.equal(canonicalStringify(generateWarehouseGraph(minimum)), canonicalStringify(generateWarehouseGraph(minimum)))
  const roles = [...(generateWarehouseGraph(minimum).members ?? []).map(item => item.role)]
  assert.equal(new Set(roles).size, roles.length)
  const odd = generateWarehouseGraph(warehouse({ numBays: 7 }))
  assert.ok((odd.nodes?.length ?? 0) > 0)
  assert.ok(odd.members?.some(member => member.role.startsWith('bay:6:')))
})

test('warehouse validates maximum-like topology and rejects degeneracy', () => {
  const large = generateWarehouseGraph(warehouse({ length: 300, numBays: 50, numPurlins: 12 }))
  assert.equal(large.nodes?.some(node => node.record.position.some(value => !Number.isFinite(value))), false)
  assert.throws(() => generateWarehouseGraph(warehouse({ width: 0 })), /width/)
  assert.throws(() => generateWarehouseGraph(warehouse({ numBays: 2.5 })), /integers/)
  assert.throws(() => generateWarehouseGraph(warehouse({ pitch: 90 })), /pitch/)
})

test('Grid, PortalFrame and FrameArray expose semantic P0 graphs', () => {
  const grid = generateGridGraph({ xSpacings: [5, 5], ySpacings: [6] })
  assert.equal(grid.grids?.[0].role, 'grid:primary')
  const portal = generatePortalFrameGraph({ width: 20, height: 6, pitch: 15, sectionId: 1 })
  assert.equal(portal.members?.filter(member => member.role.includes('column')).length, 2)
  assert.equal(portal.members?.filter(member => member.role.includes('rafter')).length, 2)
  const array = generateFrameArrayGraph({ width: 20, height: 6, pitch: 15, sectionId: 1, length: 60, numBays: 5 })
  assert.ok(array.nodes?.some(node => node.role.startsWith('frame-line:5:')))
  assert.ok(array.members?.some(member => member.role.startsWith('bay:4:')))
})
