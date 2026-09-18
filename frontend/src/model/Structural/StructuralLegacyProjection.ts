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
 *
 * Complexity contract: every id lookup goes through Map indexes and every
 * removal is one filter pass per collection. A naive `find`/`findIndex` per
 * entity is O(n²) across a bulk commit and froze the main thread for tens of
 * seconds on 100k-member imports.
 */
export const applyStructuralChangeToLegacy = (
  model: Model,
  document: StructuralDocument,
  change: StructuralChangeSet,
) => {
  // One action for the whole projection: MobX batches the notifications of the
  // thousands of array mutations instead of scheduling reactions per push.
  runInAction(() => projectStructuralChanges(model, document, change))
}

/**
 * Projection body (see the complexity contract above). Declared after the
 * entry point but only ever invoked from inside it, so the reference is
 * always initialized by call time.
 */
const projectStructuralChanges = (
  model: Model,
  document: StructuralDocument,
  change: StructuralChangeSet,
) => {
  const changes = change.changes

  // Remove dependants before their topology. Domain cascade has already been
  // validated and committed in StructuralDocument, so only projection cleanup
  // happens here.
  const deletedLoadIds = new Set(changes.loads.deleted)
  if (deletedLoadIds.size) {
    model.loads = model.loads.filter(load => {
      if (!deletedLoadIds.has(load.id)) return true
      load.dispose()
      return false
    })
  }
  const deletedBoundaryConditionIds = new Set(changes.boundaryConditions.deleted)
  if (deletedBoundaryConditionIds.size) {
    const boundaryConditionsById = new Map(model.boundaryConditions.map(item => [item.id, item]))
    for (const id of deletedBoundaryConditionIds) boundaryConditionsById.get(id)?.delete()
  }
  const deletedShellIds = new Set(changes.shells.deleted)
  if (deletedShellIds.size) {
    model.shells = model.shells.filter(shell => {
      if (!deletedShellIds.has(shell.id)) return true
      shell.dispose()
      return false
    })
  }

  // Members to remove: explicit deletes plus everything that must be rebuilt
  // (topology changed, its section changed or its material changed).
  const rebuildMemberIds = new Set([...changes.members.deleted, ...changes.members.created, ...changes.members.updated])
  for (const nodeId of changes.nodes.updated) {
    for (const memberId of document.memberIdsByNodeId.get(nodeId) ?? []) rebuildMemberIds.add(memberId)
  }
  for (const sectionId of [...changes.sections.updated, ...changes.sections.created]) {
    for (const memberId of document.memberIdsBySectionId.get(sectionId) ?? []) rebuildMemberIds.add(memberId)
  }
  if (changes.materials.updated.length) for (const id of document.members.keys()) rebuildMemberIds.add(id)
  if (rebuildMemberIds.size) {
    model.members = model.members.filter(member => {
      if (!rebuildMemberIds.has(member.id)) return true
      member.disposeProjection()
      return false
    })
    if (model.members.length === 0) model.memberIndexHighWater = 0
  }

  const deletedNodeIds = new Set(changes.nodes.deleted)
  if (deletedNodeIds.size) {
    model.nodes = model.nodes.filter(node => {
      if (!deletedNodeIds.has(node.id)) return true
      node.dispose()
      return false
    })
  }

  if (changes.materials.created.length || changes.materials.updated.length || changes.materials.deleted.length) {
    model.materials = [...document.materials.values()].map(item => structuredClone(item) as Material)
  }
  if (
    changes.sections.created.length || changes.sections.updated.length || changes.sections.deleted.length ||
    changes.materials.created.length || changes.materials.updated.length || changes.materials.deleted.length
  ) {
    model.sections = [...document.sections.keys()].map(id => legacySection(document, id))
  }

  const nodesById = new Map(model.nodes.map(node => [node.id, node]))
  for (const id of [...changes.nodes.created, ...changes.nodes.updated]) {
    const record = document.nodes.get(id)!
    const position = jsonToThree(record.position[0], record.position[1], record.position[2])
    let node = nodesById.get(id)
    if (!node) {
      node = new Node(position, record.name, id)
      node.model = model
      node.create()
      model.nodes.push(node)
      nodesById.set(id, node)
    } else {
      node.x = position.x
      node.y = position.y
      node.z = position.z
      node.name = record.name
      node.mesh?.position.copy(position)
    }
  }

  if (rebuildMemberIds.size) {
    const sectionsById = new Map(model.sections.map(section => [section.id, section]))
    for (const id of rebuildMemberIds) {
      const record = document.members.get(id)
      if (!record) continue
      const nodeI = nodesById.get(record.nodeI)
      const nodeJ = nodesById.get(record.nodeJ)
      const section = sectionsById.get(record.sectionId)
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
  }

  for (const id of [...changes.shells.created, ...changes.shells.updated]) {
    const record = document.shells.get(id)!
    const nodes = record.nodeIds.map(nodeId => nodesById.get(nodeId)!)
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
