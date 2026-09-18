import assert from 'node:assert/strict'
import test from 'node:test'
import { StructuralDocument } from '../../core/structural/index.ts'
import { legacyModelToDocumentSeed } from './legacyStructuralDocumentAdapter.ts'

test('legacy observable-like proxies are converted to cloneable primitive records', () => {
  const material = new Proxy(
    { id: 10, name: 'Steel', E: 210e9, nu: 0.3, rho: 7850 },
    {},
  )
  const section = new Proxy(
    { id: 20, name: 'IPE300', type: 'I' as const, depth: 300, width: 150, tw: 7.1, tf: 10.7, r: 15, material },
    {},
  )
  const seed = legacyModelToDocumentSeed({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }],
    materials: [material],
    sections: [section],
    members: [{ id: 30, nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }], section }],
    shells: [],
    loads: [],
    boundaryConditions: [],
  })

  assert.doesNotThrow(() => structuredClone(seed))
  const document = new StructuralDocument(seed)
  assert.equal(document.sections.get(20)?.materialId, 10)
})
