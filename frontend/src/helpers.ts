
import * as THREE from 'three';
// import { useModel } from './model/Context';

import Node from './model/Elements/Node/Node';
import ElasticBeamColumnClass from './model/Elements/ElasticBeamColumn/ElasticBeamColumn';
import BoundaryCondition from './model/BoundaryCondition/BoundaryCondition';
import Load from './model/Load/Load';
import Model from './model/Model';
import { threeToJson, jsonToThree } from './utils/axis';

export const exportModelJson = (model: Model) => {
  // Create JSON structure from the current model.
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
      return {
        id: member.id,
        label: member.label,
        nodei: {
          id: member.nodes[0].id
        },
        nodej: {
          id: member.nodes[1].id
        },
        section: member.section.id,
        vecxz: [vecxz[0], vecxz[1], vecxz[2]]
      };
    }),
    boundary_conditions: model.boundaryConditions.map(bc => ({
      id: bc.id,
      type: bc.type,
      targets: bc.targets,
      name: bc.name,
      dx: bc.dx,
      dy: bc.dz,
      dz: bc.dy,
      rx: bc.rx,
      ry: bc.rz,
      rz: bc.ry
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
    }))
  };

  return jsonData;
};

export const buildModelOnjson = async (model: Model , path : string) => {
  try {
    
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`);
    }
    const jsonData = await response.json();

    // const model = useModel();
    // Clear existing model first
    model.clear()
    
    // Create a map to store node references by ID for member creation
    const nodeMap = new Map<number, Node>()
    
    // 1. Create nodes first
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
    
    // 3. Create members/elements
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
    
    // 4. Create boundary conditions
    if (jsonData.boundary_conditions) {
      jsonData.boundary_conditions.forEach((bcData: any) => {
        const boundaryCondition = new BoundaryCondition(model, {
          id: bcData.id,
          type: bcData.type,
          targets: bcData.targets,
          name: bcData.name,
          dx: bcData.dx,
          dy: bcData.dz,
          dz: bcData.dy,
          rx: bcData.rx,
          ry: bcData.rz,
          rz: bcData.ry
        } as any)
        boundaryCondition.createOrUpdate()
      })
      console.log(`Created ${jsonData.boundary_conditions.length} boundary conditions`)
    }
    
    // 5. Create loads
    if (jsonData.loads) {
      jsonData.loads.forEach((loadData: any) => {
        const load = new Load(model, {
          id: loadData.id,
          type: loadData.type,
          targets: loadData.targets,
          name: loadData.name,
          value: jsonToThree(loadData.value.x, loadData.value.y, loadData.value.z),
        } as any)
        load.createOrUpdate()
      })
      console.log(`Created ${jsonData.loads.length} loads`)
    }
    
    // Fit the camera to the model so large models are not culled by the far plane
    model.camera.fitModelToView()

    console.log('Model loaded successfully from JSON!')
    // alert('Model loaded successfully!')
    
  } catch (error) {
    console.error('Error loading model from JSON:', error)
    alert('Error loading model: ' + error)
  }
}

