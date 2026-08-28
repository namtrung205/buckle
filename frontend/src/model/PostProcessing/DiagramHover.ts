import * as THREE from 'three'
import { Model } from '../Model'

export type HoverStation = {
  s: number // arc position along the member (model length units)
  base: THREE.Vector3 // point on the undeformed member axis (three.js coords)
  offset: THREE.Vector3 // diagram point (base + scaled value offset)
  values: Record<string, number> // all values at this station (N, Vy, Vz, T, My, Mz, dX, dY, dZ)
}

export type HoverMember = {
  memberId: number | string
  label: string
  stations: HoverStation[]
}

const FORCE_LABELS: { key: string; label: string; unit?: string; scale?: number }[] = [
  { key: 'N', label: 'N', unit: 'kN' },
  { key: 'Vy', label: 'Vy', unit: 'kN' },
  { key: 'Vz', label: 'Vz', unit: 'kN' },
  { key: 'T', label: 'T', unit: 'kN' },
  { key: 'My', label: 'My', unit: 'kNm' },
  { key: 'Mz', label: 'Mz', unit: 'kNm' },
  { key: 'dX', label: 'Δx', unit: 'mm', scale: 1000 },
  { key: 'dY', label: 'Δy', unit: 'mm', scale: 1000 },
  { key: 'dZ', label: 'Δz', unit: 'mm', scale: 1000 },
]

const fmt = (v: number) => {
  const a = Math.abs(v)
  if (a >= 100) return v.toFixed(0)
  if (a >= 1) return v.toFixed(2)
  if (a >= 0.001) return v.toFixed(4)
  return v.toFixed(6)
}

/**
 * Hover controller for result diagrams (ported behaviour from "Sample Visualize result.html"):
 * raycasts the pointer against the diagram meshes, finds the closest station on the hovered
 * member and shows a tooltip with all internal force / displacement values at that station.
 */
class DiagramHover {
  model: Model
  enabled = false
  private targets: THREE.Mesh[] = []
  private members: HoverMember[] = []
  private activeType: string | null = null
  private tooltip: HTMLDivElement | null = null
  private marker: THREE.Mesh | null = null
  private rayCaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()

  constructor(model: Model) {
    this.model = model
    this.model.renderer.domElement.addEventListener('pointermove', this.onPointerMove)
    this.model.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave)
  }

  /** Provide the hoverable meshes + per-member station data for tooltip lookup. */
  setTargets(targets: THREE.Mesh[], members: HoverMember[], activeType: string | null, markerRadius: number) {
    this.targets = targets
    this.members = members
    this.activeType = activeType
    this.enabled = targets.length > 0
    if (!this.enabled) {
      this.hide()
      return
    }
    this.ensureMarker(markerRadius)
  }

  clearTargets() {
    this.targets = []
    this.members = []
    this.enabled = false
    this.hide()
  }

  private ensureMarker(markerRadius: number) {
    if (!this.marker) {
      const geometry = new THREE.SphereGeometry(1, 12, 12)
      const material = new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false, transparent: true })
      this.marker = new THREE.Mesh(geometry, material)
      this.marker.renderOrder = 2000
      this.marker.visible = false
      this.marker.userData.type = 'diagram'
      this.model.scene.add(this.marker)
    }
    this.marker.scale.setScalar(markerRadius)
  }

  private ensureTooltip(): HTMLDivElement {
    if (!this.tooltip) {
      const el = document.createElement('div')
      el.id = 'diagram-hover-tooltip'
      el.style.position = 'absolute'
      el.style.display = 'none'
      el.style.pointerEvents = 'none'
      el.style.zIndex = '5000'
      el.style.backgroundColor = 'rgba(255, 255, 255, 0.96)'
      el.style.border = '1px solid #333'
      el.style.borderRadius = '6px'
      el.style.padding = '6px 10px'
      el.style.fontFamily = '"Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      el.style.fontSize = '11px'
      el.style.lineHeight = '1.5'
      el.style.color = '#111'
      el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.25)'
      el.style.whiteSpace = 'pre'
      this.model.container?.appendChild(el)
      this.tooltip = el
    }
    return this.tooltip
  }

  private onPointerMove = (event: PointerEvent) => {
    if (!this.enabled || this.targets.length === 0) return
    const domElement = this.model.renderer.domElement
    const rect = domElement.getBoundingClientRect()
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    )
    this.rayCaster.setFromCamera(this.pointer, this.model.camera.cam)
    const intersects = this.rayCaster.intersectObjects(this.targets, false)
    if (intersects.length === 0) {
      this.hide()
      return
    }
    const hit = intersects[0]
    const memberId = hit.object.userData?.memberId
    const member = this.members.find(m => String(m.memberId) === String(memberId))
    if (!member || member.stations.length === 0) {
      this.hide()
      return
    }
    // Find the closest station to the hit point (based on the baseline axis points)
    let nearest = member.stations[0]
    let bestDistance = Infinity
    for (const station of member.stations) {
      const d = station.base.distanceToSquared(hit.point)
      if (d < bestDistance) {
        bestDistance = d
        nearest = station
      }
    }

    // Marker on the diagram at the nearest station
    if (this.marker) {
      this.marker.position.copy(nearest.offset)
      this.marker.visible = true
    }

    // Build tooltip content: active type first, then the remaining quantities
    const rows: string[] = []
    const title = `${member.label}  •  s = ${fmt(nearest.s)}`
    const entries = FORCE_LABELS.filter(item => nearest.values[item.key] !== undefined)
    const ordered = [
      ...entries.filter(item => item.key === this.activeType),
      ...entries.filter(item => item.key !== this.activeType)
    ]
    for (const item of ordered) {
      const raw = nearest.values[item.key]
      const value = raw * (item.scale ?? 1)
      rows.push(`${item.key === this.activeType ? '▸ ' : ''}${item.label} [${item.unit ?? ''}]: ${fmt(value)}`)
    }
    const tooltip = this.ensureTooltip()
    tooltip.innerHTML = `<b>${title}</b>\n${rows.join('\n')}`
    tooltip.style.display = 'block'

    // Position the tooltip next to the station projected on screen
    const projected = nearest.offset.clone().project(this.model.camera.cam)
    const containerRect = this.model.container?.getBoundingClientRect()
    const x = (projected.x * 0.5 + 0.5) * rect.width + (containerRect?.left ?? 0)
    const y = (-projected.y * 0.5 + 0.5) * rect.height + (containerRect?.top ?? 0)
    tooltip.style.left = `${x + 14}px`
    tooltip.style.top = `${y + 14}px`
  }

  private onPointerLeave = () => {
    this.hide()
  }

  private hide() {
    if (this.marker) this.marker.visible = false
    if (this.tooltip) this.tooltip.style.display = 'none'
  }

  dispose() {
    this.model.renderer.domElement.removeEventListener('pointermove', this.onPointerMove)
    this.model.renderer.domElement.removeEventListener('pointerleave', this.onPointerLeave)
    this.clearTargets()
    if (this.marker) {
      this.marker.geometry.dispose()
      ;(this.marker.material as THREE.Material).dispose()
      this.model.scene.remove(this.marker)
      this.marker = null
    }
    this.tooltip?.remove()
    this.tooltip = null
  }
}

export default DiagramHover
