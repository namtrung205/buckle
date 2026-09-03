import * as THREE from 'three'
import { reaction } from 'mobx'
import Model from '../Model'
import { Level } from '../../types'

/**
 * Revit-style level datums — horizontal reference planes drawn in the 3D scene.
 *
 * Each level gets a horizontal line (green) spanning the model plan, a small
 * "level head" marker at the left end (like a section/elevation symbol) and a
 * text label showing the level name + elevation (e.g. "Level 2   +5.000").
 *
 * The whole set rebuilds automatically whenever `model.levels` changes (MobX
 * reaction), so creating / renaming / deleting / re-elevating a level always
 * keeps the 3D datums in sync.
 */
const LEVEL_COLOR = 0x2ecc71
const LEVEL_HEAD_HEIGHT = 1.0
const LEVEL_HEAD_HORIZ = 1.2

class LevelVisual {
  model: Model
  group: THREE.Group = new THREE.Group()
  private lineMaterial: THREE.LineBasicMaterial
  private knownLabelIds: string[] = []
  private disposer: () => void

  constructor(model: Model) {
    this.model = model
    this.lineMaterial = new THREE.LineBasicMaterial({ color: LEVEL_COLOR })
    // Visible on every layer, like the grid / grid-system datums.
    this.group.layers.enableAll()
    this.model.scene.add(this.group)

    this.disposer = reaction(
      () => this.model.levels.map((l) => `${l.value}:${l.label}`).join('|'),
      () => this.rebuild(),
    )
    this.rebuild()
  }

  /** Horizontal span for the level lines (grid extent + nodes, else a default). */
  private span(): [number, number] {
    const xs: number[] = []
    this.model.grids.forEach((g) => g.xLines.forEach((l) => xs.push(l.coord)))
    this.model.nodes?.forEach((n) => xs.push(n.x))
    if (xs.length) {
      const min = Math.min(...xs)
      const max = Math.max(...xs)
      const pad = Math.max(2, (max - min) * 0.05)
      return [min - pad, max + pad]
    }
    return [-30, 30]
  }

  private fmtElevation(value: number): string {
    return `${value >= 0 ? '+' : ''}${value.toFixed(3)}`
  }

  private addLevel(level: Level) {
    const [x0, x1] = this.span()
    const y = level.value

    // Horizontal datum line.
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x0, y, 0),
      new THREE.Vector3(x1, y, 0),
    ])
    this.group.add(new THREE.Line(lineGeo, this.lineMaterial))

    // Level head (left end) — a small marker like Revit's section symbol.
    const headGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x0, y, 0),
      new THREE.Vector3(x0, y + LEVEL_HEAD_HEIGHT, 0),
      new THREE.Vector3(x0 + LEVEL_HEAD_HORIZ, y + LEVEL_HEAD_HEIGHT, 0),
    ])
    this.group.add(new THREE.Line(headGeo, this.lineMaterial))

    // Text label: name + elevation.
    const id = `level-${level.value}`
    this.knownLabelIds.push(id)
    this.model.labeler.batchUpdateOrCreate([{
      id,
      position: new THREE.Vector3(x0 + LEVEL_HEAD_HORIZ + 0.6, y + LEVEL_HEAD_HEIGHT + 0.3, 0),
      text: `${level.label}   ${this.fmtElevation(level.value)}`,
      type: 'level',
    }])
  }

  private clear() {
    if (this.knownLabelIds.length) this.model.labeler.batchDelete(this.knownLabelIds)
    this.knownLabelIds = []
    this.group.children.forEach((child) => {
      if (child instanceof THREE.Line) child.geometry.dispose()
    })
    this.group.clear()
  }

  private rebuild() {
    this.clear()
    this.model.levels.forEach((level) => this.addLevel(level))
  }

  dispose() {
    this.disposer()
    this.clear()
    this.model.scene.remove(this.group)
    this.lineMaterial.dispose()
  }
}

export default LevelVisual