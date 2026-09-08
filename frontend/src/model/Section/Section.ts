import Model from '../Model'
import { Section as SectionData } from '../../types'
import { COMMAND_SCHEMA_VERSION, type SectionRecord } from '../../core/structural'

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
    const { material, ...section } = this.section
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
