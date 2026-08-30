import { Model } from "../Model"
import * as THREE from 'three'
import type { Label, SupportFixity } from "../Labeler/Labeler"
class BoundaryCondition {
  type : 'fixed' | 'pinned' |  'roller' | 'roller-x' | 'roller-y' | 'custom' | 'elastic' = 'fixed'
  targets : number[] = []
  name : string = ''
  model : Model
  id : number = 0
  dx? : number
  dy? : number
  dz? : number
  rx? : number
  ry? : number
  rz? : number
  rotation : number = 0
  mesh : THREE.Mesh [] = []
  constructor(model: Model, boundaryCondition: BoundaryCondition) {
    this.model = model
    this.type = boundaryCondition.type
    this.targets = boundaryCondition.targets
    this.name = boundaryCondition.name
    this.id = boundaryCondition.id || Math.floor(Math.random() * 0x7FFFFFFF)
    this.mesh = boundaryCondition.mesh || []
    this.rotation = boundaryCondition.rotation || 0
    this.dx = boundaryCondition.dx
    this.dy = boundaryCondition.dy
    this.dz = boundaryCondition.dz
    this.rx = boundaryCondition.rx
    this.ry = boundaryCondition.ry
    this.rz = boundaryCondition.rz
  }

  createOrUpdate(){ 
    this.model.invalidateResults()
    this.replaceExistingSupports()
    this.dispose()  
    switch(this.type){
      case 'fixed':
        this.dx = 1
        this.dy = 1
        this.dz = 1
        this.rx = 1
        this.ry = 1
        this.rz = 1
        
        this.createSupportSymbols()
      break
      case 'pinned':
        this.dx = 1
        this.dy = 1
        this.dz = 1
        this.rx = 1  // Restrain torsion to prevent mechanism/singularity
        this.ry = 0
        this.rz = 0
        this.createSupportSymbols()
        break
      case 'roller' :
        this.dx = 0
        this.dy = 1  // MUST fix vertical translation (Y) to prevent rigid body rotation
        this.dz = 1  // Fix out-of-plane translation
        this.rx = 1  // Restrain torsion to prevent mechanism/singularity
        this.ry = 0
        this.rz = 0
        this.createSupportSymbols()
        break
      case 'elastic':
        this.targets.forEach(target => {
          this.createElasticSupport(target)
        })
        break
      case 'roller-x':
      case 'roller-y':
      case 'custom':
        // Reflect the stored per-DOF restraint flags in the hexagon sectors
        this.createSupportSymbols()
        break
    }
    const index = this.model.boundaryConditions.findIndex(item => item.id === this.id)
    if(index === -1){
      this.model.boundaryConditions.push(this)
    }else{
      this.model.boundaryConditions[index] = this
    }

  }

  delete(){
    const index = this.model.boundaryConditions.findIndex(item => item.id === this.id)
    const id = this.id
    
    if(index !== -1){
      this.model.boundaryConditions.splice(index, 1)
    }
    this.dispose()
  }

  /**
   * Enforce one support per node: when this boundary condition claims a node
   * already referenced by another support, the other support loses that node
   * (and is removed entirely once it runs out of targets). The new/edited
   * support therefore replaces any previous support on the same nodes.
   */
  replaceExistingSupports(){
    for(const target of this.targets){
      const conflicts = this.model.boundaryConditions.filter(bc => bc.id !== this.id && bc.targets.includes(target))
      for(const bc of conflicts){
        bc.targets = bc.targets.filter(t => t !== target)
        this.model.labeler.batchDelete([`support-${bc.id}-${target}`])
        if(bc.targets.length === 0) bc.delete()
      }
    }
  }

  /**
   * Midas-Civil style support symbol: a hexagon split into 6 sectors
   * (X, Y, Z, MX, MY, MZ — clockwise from the upper-right) colored green when
   * the DOF is restrained and red when it is free. Rendered as a CSS2D
   * annotation pinned to the node so it always draws on top of every other
   * object, with a constant screen size (no 3D geometry involved).
   */
  createSupportSymbols(){
    const labels : Label[] = []
    for(const target of this.targets){
      const node = this.model.nodes.find(item => item.id === target)
      if(!node) continue

      const fixity : SupportFixity = {
        x : !!this.dx,
        y : !!this.dy,
        z : !!this.dz,
        mx : !!this.rx,
        my : !!this.ry,
        mz : !!this.rz
      }

      labels.push({
        id : `support-${this.id}-${target}`,
        position : new THREE.Vector3(node.x, node.y, node.z),
        text : '',
        type : 'support',
        fixity,
        rotation : this.rotation || 0
      })
    }

    // Rebuild from scratch so restraint-flag changes re-render the sector colors
    this.removeSupportSymbols()
    if(labels.length) this.model.labeler.create(labels)
  }

  removeSupportSymbols(){
    const ids = this.targets.map(target => `support-${this.id}-${target}`)
    if(ids.length) this.model.labeler.batchDelete(ids)
  }

  createElasticSupport(target: number){
    const node = this.model.nodes.find(item => item.id === target)

    if(!node) return 

    const hasXSpring = (this.dx !== 0 && this.dx !== 1) || (this.rx !== 0 && this.rx !== 1)
    if (hasXSpring) this.createSpring(node, new THREE.Vector3(1, 0, 0), 'x')
    
    const hasYSpring = (this.dz !== 0 && this.dz !== 1) || (this.rz !== 0 && this.rz !== 1)
    if (hasYSpring) this.createSpring(node, new THREE.Vector3(0, 1, 0), 'y')
    
    const hasZSpring = (this.dy !== 0 && this.dy !== 1) || (this.ry !== 0 && this.ry !== 1)
    if (hasZSpring) this.createSpring(node, new THREE.Vector3(0, 0, 1), 'z')
    
  }

  createSpring(node: any, direction: THREE.Vector3, name: string){
    const springHeight = 0.5
    const springRadius = 0.15
    const springTurns = 4
    
    // Create helix path
    const points: THREE.Vector3[] = []
    const segments = 64
    
    // Create a local coordinate system where the spring extends along the direction vector
    const up = new THREE.Vector3(0, 1, 0)
    let right = new THREE.Vector3()
    let forward = new THREE.Vector3()
    
    if (Math.abs(direction.dot(up)) > 0.99) {
      // If direction is nearly vertical, use X and Z for the spring plane
      right = new THREE.Vector3(1, 0, 0)
      forward = new THREE.Vector3(0, 0, 1)
    } else {
      right = new THREE.Vector3().crossVectors(up, direction).normalize()
      forward = new THREE.Vector3().crossVectors(direction, right).normalize()
    }
    
    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      const angle = t * Math.PI * 2 * springTurns
      const localX = Math.cos(angle) * springRadius
      const localY = -t * springHeight  // Start at 0 (top) and extend along direction
      const localZ = Math.sin(angle) * springRadius
      
      // Transform local coordinates to world coordinates
      const worldPos = new THREE.Vector3()
        .addScaledVector(right, localX)
        .addScaledVector(direction, localY)
        .addScaledVector(forward, localZ)
      
      points.push(worldPos)
    }
    
    const curve = new THREE.CatmullRomCurve3(points)
    const tubeGeometry = new THREE.TubeGeometry(curve, segments, 0.02, 8, false)
    const material = new THREE.MeshBasicMaterial({ color: 0xFF6B35 })
    const spring = new THREE.Mesh(tubeGeometry, material)
    
    // Position spring at node, with top at node position
    spring.position.set(node.x, node.y, node.z)
    this.mesh.push(spring)
    this.model.scene.add(spring)
    
    // Add a base plate at the end of the spring
    const baseGeometry = new THREE.CylinderGeometry(springRadius * 1.5, springRadius * 1.5, 0.05, 16)
    const baseMaterial = new THREE.MeshBasicMaterial({ color: 0x1E90FF })
    const base = new THREE.Mesh(baseGeometry, baseMaterial)
    
    // Position base at the end of the spring along the direction
    const basePosition = new THREE.Vector3(node.x, node.y, node.z)
      .addScaledVector(direction, -springHeight - 0.025)
    
    base.position.copy(basePosition)
    
    // Orient the base to be perpendicular to the spring direction
    base.lookAt(basePosition.clone().add(direction))
    base.rotateX(Math.PI / 2) // Rotate to align with the spring direction
    
    this.mesh.push(base)
    this.model.scene.add(base)
  }

  private dispose = () => {
    this.removeSupportSymbols()
    if(!this.mesh) return 
    function removeObjWithChildren(obj : any) {
      if (obj.children.length > 0) {
        for (var x = obj.children.length - 1; x >= 0; x--) {
          removeObjWithChildren(obj.children[x])
        }
      }
      if (obj.isMesh || obj.isLine) {
        obj.geometry.dispose();
        if( Array.isArray(obj.material)){
          for(let i = 0; i < obj.material.length; i++){
            obj.material[i].dispose()
          }
        }else{
          obj.material.dispose();
        }
      }
      if (obj.parent) {
        obj.parent.remove(obj)
      }
    }
    this.mesh.forEach(function(obj) {
      removeObjWithChildren(obj)
    });
  }
}

export default BoundaryCondition