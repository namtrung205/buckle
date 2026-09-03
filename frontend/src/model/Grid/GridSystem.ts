import * as THREE from 'three'
import { makeAutoObservable } from 'mobx'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import helvetiker from 'three/examples/fonts/helvetiker_regular.typeface.json'
import Model from '../Model'

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
const TEXT_COLOR = 0xcfe6ff
// Slightly above the ground plane mesh (-0.0015) and the drawing grid (-0.005)
// so the axis lines never z-fight with them.
const GRID_ELEVATION = 0.02
const BUBBLE_RADIUS_PX = 13
// Extent used for a direction when the crossing family has no lines yet.
const FALLBACK_EXTENT = 10

const _worldPos = new THREE.Vector3()

/* ── line-drawn bubble assets ───────────────────────────────────────────────
 * The end bubbles are drawn with plain LINES (a circle outline + vector text
 * strokes, SHX-style) instead of filled meshes so they never z-fight, flicker
 * or look banded at screen size. The geometries are cached per content and
 * SHARED by every grid — only the per-grid axis lines are owned per grid, so
 * a grid rebuild must never dispose these shared geometries.
 */
const GRID_FONT = new FontLoader().parse(helvetiker as unknown as Parameters<typeof FontLoader.prototype.parse>[0])

const circleCache = new Map<string, THREE.BufferGeometry>()

/** Unit-radius circle outline (in the XY plane, radius 1) as a LineLoop. */
function unitCircleGeometry(): THREE.BufferGeometry {
  let geo = circleCache.get('unit-circle')
  if (!geo) {
    const segments = 64
    const points: THREE.Vector3[] = []
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2
      points.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0))
    }
    geo = new THREE.BufferGeometry().setFromPoints(points)
    circleCache.set('unit-circle', geo)
  }
  return geo
}

const textCache = new Map<string, THREE.BufferGeometry>()

/**
 * Stroke the label text its vector outlines (like an SHX font) as LineSegments.
 * The result is centred on the origin at a height of ~1 unit, scaled down if
 * needed so it always fits inside the unit bubble circle.
 */
function textGeometry(text: string): THREE.BufferGeometry {
  let geo = textCache.get(text)
  if (geo) return geo

  const shapes = GRID_FONT.generateShapes(text, 1)
  const shapeGeo = new THREE.ShapeGeometry(shapes, 12)
  const edges = new THREE.EdgesGeometry(shapeGeo, 1)
  const raw = (edges.getAttribute('position') as THREE.BufferAttribute).array as ArrayLike<number>
  const positions = new Float32Array(raw.length)
  for (let i = 0; i < raw.length; i++) positions[i] = raw[i] as number
  shapeGeo.dispose()
  edges.dispose()

  // Centre the glyphs and cap them so they fit inside the unit bubble.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i] < minX) minX = positions[i]
    if (positions[i] > maxX) maxX = positions[i]
    if (positions[i + 1] < minY) minY = positions[i + 1]
    if (positions[i + 1] > maxY) maxY = positions[i + 1]
  }
  const w = Math.max(1e-6, maxX - minX)
  const h = Math.max(1e-6, maxY - minY)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const scale = Math.min(1, 1.2 / Math.max(w, h))
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (positions[i] - cx) * scale
    positions[i + 1] = (positions[i + 1] - cy) * scale
  }

  geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.computeBoundingSphere()
  textCache.set(text, geo)
  return geo
}

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
  private lineMaterial: THREE.LineBasicMaterial
  private circleMaterial: THREE.LineBasicMaterial
  private textMaterial: THREE.LineBasicMaterial

  constructor(model: Model, def: GridSystemDef) {
    this.model = model
    this.id = def.id || Math.floor(Math.random() * 0x7FFFFFFF)
    this.name = def.name || 'Grid 1'
    this.x = { ...def.x, coords: [...(def.x.coords || [])] }
    this.y = { ...def.y, coords: [...(def.y.coords || [])] }
    this.extension = def.extension
    this.showBubbles = def.showBubbles

    this.lineMaterial = new THREE.LineBasicMaterial({ color: GRID_COLOR })
    this.circleMaterial = new THREE.LineBasicMaterial({ color: GRID_COLOR })
    this.textMaterial = new THREE.LineBasicMaterial({ color: TEXT_COLOR })

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

    // "X" lines: at x = coord, running parallel to the Z axis.
    this.xLines.forEach((line) => {
      const zStart = zCoords.length ? zMin - ext : -FALLBACK_EXTENT
      const zEnd = zCoords.length ? zMax + ext : FALLBACK_EXTENT
      this.addLine(
        new THREE.Vector3(line.coord, GRID_ELEVATION, zStart),
        new THREE.Vector3(line.coord, GRID_ELEVATION, zEnd),
      )
      if (this.showBubbles) {
        this.addBubble(new THREE.Vector3(line.coord, GRID_ELEVATION, zStart), line.label)
        this.addBubble(new THREE.Vector3(line.coord, GRID_ELEVATION, zEnd), line.label)
      }
    })

    // "Y" lines: at z = coord, running parallel to the X axis.
    this.yLines.forEach((line) => {
      const xStart = xCoords.length ? xMin - ext : -FALLBACK_EXTENT
      const xEnd = xCoords.length ? xMax + ext : FALLBACK_EXTENT
      this.addLine(
        new THREE.Vector3(xStart, GRID_ELEVATION, line.coord),
        new THREE.Vector3(xEnd, GRID_ELEVATION, line.coord),
      )
      if (this.showBubbles) {
        this.addBubble(new THREE.Vector3(xStart, GRID_ELEVATION, line.coord), line.label)
        this.addBubble(new THREE.Vector3(xEnd, GRID_ELEVATION, line.coord), line.label)
      }
    })

    // Grids show on every storey layer (SAP/ETABS draw them on all plans).
    this.group.layers.enableAll()
    this.group.visible = this.visible
    this.model.scene.add(this.group)

    this.updateScreenScale()
  }

  private addLine(start: THREE.Vector3, end: THREE.Vector3) {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end])
    const line = new THREE.Line(geometry, this.lineMaterial)
    line.raycast = () => {} // never block member / node picking
    this.group.add(line)
  }

  private addBubble(position: THREE.Vector3, text: string) {
    const bubble = new THREE.Group()
    // Line-drawn bubble (SAP/ETABS style): a circle outline + stroked text,
    // both plain LINES so they never z-fight or flicker like filled meshes.
    // Unit size — updateScreenScale() keeps them at a constant on-screen size.
    const circle = new THREE.LineLoop(unitCircleGeometry(), this.circleMaterial)
    circle.raycast = () => {}
    const textLines = new THREE.LineSegments(textGeometry(text), this.textMaterial)
    textLines.raycast = () => {}
    bubble.add(circle, textLines)
    bubble.rotation.x = -Math.PI / 2
    bubble.position.copy(position)
    this.bubbles.push(bubble)
    this.group.add(bubble)
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
  }

  toggleVisible() {
    this.setVisible(!this.visible)
  }

  private disposeGeometry() {
    // Only dispose the per-grid axis lines — the circle / text geometries are
    // SHARED caches (see the module-level builders) and must keep living.
    this.group.children.forEach((child) => {
      if (child instanceof THREE.Line && !(child instanceof THREE.LineSegments) && !(child instanceof THREE.LineLoop)) {
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
    this.circleMaterial.dispose()
    this.textMaterial.dispose()
    const index = this.model.grids.findIndex((g) => g.id === this.id)
    if (index !== -1) this.model.grids.splice(index, 1)
  }
}

export default GridSystem