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
      const material = new THREE.MeshBasicMaterial({ color: 0xf0f4f8, depthTest: false, transparent: true })
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
      el.style.position = 'fixed'
      el.style.display = 'none'
      el.style.pointerEvents = 'none'
      el.style.zIndex = '5000'
      el.style.backgroundColor = 'rgba(15, 19, 26, 0.96)'
      el.style.border = '1px solid #3b4654'
      el.style.borderLeft = '3px solid #4a90e2'
      el.style.borderRadius = '6px'
      el.style.padding = '8px 12px'
      el.style.fontFamily = '"JetBrains Mono", ui-monospace, "SF Mono", monospace'
      el.style.fontSize = '11.5px'
      el.style.lineHeight = '1.7'
      el.style.color = '#e8edf4'
      el.style.boxShadow = '0 8px 24px rgba(0,0,0,0.5)'
      el.style.whiteSpace = 'nowrap'
      if (!document.getElementById('diagram-hover-tooltip-style')) {
        const style = document.createElement('style')
        style.id = 'diagram-hover-tooltip-style'
        style.textContent = [
          '#diagram-hover-tooltip .row{display:flex;justify-content:space-between;gap:16px;}',
          '#diagram-hover-tooltip .row .lbl{color:#9aa7b8;}',
          '#diagram-hover-tooltip .row.on{color:#7fb3ff;font-weight:700;}',
          '#diagram-hover-tooltip .row.on .lbl{color:#7fb3ff;}',
          '#diagram-hover-tooltip .hd{color:#7fb3ff;font-weight:700;margin-bottom:3px;border-bottom:1px solid #3b4654;padding-bottom:3px;}',
        ].join('\n')
        document.head.appendChild(style)
      }
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

    // Build tooltip content: .hd title + .row label/value pairs (like the sample)
    const title = `${member.label}  •  s = ${fmt(nearest.s)}`
    const entries = FORCE_LABELS.filter(item => nearest.values[item.key] !== undefined)
    const ordered = [
      ...entries.filter(item => item.key === this.activeType),
      ...entries.filter(item => item.key !== this.activeType)
    ]
    let html = `<div class="hd">${title}</div>`
    for (const item of ordered) {
      const raw = nearest.values[item.key]
      const value = raw * (item.scale ?? 1)
      const active = item.key === this.activeType
      html += `<div class="row${active ? ' on' : ''}">`
      html += `<span class="lbl">${active ? '▸ ' : ''}${item.label} [${item.unit ?? ''}]</span>`
      html += `<span>${fmt(value)}</span></div>`
    }
    const tooltip = this.ensureTooltip()
    tooltip.innerHTML = html
    tooltip.style.display = 'block'

    // Position the tooltip anchored to the cursor (like the sample), flipping
    // near the right/bottom edges so it never leaves the viewport
    const tw = tooltip.offsetWidth || 200
    const th = tooltip.offsetHeight || 140
    let x = event.clientX + 16
    let y = event.clientY + 16
    if (x + tw > window.innerWidth - 8) x = event.clientX - tw - 16
    if (y + th > window.innerHeight - 8) y = event.clientY - th - 16
    x = Math.max(8, x)
    y = Math.max(8, y)
    tooltip.style.left = `${x}px`
    tooltip.style.top = `${y}px`
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
    document.getElementById('diagram-hover-tooltip-style')?.remove()
  }
}

export default DiagramHover
