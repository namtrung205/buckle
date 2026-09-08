
import * as THREE from 'three';
// import { useModel } from './model/Context';

import Node from './model/Elements/Node/Node';
import ElasticBeamColumnClass from './model/Elements/ElasticBeamColumn/ElasticBeamColumn';
import BoundaryCondition from './model/BoundaryCondition/BoundaryCondition';
import Load from './model/Load/Load';
import Shell from './model/Elements/Shell/Shell';
import Model from './model/Model';
import { threeToJson, jsonToThree } from './utils/axis';
import { runInAction } from 'mobx';
import type { StructuralModelDto } from './contracts/structuralModel';
import { analysisTransportToDocumentSeed, type AnalysisTransportInput } from './core/structural';

/**
 * Export the model to the shared JSON schema.
 *
 * The JSON schema / backend is the single source of truth and stays Z-up
 * (X horizontal, Y horizontal, Z vertical — Midas/SAP/OpenSees convention).
 * The Three.js scene is Y-up (WebGL). The only conversion between the two
 * happens HERE, at this boundary:
 *
 *   UI (three.js Y-up)  --exportModelJson-->  JSON / OpenSees (Z-up)
 *   JSON / OpenSees (Z-up) --buildModelFromJson-->  UI (three.js Y-up)
 *
 * Any other render engine can consume/publish the same Z-up JSON without
 * knowing about the Y<->Z permutation.
 */
export const exportModelJson = (model: Model) => {
  // Return a mutable transport clone for Axios/download consumers; the source
  // AnalysisSnapshot remains deeply frozen and tied to its model revision.
  return structuredClone(model.createAnalysisSnapshot().model) as unknown as StructuralModelDto;
};

/**
 * Build the Three.js scene from a Z-up JSON payload (the shared schema).
 * Converts nodes, member vecxz, boundary conditions and load values from the
 * Z-up engineering frame into the three.js Y-up scene frame. Created shells
 * too when the payload provides them.
 */
export const buildModelFromJson = (model: Model, input: StructuralModelDto) => {
  model.clear()

  // Validate and normalize topology in the pure core before creating any
  // Three.js/MobX legacy entity. This prevents partially imported scenes.
  model.structuralDocument.reconcile(
    analysisTransportToDocumentSeed(input as unknown as AnalysisTransportInput),
  )
  const jsonData = structuredClone(
    model.structuralDocument.createAnalysisSnapshot().model,
  ) as unknown as StructuralModelDto

  // Create a map to store node references by ID for member creation
  const nodeMap = new Map<number, Node>()

  // 1. Create nodes first — convert (x, y, z) from Z-up to three.js (Y-up)
  if (jsonData.nodes) {
    jsonData.nodes.forEach((nodeData) => {
      const p = jsonToThree(nodeData.x, nodeData.y, nodeData.z)
      const node = new Node(
        p,
        nodeData.name
      )
      // Use the original ID from the JSON
      node.id = nodeData.id
      node.model = model
      node.create()
      model.nodes.push(node)
      nodeMap.set(node.id, node)
    })
    console.log(`Created ${jsonData.nodes.length} nodes`)
  }

  // 2. Update materials and sections if provided
  if (jsonData.materials) {
    runInAction(() => { model.materials = jsonData.materials })
  }
  if (jsonData.sections) {
    runInAction(() => { model.sections = jsonData.sections })
  }

  // 3. Create members/elements — convert vecxz from Z-up to three.js (Y-up)
  if (jsonData.members) {
    jsonData.members.forEach((memberData) => {
      const nodei = nodeMap.get(memberData.nodei.id)
      const nodej = nodeMap.get(memberData.nodej.id)

      if (!nodei || !nodej) {
        console.warn(`Could not find nodes for member ${memberData.id}`)
        return
      }

      // Find the section
      const section = model.sections.find(s => s.id === memberData.section)
      if (!section) {
        console.warn(`Could not find section ${memberData.section} for member ${memberData.id}`)
        return
      }

      const vecxz = Array.isArray(memberData.vecxz)
        ? jsonToThree(memberData.vecxz[0], memberData.vecxz[1], memberData.vecxz[2])
        : undefined

      const member = new ElasticBeamColumnClass(
        model,
        memberData.label || `Member ${memberData.id}`,
        [nodei, nodej],
        section,
      )
      member.id = memberData.id
      member.release = memberData.release || ""
      member.gamma = memberData.gamma || 0
      if (vecxz) member.vecxz = vecxz
      member.create()
      model.members.push(member)
    })
    console.log(`Created ${jsonData.members.length} members`)
  }

  // 4. Create shell elements if provided (nodes already in three.js frame)
  if (jsonData.shells) {
    jsonData.shells.forEach((shellData) => {
      const shellNodes = shellData.nodes
        .map((nodeId) => nodeMap.get(nodeId))
        .filter((node): node is Node => node !== undefined)
      if (shellNodes.length < 3) {
        console.warn(`Could not find all nodes for shell ${shellData.id}`)
        return
      }
      const shell = new Shell(
        model,
        shellData.name || `Shell-${shellData.id}`,
        shellNodes,
        shellData.thickness ?? 0.005,
        shellData.material,
        shellData.id
      )
      shell.create()
      model.shells.push(shell)
    })
    console.log(`Created ${jsonData.shells.length} shells`)
  }

  // 5. Create boundary conditions — DOF flags keep their semantic meaning and
  // are passed through unchanged (no Y<->Z swap; only spatial vectors such as
  // node coordinates / vecxz / load values are converted to the three.js frame).
  // Supports without targets are invalid and never enter the model.
  if (jsonData.boundary_conditions) {
    jsonData.boundary_conditions
      .filter((bcData) => bcData.targets.length > 0)
      .forEach((bcData) => {
      const boundaryCondition = new BoundaryCondition(model, {
        id: bcData.id,
        type: bcData.type,
        targets: bcData.targets,
        name: bcData.name,
        dx: bcData.dx,
        dy: bcData.dy,
        dz: bcData.dz,
        rx: bcData.rx,
        ry: bcData.ry,
        rz: bcData.rz,
        rotation: bcData.rotation,
      })
      boundaryCondition.createOrUpdate()
      })
    console.log(`Created ${jsonData.boundary_conditions.length} boundary conditions`)
  }

  // 6. Create loads — convert value from Z-up to three.js (Y-up)
  // Loads without targets are invalid and never enter the model.
  if (jsonData.loads) {
    jsonData.loads
      .filter((loadData) => loadData.targets.length > 0)
      .forEach((loadData) => {
      const load = new Load(model, {
        id: loadData.id,
        type: loadData.type,
        targets: loadData.targets,
        name: loadData.name,
        value: jsonToThree(loadData.value.x, loadData.value.y, loadData.value.z),
        magnitude: loadData.magnitude,
      })
      load.createOrUpdate()
      })
    console.log(`Created ${jsonData.loads.length} loads`)
  }

  // Build the backend-independent render database after all legacy entities
  // exist, then apply the user-selected representation without rebuilding it.
  model.syncStructuralSceneDB()
  model.applyRenderModeVisibility()

  // Fit the camera to the model so large models are not culled by the far plane
  model.camera.fitModelToView()

  console.log('Model loaded successfully from JSON!')
}

export const buildModelOnjson = async (model: Model, path: string) => {
  try {
    const response = await fetch(path)
    if (!response.ok) {
      throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`)
    }
    const jsonData = await response.json()
    buildModelFromJson(model, jsonData)
  } catch (error) {
    console.error('Error loading model from JSON:', error)
    alert('Error loading model: ' + error)
  }
}

