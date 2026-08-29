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

const SFAC = 1E-5 // displacement scale the backend applies to SI forces: plot_offset = value_SI * SFAC * localAxis
const FORCE_UNITS: Record<string, string> = { N: 'kN', Vy: 'kN', Vz: 'kN', T: 'kN', My: 'kNm', Mz: 'kNm' }

export type StationPoint = {
  s: number // arc position along the member
  base: THREE.Vector3 // undeformed axis point (three.js coords)
  value: number // scalar used for the active diagram/colouring
  offset: THREE.Vector3 // rendered diagram point
  values: Record<string, number> // all quantities at this station (N..Mz, dX, dY, dZ)
  offsetsByType?: Record<string, THREE.Vector3> // per-force unscaled diagram offset (value * local axis), from the backend
  dispVec?: THREE.Vector3 // real interpolated displacement (three.js axes), for the deflected shape
}

type SolidSave = {
  mesh: THREE.Mesh
  material: THREE.MeshLambertMaterial
  color: number
  hadVertexColors: boolean
  hadOriginalColor: boolean
  originalColor: any
}

export type MemberDiagramData = {
  memberId: number | string
  label: string
  axis: THREE.Vector3
  length: number
  localY: THREE.Vector3 // section local Y axis (three.js coords) -> N/Vy/T/Mz diagram plane
  localZ: THREE.Vector3 // section local Z axis (three.js coords) -> Vz/My diagram plane
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
  private coloredSolids: Map<string, SolidSave[]> = new Map()
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

  /**
   * The backend stores coordinates in OpenSees axes: OS (X, Y, Z) = model (x, z, y)
   * (the vertical model y is OpenSees z). The three.js scene uses the model axes
   * directly -> swap the Y/Z components back here.
   */
  private toThreeCoord(c: number[]) {
    return new THREE.Vector3(c[0], c[2], c[1])
  }

  /**
   * Build per-member station data from the analysis output.
   * Uses the intermediate `stations` provided by the backend when available and falls back
   * to the legacy end-node `node_efforts` (2 points) for older payloads.
   */
  private buildMemberData(member: any): MemberDiagramData | null {
    let points: {
      coord: number[]
      plotPoints: Record<string, number[]>
      values: Record<string, number>
    }[] = []
    if (member.stations?.length) {
      points = member.stations
        .filter((s: any) => s.values && Object.keys(s.values).length > 0)
        .map((s: any) => ({ coord: s.coord, plotPoints: s.plot_points ?? {}, values: { ...s.values } }))
    } else if (member.node_efforts?.length) {
      points = member.node_efforts.map((node: any) => {
        const values: Record<string, number> = {}
        const plotPoints: Record<string, number[]> = {}
        for (const [key, effort] of Object.entries(node.efforts ?? {})) {
          values[key] = (effort as any).value
          // displaced_positions = coord + value * SFAC * localAxis (the backend plot point)
          if ((effort as any).displaced_positions) plotPoints[key] = (effort as any).displaced_positions
        }
        return { coord: node.coord, plotPoints, values }
      })
    }
    if (points.length < 2) return null

    // Sort the stations along the member axis
    const first = this.toThreeCoord(points[0].coord)
    const last = this.toThreeCoord(points[points.length - 1].coord)
    const axis = last.clone().sub(first)
    if (axis.lengthSq() < 1e-12) return null
    axis.normalize()
    points.sort((a, b) => this.toThreeCoord(a.coord).dot(axis) - this.toThreeCoord(b.coord).dot(axis))

    const p0 = this.toThreeCoord(points[0].coord)

    // Section local axes in three.js coords, following the OpenSees element orientation:
    // ylocal = vecxz orthogonalised against the member axis, zlocal = ylocal x xlocal.
    // Used when the backend payload has no per-force plot points (older runs).
    const element = (this.model.members as any[]).find((m: any) => String(m?.id) === String(member.id))
    const vecxz = element?.vecxz as THREE.Vector3 | undefined
    let vPerp: THREE.Vector3 | null = null
    if (vecxz) {
      vPerp = vecxz.clone().addScaledVector(axis, -vecxz.dot(axis))
      if (vPerp.lengthSq() < 1e-8) vPerp = null
      else vPerp.normalize()
    }
    let localY: THREE.Vector3
    let localZ: THREE.Vector3
    if (vPerp) {
      localY = vPerp
      localZ = new THREE.Vector3().crossVectors(vPerp, axis).normalize()
    } else {
      // Fallback: a horizontal perpendicular + the vertical it defines
      localY = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0))
      if (localY.lengthSq() < 1e-8) localY = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(1, 0, 0))
      if (localY.lengthSq() < 1e-8) localY.set(0, 0, 1)
      localY.normalize()
      localZ = new THREE.Vector3().crossVectors(localY, axis).normalize()
    }

    const endDisp = this.getMemberEndDisplacements(member)
    const length = this.toThreeCoord(points[points.length - 1].coord).sub(p0).dot(axis)
    // Diagnostic: which offset source is in use (helps detect stale backend/frontend at runtime)
    const hasPlotPoints = points.some(p => Object.keys(p.plotPoints).length > 0)
    console.info(
      `[Diagrams] member ${member.id}: offset source = ${hasPlotPoints ? 'backend plot_points' : vecxz ? 'vecxz fallback' : 'generic fallback'}, localZ(three) = (${localZ.x.toFixed(2)}, ${localZ.y.toFixed(2)}, ${localZ.z.toFixed(2)})`
    )

    const stations: StationPoint[] = points.map(p => {
      const base = this.toThreeCoord(p.coord)
      // Per-force diagram offsets exactly as the backend computes them:
      // plot_offset = value_SI * SFAC * localAxis, while `values` are stored in kN (value_SI / 1E3)
      // -> normalize to value_kN * localAxis by dividing by (SFAC * 1E3)
      const offsetsByType: Record<string, THREE.Vector3> = {}
      for (const [key, point] of Object.entries(p.plotPoints)) {
        offsetsByType[key] = this.toThreeCoord(point).sub(base).multiplyScalar(1 / (SFAC * 1E3))
      }
      // Real displacement interpolated between the two end nodes (deflected-shape mode)
      let dispVec: THREE.Vector3 | undefined
      if (endDisp) {
        const t = length > 0 ? base.clone().sub(p0).dot(axis) / length : 0
        dispVec = endDisp[0].clone().lerp(endDisp[1], t)
        p.values['dX'] = dispVec.x
        p.values['dY'] = dispVec.y
        p.values['dZ'] = dispVec.z
      } else {
        p.values['dX'] = 0
        p.values['dY'] = 0
        p.values['dZ'] = 0
      }
      return {
        s: base.clone().sub(p0).dot(axis),
        base,
        value: 0,
        offset: base.clone(),
        values: p.values,
        offsetsByType,
        dispVec
      }
    })

    return {
      memberId: member.id,
      label: member.label || `Member ${member.id}`,
      axis,
      length,
      localY,
      localZ,
      stations
    }
  }

  /** Real end-node displacements (three.js axes) of the member, for the deflected-shape mode. */
  private getMemberEndDisplacements(member: any): [THREE.Vector3, THREE.Vector3] | null {
    const element = (this.model.members as any[]).find((m: any) => String(m?.id) === String(member.id))
    const nodes = element?.nodes
    if (!nodes || nodes.length < 2) return null
    const outputNodes = this.model.output?.nodes ?? []
    const result: (THREE.Vector3 | null)[] = []
    for (const node of nodes.slice(0, 2)) {
      const outputNode = outputNodes.find((n: any) => n.id === node.id)
      const d = outputNode?.displacements
      if (!d) {
        result.push(null)
        continue
      }
      // The backend swaps the vertical axis when creating the OpenSees model:
      // OpenSees (X, Y, Z) = model (x, z, y) while three.js = model (x, y, z)
      // -> undo the swap: three disp = (OS ux, OS uz, OS uy)
      result.push(new THREE.Vector3(d.ux ?? 0, d.uz ?? 0, d.uy ?? 0))
    }
    if (!result[0] || !result[1]) return null
    return [result[0] as THREE.Vector3, result[1] as THREE.Vector3]
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
      // Real interpolated displacement, exaggerated by the UI factor
      return station.base.clone().addScaledVector(station.dispVec ?? new THREE.Vector3(), this.deflectionMultiplier)
    }
    // Preferred: the backend plot point per force type (coord + value_SI * SFAC * localAxis)
    const plotOffset = station.offsetsByType?.[type]
    if (plotOffset) {
      return station.base.clone().addScaledVector(plotOffset, scale)
    }
    // Fallback for older payloads: reconstruct value * localAxis from the section axes.
    // Same convention as the backend default_dir: N/Vy/T/Mz act along local Y, Vz/My along local Z.
    const dir = type === 'Vz' || type === 'My' ? data.localZ : data.localY
    return station.base.clone().addScaledVector(dir, station.value * scale)
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
        if (this.showRefLine) this.buildRefLine(data)
      } else {
        if (this.showRibbon) {
          this.buildRibbon(data)
          if (this.showHatch) this.buildHatch(data)
        }
        this.buildBaseline(data)
        this.buildOutline(data)
      }
      if (this.showContour) this.colorMemberSolids(data)
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

  /** Colour the member solid meshes with the per-station colormap (replaces the contour tube). */
  private colorMemberSolids(data: MemberDiagramData) {
    const element = (this.model.members as any[]).find(
      (m: any) => String(m?.id) === String(data.memberId)
    )
    const group = element?.mesh
    if (!group?.traverse) return
    const key = String(data.memberId)
    const saves: SolidSave[] = this.coloredSolids.get(key) ?? []

    group.traverse((child: any) => {
      if (!child.isMesh || !child.geometry?.attributes?.position) return
      const solid = child as THREE.Mesh
      const material = solid.material as THREE.MeshLambertMaterial
      if (!material) return

      if (!saves.some(save => save.mesh === solid)) {
        saves.push({
          mesh: solid,
          material,
          color: material.color.getHex(),
          hadVertexColors: material.vertexColors,
          hadOriginalColor: 'originalColor' in solid.userData,
          originalColor: solid.userData.originalColor
        })
      }

      // Map the local z extent to the station arc position (works for centred or 0-based extrusions)
      const geometry = solid.geometry as THREE.BufferGeometry
      geometry.computeBoundingBox()
      const box = geometry.boundingBox!
      const zSpan = Math.max(box.max.z - box.min.z, 1e-9)
      const length = data.length || 1

      const positions = geometry.attributes.position as THREE.BufferAttribute
      const count = positions.count
      let colors = geometry.attributes.color as THREE.BufferAttribute | undefined
      if (!colors || colors.count !== count) {
        colors = new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3)
        geometry.setAttribute('color', colors)
      }
      const color = new THREE.Color()
      for (let i = 0; i < count; i++) {
        const s = ((positions.getZ(i) - box.min.z) / zSpan) * length
        const value = this.interpolateStationValue(data.stations, s)
        color.copy(this.stationColor(value))
        colors.setXYZ(i, color.r, color.g, color.b)
      }
      colors.needsUpdate = true

      // White base lets the vertex colours show at full intensity
      material.vertexColors = true
      material.color.setHex(0xffffff)
      material.needsUpdate = true
      // Selector restores this colour on hover-out (keeps the colormap correct while active)
      solid.userData.originalColor = 0xffffff
      solid.userData.memberId = data.memberId
      solid.userData.hoverable = true
    })

    this.coloredSolids.set(key, saves)
  }

  /** Restore the member solid materials/geometry changed by colorMemberSolids. */
  private restoreMemberSolids() {
    if (this.coloredSolids.size === 0) return
    for (const saves of this.coloredSolids.values()) {
      for (const save of saves) {
        save.material.vertexColors = save.hadVertexColors
        save.material.color.setHex(save.color)
        save.material.needsUpdate = true
        if (save.hadOriginalColor) save.mesh.userData.originalColor = save.originalColor
        else delete save.mesh.userData.originalColor
        delete save.mesh.userData.hoverable
        delete save.mesh.userData.memberId
      }
    }
    this.coloredSolids.clear()
  }

  /** Linear interpolation of the active value at an arc position along the member. */
  private interpolateStationValue(stations: StationPoint[], s: number): number {
    const n = stations.length
    if (n === 0) return 0
    if (s <= stations[0].s) return stations[0].value
    if (s >= stations[n - 1].s) return stations[n - 1].value
    let lo = 0
    let hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (stations[mid].s <= s) lo = mid
      else hi = mid
    }
    const a = stations[lo]
    const b = stations[hi]
    const t = (s - a.s) / (b.s - a.s || 1)
    return a.value + (b.value - a.value) * t
  }

  /** Max/min tags for a member — pill labels coloured to match the diverging colormap. */
  private collectExtremes(data: MemberDiagramData, type: string) {
    let max = { value: -Infinity, station: null as StationPoint | null }
    let min = { value: Infinity, station: null as StationPoint | null }
    for (const station of data.stations) {
      if (station.value > max.value) max = { value: station.value, station }
      if (station.value < min.value) min = { value: station.value, station }
    }
    // Colours follow the diagram colormap: blue = positive lobe, red = negative lobe
    const POS = '#2f6fed'
    const NEG = '#e5484d'
    const suffix = type === DEFLECTION_TYPE ? 'defl' : type
    if (max.station) {
      const isDefl = type === DEFLECTION_TYPE
      const text = isDefl ? `${fmt(max.value * 1000)} mm` : `${fmt(max.value)} ${this.unit}`
      this.labels.push({
        id: `max-${suffix}-label-${data.memberId}`,
        position: max.station.offset.clone(),
        text,
        type: 'effort',
        backgroundColor: isDefl ? POS : (max.value >= 0 ? POS : NEG)
      })
    }
    if (min.station && min.station !== max.station && type !== DEFLECTION_TYPE) {
      this.labels.push({
        id: `min-${suffix}-label-${data.memberId}`,
        position: min.station.offset.clone(),
        text: `${fmt(min.value)} ${this.unit}`,
        type: 'effort',
        backgroundColor: min.value >= 0 ? POS : NEG
      })
    }
  }

  /** Expose ribbon/contour meshes + station data to the hover tooltip controller. */
  private updateHoverTargets() {
    // Solid meshes currently coloured by the contour mode are hoverable too
    const solidTargets: THREE.Mesh[] = []
    for (const element of this.model.members as any[]) {
      if (!this.coloredSolids.has(String(element?.id))) continue
      element.mesh?.traverse?.((child: any) => {
        if (child.isMesh) solidTargets.push(child as THREE.Mesh)
      })
    }
    this.hoverMeshes = [
      ...this.meshes.filter((mesh: any) => mesh.isMesh && mesh.userData?.hoverable),
      ...solidTargets
    ] as THREE.Mesh[]
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
    this.restoreMemberSolids()
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

