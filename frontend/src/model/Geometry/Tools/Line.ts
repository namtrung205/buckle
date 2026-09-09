import { Model } from '../../Model';
import * as THREE from 'three';
import { Tool } from './types';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import ElasticBeamColumn from '../../Elements/ElasticBeamColumn/ElasticBeamColumn'
import Node from '../../Elements/Node/Node';
import { ElementType, Line3D, mockSections, Section } from '../../../types';
import { Vector3 } from 'three';
import { makeAutoObservable } from 'mobx';
import { findNodeAtPosition } from '../Helpers/utils';
import type { SnappedMemberPoint } from '../Helpers/Snapper';
import type { StructuralCommandOperation } from '../../../core/structural/commands';
type Label = {
  id : string
  position : Vector3
  text : string
  type? : 'effort' | 'load' | 'length' | 'angle' | 'arc' | 'prompt'
  rotation? : number
}

export default class Line implements Tool {
  private static instance: Line | null = null;

  enabled = true
  state : number = 0;
  inputMode: "point" | "lengthAndAngle" = 'point'
  inputState: 'length' | 'angle' = 'length';
  uuid : string = 'Line3D'
  mesh : Line2 | THREE.Mesh | null = null;
  model : Model = Model.getInstance()
  currentPointerCoord : THREE.Vector3;
  onOrthoMode : boolean;
  type : ElementType = '3dLine';
  startPoint: Node = new Node( new THREE.Vector3(0,0,0,) );
  endPoint: Node = new Node( new THREE.Vector3(0,0,0,) );
  angle  = '' ;
  length = ''
  positions: Array<number> = []
  section : Section
  colLength : number = 4
  private previousSelectionMode: 'node' | 'element1d' | 'shell2d' | null = null
  private startMemberSnap: SnappedMemberPoint | undefined
  private endMemberSnap: SnappedMemberPoint | undefined

  static getInstance(): Line {
    if (Line.instance === null) {
      Line.instance = new Line();
    }
    return Line.instance;
  }

  set setupEvent(enabled: boolean) {
    this.model.canvas.addEventListener('mousemove', this.onMouseMove);
    this.model.canvas.addEventListener('click', this.onDrawClick);
    this.model.canvas.addEventListener('contextmenu', this.onRightClick);
    window.addEventListener('keydown', this.onKey);
  }

  private constructor()
  {
    this.currentPointerCoord = new THREE.Vector3();
    this.onOrthoMode = false;
    this.setupEvent = true
    this.section = this.model.sections[0]
    makeAutoObservable(this)
  }

  private onMouseMove = (e: MouseEvent) => {
    // 3D mode (no active workplane): there is no plane to raycast onto — the
    // pointer position comes from the snapper's node snap instead. Without a
    // snapped node there is NO valid position, so the preview keeps tracking
    // the last snapped node instead of jumping to a phantom plane point.
    if (!this.model.hasActiveWorkPlane) {
      const snap = this.model.snapper.snappedCoords
      if (!snap) return
      this.currentPointerCoord = snap.clone()
      if (this.state === 2 || this.state === 3) {
        this.update(this.endPoint, new Node(this.currentPointerCoord))
      }
      return
    }

    const mouseLoc = this.getMouseLocation(e,this.model.canvas, this.model.worldPlane, this.model.camera.cam);
    this.currentPointerCoord = mouseLoc;
    if (this.state === 1) {
      this.currentPointerCoord = mouseLoc;
    }

    if (this.state === 2 ||  this.state === 3) {

      this.update(this.endPoint, new Node(this.currentPointerCoord))
    }
  }

  private onDrawClick = () => {
    if(this.state === 0) return
    const snappedCoords =  this.model.snapper.snappedCoords
    const snappedNode = this.model.snapper.snappedNode
    const snappedMemberPoint = this.model.snapper.snappedMemberPoint
    // 3D mode (no active workplane): EVERY member endpoint must be an existing
    // node — free points on the world grid / plane never create members here.
    const threeD = !this.model.hasActiveWorkPlane

    const nodeId = snappedNode?.id
    if (this.state === 1) {
      if (threeD) {
        // 3D mode: the stroke can only start from an existing node, at the
        // node's true 3D position, or from a special station on a member.
        if (!snappedNode && !snappedMemberPoint) return
        const position = snappedNode
          ? new THREE.Vector3(snappedNode.x, snappedNode.y, snappedNode.z)
          : snappedMemberPoint!.position.clone()
        this.startPoint = new Node(position)
        if (snappedNode) this.startPoint.id = snappedNode.id
      }
      else if(snappedCoords){
        this.startPoint = new Node(this.clampToPlane(snappedCoords))

        if(snappedNode) this.startPoint.id = snappedNode.id
      }
      else{
        this.startPoint =  new Node(this.clampToPlane(this.currentPointerCoord))
      } 

      this.startMemberSnap = snappedMemberPoint
        ? { ...snappedMemberPoint, position: snappedMemberPoint.position.clone() }
        : undefined

      // Reuse an existing node located at the same coordinates so members stay
      // structurally connected even when the node snap was missed
      const existingStart = findNodeAtPosition(this.model.nodes, new THREE.Vector3(this.startPoint.x, this.startPoint.y, this.startPoint.z))
      if(existingStart) {
        this.startPoint.id = existingStart.id
        this.startMemberSnap = undefined
      }

      if(this.type === 'colDown' || this.type === 'colUp'){
        this.create()
        return
      }

      this.endPoint = new Node(
        new THREE.Vector3(this.startPoint.x , this.startPoint.y , this.startPoint.z) 
      )

      if(snappedNode) this.endPoint.id = snappedNode.id

      this.state = 2 
    }
    else if (this.state === 2) {
      
      if (threeD) {
        if (!snappedNode && !snappedMemberPoint) return
        const position = snappedNode
          ? new THREE.Vector3(snappedNode.x, snappedNode.y, snappedNode.z)
          : snappedMemberPoint!.position.clone()
        this.endPoint = new Node(position)
        if (snappedNode) this.endPoint.id = snappedNode.id
      }
      else if(snappedNode){
        this.endPoint = new Node(this.clampToPlane(new THREE.Vector3(snappedNode.x, snappedNode.y, snappedNode.z)))
        this.endPoint.id = snappedNode.id
      }else{
        const point = this.clampToPlane(new THREE.Vector3(this.positions[3], this.positions[4], this.positions[5]))
        this.endPoint = new Node(point)
        // Reuse an existing node at the same coordinates (missed snap) so the
        // new member shares that node instead of a disconnected duplicate
        const existingEnd = findNodeAtPosition(this.model.nodes, point)
        if(existingEnd) this.endPoint.id = existingEnd.id
      }

      this.endMemberSnap = snappedMemberPoint
        ? { ...snappedMemberPoint, position: snappedMemberPoint.position.clone() }
        : undefined
      const existingEnd = findNodeAtPosition(this.model.nodes, new THREE.Vector3(this.endPoint.x, this.endPoint.y, this.endPoint.z))
      if (existingEnd) {
        this.endPoint.id = existingEnd.id
        this.endMemberSnap = undefined
      }
      this.create()
      this.state = 3
    }
    else if(this.state === 3)
    {
      this.startPoint = this.endPoint
      this.startMemberSnap = undefined
      if (threeD) {
        if (!snappedNode && !snappedMemberPoint) return
        const position = snappedNode
          ? new THREE.Vector3(snappedNode.x, snappedNode.y, snappedNode.z)
          : snappedMemberPoint!.position.clone()
        this.endPoint = new Node(position)
        if (snappedNode) this.endPoint.id = snappedNode.id
      }
      else if(snappedNode){
        this.endPoint = new Node(this.clampToPlane(new THREE.Vector3(snappedNode.x, snappedNode.y, snappedNode.z)))
        this.endPoint.id = snappedNode.id
      }else{
        const point = this.clampToPlane(new THREE.Vector3(this.positions[3], this.positions[4], this.positions[5]))
        this.endPoint = new Node(point)
        // Reuse an existing node at the same coordinates (missed snap)
        const existingEnd = findNodeAtPosition(this.model.nodes, point)
        if(existingEnd) this.endPoint.id = existingEnd.id
      }
      this.endMemberSnap = snappedMemberPoint
        ? { ...snappedMemberPoint, position: snappedMemberPoint.position.clone() }
        : undefined
      const existingEnd = findNodeAtPosition(this.model.nodes, new THREE.Vector3(this.endPoint.x, this.endPoint.y, this.endPoint.z))
      if (existingEnd) {
        this.endPoint.id = existingEnd.id
        this.endMemberSnap = undefined
      }
      this.create()
    }
  };
  
  private onKey = (event: KeyboardEvent) => { 
    if (event.key === 'Escape') {
      event.preventDefault();
      this.stop()
      this.delete()
      // this.dispose()
    } 
  };

  private onRightClick = (e: MouseEvent) => {
    if(this.state === 0) return
    e.preventDefault(); 
    this.delete()
    this.state = 1;
  };

  start = () => {
    if (this.model.isLocked) return;
    if(this.state === 0) {
      // Drawing endpoints is a node-picking workflow in every render backend.
      // Temporarily use Node select mode so the selector and snapper share the
      // same GPU node-pick pass, then restore the user's mode on Stop/Escape.
      this.previousSelectionMode = this.model.selectionMode
      this.model.setSelectionMode('node')
      this.state = 1
      // this.type = type
      this.model.canvas.style.cursor = 'crosshair'
      this.model.snapper.enable()
      this.model.console.create({
        id: '',
        message: 'Select the first point',
        type: 'INFO',
        timestamp: new Date()
      })

      return
    }
    const positions = [
      this.startPoint.x, 
      this.startPoint.y, 
      this.startPoint.z, 
      this.endPoint.x, 
      this.endPoint.y, 
      this.endPoint.z
    ]
    
    let geometry : LineGeometry | THREE.BoxGeometry
    let material : LineMaterial | THREE.MeshBasicMaterial
    geometry = new LineGeometry();
    geometry.setPositions(positions);
    material = new LineMaterial({
      color: 0x0000ff,
      linewidth: 5, // in pixels
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
    });
    this.mesh = new Line2(geometry, material);
    this.mesh.userData.type = this.type;
    this.model.scene.add(this.mesh);
  };
  
  create(layer : number = this.model.layer)
  {

    
    const vecz = new THREE.Vector3(0, 0, 1)
   
    const type = this.type
    const nodeIds = this.model.nodes.map((node) => node.id)
    switch(type) 
    {
      case 'elasticBeamColumn':
        if(this.state === 2 || this.state === 3) this.createElasticMember()
        break;
      case 'colUp':
      case 'colDown':
        const nodei = this.startPoint
        const colLength = this.type === 'colDown' ? -this.colLength : this.colLength 
        const position = new THREE.Vector3(this.startPoint.x , this.startPoint.y + colLength , this.startPoint.z) 
        let nodej: Node | null
        nodej = findNodeAtPosition(this.model.nodes, position , 0.01)
        if(!nodej){
          nodej = new Node(
            new THREE.Vector3(this.startPoint.x , this.startPoint.y + colLength , this.startPoint.z) 
          )
        }

        const createNodes = [nodei, nodej]
          .filter(node => !nodeIds.includes(node.id))
          .map(node => ({ id: node.id, name: node.name, position: [node.x, node.z, node.y] as const }))
        this.model.executeCommand({
          commandId: crypto.randomUUID(), type: 'Transaction', schemaVersion: '1.0',
          modelRevision: this.model.structuralDocument.revision, source: 'ui',
          payload: { operations: [
            ...(createNodes.length ? [{ type: 'CreateNodes' as const, payload: { nodes: createNodes } }] : []),
            { type: 'CreateMembers', payload: { members: [{
              nodeI: nodei.id, nodeJ: nodej.id, sectionId: this.section.id,
            }] } },
          ] },
        })
        break
      default:
        // mesh.layers.set(layer)
        break;
    }   
  }

  /** Split every internally snapped source member and create the drawn member
   * in one command. The original member ID is retained for its I-side segment;
   * that keeps document references stable and makes one Undo restore all edits. */
  private createElasticMember() {
    const nodei = this.startPoint
    const nodej = this.endPoint
    const startPosition = new THREE.Vector3(nodei.x, nodei.y, nodei.z)
    const endPosition = new THREE.Vector3(nodej.x, nodej.y, nodej.z)
    if (nodei.id === nodej.id || startPosition.distanceTo(endPosition) < 1e-9) return

    const requests = [
      this.startMemberSnap ? { snap: this.startMemberSnap, node: nodei } : null,
      this.endMemberSnap ? { snap: this.endMemberSnap, node: nodej } : null,
    ].filter((value): value is { snap: SnappedMemberPoint; node: Node } => value !== null)

    // Two clicks on the same station must resolve to one structural node.
    const stationNodes = new Map<string, Node>()
    for (const request of requests) {
      const key = `${request.snap.memberId}:${request.snap.ratio}`
      const existing = stationNodes.get(key)
      if (existing) request.node.id = existing.id
      else stationNodes.set(key, request.node)
    }
    if (nodei.id === nodej.id) return

    const knownNodeIds = new Set(this.model.nodes.map(node => node.id))
    const nodesToCreate = new Map<number, Node>()
    for (const node of [nodei, nodej]) {
      if (!knownNodeIds.has(node.id)) nodesToCreate.set(node.id, node)
    }

    const grouped = new Map<number, { ratio: number; node: Node }[]>()
    for (const request of requests) {
      const points = grouped.get(request.snap.memberId) ?? []
      if (!points.some(point => Math.abs(point.ratio - request.snap.ratio) < 1e-9)) {
        points.push({ ratio: request.snap.ratio, node: request.node })
      }
      grouped.set(request.snap.memberId, points)
    }

    const updates: Extract<StructuralCommandOperation, { type: 'UpdateMembers' }>['payload']['members'][number][] = []
    const replacementMembers: Extract<StructuralCommandOperation, { type: 'CreateMembers' }>['payload']['members'][number][] = []
    const replacementEdges = new Set<string>()
    const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`

    for (const [memberId, points] of grouped) {
      const record = this.model.structuralDocument.members.get(memberId)
      if (!record) return
      points.sort((a, b) => a.ratio - b.ratio)
      updates.push({ id: memberId, patch: { nodeJ: points[0].node.id } })
      replacementEdges.add(edgeKey(record.nodeI, points[0].node.id))

      const { id: _id, nodeI: _nodeI, nodeJ: _nodeJ, ...properties } = record
      for (let index = 0; index < points.length; index++) {
        const from = points[index].node.id
        const to = points[index + 1]?.node.id ?? record.nodeJ
        replacementMembers.push({ ...properties, nodeI: from, nodeJ: to })
        replacementEdges.add(edgeKey(from, to))
      }
    }

    const operations: StructuralCommandOperation[] = []
    if (nodesToCreate.size) operations.push({
      type: 'CreateNodes',
      payload: { nodes: [...nodesToCreate.values()].map(node => ({
        id: node.id,
        ...(node.name ? { name: node.name } : {}),
        position: [node.x, node.z, node.y] as const,
      })) },
    })
    if (updates.length) operations.push({ type: 'UpdateMembers', payload: { members: updates } })

    // If both picked points lie on the same source member, splitting may have
    // already produced the requested edge. Do not create an overlapping member.
    if (!replacementEdges.has(edgeKey(nodei.id, nodej.id))) {
      replacementMembers.push({ nodeI: nodei.id, nodeJ: nodej.id, sectionId: this.section.id })
    }
    if (replacementMembers.length) operations.push({ type: 'CreateMembers', payload: { members: replacementMembers } })
    if (!operations.length) return

    this.model.executeCommand({
      commandId: crypto.randomUUID(), type: 'Transaction', schemaVersion: '1.0',
      modelRevision: this.model.structuralDocument.revision, source: 'ui',
      payload: { operations },
    })
    this.startMemberSnap = undefined
    this.endMemberSnap = undefined
  }

  update(startPoint: Node, endPoint: Node)
  {
    if (!this.mesh) this.start()
    const type = this.type
    const positions = [startPoint.x, startPoint.y, startPoint.z, endPoint.x, endPoint.y, endPoint.z]
    
    if (this.onOrthoMode && this.state >= 2) {
      const orthoEndPoint = this.getOrthogonalProjection(startPoint, endPoint)
      positions[3] = orthoEndPoint.x
      positions[4] = orthoEndPoint.y
      positions[5] = orthoEndPoint.z
      endPoint = new Node(orthoEndPoint)
    }
  
    if((this.model.snapper.onGrid || this.model.snapper.onNode) && this.model.snapper.snappedCoords)
    {
      const snappedCoords = this.model.snapper.snappedCoords
      positions[3] = snappedCoords.x
      positions[4] = snappedCoords.y
      positions[5] = snappedCoords.z
    }

    this.positions = positions
    if(this.mesh instanceof Line2) {
      this.mesh.geometry.setPositions(positions)
      this.mesh.computeLineDistances();
      this.mesh.layers.set(this.model.layer)
      this.mesh.material.resolution.set(window.innerWidth, window.innerHeight);
    }
    
    const start = new THREE.Vector3(this.positions[0], this.positions[1], this.positions[2])
    const end = new THREE.Vector3(this.positions[3], this.positions[4], this.positions[5])
    const midPoint = this.getMidPoint(start, end)
    const length = start.distanceTo(end)
    
    // Calculate label angle using atan2 for proper quadrant handling
    const dx = end.x - start.x
    const dz = end.z - start.z
    let labelAngle = Math.atan2(dz, dx) * 180 / Math.PI
    
    if (labelAngle > 90) {
      labelAngle -= 180;
    } else if (labelAngle < -90) {
      labelAngle += 180;
    }

    const labels : Label[] = [
      {
        id: 'Line3D',
        text: `${length.toFixed(2)}`,
        position: midPoint,
        rotation: labelAngle,
        type:'length'
      }, 
    ]
    this.model.labeler.batchUpdateOrCreate(labels)
  }

  delete()
  {
    if(!this.mesh) return 
    this.model.scene.remove(this.mesh!)
    this.mesh.geometry.dispose();
    this.model.labeler.batchDelete(['Line3D'])
    this.mesh = null
  }

  /**
   * Project a picked point onto the active working plane and return a fresh
   * vector. Guarantees every member endpoint lies ON the plane, so drawing
   * never creates a member whose node sits on another level / axis.
   *
   * Uses Plane.projectPoint (respects the plane's `constant`/offset) — NOT
   * Vector3.projectOnPlane, which projects onto the parallel plane THROUGH THE
   * ORIGIN and silently moves every point to e.g. elevation 0 on offset plans.
   */
  clampToPlane = (p: THREE.Vector3): THREE.Vector3 =>
    this.model.worldPlane.projectPoint(p, new THREE.Vector3())

  getMouseLocation (
    event : MouseEvent,  
    canvas : HTMLCanvasElement, 
    plane: THREE.Plane, 
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera) {
      const rect = canvas.getBoundingClientRect();
      const _vec2 = new THREE.Vector2();
      const _vec3 = new THREE.Vector3();
      const raycaster = new THREE.Raycaster();
      _vec2.x = (( ( event.clientX - rect.left ) / ( rect.right - rect.left ) ) * 2 - 1);
      _vec2.y =  -( ( event.clientY - rect.top ) / ( rect.bottom - rect.top) ) * 2 + 1;
      raycaster.setFromCamera(_vec2, camera);
  
      raycaster.ray.intersectPlane(plane, _vec3);
      return _vec3
  }

  enableOrthoMode = () => {
    this.onOrthoMode = true;
  }

  disableOrthoMode = () => {
    this.onOrthoMode = false;
  }

  toogleOrthomode = () => {
    this.onOrthoMode = !this.onOrthoMode
  }
  
  dispose = () => {
    this.model.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.model.canvas.removeEventListener('click', this.onDrawClick);
    this.model.canvas.removeEventListener('contextmenu', this.onRightClick);
    window.removeEventListener('keydown', this.onKey);
  }

  setSection(id : number){
    const section = this.model.sections.find((section) => section?.id === id)
    if(!section) return

    this.section = section
  }
  stop() {
    this.state = 0
    this.startMemberSnap = undefined
    this.endMemberSnap = undefined
    this.model.canvas.style.cursor = 'default'
    this.model.snapper.disable()
    if (this.previousSelectionMode) {
      const mode = this.previousSelectionMode
      this.previousSelectionMode = null
      this.model.setSelectionMode(mode)
    }
  }
  // HELPER FUNCTIONS
  // https://github.com/Immugio/three-math-extensions

  getMidPoint = (startPoint: THREE.Vector3, endPoint: THREE.Vector3) => {
    const midPoint = new THREE.Vector3()
    midPoint.x = (startPoint.x + endPoint.x) / 2
    midPoint.y = (startPoint.y + endPoint.y) / 2
    midPoint.z = (startPoint.z + endPoint.z) / 2
    return midPoint
  }

  getOrthogonalProjection = (startPoint: Node, endPoint: Node): THREE.Vector3 => {
    const dx = endPoint.x - startPoint.x
    const dy = endPoint.y - startPoint.y
    const dz = endPoint.z - startPoint.z
    const line = new THREE.Vector3(dx, startPoint.y, dz)
    let vecx = new THREE.Vector3(1, 0, 0)
    let angle_rad_vecx_line : number
    let angle_deg_vecx_line : number
    if((dx < 0 && dz > 0) || (dx < 0 && dz < 0) )  vecx = new THREE.Vector3(-1, 0, 0)
    
    angle_rad_vecx_line = Math.acos(line.dot(vecx) / line.length())
    angle_deg_vecx_line = 180 * angle_rad_vecx_line / Math.PI

    if(angle_deg_vecx_line <= 45) return new THREE.Vector3(endPoint.x, startPoint.y, startPoint.z)
    else return new THREE.Vector3(startPoint.x, startPoint.y, endPoint.z)

  }

  getAxisAngle = (axis: THREE.Vector3) => {
    const position = this.mesh!.geometry.attributes.position.array
    const startPoint = new THREE.Vector3(position[0], position[1], position[2])
    const endPoint = new THREE.Vector3(position[3], position[4], position[5])

    // console.log('startPoint', startPoint)
    // console.log('endPoint', endPoint)
    const vectorLine = new THREE.Vector3
    (
      endPoint.x - startPoint.x, 
      endPoint.y - startPoint.y, 
      endPoint.z - startPoint.z
    )
    const direction = vectorLine.clone().normalize()

    const dotProduct = axis.dot(direction)
    const lineLength = vectorLine.length()
    const cosAngle = dotProduct / direction.length()
    const angleRad = Math.acos(cosAngle)
    const angleDeg = angleRad * 180 / Math.PI

    return angleDeg
  }

  setType = (type: ElementType): void => {
    this.type = type
  }
  setColLength = (length: number) => {
    this.colLength = length
  }
}
