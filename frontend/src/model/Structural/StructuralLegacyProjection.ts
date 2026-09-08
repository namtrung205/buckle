import * as THREE from 'three'
import { runInAction } from 'mobx'
import type { Material, Section } from '../../types.ts'
import type { StructuralChangeSet, StructuralDocument } from '../../core/structural/index.ts'
import { jsonToThree } from '../../utils/axis.ts'
import type Model from '../Model.ts'
import BoundaryCondition from '../BoundaryCondition/BoundaryCondition.ts'
import Node from '../Elements/Node/Node.ts'
import ElasticBeamColumn from '../Elements/ElasticBeamColumn/ElasticBeamColumn.ts'
import Shell from '../Elements/Shell/Shell.ts'
import Load from '../Load/Load.ts'

const legacyMaterial = (document: StructuralDocument, id: number) => (
  structuredClone(document.materials.get(id)!) as Material
)

const legacySection = (document: StructuralDocument, id: number): Section => {
  const source = document.sections.get(id)!
  const { materialId, ...record } = structuredClone(source)
  return { ...record, material: legacyMaterial(document, materialId) } as Section
}

/**
 * Incrementally mirrors a canonical command commit into legacy semantic objects.
 * This is a temporary Goal-13 migration projection: the document remains the
 * authority, while Solid Extrude and pre-command property panels keep working.
 */
export const applyStructuralChangeToLegacy = (
  model: Model,
  document: StructuralDocument,
  change: StructuralChangeSet,
) => {
  const changes = change.changes

  // Remove dependants before their topology. Domain cascade has already been
  // validated and committed in StructuralDocument, so only projection cleanup
  // happens here.
  for (const id of changes.loads.deleted) {
    const index = model.loads.findIndex(item => item.id === id)
    if (index >= 0) {
      model.loads[index].dispose()
      model.loads.splice(index, 1)
    }
  }
  for (const id of changes.boundaryConditions.deleted) {
    model.boundaryConditions.find(item => item.id === id)?.delete()
  }
  for (const id of changes.shells.deleted) {
    const index = model.shells.findIndex(item => item.id === id)
    if (index >= 0) {
      model.shells[index].dispose()
      model.shells.splice(index, 1)
    }
  }
  for (const id of changes.members.deleted) {
    const index = model.members.findIndex(item => item.id === id)
    if (index >= 0) {
      model.members[index].disposeProjection()
      model.members.splice(index, 1)
    }
  }
  for (const id of changes.nodes.deleted) {
    const index = model.nodes.findIndex(item => item.id === id)
    if (index >= 0) {
      model.nodes[index].dispose()
      model.nodes.splice(index, 1)
    }
  }

  if (changes.materials.created.length || changes.materials.updated.length || changes.materials.deleted.length) {
    runInAction(() => { model.materials = [...document.materials.values()].map(item => structuredClone(item) as Material) })
  }
  if (
    changes.sections.created.length || changes.sections.updated.length || changes.sections.deleted.length ||
    changes.materials.created.length || changes.materials.updated.length || changes.materials.deleted.length
  ) {
    runInAction(() => { model.sections = [...document.sections.keys()].map(id => legacySection(document, id)) })
  }

  for (const id of [...changes.nodes.created, ...changes.nodes.updated]) {
    const record = document.nodes.get(id)!
    const position = jsonToThree(record.position[0], record.position[1], record.position[2])
    let node = model.nodes.find(item => item.id === id)
    if (!node) {
      node = new Node(position, record.name, id)
      node.model = model
      node.create()
      model.nodes.push(node)
    } else {
      node.x = position.x
      node.y = position.y
      node.z = position.z
      node.name = record.name
      node.mesh?.position.copy(position)
    }
  }

  const rebuildMemberIds = new Set([...changes.members.created, ...changes.members.updated])
  for (const nodeId of changes.nodes.updated) {
    for (const memberId of document.memberIdsByNodeId.get(nodeId) ?? []) rebuildMemberIds.add(memberId)
  }
  for (const sectionId of [...changes.sections.updated, ...changes.sections.created]) {
    for (const memberId of document.memberIdsBySectionId.get(sectionId) ?? []) rebuildMemberIds.add(memberId)
  }
  if (changes.materials.updated.length) for (const id of document.members.keys()) rebuildMemberIds.add(id)

  for (const id of rebuildMemberIds) {
    const existing = model.members.findIndex(item => item.id === id)
    if (existing >= 0) {
      model.members[existing].disposeProjection()
      model.members.splice(existing, 1)
    }
    const record = document.members.get(id)
    if (!record) continue
    const nodeI = model.nodes.find(node => node.id === record.nodeI)
    const nodeJ = model.nodes.find(node => node.id === record.nodeJ)
    const section = model.sections.find(item => item.id === record.sectionId)
    if (!nodeI || !nodeJ || !section) continue
    const member = new ElasticBeamColumn(model, record.label ?? `Member ${id}`, [nodeI, nodeJ], section, id)
    member.gamma = record.gammaDegrees ?? 0
    member.release = record.release ?? ''
    if (record.referenceAxis) {
      member.vecxz = jsonToThree(record.referenceAxis[0], record.referenceAxis[1], record.referenceAxis[2])
    }
    member.create()
    model.members.push(member)
  }

  for (const id of [...changes.shells.created, ...changes.shells.updated]) {
    const existing = model.shells.findIndex(item => item.id === id)
    if (existing >= 0) {
      model.shells[existing].dispose()
      model.shells.splice(existing, 1)
    }
    const record = document.shells.get(id)!
    const nodes = record.nodeIds.map(nodeId => model.nodes.find(node => node.id === nodeId)!)
    const shell = new Shell(model, record.name ?? `Shell-${id}`, nodes, record.thickness, legacyMaterial(document, record.materialId), id)
    shell.create()
    model.shells.push(shell)
  }

  for (const id of [...changes.loads.created, ...changes.loads.updated]) {
    const record = document.loads.get(id)!
    new Load(model, {
      id,
      name: record.name,
      type: record.type,
      targets: [...record.targetIds],
      value: new THREE.Vector3(record.value[0], record.value[2], record.value[1]),
      magnitude: record.magnitude,
    }).createOrUpdate()
  }

  for (const id of [...changes.boundaryConditions.created, ...changes.boundaryConditions.updated]) {
    const record = document.boundaryConditions.get(id)!
    new BoundaryCondition(model, {
      id,
      name: record.name,
      type: record.type,
      targets: [...record.targetNodeIds],
      dx: record.dx, dy: record.dy, dz: record.dz,
      rx: record.rx, ry: record.ry, rz: record.rz,
      rotation: record.rotationDegrees,
    }).createOrUpdate()
  }
}
