import * as THREE from "three"
import { makeAutoObservable } from "mobx";
class GridHelper{
  enabled: boolean
  scene : THREE.Scene
  /**
   * Parent group that lets the square drawing grid (ô vuông) rotate into the
   * active working plane. `grid` is the THREE.GridHelper child lying in local
   * XZ; rotating the group re-orients the grid onto the working plane, and the
   * grid's local y (-0.005) keeps it just below that plane (no z-fighting).
   */
  group : THREE.Group
  grid : THREE.GridHelper
  size : number
  divisions : number
  spacing : number 
  set setupEvent(enabled: boolean) {
    if (enabled) {
      this.scene.add( this.group );
    } else {
      this.scene.remove( this.group );
    }
  }


  constructor(scene : THREE.Scene){
    this.enabled = true
    this.size = 50
    this.divisions = 50
    this.spacing = 1
    // Blue-gray grid tuned for the dark AutoCAD-style background (#212830)
    this.group = new THREE.Group()
    this.grid = new THREE.GridHelper( this.size, this.divisions, new THREE.Color(0x4a5765), new THREE.Color(0x36404a) );
    this.grid.position.y = -0.005
    this.group.add(this.grid)
    this.scene = scene
    this.setupEvent = true;
    makeAutoObservable(this)
  }

  setVisible(visible : boolean){
    this.enabled = visible
    this.grid.visible = visible
  }

  toggle(){
    this.setVisible(!this.enabled)
  }

  hide(){
    this.setVisible(false)
  }

  show(){
    this.setVisible(true)
  }

  /**
   * Orient the square grid so it lies in the given plane (normal + THREE.Plane
   * constant). The grid's local up (+Y) is rotated to the plane normal and the
   * group is placed at the plane's closest point to the origin.
   */
  applyWorkingPlane(normal: THREE.Vector3, constant: number){
    const n = normal.clone().normalize()
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n)
    this.group.position.copy(n).multiplyScalar(-constant)
  }

  toGround(){
    this.grid.position.y = -0.005
  }

  dispose(){
    this.scene.remove(this.group)
    this.group.clear()
    this.grid.geometry.dispose()
    if (Array.isArray(this.grid.material)) {
      this.grid.material.forEach((mat) => mat.dispose())
    } else {
      this.grid.material.dispose()
    }
  }

  get(){
    return {size : this.size , divisions : this.divisions , spacing : this.spacing }
  }

  create(size : number, divisions : number){
    this.grid = new THREE.GridHelper(size, divisions, new THREE.Color(0x4a5765), new THREE.Color(0x36404a))
    this.grid.position.y = -0.005
    this.group.clear()
    this.group.add(this.grid)
    if (this.group.parent !== this.scene) this.scene.add(this.group)
    this.size = size
    this.divisions = divisions 
    this.spacing = size / divisions
  }
  update(size : number, divisions : number){
    this.dispose()
    this.create(size, divisions)
  }
}



export default GridHelper ;