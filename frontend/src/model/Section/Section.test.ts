import test from 'node:test'
import assert from 'node:assert/strict'
import SectionModel from './Section.ts'
import { StructuralDocument, type CommandEnvelope, type CommandTransactionOperation } from '../../core/structural/index.ts'
import type Model from '../Model.ts'
import type { Section } from '../../types.ts'

test('new section creates its fallback material atomically when the model has none', () => {
  const structuralDocument = new StructuralDocument()
  const commands: CommandEnvelope[] = []
  const model = {
    sections: [], structuralDocument,
    executeCommand: (command: CommandEnvelope) => { commands.push(command) },
  } as unknown as Model
  const section = new SectionModel(model, {
    id: 10, name: 'IPE300', type: 'I', depth: 300, width: 150, tw: 7.1, tf: 10.7,
    material: { id: 0, name: 'S355', E: 210e9, nu: 0.3, rho: 7850 },
  } as Section)

  section.createOrUpdate()

  assert.equal(commands.length, 1)
  assert.equal(commands[0].type, 'Transaction')
  const operations = (commands[0].payload as { operations: readonly CommandTransactionOperation[] }).operations
  assert.deepEqual(operations.map(operation => operation.type), [
    'CreateOrUpdateMaterials', 'CreateOrUpdateSections',
  ])
  const material = operations[0]
  const createdSection = operations[1]
  if (material.type !== 'CreateOrUpdateMaterials' || createdSection.type !== 'CreateOrUpdateSections') return
  assert.equal(material.payload.materials[0].id, 1)
  assert.equal(createdSection.payload.sections[0].materialId, 1)
  assert.equal(section.section.material.id, 1)
})
