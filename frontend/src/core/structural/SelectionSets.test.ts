import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COMMAND_SCHEMA_VERSION,
  CommandGateway,
  StructuralDocument,
  type CommandEnvelope,
  type StructuralCommand,
  type StructuralDocumentSeed,
} from './index.ts'

const baseSeed = (): StructuralDocumentSeed => ({
  nodes: [
    { id: 1, position: [0, 0, 0] },
    { id: 2, position: [1, 0, 0] },
    { id: 3, position: [1, 1, 0] },
    { id: 4, position: [0, 1, 0] },
  ],
  materials: [{ id: 1, name: 'Steel', E: 210e9, nu: 0.3 }],
  sections: [{ id: 1, name: 'R200', type: 'Rectangular', materialId: 1 }],
  members: [{ id: 1, label: 'M1', nodeI: 1, nodeJ: 2, sectionId: 1 }],
  shells: [{ id: 1, nodeIds: [1, 2, 3, 4], thickness: 0.1, materialId: 1 }],
})

const envelope = (document: StructuralDocument, commandId: string, command: StructuralCommand): CommandEnvelope => ({
  commandId,
  type: command.type,
  schemaVersion: COMMAND_SCHEMA_VERSION,
  modelRevision: document.revision,
  payload: command.payload,
  source: 'ui',
})

test('nested folder hierarchy and member/shell sets commit through the gateway', () => {
  const document = new StructuralDocument(baseSeed())
  const gateway = new CommandGateway(document)

  gateway.execute(envelope(document, 'selection-nesting', {
    type: 'Transaction',
    payload: { operations: [
      { type: 'CreateOrUpdateSelectionSets', payload: { selectionSets: [
        { id: 10, name: 'Architecture', kind: 'folder', parentId: null, entityRefs: [] },
        { id: 20, name: 'Zone A', kind: 'folder', parentId: 10, entityRefs: [] },
        { id: 30, name: 'Columns A', kind: 'set', parentId: 20, entityRefs: [
          { collection: 'members', id: 1 },
          { collection: 'shells', id: 1 },
        ] },
        { id: 40, name: 'Root set', kind: 'set', parentId: null, entityRefs: [{ collection: 'members', id: 1 }] },
      ] } },
    ] },
  }))

  assert.equal(document.selectionSets.size, 4)
  assert.equal(document.selectionSets.get(30)?.parentId, 20)
  assert.deepEqual(document.selectionSets.get(30)?.entityRefs, [
    { collection: 'members', id: 1 },
    { collection: 'shells', id: 1 },
  ])
  assert.equal(document.revision, 1)
})

test('invalid parent / reference combinations are rejected atomically', () => {
  const document = new StructuralDocument(baseSeed())
  const gateway = new CommandGateway(document)

  const create = (record: unknown) => gateway.execute(envelope(document, 'bad-set-' + Math.random(), {
    type: 'CreateOrUpdateSelectionSets',
    payload: { selectionSets: [record as never] },
  }))

  // parent must be an existing folder
  assert.throws(() => create({ id: 10, name: 'X', kind: 'set', parentId: 999, entityRefs: [] }), /unknown parent/)
  // folder cannot carry references
  assert.throws(() => create({ id: 10, name: 'X', kind: 'folder', parentId: null, entityRefs: [{ collection: 'members', id: 1 }] }), /cannot hold entity references/)
  // sets may only reference members / shells
  assert.throws(() => create({ id: 10, name: 'X', kind: 'set', parentId: null, entityRefs: [{ collection: 'nodes', id: 1 }] }), /may only reference members or shells/)

  // a parent that is a set is not allowed
  gateway.execute(envelope(document, 'add-set-first', {
    type: 'CreateOrUpdateSelectionSets',
    payload: { selectionSets: [{ id: 10, name: 'Set', kind: 'set', parentId: null, entityRefs: [] }] },
  }))
  assert.throws(() => create({ id: 11, name: 'Child', kind: 'folder', parentId: 10, entityRefs: [] }), /not a folder/)

  // cycles are rejected
  gateway.execute(envelope(document, 'add-folder-a', {
    type: 'CreateOrUpdateSelectionSets',
    payload: { selectionSets: [{ id: 20, name: 'A', kind: 'folder', parentId: null, entityRefs: [] }] },
  }))
  gateway.execute(envelope(document, 'add-folder-b', {
    type: 'CreateOrUpdateSelectionSets',
    payload: { selectionSets: [{ id: 21, name: 'B', kind: 'folder', parentId: 20, entityRefs: [] }] },
  }))
  assert.throws(() => gateway.execute(envelope(document, 'cycle', {
    type: 'CreateOrUpdateSelectionSets',
    payload: { selectionSets: [{ id: 20, name: 'A', kind: 'folder', parentId: 21, entityRefs: [] }] },
  })), /cycle detected/)

  assert.equal(document.selectionSets.size, 3)
  assert.equal(document.revision, 3)
})
test('deleting a folder cascades its whole subtree in one revision', () => {
  const document = new StructuralDocument(baseSeed())
  const gateway = new CommandGateway(document)
  gateway.execute(envelope(document, 'tree', {
    type: 'Transaction',
    payload: { operations: [
      { type: 'CreateOrUpdateSelectionSets', payload: { selectionSets: [
        { id: 10, name: 'F', kind: 'folder', parentId: null, entityRefs: [] },
        { id: 11, name: 'S1', kind: 'set', parentId: 10, entityRefs: [{ collection: 'members', id: 1 }] },
        { id: 12, name: 'F2', kind: 'folder', parentId: 10, entityRefs: [] },
        { id: 13, name: 'S2', kind: 'set', parentId: 12, entityRefs: [{ collection: 'shells', id: 1 }] },
        { id: 20, name: 'Independent', kind: 'set', parentId: null, entityRefs: [] },
      ] } },
    ] },
  }))
  const revisionBefore = document.revision

  gateway.execute(envelope(document, 'delete-root', {
    type: 'DeleteSelectionSets',
    payload: { ids: [10] },
  }))

  assert.equal(document.revision, revisionBefore + 1)
  assert.equal(document.selectionSets.has(10), false)
  assert.equal(document.selectionSets.has(11), false)
  assert.equal(document.selectionSets.has(12), false)
  assert.equal(document.selectionSets.has(13), false)
  assert.equal(document.selectionSets.has(20), true)
})

test('deleting members / shells prunes dead references from sets', () => {
  const document = new StructuralDocument(baseSeed())
  const gateway = new CommandGateway(document)
  gateway.execute(envelope(document, 'make-set', {
    type: 'CreateOrUpdateSelectionSets',
    payload: { selectionSets: [{ id: 10, name: 'Both', kind: 'set', parentId: null, entityRefs: [
      { collection: 'members', id: 1 },
      { collection: 'shells', id: 1 },
    ] }] },
  }))

  gateway.execute(envelope(document, 'delete-member', { type: 'DeleteMembers', payload: { ids: [1] } }))
  assert.deepEqual(document.selectionSets.get(10)?.entityRefs, [{ collection: 'shells', id: 1 }])

  gateway.execute(envelope(document, 'delete-shell', { type: 'DeleteShells', payload: { ids: [1] } }))
  assert.deepEqual(document.selectionSets.get(10)?.entityRefs, [])
})

test('selection sets survive a snapshot round-trip but stay out of the analysis transport', () => {
  const document = new StructuralDocument(baseSeed())
  const gateway = new CommandGateway(document)
  gateway.execute(envelope(document, 'make-set', {
    type: 'CreateOrUpdateSelectionSets',
    payload: { selectionSets: [
      { id: 1, name: 'F', kind: 'folder', parentId: null, entityRefs: [] },
      { id: 2, name: 'S', kind: 'set', parentId: 1, entityRefs: [{ collection: 'members', id: 1 }] },
    ] },
  }))

  const restored = StructuralDocument.fromSnapshot(document.getSnapshot())
  assert.equal(restored.getSnapshotHash(), document.getSnapshotHash())
  assert.equal(restored.selectionSets.get(2)?.parentId, 1)
  assert.deepEqual(restored.selectionSets.get(2)?.entityRefs, [{ collection: 'members', id: 1 }])

  const analysis = restored.createAnalysisSnapshot().model
  assert.equal('selectionSets' in analysis, false)
  assert.equal('groups' in analysis, false)
})