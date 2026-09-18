import * as THREE from 'three';
import { Model } from '../../Model';
import { Node } from '../../../types';

import { Vector3 } from 'three';
import { ElementType } from '../../../types';
import { findNodeAtPosition } from './utils';
import { makeAutoObservable } from "mobx";
import {
  closestProjectedMemberPoint,
  MEMBER_SNAP_RATIOS,
  memberSnapRatioLabel,
} from './structuralSnap';

export type SnappedMemberPoint = Readonly<{
  memberId: number
  ratio: number
  position: THREE.Vector3
}>

type Label = {
  id : string
  position : Vector3
  text : string
  type : 'effort' | 'load' | 'length' | 'angle' | 'arc' | 'gridSnap' | 'endPointSnap'
  rotation? : number
}

class Snapper {
  snap : THREE.Mesh | THREE.Group | null
  enabled : boolean
  onGrid : boolean
  onNode : boolean = true
  snappedCoords : THREE.Vector3 | null
  snappedScreenCoords : THREE.Vector2 | null 
  snappedNode : Node | undefined
  snappedMemberPoint : SnappedMemberPoint | undefined
  model : Model  
  /** Endpoint snap provenance for the viewport interaction adapter (Goal 3):
   *  the snapped node id plus the (possibly plane-projected) position. `exact`
   *  mirrors the 1e-4 on-plane rule — only an exact on-plane node keeps its
   *  identity when a plugin interaction reuses it. */
  snappedEndpoint : { id : number, position : THREE.Vector3, exact : boolean } | undefined
  /** Grid snap position when the current pointer snapped to the grid. */
  snappedGrid : THREE.Vector3 | undefined
  threshold : number = 0.1
  /** Max perpendicular distance (m) a node/point may sit from the active working
   *  plane to still count as "on the plane" — tighter than the endpoint screen
   *  threshold so picking never snaps to a node on another level / axis. */
  planeThreshold : number = 0.5
  set setupEvent(enabled: boolean) {
    if (enabled) {
      this.update()
    }
  }
  constructor(model : Model) {
    this.model = model
    this.onGrid = true
    this.snap = null
    this.snappedCoords = null
    this.snappedScreenCoords = null
    this.snappedNode = undefined
    this.snappedMemberPoint = undefined
    this.enabled = false
    this.setupEvent = true
    makeAutoObservable(this)
  }

  snapToGrid = (pointerCoords: THREE.Vector3, gridSize : number ): THREE.Vector3 => {
    
    const newCoords = new THREE.Vector3().copy(pointerCoords);
    const screenCoords = new THREE.Vector2(pointerCoords.x, pointerCoords.y)
    // Always resolve the pointer against the ACTIVE working plane, never a
    // hard-coded horizontal plane — so drawing on a vertical face (grid axis /
    // elevation) stays ON that face.
    const worldPosition = this.screenToWorld(screenCoords, this.model.camera.cam)

    //declaration of function which calculates new values and returns them
    const getCoordByOriginAndGridSize = (coord: number, gridSize: number): number => {
      // Calculate how many grid units we are from origin
      const gridUnits = coord / gridSize;
      // Round to nearest integer grid unit
      const roundedGridUnits = Math.round(gridUnits);
      // Convert back to coordinate space with high precision
      return roundedGridUnits * gridSize;
    };

    // Snap only the two in-plane axes (the two basis axes of the active plane),
    // then re-project onto the plane so the result can never drift off it
    // (rounding the normal axis is what used to pull points off vertical faces).
    const plane = this.model.worldPlane
    const n = plane.normal
    const absNx = Math.abs(n.x)
    const absNy = Math.abs(n.y)
    const absNz = Math.abs(n.z)

    if (absNy >= absNx && absNy >= absNz) {
      // Horizontal plan (normal ≈ Y): snap X and Z, keep Y = plane elevation.
      newCoords.x = getCoordByOriginAndGridSize(worldPosition.x, gridSize)
      newCoords.z = getCoordByOriginAndGridSize(worldPosition.z, gridSize)
    } else if (absNz >= absNx && absNz >= absNy) {
      // Vertical face Z = const (OXZ): snap X and Y(h) horizontally-vertical.
      newCoords.x = getCoordByOriginAndGridSize(worldPosition.x, gridSize)
      newCoords.y = getCoordByOriginAndGridSize(worldPosition.y, gridSize)
    } else {
      // Vertical face X = const (OYZ): snap Z and Y.
      newCoords.y = getCoordByOriginAndGridSize(worldPosition.y, gridSize)
      newCoords.z = getCoordByOriginAndGridSize(worldPosition.z, gridSize)
    }

    // Clamp back onto the working plane (removes any accumulated drift).
    plane.projectPoint(newCoords, newCoords)

    return newCoords;
  }

  update()
  { 
    this.model.labeler?.deleteOne('gridSnap')
    this.model.labeler?.deleteOne('endPointSnap')
    // if(this.model?.lineTool?.state === 0) return 

    // 3D drawing mode = no user workplane is active (default 'world' OXY plan):
    // the draw tool may ONLY snap to existing nodes — never to the grid or to a
    // free point on the default world plane.
    const threeD = !this.model.hasActiveWorkPlane

    const gridSize = this.model.gridHelper.size
    const gridDivisions = this.model.gridHelper.divisions
    const gridStep = gridSize / gridDivisions
    const snappedGrid = threeD ? null : this.snapToGrid(this.model.pointerCoords, gridStep)
    const {snappedEndPoint, elementId, memberPoint } = this.getClosestEndPoint(threeD)
      || { snappedEndPoint: null, elementId: null, memberPoint: undefined }
    

    this.snappedNode = undefined
    this.snappedMemberPoint = undefined
    this.snappedCoords = null
    this.snappedScreenCoords = null

    this.snappedEndpoint = undefined
    this.snappedGrid = undefined
    if(this.onNode && snappedEndPoint){
      const node = this.model?.nodes?.find((n) => n.id === elementId)
        ?? findNodeAtPosition(this.model.nodes, snappedEndPoint)
      if(node){
        if (threeD) {
          this.snappedCoords = snappedEndPoint.clone()
          this.snappedNode = node
        } else {
          const plane = this.model.worldPlane
          const distance = Math.abs(plane.distanceToPoint(snappedEndPoint))
          if (distance <= this.planeThreshold) {
            this.snappedCoords = plane.projectPoint(snappedEndPoint.clone(), new THREE.Vector3())
            this.snappedNode = distance <= 1e-4 ? node : undefined
          }
        }
      } else if (memberPoint) {
        // This station becomes a real node only when Line commits the split.
        const p = threeD
          ? memberPoint.position.clone()
          : this.model.worldPlane.projectPoint(memberPoint.position, new THREE.Vector3())
        this.snappedCoords = p
        this.snappedMemberPoint = { ...memberPoint, position: p.clone() }
      }

      if (this.snappedCoords) {
        if (this.snappedNode !== undefined) {
          this.snappedEndpoint = { id: this.snappedNode.id, position: this.snappedCoords.clone(), exact: true }
        } else if (node) {
          this.snappedEndpoint = { id: node.id, position: this.snappedCoords.clone(), exact: false }
        }
        this.model?.labeler?.batchUpdateOrCreate([{
          id: 'endPointSnap',
          position: this.snappedCoords,
          text: memberPoint ? memberSnapRatioLabel(memberPoint.ratio) : '',
          type: 'endPointSnap',
        }])
        const projected = this.snappedCoords.clone().project(this.model.camera.cam)
        this.snappedScreenCoords = new THREE.Vector2(projected.x, projected.y)
      }
    }
    else if(!threeD && this.onGrid && snappedGrid){
      this.model?.labeler?.batchUpdateOrCreate([{
        id : 'gridSnap',
        position : snappedGrid,
        text : '',
        type : 'gridSnap'
      }])
      this.snappedCoords = snappedGrid
      this.snappedGrid = snappedGrid.clone()
      const projected = this.snappedCoords.clone().project(this.model.camera.cam)
      this.snappedScreenCoords = new THREE.Vector2(projected.x, projected.y)
    }
    else {
      this.snappedCoords = null
      this.snappedScreenCoords = null
      this.model.labeler?.deleteOne('endPointSnap')
    }
  }

  screenToWorld(screenCoords : THREE.Vector2, camera : THREE.PerspectiveCamera | THREE.OrthographicCamera) {
    const worldPosition = new THREE.Vector3()
    // const plane = new THREE.Plane(new THREE.Vector3(0.0, 1.0, 0.0), )
    const plane = this.model.worldPlane
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(screenCoords, camera)
    raycaster.ray.intersectPlane(plane, worldPosition)
    return worldPosition

  }
  getClosestEndPoint(threeD: boolean = false) {
    if(!this.onNode) return

    // Centerline and thin-shell modes do not expose one raycastable mesh per
    // entity. Resolve the stable node/member IDs through the shared GPU picker
    // instead of waiting for Selector.hovered (which is legacy solid-only).
    if (this.model.renderMode !== 'solid-extrude') {
      // Snapper is constructed before the structural picker during Model
      // bootstrap, and its event setup performs one immediate update.
      if (!this.model.structuralPicker) return

      const pointer = new THREE.Vector2(this.model.pointerCoords.x, this.model.pointerCoords.y)
      const camera = this.model.camera.cam
      const accepts = (position: THREE.Vector3) => threeD || Math.abs(this.model.worldPlane.distanceToPoint(position)) <= this.planeThreshold

      if (this.model.visibility?.nodes) {
        const nodePick = this.model.structuralPicker.pick(pointer.x, pointer.y, camera, 'node')
        if (nodePick) {
          const node = this.model.nodes.find(candidate => candidate.id === nodePick.entityId)
          if (node) {
            const position = new THREE.Vector3(node.x, node.y, node.z)
            if (accepts(position)) return { snappedEndPoint: position, elementId: node.id }
          }
        }
      }

      // A node hit wins. Otherwise choose only an intentional station on the
      // picked member, never an arbitrary point along its projected line.
      const memberPick = this.model.structuralPicker.pick(pointer.x, pointer.y, camera, 'member')
      const member = memberPick ? this.model.members.find(candidate => candidate.id === memberPick.entityId) : undefined
      if (!member) return
      const start = new THREE.Vector3(member.nodes[0].x, member.nodes[0].y, member.nodes[0].z)
      const end = new THREE.Vector3(member.nodes[1].x, member.nodes[1].y, member.nodes[1].z)
      const ratios = this.model.visibility?.nodes ? MEMBER_SNAP_RATIOS : [0, ...MEMBER_SNAP_RATIOS, 1]
      const closest = closestProjectedMemberPoint(pointer, camera, member.id, start, end, this.threshold, ratios)
      if (!closest || !accepts(closest.position)) return
      if (closest.ratio === 0 || closest.ratio === 1) {
        const node = closest.ratio === 0 ? member.nodes[0] : member.nodes[1]
        return { snappedEndPoint: closest.position, elementId: node.id }
      }
      return {
        snappedEndPoint: closest.position,
        elementId: member.id,
        memberPoint: { memberId: member.id, ratio: closest.ratio, position: closest.position },
      }
    }

    const mesh = this.model.selector?.hovered 
    // const lineTool = Line.getInstance()
    if(!mesh) return
    // if(mesh.uuid === lineTool?.mesh?.uuid) return
    
    // Check userData on mesh first, then check parent group if mesh doesn't have it
    let userData = mesh.userData
    if (!userData?.type && mesh.parent instanceof THREE.Group) {
      userData = mesh.parent.userData
    }
    const id = userData?.id
    const type = userData?.type as ElementType
    
    // console.log('GetClosestEndPoint', type)
    // console.log('MESH', mesh)
    const geometry = mesh.geometry
    const attributes = geometry.attributes
    const instanceEnd = attributes.instanceEnd?.array
    const positions = attributes.position; 

    let v1: number[] = [];
    let v2: number[] = [];
    const v3: number[] = [];
    let vertices: number[][] = [];
    switch(type){
      case '3dLine':
        // Guard: non-instanced meshes carry no instanceEnd attribute.
        if(!instanceEnd) break
        v1 = [instanceEnd[0], instanceEnd[1], instanceEnd[2]]   
        v2 = [instanceEnd[3], instanceEnd[4], instanceEnd[5]]
        vertices = [v1 , v2]  
        // console.log('VERTICES', vertices) 
       break;
      case 'elasticBeamColumn':
        // const id = userData?.id
        // console.log('BEAM ID', id)
        const beam = this.model.members.find(el => el.id === id)
        // console.log('SNAPPED BEAM', beam)
        const nodes = beam?.nodes
        if(!nodes) return 
        
        const nodei = nodes[0]
        const nodej = nodes[1]
        v1 = [nodei.x , nodei.y , nodei.z]
        v2 = [nodej.x , nodej.y , nodej.z]
        vertices = [v1 , v2]
        break;
      case 'node' :
        const node = this.model.nodes.find((el) => el.id === id)
        
        if(!node) return

        v1 = [node.x , node.y , node.z] 
        vertices = [v1]
        break;
    }

    const pointer = new THREE.Vector2(this.model.pointerCoords.x, this.model.pointerCoords.y);
        
    let closestVertex = null
    let closestDistance = Infinity
    
    for(const vertex of vertices){
      const v = new THREE.Vector3(vertex[0], vertex[1], vertex[2])
      // Reject vertices off the active working plane so endpoint snaps never
      // jump to a node on another level / axis. In 3D mode (no workplane) every
      // existing node is a valid snap target regardless of its height.
      if (!threeD && Math.abs(this.model.worldPlane.distanceToPoint(v)) > this.planeThreshold) continue
      const vertexProjected = v.clone().project(this.model.camera.cam)
      const vertexOnScreen = new THREE.Vector2(vertexProjected.x, vertexProjected.y)
      const distance = vertexOnScreen.distanceTo(pointer)
      if(distance < closestDistance){
        closestDistance = distance
        closestVertex = v
      }
    }
    if(closestDistance < this.threshold){
      return { snappedEndPoint : closestVertex, elementId : id };
    } 
  }

  disable() {
    this.model.labeler?.deleteOne('gridSnap')
    this.model.labeler?.deleteOne('endPointSnap')
    this.enabled = false
    this.snappedEndpoint = undefined
    this.snappedGrid = undefined
  }

  enable() {
    this.enabled = true
    this.onGrid = true
    this.onNode = true
  }

  toggleOnNode(){
    this.onNode = !this.onNode
  }
  
  toggleOnGrid(){
    this.onGrid = !this.onGrid
  }  
}

export default Snapper;
