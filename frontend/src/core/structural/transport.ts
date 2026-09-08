import type {
  AnalysisTransportInput,
  MaterialRecord,
  StructuralDocumentSeed,
} from './types.ts'

/** Normalize the denormalized v1 API model into stable-ID document records. */
export const analysisTransportToDocumentSeed = (model: AnalysisTransportInput): StructuralDocumentSeed => {
  const materials = new Map<number, MaterialRecord>()
  for (const material of model.materials) materials.set(material.id, structuredClone(material))
  for (const section of model.sections) materials.set(section.material.id, structuredClone(section.material))
  for (const shell of model.shells) materials.set(shell.material.id, structuredClone(shell.material))
  const { modelRevision: _modelRevision, snapshotHash: _snapshotHash, ...metadata } = model.metadata ?? {}

  return {
    nodes: model.nodes.map(node => ({
      id: node.id,
      ...(node.name ? { name: node.name } : {}),
      position: [node.x, node.y, node.z],
    })),
    materials: [...materials.values()],
    sections: model.sections.map(section => {
      const { material, ...rest } = section
      return { ...structuredClone(rest), materialId: material.id }
    }),
    members: model.members.map(member => ({
      id: member.id,
      ...(member.label ? { label: member.label } : {}),
      nodeI: member.nodei.id,
      nodeJ: member.nodej.id,
      sectionId: member.section,
      ...(member.vecxz ? { referenceAxis: [...member.vecxz] as [number, number, number] } : {}),
      gammaDegrees: member.gamma,
      release: member.release,
    })),
    shells: model.shells.map(shell => ({
      id: shell.id,
      ...(shell.name ? { name: shell.name } : {}),
      nodeIds: [...shell.nodes] as [number, number, number, number],
      thickness: shell.thickness,
      materialId: shell.material.id,
    })),
    loads: model.loads.map(load => ({
      id: load.id,
      ...(load.name ? { name: load.name } : {}),
      type: load.type,
      targetIds: [...load.targets],
      value: [load.value.x, load.value.y, load.value.z],
      ...(load.magnitude === undefined ? {} : { magnitude: load.magnitude }),
    })),
    boundaryConditions: model.boundary_conditions.map(bc => ({
      id: bc.id,
      ...(bc.name ? { name: bc.name } : {}),
      type: bc.type,
      targetNodeIds: [...bc.targets],
      dx: bc.dx, dy: bc.dy, dz: bc.dz,
      rx: bc.rx, ry: bc.ry, rz: bc.rz,
      rotationDegrees: bc.rotation,
    })),
    metadata,
  }
}
