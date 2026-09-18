import type Model from '../Model.ts'
import type { Section as SectionData } from '../../types.ts'
import { COMMAND_SCHEMA_VERSION, type MaterialRecord, type SectionRecord } from '../../core/structural/index.ts'

class Section {
  model: Model
  section: SectionData
  constructor(model: Model, section: SectionData) {
    this.model = model
    this.section = {
      ...section,
      id: section.id || Math.floor(Math.random() * 0x7FFFFFFF),
      name: section.name || `Section ${model.sections.length + 1}`,
    }
  }

  createOrUpdate() {
    const { material: initialMaterial, ...section } = this.section
    let material = initialMaterial
    if (!this.model.structuralDocument.materials.has(material.id)) {
      const materialId = Number.isSafeInteger(material.id) && material.id > 0
        ? material.id
        : Math.max(0, ...this.model.structuralDocument.materials.keys()) + 1
      material = { ...material, id: materialId }
      this.section = { ...this.section, material }
      this.model.executeCommand({
        commandId: crypto.randomUUID(), type: 'Transaction',
        schemaVersion: COMMAND_SCHEMA_VERSION,
        modelRevision: this.model.structuralDocument.revision,
        payload: { operations: [
          { type: 'CreateOrUpdateMaterials', payload: { materials: [material as MaterialRecord] } },
          { type: 'CreateOrUpdateSections', payload: { sections: [{ ...section, materialId }] } },
        ] },
        source: 'ui',
      })
      return
    }
    this.model.executeCommand({
      commandId: crypto.randomUUID(), type: 'CreateOrUpdateSections',
      schemaVersion: COMMAND_SCHEMA_VERSION,
      modelRevision: this.model.structuralDocument.revision,
      payload: { sections: [{ ...section, materialId: material.id } as SectionRecord] },
      source: 'ui',
    })
  }

  /**
   * Members hold their section by object reference, so replacing the entry in
   * `model.sections` (i.e. editing an existing section) leaves every linked
   * member pointing at the stale object with outdated 3D geometry. Re-point
   * each member that uses this section (matched by id) and rebuild its
   * geometry through `update()` (dispose + create) so the viewport always
   * reflects the edited section — no matter which UI path triggered the edit.
   */
  private refreshDependentMembers() {
    this.model.members
      .filter((member) => member.section?.id === this.section.id)
      .forEach((member) => member.update(member.nodes, this.section, member.gamma, member.label, member.release))
  }

  delete() {
    this.model.executeCommand({
      commandId: crypto.randomUUID(), type: 'DeleteSections',
      schemaVersion: COMMAND_SCHEMA_VERSION,
      modelRevision: this.model.structuralDocument.revision,
      payload: { ids: [this.section.id] },
      source: 'ui',
    })
  }
}

export default Section
