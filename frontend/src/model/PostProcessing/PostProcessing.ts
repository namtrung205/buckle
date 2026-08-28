import { Model } from "../Model"

import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { makeAutoObservable } from 'mobx'
import { valueToColor01 } from './Colormap'
import DiagramHover, { HoverMember } from './DiagramHover'

export const DIAGRAM_TYPES = ['N', 'Vy', 'Vz', 'T', 'My', 'Mz'] as const
export type DiagramType = (typeof DIAGRAM_TYPES)[number]
export const DEFLECTION_TYPE = 'defl'

const SFAC = 1E-5 // displacement scale applied on the backend (s_p = s_0 + SFAC * disp)
const FORCE_UNITS: Record<string, string> = { N: 'kN', Vy: 'kN', Vz: 'kN', T: 'kN', My: 'kNm', Mz: 'kNm' }

export type StationPoint = {
  s: number // arc position along the member
  base: THREE.Vector3 // undeformed axis point (three.js coords)
  displaced: THREE.Vector3 // displaced axis point from the backend (already scaled by SFAC)
  value: number // scalar used for the active diagram/colouring
  offset: THREE.Vector3 // rendered diagram point
  values: Record<string, number> // all quantities at this station (N..Mz, dX, dY, dZ)
}

export type MemberDiagramData = {
  memberId: number | string
  label: string
  axis: THREE.Vector3
  length: number
  offsetDir: THREE.Vector3 // direction perpendicular to the member used to draw force diagrams
  stations: StationPoint[]
}

const fmt = (v: number) => {
  const a = Math.abs(v)
  if (a >= 100) return v.toFixed(0)
  if (a >= 1) return v.toFixed(2)
  if (a >= 0.001) return v.toFixed(4)
  return v.toFixed(6)
}

class PostProcessing {
  model: Model
  meshes: any[] = []
  hover: DiagramHover

  // Observable state consumed by the Results UI (legend, sliders, toggles)
  activeType: string | null = null
  min = 0
  max = 0
  unit = ''
  scaleMultiplier = 1
  deflectionMultiplier = 100
  showRibbon = true
  showHatch = true
  showContour = false
  showLabels = true
  showRefLine = true

  private membersData: MemberDiagramData[] = []
  private hoverMeshes: THREE.Mesh[] = []
  private labels: any[] = []
  private currentMin = 0
  private currentMax = 1
  private modelSize = 10

  constructor(model: Model) {
    this.model = model
    this.hover = new DiagramHover(model)
    makeAutoObservable(this, {
      model: false,
      meshes: false,
      hover: false,
      membersData: false,
      hoverMeshes: false,
      labels: false
    } as any)
  }

  /** Backend coords are [x, y, z] with y vertical; the three.js scene maps them to (x, z, y). */
  private toThreeCoord(c: number[]) {
    return new THREE.Vector3(c[0], c[2], c[1])
  }

  /**
   * Build per-member station data from the analysis output.
   * Uses the intermediate `stations` provided by the backend when available and falls back
   * to the legacy end-node `node_efforts` (2 points) for older payloads.
   */
  private buildMemberData(member: any): MemberDiagramData | null {
    let points: { coord: number[]; displaced: number[]; values: Record<string, number> }[] = []
    if (member.stations?.length) {
      points = member.stations
        .filter((s: any) => s.values && Object.keys(s.values).length > 0)
        .map((s: any) => ({ coord: s.coord, displaced: s.displaced ?? s.coord, values: { ...s.values } }))
    } else if (member.node_efforts?.length) {
      points = member.node_efforts.map((node: any) => {
        const values: Record<string, number> = {}
        let displaced = node.coord
        for (const [key, effort] of Object.entries(node.efforts ?? {})) {
          values[key] = (effort as any).value
          if ((effort as any).displaced_positions) displaced = (effort as any).displaced_positions
        }
        return { coord: node.coord, displaced, values }
      })
    }
    if (points.length < 2) return null

    // Unscaled displacement components (used by hover tooltips & the deflected shape)
    for (const p of points) {
      p.values['dX'] = (p.displaced[0] - p.coord[0]) / SFAC
      p.values['dY'] = (p.displaced[1] - p.coord[1]) / SFAC
      p.values['dZ'] = (p.displaced[2] - p.coord[2]) / SFAC
    }

    // Sort the stations along the member axis
    const first = this.toThreeCoord(points[0].coord)
    const last = this.toThreeCoord(points[points.length - 1].coord)
    const axis = last.clone().sub(first)
    if (axis.lengthSq() < 1e-12) return null
    axis.normalize()
    points.sort((a, b) => this.toThreeCoord(a.coord).dot(axis) - this.toThreeCoord(b.coord).dot(axis))

    const p0 = this.toThreeCoord(points[0].coord)
    const stations: StationPoint[] = points.map(p => {
      const base = this.toThreeCoord(p.coord)
      const displaced = this.toThreeCoord(p.displaced)
      return {
        s: base.clone().sub(p0).dot(axis),
        base,
        displaced,
        value: 0,
        offset: base.clone(),
        values: p.values
      }
    })

    // Force diagrams are drawn perpendicular to the member axis
    const up = new THREE.Vector3(0, 1, 0)
    let offsetDir = new THREE.Vector3().crossVectors(axis, up)
    if (offsetDir.lengthSq() < 1e-8) {
      offsetDir = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(1, 0, 0))
    }
    if (offsetDir.lengthSq() < 1e-8) offsetDir.set(0, 0, 1)
    offsetDir.normalize()

    const length = stations[stations.length - 1].s
    return {
      memberId: member.id,
      label: member.label || `Member ${member.id}`,
      axis,
      length,
      offsetDir,
      stations
    }
  }

  /** Largest extent of the analysed model, used for auto-scaling diagrams. */
  private computeModelSize(): number {
    const box = new THREE.Box3()
    const v = new THREE.Vector3()
    const members = this.model.output?.members ?? []
    for (const member of members) {
      const coords = member.stations?.length
        ? member.stations.map((s: any) => s.coord)
        : (member.node_efforts ?? []).map((n: any) => n.coord)
      for (const c of coords) box.expandByPoint(v.set(c[0], c[1], c[2]))
    }
    if (box.isEmpty()) return 10
    const size = new THREE.Vector3()
    box.getSize(size)
    return Math.max(size.x, size.y, size.z) || 10
  }

  /** Scalar diagram value of a station for the active type. */
  private stationValue(type: string, station: StationPoint): number {
    if (type === DEFLECTION_TYPE) {
      return Math.sqrt(
        station.values['dX'] ** 2 + station.values['dY'] ** 2 + station.values['dZ'] ** 2
      )
    }
    return station.values[type] ?? 0
  }

  /** Position of a station in the rendered diagram. */
  private stationOffset(type: string, data: MemberDiagramData, station: StationPoint, scale: number): THREE.Vector3 {
    if (type === DEFLECTION_TYPE) {
      // Exaggerate the real displacement: displaced = base + SFAC * disp
      return station.base.clone().addScaledVector(
        station.displaced.clone().sub(station.base),
        this.deflectionMultiplier / SFAC
      )
    }
    return station.base.clone().addScaledVector(data.offsetDir, station.value * scale)
  }

  /** Render a force/torsion/moment diagram (N, Vy, Vz, T, My, Mz). */
  showDiagram(type: string, selectedMemberIds: number[] = []) {
    this.render(type, selectedMemberIds)
  }

  /** Render the exaggerated deflected shape, coloured by displacement magnitude. */
  showDeflectedShape(selectedMemberIds: number[] = []) {
    this.render(DEFLECTION_TYPE, selectedMemberIds)
  }

  private render(type: string, selectedMemberIds: number[] = []) {
    this.dispose()

    const output = this.model.output
    if (!output?.members) return

    this.activeType = type
    this.unit = type === DEFLECTION_TYPE ? 'mm' : (FORCE_UNITS[type] ?? '')

    const selected = output.members.filter(
      (member: any) => selectedMemberIds.length === 0 || selectedMemberIds.includes(member.id)
    )
    const membersData: MemberDiagramData[] = []
    for (const member of selected) {
      const data = this.buildMemberData(member)
      if (data) membersData.push(data)
    }
    if (membersData.length === 0) {
      this.updateHoverTargets()
      return
    }

    // Active scalar value per station + global range
    let min = Infinity
    let max = -Infinity
    for (const data of membersData) {
      for (const station of data.stations) {
        station.value = this.stationValue(type, station)
        if (station.value < min) min = station.value
        if (station.value > max) max = station.value
      }
    }
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 0 }
    if (min === max) { min -= 1; max += 1 }
    this.min = type === DEFLECTION_TYPE ? 0 : min
    this.max = max
    this.currentMin = min
    this.currentMax = max

    this.modelSize = this.computeModelSize()
    const maxAbs = Math.max(Math.abs(min), Math.abs(max)) || 1
    // Auto-fit: at multiplier 1 the largest |value| occupies 8% of the model size
    const scale = ((this.modelSize * 0.08) / maxAbs) * this.scaleMultiplier

    for (const data of membersData) {
      for (const station of data.stations) {
        station.offset.copy(this.stationOffset(type, data, station, scale))
      }
      if (type === DEFLECTION_TYPE) {
        this.buildOutline(data)
        if (this.showContour) this.buildContourTube(data)
        if (this.showRefLine) this.buildRefLine(data)
      } else {
        if (this.showRibbon) {
          this.buildRibbon(data)
          if (this.showHatch) this.buildHatch(data)
        }
        if (this.showContour) this.buildContourTube(data)
        this.buildBaseline(data)
        this.buildOutline(data)
      }
      if (this.showLabels) this.collectExtremes(data, type)
    }

    this.membersData = membersData
    this.model.labeler.batchUpdateOrCreate(this.labels)
    this.updateHoverTargets()
  }

  /** Color of a station for the active range (zero-centered diverging colormap). */
  stationColor(value: number): THREE.Color {
    return valueToColor01(value, this.currentMin, this.currentMax)
  }

  private addHoverable(mesh: THREE.Mesh, memberId: number | string) {
    mesh.userData.type = 'diagram'
    mesh.userData.memberId = memberId
    mesh.userData.hoverable = true
  }

  /** Filled area between the member axis and the diagram curve, coloured per-vertex. */
  private buildRibbon(data: MemberDiagramData) {
    const stations = data.stations
    const vertices: number[] = []
    const colors: number[] = []
    const indices: number[] = []
    const color = new THREE.Color()

    for (const station of stations) {
      vertices.push(station.base.x, station.base.y, station.base.z)
      color.copy(this.stationColor(station.value))
      colors.push(color.r, color.g, color.b)
    }
    for (const station of stations) {
      vertices.push(station.offset.x, station.offset.y, station.offset.z)
      color.copy(this.stationColor(station.value))
      colors.push(color.r, color.g, color.b)
    }
    const n = stations.length
    for (let i = 0; i < n - 1; i++) {
      const b1 = i, b2 = i + 1, t1 = n + i, t2 = n + i + 1
      indices.push(b1, t1, b2, b2, t1, t2)
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      opacity: 0.85,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.renderOrder = 10
    this.addHoverable(mesh, data.memberId)
    this.model.scene.add(mesh)
    this.meshes.push(mesh)
  }

  /** Thin hatching lines between the axis and the diagram curve. */
  private buildHatch(data: MemberDiagramData) {
    const positions: number[] = []
    const stations = data.stations
    const step = Math.max(1, Math.round(stations.length / 40))
    for (let i = 0; i < stations.length; i += step) {
      const { base, offset } = stations[i]
      positions.push(base.x, base.y, base.z, offset.x, offset.y, offset.z)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    const material = new THREE.LineBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.5 })
    const lines = new THREE.LineSegments(geometry, material)
    lines.userData.type = 'diagram'
    this.model.scene.add(lines)
    this.meshes.push(lines)
  }

  /** Straight reference line along the undeformed member axis. */
  private buildBaseline(data: MemberDiagramData) {
    const points = data.stations.map(s => s.base)
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const material = new THREE.LineBasicMaterial({ color: 0x333333 })
    const line = new THREE.Line(geometry, material)
    line.userData.type = 'diagram'
    this.model.scene.add(line)
    this.meshes.push(line)
  }

  /** Dashed reference line for the deflected shape mode. */
  private buildRefLine(data: MemberDiagramData) {
    const points = data.stations.map(s => s.base)
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const dashSize = this.modelSize * 0.02
    const material = new THREE.LineDashedMaterial({
      color: 0x888888,
      dashSize,
      gapSize: dashSize * 0.6
    })
    const line = new THREE.Line(geometry, material)
    line.computeLineDistances()
    line.userData.type = 'diagram'
    this.model.scene.add(line)
    this.meshes.push(line)
  }

  /** Black diagram curve on top of the filled area (smoothed like the sample). */
  private buildOutline(data: MemberDiagramData) {
    const stations = data.stations
    const curve = new THREE.CatmullRomCurve3(stations.map(s => s.offset))
    const curvePoints = curve.getPoints(stations.length * 3)
    const points = curvePoints.flatMap(p => [p.x, p.y, p.z])
    const lineGeometry = new LineGeometry().setPositions(points)
    const lineMaterial = new LineMaterial({
      color: 0x000000,
      linewidth: 2,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
    })
    const line = new Line2(lineGeometry, lineMaterial)
    line.renderOrder = 1000
    line.userData.type = 'diagram'
    this.model.scene.add(line)
    this.meshes.push(line)
  }

  /** Contour tube around the member axis, vertex-coloured by the active value. */
  private buildContourTube(data: MemberDiagramData) {
    const stations = data.stations
    const segments = 8
    const positions: number[] = []
    const colors: number[] = []
    const indices: number[] = []
    const color = new THREE.Color()

    // Orthonormal basis perpendicular to the member axis
    const u = new THREE.Vector3().crossVectors(data.axis, new THREE.Vector3(0, 1, 0))
    if (u.lengthSq() < 1e-8) u.crossVectors(data.axis, new THREE.Vector3(1, 0, 0))
    if (u.lengthSq() < 1e-8) u.set(0, 0, 1)
    u.normalize()
    const v = new THREE.Vector3().crossVectors(data.axis, u).normalize()

    const radius = this.modelSize * 0.012
    for (const station of stations) {
      for (let j = 0; j < segments; j++) {
        const angle = (j / segments) * Math.PI * 2
        const point = station.base.clone()
          .addScaledVector(u, Math.cos(angle) * radius)
          .addScaledVector(v, Math.sin(angle) * radius)
        positions.push(point.x, point.y, point.z)
        color.copy(this.stationColor(station.value))
        colors.push(color.r, color.g, color.b)
      }
    }
    const ringCount = stations.length
    for (let i = 0; i < ringCount - 1; i++) {
      for (let j = 0; j < segments; j++) {
        const j2 = (j + 1) % segments
        const a = i * segments + j
        const b = i * segments + j2
        const c = (i + 1) * segments + j
        const d = (i + 1) * segments + j2
        indices.push(a, c, b, b, c, d)
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.renderOrder = 20
    this.addHoverable(mesh, data.memberId)
    this.model.scene.add(mesh)
    this.meshes.push(mesh)
  }

  /** Create max/min effort labels for a member (kept from the previous behaviour). */
  private collectExtremes(data: MemberDiagramData, type: string) {
    let max = { value: -Infinity, station: null as StationPoint | null }
    let min = { value: Infinity, station: null as StationPoint | null }
    for (const station of data.stations) {
      if (station.value > max.value) max = { value: station.value, station }
      if (station.value < min.value) min = { value: station.value, station }
    }
    const suffix = type === DEFLECTION_TYPE ? 'defl' : type
    if (max.station) {
      const isDefl = type === DEFLECTION_TYPE
      const text = isDefl ? `${fmt(max.value * 1000)} mm` : `${fmt(max.value)} ${this.unit}`
      this.labels.push({
        id: `max-${suffix}-label-${data.memberId}`,
        position: max.station.offset.clone(),
        text,
        type: 'effort',
        backgroundColor: isDefl ? '#90EE90' : (max.value >= 0 ? '#90EE90' : '#FFB6C1')
      })
    }
    if (min.station && min.station !== max.station && type !== DEFLECTION_TYPE) {
      this.labels.push({
        id: `min-${suffix}-label-${data.memberId}`,
        position: min.station.offset.clone(),
        text: `${fmt(min.value)} ${this.unit}`,
        type: 'effort',
        backgroundColor: min.value >= 0 ? '#90EE90' : '#FFB6C1'
      })
    }
  }

  /** Expose ribbon/contour meshes + station data to the hover tooltip controller. */
  private updateHoverTargets() {
    this.hoverMeshes = this.meshes.filter(
      (mesh: any) => mesh.isMesh && mesh.userData?.hoverable
    ) as THREE.Mesh[]
    const hoverMembers: HoverMember[] = this.membersData.map(data => ({
      memberId: data.memberId,
      label: data.label,
      stations: data.stations.map(station => ({
        s: station.s,
        base: station.base,
        offset: station.offset,
        values: station.values
      }))
    }))
    const markerRadius = this.modelSize * 0.008
    this.hover.setTargets(this.hoverMeshes, hoverMembers, this.activeType, markerRadius)
  }

  dispose() {
    this.meshes.forEach(mesh => {
      mesh.geometry?.dispose()
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material: THREE.Material) => material.dispose())
      } else {
        mesh.material?.dispose()
      }
      this.model.scene.remove(mesh)
    })

    this.meshes = []
    this.membersData = []
    this.hoverMeshes = []
    this.labels = []
    this.hover.clearTargets()
    this.activeType = null
    this.min = 0
    this.max = 0
    this.removeLabels()
  }

  removeLabels() {
    this.model.labeler.deleteAll('effort')
  }
}

export default PostProcessing

