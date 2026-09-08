import assert from 'node:assert/strict'
import test from 'node:test'
import { StructuralDocument } from '../../core/structural/index.ts'
import { StructuralSceneDB } from './StructuralSceneDB.ts'
import { StructuralDocumentBridge } from './StructuralDocumentBridge.ts'

const document = () => new StructuralDocument({
  nodes: [
    { id: 1, position: [0, 0, 0] },
    { id: 2, position: [4, 0, 0] },
  ],
  materials: [{ id: 10, name: 'Steel', E: 210e9, nu: 0.3 }],
  sections: [{ id: 20, name: 'H300', type: 'I', materialId: 10, depth: 300, width: 150, tw: 8, tf: 12 }],
  members: [{ id: 30, nodeI: 1, nodeJ: 2, sectionId: 20, referenceAxis: [0, 0, 1] }],
})

test('document node change updates only node and connected member dirty ranges', () => {
  const doc = document()
  const db = new StructuralSceneDB()
  const bridge = new StructuralDocumentBridge(doc, db)
  db.clearDirtyRanges()

  doc.updateNode(2, { position: [6, 2, 3] })

  assert.deepEqual(db.dirtyNodes, { min: 1, maxExclusive: 2 })
  assert.deepEqual(db.dirtyMembers, { min: 0, maxExclusive: 1 })
  assert.deepEqual(Array.from(db.memberEndpoints.slice(3, 6)), [6, 3, 2])
  bridge.dispose()
})

test('document create and cascade delete stay synchronized without full replace', () => {
  const doc = document()
  const db = new StructuralSceneDB()
  const bridge = new StructuralDocumentBridge(doc, db)
  const initialVersion = db.version

  doc.addNode({ id: 3, position: [8, 0, 0] })
  doc.addMember({ id: 31, nodeI: 2, nodeJ: 3, sectionId: 20 })
  assert.equal(db.nodeIndexById.has(3), true)
  assert.equal(db.memberIndexById.has(31), true)

  doc.deleteNode(3, { cascade: true })
  assert.equal(db.nodeIndexById.has(3), false)
  assert.equal(db.memberIndexById.has(31), false)
  assert.ok(db.version > initialVersion)
  bridge.dispose()
})

test('one reconcile can rewire a member and remove its old node/profile', () => {
  const doc = document()
  const db = new StructuralSceneDB()
  const bridge = new StructuralDocumentBridge(doc, db)

  doc.reconcile({
    nodes: [{ id: 1, position: [0, 0, 0] }, { id: 3, position: [8, 0, 0] }],
    materials: [{ id: 10, name: 'Steel', E: 210e9, nu: 0.3 }],
    sections: [{ id: 21, name: 'Box', type: 'RectangularHollow', materialId: 10, height: 300, width: 200, thickness: 10 }],
    members: [{ id: 30, nodeI: 1, nodeJ: 3, sectionId: 21 }],
  })

  assert.equal(db.nodeIndexById.has(2), false)
  assert.equal(db.nodeIndexById.has(3), true)
  assert.equal(db.profileIndexById.has(20), false)
  assert.equal(db.profileIndexById.has(21), true)
  assert.equal(db.memberEndNodeIndices[0], db.nodeIndexById.get(3))
  assert.equal(db.memberProfileIndices[0], db.profileIndexById.get(21))
  bridge.dispose()
})
