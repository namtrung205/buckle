import * as THREE from 'three'
import { makeAutoObservable } from 'mobx'
import Model from '../Model'
import { Label } from '../../types'

/**
 * SAP2000 / ETABS style structural axis grid.
 *
 * A grid system is two families of lines drawn on the base plane:
 *  - "X" lines sit at successive x coordinates and run parallel to the Z axis
 *    (labelled A, B, C … by default, like ETABS' lettered grid).
 *  - "Y" lines sit at successive z coordinates and run parallel to the X axis
 *    (labelled 1, 2, 3 … by default).
 *
 * Every line reaches `extension` metres past the outer lines of the crossing
 * family and ends in a labelled bubble (constant on-screen size, same trick
 * as nodes). Grids stay visible on every storey layer and their objects are
 * excluded from raycasting so they never block member / node selection.
 */

export type GridLabelStyle = 'letters' | 'numbers'

export type GridDirectionSpec = {
  /** Label sequence used for the lines of this direction. */
  labelStyle: GridLabelStyle
  /** 'equal' = arithmetic series (start + i·spacing), 'list' = explicit coords. */
  mode: 'equal' | 'list'
  start: number
  spacing: number
  count: number
  coords: number[]
}

export type GridLine = { axis: 'X' | 'Y'; label: string; coord: number }

export type GridSystemDef = {
  id?: number
  name: string
  x: GridDirectionSpec
  y: GridDirectionSpec
  /** How far every line reaches past the outer grid bounds (m). */
  extension: number
  /** Draw the labelled end bubbles. */
  showBubbles: boolean
}

const GRID_COLOR = 0x64b5f6
// Slightly above the ground plane mesh (-0.0015) and the drawing grid (-0.005)
// so the axis lines never z-fight with them.
const GRID_ELEVATION = 0.02
const BUBBLE_RADIUS_PX = 13
// Extent used for a direction when the crossing family has no lines yet.
const FALLBACK_EXTENT = 10

const _worldPos = new THREE.Vector3()

/** Spreadsheet-style column label: 0 → A … 25 → Z, 26 → AA … */
export function columnLabel(index: number): string {
  let label = ''
  let n = index
  do {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return label
}

function lineLabel(spec: GridDirectionSpec, index: number): string {
  return spec.labelStyle === 'letters' ? columnLabel(index) : String(index + 1)
}

/** Expand a direction spec into its concrete grid lines. */
export function resolveLines(spec: GridDirectionSpec, axis: 'X' | 'Y'): GridLine[] {
  if (spec.mode === 'list') {
    return spec.coords.map((coord, i) => ({ axis, label: lineLabel(spec, i), coord }))
  }
  const count = Math.max(0, Math.floor(spec.count))
  return Array.from({ length: count }, (_, i) => ({
    axis,
    label: lineLabel(spec, i),
    coord: spec.start + i * spec.spacing,
  }))
}

class GridSystem {
  model: Model
  id: number
  name: string
  x: GridDirectionSpec
  y: GridDirectionSpec
  extension: number
  showBubbles: boolean
  visible: boolean = true
  /** Resolved lines, refreshed on every (re)build — read by the model tree. */
  xLines: GridLine[] = []
  yLines: GridLine[] = []
  group: THREE.Group = new THREE.Group()
  private bubbles: THREE.Group[] = []
  private labelData: Label[] = []
  private lineMaterial: THREE.LineBasicMaterial
  private fillMaterial: THREE.MeshBasicMaterial
  private ringMaterial: THREE.MeshBasicMaterial

  constructor(model: Model, def: GridSystemDef) {
    this.model = model
    this.id = def.id || Math.floor(Math.random() * 0x7FFFFFFF)
    this.name = def.name || 'Grid 1'
    this.x = { ...def.x, coords: [...(def.x.coords || [])] }
    this.y = { ...def.y, coords: [...(def.y.coords || [])] }
    this.extension = def.extension
    this.showBubbles = def.showBubbles

    this.lineMaterial = new THREE.LineBasicMaterial({ color: GRID_COLOR })
    this.fillMaterial = new THREE.MeshBasicMaterial({ color: 0x212830 }) // viewport background
    this.ringMaterial = new THREE.MeshBasicMaterial({ color: GRID_COLOR })

    makeAutoObservable(this)
  }

  createOrUpdate() {
    const index = this.model.grids.findIndex((g) => g.id === this.id)
    if (index === -1) {
      this.model.grids.push(this)
      this.create()
    } else {
      // Slot replacement keeps MobX observers (model tree, dialogs) in sync.
      this.model.grids[index] = this
      this.rebuild()
    }
  }

  /** Mutate the definition in place (edit flow) and rebuild the geometry. */
  applyDef(def: GridSystemDef) {
    this.name = def.name || this.name
    this.x = { ...def.x, coords: [...(def.x.coords || [])] }
    this.y = { ...def.y, coords: [...(def.y.coords || [])] }
    this.extension = def.extension
    this.showBubbles = def.showBubbles
    this.rebuild()
  }

  private rebuild() {
    this.disposeGeometry()
    this.create()
  }

  private create() {
    this.xLines = resolveLines(this.x, 'X')
    this.yLines = resolveLines(this.y, 'Y')

    const xCoords = this.xLines.map((l) => l.coord)
    const zCoords = this.yLines.map((l) => l.coord)
    const xMin = xCoords.length ? Math.min(...xCoords) : 0
    const xMax = xCoords.length ? Math.max(...xCoords) : 0
    const zMin = zCoords.length ? Math.min(...zCoords) : 0
    const zMax = zCoords.length ? Math.max(...zCoords) : 0
    const ext = Math.max(0, this.extension)

    const labels: Label[] = []

    // "X" lines: at x = coord, running parallel to the Z axis.
    this.xLines.forEach((line, i) => {
      const zStart = zCoords.length ? zMin - ext : -FALLBACK_EXTENT
      const zEnd = zCoords.length ? zMax + ext : FALLBACK_EXTENT
      this.addLine(
        new THREE.Vector3(line.coord, GRID_ELEVATION, zStart),
        new THREE.Vector3(line.coord, GRID_ELEVATION, zEnd),
      )
      if (this.showBubbles) {
        this.addBubble(new THREE.Vector3(line.coord, GRID_ELEVATION, zStart))
        this.addBubble(new THREE.Vector3(line.coord, GRID_ELEVATION, zEnd))
        labels.push(this.bubbleLabel(line.label, line.coord, zStart, `grid-${this.id}-x-${i}-start`))
        labels.push(this.bubbleLabel(line.label, line.coord, zEnd, `grid-${this.id}-x-${i}-end`))
      }
    })

    // "Y" lines: at z = coord, running parallel to the X axis.
    this.yLines.forEach((line, i) => {
      const xStart = xCoords.length ? xMin - ext : -FALLBACK_EXTENT
      const xEnd = xCoords.length ? xMax + ext : FALLBACK_EXTENT
      this.addLine(
        new THREE.Vector3(xStart, GRID_ELEVATION, line.coord),
        new THREE.Vector3(xEnd, GRID_ELEVATION, line.coord),
      )
      if (this.showBubbles) {
        this.addBubble(new THREE.Vector3(xStart, GRID_ELEVATION, line.coord))
        this.addBubble(new THREE.Vector3(xEnd, GRID_ELEVATION, line.coord))
        labels.push(this.bubbleLabel(line.label, xStart, line.coord, `grid-${this.id}-y-${i}-start`))
        labels.push(this.bubbleLabel(line.label, xEnd, line.coord, `grid-${this.id}-y-${i}-end`))
      }
    })

    // Grids show on every storey layer (SAP/ETABS draw them on all plans).
    this.group.layers.enableAll()
    this.group.visible = this.visible
    this.model.scene.add(this.group)

    this.labelData = labels
    if (labels.length) this.model.labeler.batchUpdateOrCreate(labels)
    this.updateScreenScale()
  }

  private addLine(start: THREE.Vector3, end: THREE.Vector3) {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end])
    const line = new THREE.Line(geometry, this.lineMaterial)
    line.raycast = () => {} // never block member / node picking
    this.group.add(line)
  }

  private addBubble(position: THREE.Vector3) {
    const bubble = new THREE.Group()
    // Unit radii — updateScreenScale() sizes the bubble in screen pixels.
    const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 32), this.fillMaterial)
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 32), this.ringMaterial)
    fill.raycast = () => {}
    ring.raycast = () => {}
    bubble.add(fill, ring)
    bubble.rotation.x = -Math.PI / 2
    bubble.position.copy(position)
    this.bubbles.push(bubble)
    this.group.add(bubble)
  }

  private bubbleLabel(text: string, x: number, z: number, id: string): Label {
    return { id, position: new THREE.Vector3(x, GRID_ELEVATION, z), text, type: 'grid' }
  }

  /** Keep the bubbles at a constant on-screen size (same trick as nodes). */
  updateScreenScale() {
    if (!this.visible) return
    this.bubbles.forEach((bubble) => {
      bubble.getWorldPosition(_worldPos)
      bubble.scale.setScalar(this.model.pixelToWorld(_worldPos, BUBBLE_RADIUS_PX))
    })
  }

  setVisible(visible: boolean) {
    this.visible = visible
    this.group.visible = visible
    if (visible) {
      if (this.labelData.length) this.model.labeler.batchUpdateOrCreate(this.labelData)
    } else {
      this.model.labeler.batchDelete(this.labelData.map((l) => l.id))
    }
  }

  toggleVisible() {
    this.setVisible(!this.visible)
  }

  private disposeGeometry() {
    this.model.labeler.batchDelete(this.labelData.map((l) => l.id))
    this.labelData = []
    this.group.children.forEach((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose()
      }
    })
    this.model.scene.remove(this.group)
    this.group.clear()
    this.bubbles = []
    this.xLines = []
    this.yLines = []
  }

  delete() {
    this.disposeGeometry()
    this.lineMaterial.dispose()
    this.fillMaterial.dispose()
    this.ringMaterial.dispose()
    const index = this.model.grids.findIndex((g) => g.id === this.id)
    if (index !== -1) this.model.grids.splice(index, 1)
  }
}

export default GridSystem