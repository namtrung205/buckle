import * as THREE from 'three'
import { makeAutoObservable } from 'mobx'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
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
  /** Draw faint vertical rise lines extending each axis through every level. */
  showRise?: boolean
}

const GRID_COLOR = 0x64b5f6
const TEXT_COLOR = 0xdcebff
// Faded colour for the vertical datum lines that extend each grid axis through
// every level (Revit-style "grid runs through the building" hint).
const GRID_RISE_COLOR = 0x33557a
// Slightly above the ground plane mesh (-0.0015) and the drawing grid (-0.005)
// so the axis lines never z-fight with them.
const GRID_ELEVATION = 0.02
const BUBBLE_RADIUS_PX = 13
// Gap (px) left between the end of a grid line and its bubble circle.
const BUBBLE_GAP_PX = 4
// Extent used for a direction when the crossing family has no lines yet.
const FALLBACK_EXTENT = 10

const _worldPos = new THREE.Vector3()

/* ── line-drawn bubble assets ───────────────────────────────────────────────
 * The end bubbles are drawn with LINES (a circle outline) + FILLED vector text
 * (a real font, courtesy of the shared Typeface JSON) instead of stroke text.
 * The text lies FLAT on the grid plane (no camera-facing billboard) and the
 * geometries are cached per content and SHARED by every grid — only the
 * per-grid axis lines are owned per grid, so a grid rebuild must never dispose
 * these shared geometries.
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
 * Build a FILLED, real-font glyph mesh (like a raster text, but vector) for the
 * bubble label. It is centred on the origin and scaled so it always fits inside
 * the unit bubble circle. The text is a flat shape on XY — the bubble group is
 * rotated flat onto the grid plane, so it never billboards around the camera.
 */
function textFillGeometry(text: string): THREE.BufferGeometry {
  let geo = textCache.get(text)
  if (geo) return geo

  const textGeo = new TextGeometry(text, { font: GRID_FONT, size: 1, depth: 0.06, curveSegments: 3, bevelEnabled: false })
  textGeo.computeBoundingBox()
  const bb = textGeo.boundingBox!
  const cx = (bb.min.x + bb.max.x) / 2
  const cy = (bb.min.y + bb.max.y) / 2
  const maxDim = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, 1e-6)
  // Fit the glyphs inside ~62% of the unit bubble radius, keeping a margin.
  const scale = Math.min(1, 0.62 / maxDim)
  textGeo.translate(-cx, -cy, 0)
  textGeo.scale(scale, scale, 1)

  geo = textGeo
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
  /** Elevation (three.js Y) at which the PLAN lines are drawn — follows the
   *  active level so the axis grid shows through at every storey. */
  elevation: number = 0
  /** Faint vertical lines extending each axis through all levels (optional). */
  showRise: boolean = true
  /** Resolved lines, refreshed on every (re)build — read by the model tree. */
  xLines: GridLine[] = []
  yLines: GridLine[] = []
  group: THREE.Group = new THREE.Group()
  private bubbles: THREE.Group[] = []
  // Line ↔ bubble links used to trim each grid line just before its bubble
  // circle (a constant on-screen gap, recomputed every frame).
  private bubbleTies: { line: THREE.Line; bubble: THREE.Group; dir: THREE.Vector3; isStart: boolean }[] = []
  private lineMaterial: THREE.LineBasicMaterial
  private circleMaterial: THREE.LineBasicMaterial
  private textMaterial: THREE.MeshBasicMaterial
  private riseMaterial: THREE.LineBasicMaterial

  constructor(model: Model, def: GridSystemDef) {
    this.model = model
    this.id = def.id || Math.floor(Math.random() * 0x7FFFFFFF)
    this.name = def.name || 'Grid 1'
    this.x = { ...def.x, coords: [...(def.x.coords || [])] }
    this.y = { ...def.y, coords: [...(def.y.coords || [])] }
    this.extension = def.extension
    this.showBubbles = def.showBubbles
    this.showRise = def.showRise !== false
    // Respect the global Grids visibility toggle (Settings → Visibility) so a
    // grid created while grids are hidden stays hidden too (default: hidden).
    this.visible = model.visibility?.grids ?? false

    this.lineMaterial = new THREE.LineBasicMaterial({ color: GRID_COLOR })
    this.circleMaterial = new THREE.LineBasicMaterial({ color: GRID_COLOR })
    this.textMaterial = new THREE.MeshBasicMaterial({ color: TEXT_COLOR, side: THREE.DoubleSide })
    this.riseMaterial = new THREE.LineBasicMaterial({ color: GRID_RISE_COLOR, transparent: true, opacity: 0.45 })

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
    this.showRise = def.showRise !== false
    this.rebuild()
  }

  /** Move the plan grid to a new elevation (active level) and redraw. */
  setElevation(elevation: number) {
    if (this.elevation === elevation) return
    this.elevation = elevation
    this.rebuild()
  }

  /** Toggle the faint vertical rise lines that run through every level. */
  setShowRise(show: boolean) {
    if (this.showRise === show) return
    this.showRise = show
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
    const y = this.elevation

    // "X" lines: at x = coord, running parallel to the Z axis.
    this.xLines.forEach((line) => {
      const zStart = zCoords.length ? zMin - ext : -FALLBACK_EXTENT
      const zEnd = zCoords.length ? zMax + ext : FALLBACK_EXTENT
      const lineObj = this.addLine(
        new THREE.Vector3(line.coord, y, zStart),
        new THREE.Vector3(line.coord, y, zEnd),
      )
      if (this.showBubbles) {
        const bStart = this.addBubble(new THREE.Vector3(line.coord, y, zStart), line.label)
        const bEnd = this.addBubble(new THREE.Vector3(line.coord, y, zEnd), line.label)
        // Interior direction (from each end toward the line body) — +Z / −Z.
        this.tieBubble(lineObj, bStart, new THREE.Vector3(0, 0, 1), true)
        this.tieBubble(lineObj, bEnd, new THREE.Vector3(0, 0, -1), false)
      }
    })

    // "Y" lines: at z = coord, running parallel to the X axis.
    this.yLines.forEach((line) => {
      const xStart = xCoords.length ? xMin - ext : -FALLBACK_EXTENT
      const xEnd = xCoords.length ? xMax + ext : FALLBACK_EXTENT
      const lineObj = this.addLine(
        new THREE.Vector3(xStart, y, line.coord),
        new THREE.Vector3(xEnd, y, line.coord),
      )
      if (this.showBubbles) {
        const bStart = this.addBubble(new THREE.Vector3(xStart, y, line.coord), line.label)
        const bEnd = this.addBubble(new THREE.Vector3(xEnd, y, line.coord), line.label)
        // Interior direction (from each end toward the line body) — +X / −X.
        this.tieBubble(lineObj, bStart, new THREE.Vector3(1, 0, 0), true)
        this.tieBubble(lineObj, bEnd, new THREE.Vector3(-1, 0, 0), false)
      }
    })

    // Vertical "rise" lines: each axis extended through every level so the grid
    // reads as a continuous 3D datum (Revit-style). Only on the outer ends to
    // avoid clutter; each axis gets 2 verticals at its span ends.
    if (this.showRise) {
      const [yMin, yMax] = this.levelsExtent()
      const zStart = zCoords.length ? zMin - ext : -FALLBACK_EXTENT
      const xStart = xCoords.length ? xMin - ext : -FALLBACK_EXTENT
      this.xLines.forEach((line) => {
        this.addRise(new THREE.Vector3(line.coord, yMin, zStart), new THREE.Vector3(line.coord, yMax, zStart))
      })
      this.yLines.forEach((line) => {
        this.addRise(new THREE.Vector3(xStart, yMin, line.coord), new THREE.Vector3(xStart, yMax, line.coord))
      })
    }

    // Grids show on every storey layer (SAP/ETABS draw them on all plans).
    this.group.layers.enableAll()
    this.group.visible = this.visible
    this.model.scene.add(this.group)

    this.updateScreenScale()
  }

  /** Vertical span covered by the model levels (fallback to a sane range). */
  private levelsExtent(): [number, number] {
    const vals = this.model.levels.map((l) => l.value)
    if (vals.length) {
      const min = Math.min(...vals)
      const max = Math.max(...vals)
      return [min - 0.5, max + 0.5]
    }
    return [-0.5, 10]
  }

  private addRise(start: THREE.Vector3, end: THREE.Vector3): THREE.Line {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end])
    const line = new THREE.Line(geometry, this.riseMaterial)
    line.raycast = () => {} // never block member / node picking
    this.group.add(line)
    return line
  }

  private addLine(start: THREE.Vector3, end: THREE.Vector3): THREE.Line {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end])
    const line = new THREE.Line(geometry, this.lineMaterial)
    line.raycast = () => {} // never block member / node picking
    this.group.add(line)
    return line
  }

  private addBubble(position: THREE.Vector3, text: string): THREE.Group {
    const bubble = new THREE.Group()
    // Line-drawn bubble (SAP/ETABS style): a circle outline + a FILLED text
    // mesh using a real font. Both sit flat on the grid plane — the text does
    // NOT billboard around the camera. Unit size, kept constant on screen by
    // updateScreenScale().
    const circle = new THREE.LineLoop(unitCircleGeometry(), this.circleMaterial)
    circle.raycast = () => {}
    const textMesh = new THREE.Mesh(textFillGeometry(text), this.textMaterial)
    textMesh.raycast = () => {}
    textMesh.position.z = 0.031 // raise the glyphs just above the circle line
    bubble.add(circle, textMesh)
    bubble.rotation.x = -Math.PI / 2
    bubble.position.copy(position)
    this.bubbles.push(bubble)
    this.group.add(bubble)
    return bubble
  }

  /** Link an axis line to its end bubble for per-frame edge trimming. */
  private tieBubble(line: THREE.Line, bubble: THREE.Group, dir: THREE.Vector3, isStart: boolean) {
    this.bubbleTies.push({ line, bubble, dir, isStart })
  }

  /** Keep the bubbles at a constant on-screen size (same trick as nodes). */
  updateScreenScale() {
    if (!this.visible) return
    // px→world factor at the bubble's depth (constant for this ortho/iso frame).
    const px = this.bubbleTies.length
      ? this.model.pixelToWorld(this.bubbleTies[0].bubble.position, 1)
      : this.model.pixelToWorld(_worldPos.set(0, 0, 0), 1)

    this.bubbleTies.forEach((tie) => {
      const pos = tie.bubble.position
      tie.bubble.scale.setScalar(px * BUBBLE_RADIUS_PX)

      // Trim the axis line just before the circle so the two never intersect,
      // keeping a constant on-screen gap regardless of zoom.
      const trim = px * (BUBBLE_RADIUS_PX + BUBBLE_GAP_PX)
      const attr = (tie.line.geometry.attributes.position as THREE.BufferAttribute)
      attr.setXYZ(
        tie.isStart ? 0 : 1,
        pos.x + tie.dir.x * trim,
        pos.y,
        pos.z + tie.dir.z * trim,
      )
      attr.needsUpdate = true
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
    this.bubbleTies = []
    this.xLines = []
    this.yLines = []
  }

  delete() {
    this.disposeGeometry()
    this.lineMaterial.dispose()
    this.circleMaterial.dispose()
    this.textMaterial.dispose()
    this.riseMaterial.dispose()
    const index = this.model.grids.findIndex((g) => g.id === this.id)
    if (index !== -1) this.model.grids.splice(index, 1)
  }
}

export default GridSystem