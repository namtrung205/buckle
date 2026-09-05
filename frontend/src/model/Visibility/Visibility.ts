import Model from "../Model"
import Labeler from "../Labeler/Labeler"
import { Label } from "../../types"
import * as THREE from "three";
import { makeAutoObservable } from "mobx";
class Visibility {
  labeler : Labeler
  model : Model
  nodes : boolean = true
  nodeLabels : boolean = false
  members : boolean = true
  memberLabels : boolean = false
  sections : boolean = true
  loads : boolean = true
  // Startup defaults: structural axis grids and the level datum set stay
  // HIDDEN until enabled in Settings → Visibility. GridSystem / LevelVisual
  // read these flags when they are created, so the 3D view and this dialog
  // always start in sync.
  grids : boolean = false
  levels : boolean = false
  
  constructor(model : Model) {
    this.model = model
    this.labeler = model.labeler

    makeAutoObservable(this)
  }

  showOrHideMembers(visible : boolean){
    this.members = visible
    this.model.members.forEach((member) => {
      // member.mesh.visible = visible

      const line = member.line
      if(line) line.mesh.visible = visible

    })
  }

  showOrHideMemberLabels(visible : boolean) {
    this.memberLabels = visible
    const ids = this.model.members.map((member) => `member-${member.id}`)
    const delta = 0.1
    if(!visible) {
      this.model.labeler.batchDelete(ids) 
      return
    } 

    const labels : Label[] = this.model.members.map((member) => {
      const nodes = member.nodes
      const iNode = nodes[0]
      const jNode = nodes[1]

      const xCenter = (iNode.x + jNode.x) / 2
      const yCenter = (iNode.y + jNode.y) / 2
      const zCenter = (iNode.z + jNode.z) / 2
      return(
        {
          id : `member-${member.id}`,
          position : new THREE.Vector3(xCenter, yCenter + delta, zCenter),
          text : member.label ? member.label : '',
        }
      )
    })
    
    this.model.labeler.batchUpdateOrCreate(labels)
  }
  
  showOrHideNodes(visible : boolean){
    this.nodes = visible
    this.model.nodes.forEach((node) => {
      node.mesh.visible = visible
    })
  }

  showOrHideNodeLabels(visible : boolean) {
    this.nodeLabels = visible
    const ids = this.model.nodes.map((node) => `node-${node.id}`)
    const delta = 0.1
    if(!visible) {
      this.model.labeler.batchDelete(ids) 
      return
    } 

    const labels : Label[] = this.model.nodes.map((node) => {
      return(
        {
          id : `node-${node.id}`,
          position : new THREE.Vector3(node.x, node.y + delta, node.z),
          text : node.name ? node.name : '',
        }
      )
    })
    
    this.model.labeler.batchUpdateOrCreate(labels)
  }

  showOrHideSections(visible : boolean){
    this.sections = visible
    this.model.members.forEach((member) => {
      member.mesh.visible = visible
      member.edges.visible = visible
    })
  }

  showOrHideLoads(visible : boolean){
    this.loads = visible
    this.model.loads.forEach((load) => {
      load.mesh.forEach(m => m.visible = visible)
      if (visible) {
        load.createLabels()
      } else {
        load.removeAllLabels()
      }
    })
  }

  /** Show/hide every structural axis grid (Settings → Visibility). */
  showOrHideGrids(visible : boolean){
    this.grids = visible
    this.model.grids.forEach((grid) => {
      grid.setVisible(visible)
    })
  }

  /** Show/hide the level datum set (3D datums + their text labels). */
  showOrHideLevels(visible : boolean){
    this.levels = visible
    this.model.levelVisual?.setVisible(visible)
  }

  /* ── model-mode snapshot / restore ──────────────────────────────────────
   * The Results tabs (force/stress/deformation diagrams, reactions) hide the
   * member centre lines, solid sections and loads on the THREE objects AND
   * clobber these flags while a result is displayed. Unlocking / leaving the
   * results dock must bring the model view back — this snapshot remembers the
   * model-mode visibility that existed before any result hid things. */
  private modelViewSnapshot: { members: boolean; sections: boolean; loads: boolean } | null = null;

  /** Remember the current model-mode visibility (call once when results mode
   *  begins; the first snapshot wins so a re-run keeps the original view). */
  snapshotModelView(){
    if (this.modelViewSnapshot) return
    this.modelViewSnapshot = {
      members: this.members,
      sections: this.sections,
      loads: this.loads,
    }
  }

  /** Re-apply the saved model-mode visibility (member centre lines, solid
   *  sections, loads) and drop the snapshot. Idempotent: without a snapshot it
   *  simply re-applies the current flags, so repeated calls are safe. */
  restoreModelView(){
    const snap = this.modelViewSnapshot
    this.modelViewSnapshot = null
    this.showOrHideMembers(snap ? snap.members : this.members)
    this.showOrHideSections(snap ? snap.sections : this.sections)
    this.showOrHideLoads(snap ? snap.loads : this.loads)
  }

}

export default Visibility