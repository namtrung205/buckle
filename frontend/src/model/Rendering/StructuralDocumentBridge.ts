import type {
  Member1DRecord,
  SectionRecord,
  StructuralChangeSet,
  StructuralDocument,
} from '../../core/structural/index.ts'
import { StructuralSceneDB, type ProfileFamily, type SceneMemberInput, type SceneProfileInput, type StructuralSceneSource } from './StructuralSceneDB.ts'

const mm = (value: number | undefined) => (value ?? 0) * 0.001

const sectionFamily = (section: SectionRecord): ProfileFamily => {
  switch (section.type) {
    case 'I': case 'IPN': return 'h'
    case 'RectangularHollow': return 'box'
    case 'Circular': case 'HollowCircular': return 'pipe'
    case 'Rectangular': return 'rectangular'
    case 'Channel': case 'UPN': return 'channel'
    case 'Angle': return 'angle'
    case 'Tee': return 'tee'
  }
}

export const documentSectionToSceneProfile = (section: SectionRecord): SceneProfileInput => {
  let parameters: number[]
  switch (section.type) {
    case 'I': case 'IPN': case 'Channel': case 'UPN': case 'Tee':
      parameters = [mm(section.depth), mm(section.width), mm(section.tw), mm(section.tf), 0, 0, mm(section.r)]
      break
    case 'RectangularHollow':
      parameters = [mm(section.height), mm(section.width), 0, 0, 0, mm(section.thickness), mm(section.ri)]
      break
    case 'HollowCircular':
      parameters = [0, 0, 0, 0, mm(section.diameter), mm(section.thickness)]
      break
    case 'Circular':
      parameters = [0, 0, 0, 0, mm(section.diameter)]
      break
    case 'Rectangular':
      parameters = [mm(section.height), mm(section.width)]
      break
    case 'Angle':
      parameters = [mm(section.width), mm(section.width), 0, 0, 0, mm(section.thickness)]
      break
  }
  return { id: section.id, family: sectionFamily(section), parameters, materialId: section.materialId }
}

const memberToScene = (member: Member1DRecord): SceneMemberInput => ({
  id: member.id,
  startNodeId: member.nodeI,
  endNodeId: member.nodeJ,
  profileId: member.sectionId,
  referenceAxis: member.referenceAxis
    ? [member.referenceAxis[0], member.referenceAxis[2], member.referenceAxis[1]]
    : [0, 1, 0],
  gammaRadians: ((member.gammaDegrees ?? 0) * Math.PI) / 180,
})

export const structuralDocumentToSceneSource = (document: StructuralDocument): StructuralSceneSource => ({
  nodes: [...document.nodes.values()].map(node => ({
    id: node.id,
    position: [node.position[0], node.position[2], node.position[1]],
  })),
  profiles: [...document.sections.values()].map(documentSectionToSceneProfile),
  members: [...document.members.values()].map(memberToScene),
})

/** Applies document change sets to the existing SoA render database. */
export class StructuralDocumentBridge {
  private readonly unsubscribe: () => void
  private readonly document: StructuralDocument
  readonly db: StructuralSceneDB

  constructor(document: StructuralDocument, db: StructuralSceneDB) {
    this.document = document
    this.db = db
    db.replace(structuralDocumentToSceneSource(document))
    this.unsubscribe = document.subscribe(change => this.apply(change))
  }

  dispose() { this.unsubscribe() }

  private apply(change: StructuralChangeSet) {
    // Detach deleted members first, but create replacement dependencies before
    // rewiring surviving members. Old nodes/profiles are removed only after
    // those rewires, so one atomic document change is also atomic for the DB.
    for (const id of change.changes.members.deleted) this.db.removeMember(id)
    for (const id of change.changes.sections.created) this.db.addProfile(documentSectionToSceneProfile(this.document.sections.get(id)!))
    for (const id of change.changes.nodes.created) {
      const node = this.document.nodes.get(id)!
      this.db.addNode({ id, position: [node.position[0], node.position[2], node.position[1]] })
    }
    for (const id of change.changes.sections.updated) {
      const profile = documentSectionToSceneProfile(this.document.sections.get(id)!)
      this.db.updateProfile(id, profile)
    }
    for (const id of change.changes.nodes.updated) {
      const node = this.document.nodes.get(id)!
      this.db.updateNode(id, [node.position[0], node.position[2], node.position[1]])
    }
    for (const id of change.changes.members.updated) this.db.updateMember(id, memberToScene(this.document.members.get(id)!))
    for (const id of change.changes.members.created) this.db.addMember(memberToScene(this.document.members.get(id)!))
    for (const id of change.changes.nodes.deleted) this.db.removeNode(id)
    for (const id of change.changes.sections.deleted) this.db.removeProfile(id)
  }
}
