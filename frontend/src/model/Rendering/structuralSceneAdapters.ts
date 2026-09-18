import type { Section } from '../../types'
import type { StructuralBenchmarkFixture } from '../Benchmark/structuralFixture'
import type { ProfileFamily, SceneProfileInput, StructuralSceneSource } from './StructuralSceneDB'

type LegacyNode = { id: number; x: number; y: number; z: number }
type LegacyMember = {
  id: number
  nodes: readonly LegacyNode[]
  section: Section
  gamma?: number
  vecxz?: { x: number; y: number; z: number }
  mesh?: { visible?: boolean }
}
export type LegacyStructuralModel = {
  nodes: readonly LegacyNode[]
  members: readonly LegacyMember[]
  sections: readonly Section[]
}

const mm = (value: number | undefined) => (value ?? 0) * 0.001

const sectionFamily = (section: Section): ProfileFamily => {
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

export const sectionToSceneProfile = (section: Section): SceneProfileInput => {
  let parameters: number[]
  switch (section.type) {
    case 'I': case 'IPN': case 'Channel': case 'UPN': case 'Tee':
      parameters = [mm(section.depth), mm(section.width), mm(section.tw), mm(section.tf), 0, 0, mm('r' in section ? section.r : 0)]
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
  return {
    id: section.id,
    family: sectionFamily(section),
    parameters,
    materialId: section.material?.id,
  }
}

/** Snapshot the current Y-up Three.js-domain model without creating Object3D. */
export const legacyModelToStructuralSource = (model: LegacyStructuralModel): StructuralSceneSource => ({
  nodes: model.nodes.map(node => ({ id: node.id, position: [node.x, node.y, node.z] })),
  profiles: model.sections.map(sectionToSceneProfile),
  members: model.members.map(member => ({
    id: member.id,
    startNodeId: member.nodes[0].id,
    endNodeId: member.nodes[1].id,
    profileId: member.section.id,
    referenceAxis: member.vecxz
      ? [member.vecxz.x, member.vecxz.y, member.vecxz.z]
      : [0, 1, 0],
    gammaRadians: ((member.gamma ?? 0) * Math.PI) / 180,
    visible: member.mesh?.visible !== false,
  })),
})

/** Convert the engineering Z-up fixture into the same Y-up render-space source. */
export const fixtureToStructuralSource = (fixture: StructuralBenchmarkFixture): StructuralSceneSource => ({
  nodes: fixture.nodes.map(node => ({ id: node.id, position: [node.x, node.z, node.y] })),
  profiles: (fixture.sections as unknown as Section[]).map(sectionToSceneProfile),
  members: fixture.members.map(member => ({
    id: member.id,
    startNodeId: member.nodei.id,
    endNodeId: member.nodej.id,
    profileId: member.section,
    referenceAxis: [member.vecxz[0], member.vecxz[2], member.vecxz[1]],
    gammaRadians: 0,
  })),
})

