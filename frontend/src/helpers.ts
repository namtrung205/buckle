
import * as THREE from 'three';
// import { useModel } from './model/Context';

import Node from './model/Elements/Node/Node';
import ElasticBeamColumnClass from './model/Elements/ElasticBeamColumn/ElasticBeamColumn';
import BoundaryCondition from './model/BoundaryCondition/BoundaryCondition';
import Load from './model/Load/Load';
import Shell from './model/Elements/Shell/Shell';
import Model from './model/Model';
import { threeToJson, jsonToThree } from './utils/axis';

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
  // Node coordinates, member vecxz and load values live in the Three.js scene
  // (Y-up), while the JSON/backend uses the Z-up engineering frame. Convert
  // at this boundary only.
  const jsonData = {
    nodes: model.nodes.map(node => {
      const p = threeToJson(new THREE.Vector3(node.x, node.y, node.z));
      return {
        id: node.id,
        name: node.name,
        x: p[0],
        y: p[1],
        z: p[2]
      };
    }),
    materials: model.materials,
    sections: model.sections,
    members: model.members.map(member => {
      const vecxz = threeToJson(member.vecxz);
      const pi = threeToJson(new THREE.Vector3(member.nodes[0].x, member.nodes[0].y, member.nodes[0].z));
      const pj = threeToJson(new THREE.Vector3(member.nodes[1].x, member.nodes[1].y, member.nodes[1].z));
      return {
        id: member.id,
        label: member.label,
        nodei: {
          id: member.nodes[0].id,
          x: pi[0],
          y: pi[1],
          z: pi[2]
        },
        nodej: {
          id: member.nodes[1].id,
          x: pj[0],
          y: pj[1],
          z: pj[2]
        },
        section: member.section.id,
        vecxz: [vecxz[0], vecxz[1], vecxz[2]],
        release: member.release || ""
      };
    }),
    // DOF restraint flags (dx, dy, dz, rx, ry, rz) are semantic labels, not
    // spatial vectors — they keep their meaning (Dx = restrain translation
    // along X, ...) regardless of the render frame. They must NOT be swapped
    // Y<->Z like node coordinates / vecxz / load values are. OpenSees applies
    // them directly via ops.fix(target, dx, dy, dz, rx, ry, rz) with DOFs
    // 1..6 = Dx,Dy,Dz,Rx,Ry,Rz, so pass them through unchanged.
    boundary_conditions: model.boundaryConditions.map(bc => ({
      id: bc.id,
      type: bc.type,
      targets: bc.targets,
      name: bc.name,
      dx: bc.dx,
      dy: bc.dy,
      dz: bc.dz,
      rx: bc.rx,
      ry: bc.ry,
      rz: bc.rz
    })),
    loads: model.loads.map(load => {
      const v = threeToJson(load.value);
      return {
        id: load.id,
        type: load.type,
        targets: load.targets,
        name: load.name,
        value: {
          x: v[0],
          y: v[1],
          z: v[2]
        },
        magnitude: load.magnitude,
      };
    }),
    shells: model.shells.map(shell => ({
      id: shell.id,
      nodes: shell.nodes.map(node => node.id),
      thickness: shell.thickness,
      material: shell.material
    })),
    metadata: {
      exportDate: new Date().toISOString(),
      modelName: 'FEM Model',
      version: '1.0'
    }
  };

  return jsonData;
};

/**
 * Build the Three.js scene from a Z-up JSON payload (the shared schema).
 * Converts nodes, member vecxz, boundary conditions and load values from the
 * Z-up engineering frame into the three.js Y-up scene frame. Created shells
 * too when the payload provides them.
 */
export const buildModelFromJson = (model: Model, jsonData: any) => {
  model.clear()

  // Create a map to store node references by ID for member creation
  const nodeMap = new Map<number, Node>()

  // 1. Create nodes first — convert (x, y, z) from Z-up to three.js (Y-up)
  if (jsonData.nodes) {
    jsonData.nodes.forEach((nodeData: any) => {
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
    model.materials = jsonData.materials
  }
  if (jsonData.sections) {
    model.sections = jsonData.sections
  }

  // 3. Create members/elements — convert vecxz from Z-up to three.js (Y-up)
  if (jsonData.members) {
    jsonData.members.forEach((memberData: any) => {
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

      const vecxz = jsonToThree(
        memberData.vecxz[0],
        memberData.vecxz[1],
        memberData.vecxz[2]
      )

      const member = new ElasticBeamColumnClass(
        model,
        memberData.label || `Member ${memberData.id}`,
        [nodei, nodej],
        section,
      )
      member.id = memberData.id
      member.create()
      member.release = memberData.release || ""
      member.vecxz = vecxz
      model.members.push(member)
    })
    console.log(`Created ${jsonData.members.length} members`)
  }

  // 4. Create shell elements if provided (nodes already in three.js frame)
  if (jsonData.shells) {
    jsonData.shells.forEach((shellData: any) => {
      const shellNodes = (shellData.nodes ?? []).map((nodeId: number) => nodeMap.get(nodeId)).filter(Boolean)
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
      .filter((bcData: any) => Array.isArray(bcData.targets) && bcData.targets.length > 0)
      .forEach((bcData: any) => {
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
        rz: bcData.rz
      } as any)
      boundaryCondition.createOrUpdate()
      })
    console.log(`Created ${jsonData.boundary_conditions.length} boundary conditions`)
  }

  // 6. Create loads — convert value from Z-up to three.js (Y-up)
  // Loads without targets are invalid and never enter the model.
  if (jsonData.loads) {
    jsonData.loads
      .filter((loadData: any) => Array.isArray(loadData.targets) && loadData.targets.length > 0)
      .forEach((loadData: any) => {
      const load = new Load(model, {
        id: loadData.id,
        type: loadData.type,
        targets: loadData.targets,
        name: loadData.name,
        value: jsonToThree(loadData.value.x, loadData.value.y, loadData.value.z),
        magnitude: loadData.magnitude,
      } as any)
      load.createOrUpdate()
      })
    console.log(`Created ${jsonData.loads.length} loads`)
  }

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

