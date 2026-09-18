import type {
  BoundaryConditionRecord,
  LoadRecord,
  MaterialRecord,
  Member1DRecord,
  NodeRecord,
  SectionRecord,
  Shell2DRecord,
  StructuralDocumentSeed,
} from '../../core/structural/index.ts'
import type { Section } from '../../types'

type LegacyVector = { x: number; y: number; z: number }
type LegacyNode = { id: number; name?: string; x: number; y: number; z: number }
type LegacyMember = {
  id: number
  label?: string
  nodes: readonly LegacyNode[]
  section: Section
  gamma?: number
  release?: string
  vecxz?: LegacyVector
}
type LegacyShell = {
  id: number
  name?: string
  nodes: readonly LegacyNode[]
  thickness: number
  material: MaterialRecord
}
type LegacyLoad = {
  id: number
  name?: string
  type: LoadRecord['type']
  targets: readonly number[]
  value: LegacyVector
  magnitude?: number
}
type LegacyBoundaryCondition = {
  id: number
  name?: string
  type: BoundaryConditionRecord['type']
  targets: readonly number[]
  dx?: number; dy?: number; dz?: number; rx?: number; ry?: number; rz?: number
  rotation?: number
}

export type LegacyDocumentModel = {
  nodes: readonly LegacyNode[]
  members: readonly LegacyMember[]
  materials: readonly MaterialRecord[]
  sections: readonly Section[]
  shells: readonly LegacyShell[]
  loads: readonly LegacyLoad[]
  boundaryConditions: readonly LegacyBoundaryCondition[]
}

const toEngineering = (value: LegacyVector): readonly [number, number, number] =>
  [value.x, value.z, value.y]

const plainMaterial = (material: MaterialRecord): MaterialRecord => ({
  id: material.id,
  name: material.name,
  ...(material.category === undefined ? {} : { category: material.category }),
  ...(material.code === undefined ? {} : { code: material.code }),
  E: Number(material.E),
  nu: Number(material.nu),
  ...(material.rho === undefined ? {} : { rho: Number(material.rho) }),
  ...(material.alpha === undefined ? {} : { alpha: Number(material.alpha) }),
  ...(material.fy === undefined ? {} : { fy: Number(material.fy) }),
  ...(material.fc === undefined ? {} : { fc: Number(material.fc) }),
  ...(material.fu === undefined ? {} : { fu: Number(material.fu) }),
  ...(material.ft === undefined ? {} : { ft: Number(material.ft) }),
  ...(material.grade === undefined ? {} : { grade: material.grade }),
  ...(material.preset === undefined ? {} : { preset: material.preset }),
})

const sectionRecord = (section: Section): SectionRecord => {
  const { material: _material, ...dimensions } = section
  return {
    ...dimensions,
    ...(dimensions.properties ? { properties: { ...dimensions.properties } } : {}),
    materialId: section.material.id,
  }
}

/**
 * Migration adapter only. It reads the legacy Y-up editor model and produces
 * the canonical Z-up document seed without importing Three.js or renderer state.
 */
export const legacyModelToDocumentSeed = (model: LegacyDocumentModel): StructuralDocumentSeed => {
  const materialById = new Map<number, MaterialRecord>()
  for (const material of model.materials) materialById.set(material.id, plainMaterial(material))
  for (const section of model.sections) materialById.set(section.material.id, plainMaterial(section.material))
  for (const shell of model.shells) materialById.set(shell.material.id, plainMaterial(shell.material))

  const nodes: NodeRecord[] = model.nodes.map(node => ({
    id: node.id,
    ...(node.name ? { name: node.name } : {}),
    position: toEngineering(node),
  }))
  const members: Member1DRecord[] = model.members.map(member => ({
    id: member.id,
    ...(member.label ? { label: member.label } : {}),
    nodeI: member.nodes[0].id,
    nodeJ: member.nodes[1].id,
    sectionId: member.section.id,
    ...(member.vecxz ? { referenceAxis: toEngineering(member.vecxz) } : {}),
    gammaDegrees: member.gamma ?? 0,
    release: member.release ?? '',
  }))
  const shells: Shell2DRecord[] = model.shells.map(shell => ({
    id: shell.id,
    ...(shell.name ? { name: shell.name } : {}),
    nodeIds: shell.nodes.map(node => node.id) as [number, number, number, number],
    thickness: shell.thickness,
    materialId: shell.material.id,
  }))
  const loads: LoadRecord[] = model.loads.map(load => ({
    id: load.id,
    ...(load.name ? { name: load.name } : {}),
    type: load.type,
    targetIds: [...load.targets],
    value: toEngineering(load.value),
    ...(load.magnitude === undefined ? {} : { magnitude: load.magnitude }),
  }))
  const boundaryConditions: BoundaryConditionRecord[] = model.boundaryConditions.map(bc => ({
    id: bc.id,
    ...(bc.name ? { name: bc.name } : {}),
    type: bc.type,
    targetNodeIds: [...bc.targets],
    dx: Number(bc.dx ?? 0), dy: Number(bc.dy ?? 0), dz: Number(bc.dz ?? 0),
    rx: Number(bc.rx ?? 0), ry: Number(bc.ry ?? 0), rz: Number(bc.rz ?? 0),
    rotationDegrees: Number(bc.rotation ?? 0),
  }))

  return {
    nodes,
    materials: [...materialById.values()],
    sections: model.sections.map(sectionRecord),
    members,
    shells,
    loads,
    boundaryConditions,
    metadata: { modelName: 'FEM Model', version: '1.0' },
  }
}
