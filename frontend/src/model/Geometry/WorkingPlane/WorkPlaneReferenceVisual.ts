import * as THREE from 'three'
import { reaction } from 'mobx'
import Model from '../../Model'

/**
 * Revit-style reference overlay on a VERTICAL working plane.
 *
 * When the active work plane is a structural grid axis (or a vertical face),
 * Revit shows you, in that same elevation view:
 *   - every LEVEL datum as a horizontal line at its elevation, and
 *   - the OTHER grid family's axes as vertical lines crossing those levels.
 *
 * This class rebuilds those references whenever the working plane (or the
 * levels / grids) change, so drawing in a grid-axis elevation always shows the
 * full datum context. It is a visual-only overlay: meshes are raycast-nulled
 * and never block picking.
 *
 * Supported planes (the ones produced by WorkingPlane.setGridLine / setAxes):
 *   - OYZ face (normal ±X): horizontal = Z, vertical = Y  (grid "X" axis, e.g. A)
 *   - OXZ face (normal ±Z): horizontal = X, vertical = Y  (grid "Y" axis, e.g. 1)
 * Horizontal plans (normal ±Y) are skipped — the GridSystem already draws the
 * plan grid there.
 */

const LEVEL_REF_COLOR = 0x2ecc71 // green, matches the level datums
const GRID_REF_COLOR = 0x64b5f6 // blue, matches the structural grid
const FALLBACK_SPAN = 40

class WorkPlaneReferenceVisual {
  model: Model
  group: THREE.Group = new THREE.Group()
  private levelMaterial: THREE.LineBasicMaterial
  private gridMaterial: THREE.LineBasicMaterial
  private disposer: () => void

  constructor(model: Model) {
    this.model = model
    this.levelMaterial = new THREE.LineBasicMaterial({ color: LEVEL_REF_COLOR, transparent: true, opacity: 0.7 })
    this.gridMaterial = new THREE.LineBasicMaterial({ color: GRID_REF_COLOR, transparent: true, opacity: 0.85 })
    this.group.layers.enableAll()
    this.group.visible = false
    this.model.scene.add(this.group)

    // Rebuild when the plane or the datum sources change. Note: `label` is a
    // MobX-observed primitive string that changes on EVERY plane mutation
    // (source + normal + offset are all baked into it), whereas `normal` is a
    // mutable Vector3 whose reference never changes on `.set()`, so it can't be
    // relied on directly for reactivity.
    this.disposer = reaction(
      () => ({
        label: this.model.workingPlane.label,
        source: this.model.workingPlane.source,
        constant: this.model.workingPlane.constant,
        levels: this.model.levels.map((l) => l.value).join('|'),
        grids: this.model.grids.map((g) => `${g.name}:${g.xLines.map((l) => l.coord).join(',')}:${g.yLines.map((l) => l.coord).join(',')}`).join('::'),
      }),
      () => this.rebuild(),
    )
    this.rebuild()
  }

  /** In-plane horizontal + vertical directions for an axis-aligned plane. */
  private frame(): { horizontal: THREE.Vector3; vertical: THREE.Vector3; center: THREE.Vector3 } | null {
    const n = this.model.workingPlane.normal.clone().normalize()
    const c = this.model.workingPlane.constant
    const absNx = Math.abs(n.x)
    const absNy = Math.abs(n.y)
    const absNz = Math.abs(n.z)

    // Horizontal plan → GridSystem handles it; nothing to do here.
    if (absNy >= absNx && absNy >= absNz) return null

    let horizontal: THREE.Vector3
    if (absNx >= absNy && absNx >= absNz) {
      // OYZ face (x = const): horizontal runs along Z, vertical along Y.
      horizontal = new THREE.Vector3(0, 0, 1)
    } else {
      // OXZ face (z = const): horizontal runs along X, vertical along Y.
      horizontal = new THREE.Vector3(1, 0, 0)
    }
    const vertical = new THREE.Vector3(0, 1, 0)
    // A point on the plane: n·p = -constant → p = -constant * n.
    const center = n.clone().multiplyScalar(-c)
    return { horizontal, vertical, center }
  }

  private span(): number {
    // Extent from grids (both families) so the references cover the whole axis.
    const coords: number[] = []
    this.model.grids.forEach((g) => {
      g.xLines.forEach((l) => coords.push(l.coord))
      g.yLines.forEach((l) => coords.push(l.coord))
    })
    this.model.nodes?.forEach((n) => coords.push(n.x, n.z))
    if (!coords.length) return FALLBACK_SPAN
    const max = Math.max(...coords.map((v) => Math.abs(v)))
    return Math.max(FALLBACK_SPAN, max * 1.6)
  }

  private addLine(a: THREE.Vector3, b: THREE.Vector3, material: THREE.LineBasicMaterial) {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b])
    const line = new THREE.Line(geo, material)
    line.raycast = () => {}
    this.group.add(line)
  }

  private rebuild() {
    this.clear()
    const frame = this.frame()
    if (!frame) {
      this.group.visible = false
      return
    }

    const showVertical =
      this.model.workingPlane.source === 'grid' || this.model.workingPlane.source === 'axes'
    if (!showVertical) {
      this.group.visible = false
      return
    }

    const { horizontal, vertical, center } = frame
    const span = this.span()
    const yMin = Math.min(...this.model.levels.map((l) => l.value), center.y) - 1
    const yMax = Math.max(...this.model.levels.map((l) => l.value), center.y) + 1

    // 1) LEVEL datums: horizontal lines at each level elevation.
    this.model.levels.forEach((level) => {
      const a = center.clone().addScaledVector(horizontal, -span).addScaledVector(vertical, level.value - center.y)
      const b = center.clone().addScaledVector(horizontal, span).addScaledVector(vertical, level.value - center.y)
      this.addLine(a, b, this.levelMaterial)
    })

    // 2) CROSSING grid axes: the OTHER family, drawn as vertical lines in-plane.
    // On x=const (OYZ), the crossing family is the Y family (z coords) — and
    // vice-versa, so we pick the family whose axis runs parallel to `horizontal`.
    this.model.grids.forEach((g) => {
      const isXFamily = Math.abs(horizontal.x) > 0.5
      const lines = isXFamily ? g.xLines : g.yLines
      lines.forEach((l) => {
        const a = center.clone().addScaledVector(horizontal, l.coord).addScaledVector(vertical, yMin - center.y)
        const b = center.clone().addScaledVector(horizontal, l.coord).addScaledVector(vertical, yMax - center.y)
        this.addLine(a, b, this.gridMaterial)
      })
    })

    this.group.visible = true
  }

  private clear() {
    this.group.children.forEach((child) => {
      if (child instanceof THREE.Line) child.geometry.dispose()
    })
    this.group.clear()
  }

  dispose() {
    this.disposer()
    this.clear()
    this.model.scene.remove(this.group)
    this.levelMaterial.dispose()
    this.gridMaterial.dispose()
  }
}

export default WorkPlaneReferenceVisual