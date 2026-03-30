import { Model } from "../../Model";
import * as THREE from 'three';
import Node from "../Node/Node";
import { 
  ElementType,
  Material,
 } from "../../../types";

class Shell {
  model: Model;
  id: number;
  nodes: Node[];
  label: string;
  mesh: THREE.Mesh;
  type: ElementType = 'shell';
  thickness: number;
  material: Material;

  constructor(model: Model, label: string, nodes: Node[], thickness: number, material: Material, id?: number) {
    this.model = model;
    this.id = id ? id : Math.floor(Math.random() * 0x7FFFFFFF);
    this.nodes = nodes;
    this.label = label;
    this.thickness = thickness;
    this.material = material;

    // Initial dummy mesh
    const geometry = new THREE.BufferGeometry();
    const meshMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x03a9f4, 
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.4,
      metalness: 0.3,
      roughness: 0.7
    });
    this.mesh = new THREE.Mesh(geometry, meshMaterial);
  }

  create = () => {
    if (this.nodes.length !== 4) {
      console.error("Shell element must have exactly 4 nodes.");
      return;
    }

    const vertices = new Float32Array([
      this.nodes[0].x, this.nodes[0].y, this.nodes[0].z,
      this.nodes[1].x, this.nodes[1].y, this.nodes[1].z,
      this.nodes[2].x, this.nodes[2].y, this.nodes[2].z,
      this.nodes[3].x, this.nodes[3].y, this.nodes[3].z,
    ]);

    // Counter-clockwise triangles: [0, 1, 2] and [0, 2, 3]
    const indices = [
      0, 1, 2,
      0, 2, 3
    ];

    this.mesh.geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    this.mesh.geometry.setIndex(indices);
    this.mesh.geometry.computeVertexNormals();

    this.mesh.userData.id = this.id;
    this.mesh.userData.type = this.type;
    this.mesh.userData.label = this.label;

    this.model.scene.add(this.mesh);
  };

  dispose = () => {
    if (this.mesh) {
      if (this.mesh.geometry) this.mesh.geometry.dispose();
      if (this.mesh.material) {
        if (Array.isArray(this.mesh.material)) {
          this.mesh.material.forEach(m => m.dispose());
        } else {
          this.mesh.material.dispose();
        }
      }
      if (this.mesh.parent) {
        this.mesh.parent.remove(this.mesh);
      }
    }
  };

  remove = () => {
    this.dispose();
    const index = this.model.shells.findIndex(s => s.id === this.id);
    if (index !== -1) {
      this.model.shells.splice(index, 1);
    }
  };
}

export default Shell;
