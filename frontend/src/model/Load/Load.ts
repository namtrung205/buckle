import * as THREE from "three";
import { Model } from "../Model";

/**
 * Semantic load record. Rendering is delegated to the instanced GPU batch
 * (Rendering/LoadGpuRenderer — 3 constant draw calls for the whole model):
 * this class owns load state (targets, value, type) and the label stream and
 * never creates Object3D. Adding/editing/deleting a load just schedules one
 * coalesced batch rebuild instead of dozens of ArrowHelper allocations.
 */
class Load {
  model : Model
  targets : number[]
  value : THREE.Vector3
  type : 'nodal' | 'linear' | 'area' | 'pressure'
  id : number
  name : string
  magnitude?: number
  /** Kept for API compatibility; the GPU batch owns all load geometry. */
  mesh : THREE.Object3D[] = []

  constructor(model : Model, load : Load) {
    this.model = model
    this.targets = load.targets
    this.value = load.value ? new THREE.Vector3(load.value.x, load.value.y, load.value.z) : new THREE.Vector3(0, 0, 0)
    this.type = 'nodal'
    this.id = load.id || Math.floor(Math.random() * 0x7FFFFFFF)
    this.name = load.name || `Load ${this.model.loads.length + 1}`
    this.type = load.type
    this.magnitude = (load as any).magnitude
  }

  createOrUpdate(){
    // A load without targets is invalid — it must never enter the model tree
    // (model.loads) nor render labels/arrows. Bail out before any mutation.
    if (!this.targets || this.targets.length === 0){
      console.warn('Load.createOrUpdate: load has no targets — skipped', this)
      return
    }
    const index = this.model.loads.findIndex(l => l.id === this.id)
    if(index !== -1){
      this.update(this)
    }else{
      this.create()
    }
  }

  update(load : Load){
    this.model.invalidateResults()
    this.value = load.value ? new THREE.Vector3(load.value.x, load.value.y, load.value.z) : new THREE.Vector3(0, 0, 0)
    this.targets = load.targets
    this.type = load.type
    this.id = load.id
    this.name = load.name
    this.magnitude = (load as any).magnitude
    this.model.loads = this.model.loads.map(l => l.id === this.id ? this : l)
    this.create()
  }

  create() {
    const index = this.model.loads.findIndex(l => l.id === this.id)
    if(index === -1){
      this.model.loads.push(this)
    }
    // Geometry lives in the instanced GPU batch (arrows + bands in 3 draw
    // calls); the numeric labels ride the GPU annotation stream.
    this.model.scheduleLoadGpuSync()
    this.removeAllLabels()
    this.createLabels()
  }

  removeAllLabels(){
    this.model.labeler.deleteAll('load');
  }

  delete() {
    this.model.invalidateResults()
    const index = this.model.loads.findIndex(l => l.id === this.id)
    if(index !== -1){
      this.model.loads.splice(index, 1)
      // Refresh all labels since multiple loads might share targets
      this.model.labeler.deleteAll('load')
      if (this.model.loads.length > 0) {
        this.model.loads[0].createLabels()
      } else {
        this.model.syncGpuAnnotations()
      }
      this.model.scheduleLoadGpuSync()
    }
  }

  dispose() {
    // The instanced batch owns load geometry; nothing per-instance to free.
    this.mesh = []
  }

  createLabels(){
    // Entity-scale annotations are rendered by one GPU glyph/symbol stream.
    this.removeAllLabels()
    this.model.syncGpuAnnotations()
  }
}

export default Load;
