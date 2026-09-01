import { Model } from "../Model"

import * as THREE from 'three'
import { makeAutoObservable } from 'mobx'
import { jsonArrayToThree } from '../../utils/axis'
import type { Label } from '../Labeler/Labeler'

export const REACTION_COMPONENTS = ['Fx', 'Fy', 'Fz', 'Mx', 'My', 'Mz'] as const
export type ReactionComponent = (typeof REACTION_COMPONENTS)[number]

const POS_COLOR = '#2f6fed'    // positive force
const NEG_COLOR = '#e5484d'    // negative force
const MOMENT_COLOR = '#f59e0b' // moment arcs

// Value labels are always pink (CAD "text" layer look).
const LABEL_COLOR = '#f472b6'

// Screen-space sizing (CSS pixels): every symbol keeps a constant on-screen
// size no matter how far the camera is or which zoom is active.
const FORCE_ARROW_LENGTH_PIXELS = 54
const MOMENT_ARC_PIXEL_RADIUS = 20
const FORCE_LABEL_GAP_PIXELS = 10
const MOMENT_LABEL_GAP_PIXELS = 12

// Unit vector of each reaction component in the three.js scene frame
// (OpenSees Z-up -> three.js Y-up permutation: ops X -> three X,
// ops Y -> three Z, ops Z (vertical) -> three Y).
const AXIS_BY_COMPONENT: Record<ReactionComponent, THREE.Vector3> = {
  Fx: new THREE.Vector3(1, 0, 0),
  Fy: new THREE.Vector3(0, 0, 1),
  Fz: new THREE.Vector3(0, 1, 0),
  Mx: new THREE.Vector3(1, 0, 0),
  My: new THREE.Vector3(0, 0, 1),
  Mz: new THREE.Vector3(0, 1, 0),
}

const SIZE_VECTOR = new THREE.Vector2()

const fmt = (v: number) => {
  const a = Math.abs(v)
  if (a >= 100) return v.toFixed(0)
  if (a >= 1) return v.toFixed(2)
  if (a >= 0.001) return v.toFixed(4)
  return v.toFixed(6)
}

type ReactionEntry = {
  id: number
  x?: number
  y?: number
  z?: number
  Fx?: number
  Fy?: number
  Fz?: number
  Mx?: number
  My?: number
  Mz?: number
}

/** A live symbol (force arrow or moment arc) rescaled every frame to keep a
 *  constant on-screen size; its value label is kept just outside the symbol
 *  and rotates along the symbol direction. */
type VizItem = {
  group: THREE.Group        // positioned at the support node
  pxLength: number          // desired on-screen length (CSS px)
  baseLength: number        // world-space length recorded at render time
  outwardDir: THREE.Vector3 // unit world vector from node toward the label
  labelGapPx: number
  labelId?: string
  labelText?: string
}

/**
 * Renders support reactions in the 3D scene, Midas-Civil style: one thin
 * arrow (same language as the load arrows) per checked force component
 * (Fx/Fy/Fz) and one thin arc per checked moment component (Mx/My/Mz) at
 * every restrained node. Every arrow points INTO its node - it starts
 * outside and the head lands on the node. All symbols are sized in screen
 * pixels (constant on-screen size when zooming) and the value text is a thin
 * SHX-style pink label without a background that follows the arrow direction.
 */
class ReactionViz {
  model: Model
  private group: THREE.Group | null = null
  private items: VizItem[] = []

  // Which components are requested at the supports (applied on Apply)
  show: Record<ReactionComponent, boolean> = {
    Fx: false,
    Fy: false,
    Fz: false,
    Mx: false,
    My: false,
    Mz: false,
  }
  showLabels = true

  constructor(model: Model) {
    this.model = model
    makeAutoObservable(this, {
      model: false,
      group: false,
      items: false,
    } as any)
  }

  get isAnyActive(): boolean {
    return REACTION_COMPONENTS.some((component) => this.show[component])
  }

  /** Checkbox toggles only change the request - Apply puts them on screen. */
  toggleComponent(component: ReactionComponent) {
    this.show[component] = !this.show[component]
  }

  setShowLabels(value: boolean) {
    this.showLabels = value
  }

  /** Apply button: draw the requested components (or clear the scene). */
  apply() {
    if (this.isAnyActive) this.render()
    else this.dispose()
  }

  /** Re-render after a new analysis finished (or clear when none checked). */
  refresh() {
    this.apply()
  }

  render() {
    this.clearScene()

    const reactions: ReactionEntry[] = this.model.output?.reactions ?? []
    if (!reactions.length || !this.isAnyActive) return

    const active = REACTION_COMPONENTS.filter((component) => this.show[component])
    const group = new THREE.Group()
    const labels: Label[] = []

    for (const reaction of reactions) {
      const origin = jsonArrayToThree([reaction.x ?? 0, reaction.y ?? 0, reaction.z ?? 0])

      for (const component of active) {
        const value = reaction[component] ?? 0
        if (Math.abs(value) < 1e-9) continue

        const isMoment = component[0] === 'M'
        const dir = AXIS_BY_COMPONENT[component].clone().multiplyScalar(value >= 0 ? 1 : -1)
        const color = isMoment ? MOMENT_COLOR : value >= 0 ? POS_COLOR : NEG_COLOR

        const pxLength = isMoment ? MOMENT_ARC_PIXEL_RADIUS : FORCE_ARROW_LENGTH_PIXELS
        const baseLength = this.pixelToWorld(origin, pxLength)

        const symbol = new THREE.Group()
        symbol.position.copy(origin)

        let baselineDir: THREE.Vector3
        let outwardDir: THREE.Vector3
        if (isMoment) {
          this.buildMomentArc(symbol, dir, baseLength, color)
          const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir)
          baselineDir = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion)
          outwardDir = baselineDir
        } else {
          // Thin ArrowHelper (same language as the load arrows): it starts
          // outside the node and the head lands on the node, pointing into it.
          symbol.add(
            new THREE.ArrowHelper(
              dir,
              dir.clone().multiplyScalar(-baseLength),
              baseLength,
              new THREE.Color(color),
              baseLength * 0.28,
              baseLength * 0.16,
            ),
          )
          baselineDir = dir
          outwardDir = dir.clone().negate()
        }

        group.add(symbol)
        const item: VizItem = {
          group: symbol,
          pxLength,
          baseLength,
          outwardDir,
          labelGapPx: isMoment ? MOMENT_LABEL_GAP_PIXELS : FORCE_LABEL_GAP_PIXELS,
        }

        if (this.showLabels) {
          const gapWorld = this.pixelToWorld(origin, item.labelGapPx)
          const labelId = `reaction-${component}-${reaction.id}`
          const text = `${component} ${fmt(value)}`
          item.labelId = labelId
          item.labelText = text
          labels.push({
            id: labelId,
            position: origin.clone().addScaledVector(outwardDir, baseLength + gapWorld),
            text,
            type: 'reaction',
            backgroundColor: LABEL_COLOR,
            rotation: this.labelRotationDeg(origin, baselineDir),
          })
        }

        this.items.push(item)
      }
    }

    if (labels.length) this.model.labeler.create(labels)
    this.model.scene.add(group)
    this.group = group
  }

  dispose() {
    this.clearScene()
  }

  /** Per-frame hook (Model.update): keep every symbol pixel-sized. */
  onFrame() {
    if (!this.items.length) return
    for (const item of this.items) {
      const origin = item.group.position
      const target = this.pixelToWorld(origin, item.pxLength)
      item.group.scale.setScalar(target / item.baseLength)
      if (item.labelId) {
        const gapWorld = this.pixelToWorld(origin, item.labelGapPx)
        this.model.labeler.updateOne({
          id: item.labelId,
          position: origin.clone().addScaledVector(item.outwardDir, target + gapWorld),
          text: item.labelText ?? '',
          type: 'reaction',
        })
      }
    }
  }

  /** Screen-clockwise angle (CSS rotate) of a world direction at a point. */
  private labelRotationDeg(origin: THREE.Vector3, baselineDir: THREE.Vector3): number {
    const cam = this.model.camera.cam
    const start = origin.clone().project(cam)
    const end = origin.clone().add(baselineDir).project(cam)
    // NDC y is up, CSS rotate is clockwise-positive -> negate dy.
    return (Math.atan2(-(end.y - start.y), end.x - start.x) * 180) / Math.PI
  }

  private clearScene() {
    if (this.group) {
      this.group.traverse((obj: any) => {
        if (obj.geometry) obj.geometry.dispose()
        if (Array.isArray(obj.material)) obj.material.forEach((material: THREE.Material) => material.dispose())
        else if (obj.material) obj.material.dispose()
      })
      this.model.scene.remove(this.group)
      this.group = null
    }
    this.items = []
    this.model.labeler.deleteAll('reaction')
  }

  private buildMomentArc(group: THREE.Group, dir: THREE.Vector3, radius: number, color: string) {
    const arc = 4.9 // ~280 degree sweep

    // The arc sweeps in the plane perpendicular to the moment axis, in the
    // right-hand-rule sense (plane normal mapped onto the moment axis).
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize())

    const points: THREE.Vector3[] = []
    const segments = 48
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * arc
      points.push(
        new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0)
          .applyQuaternion(quaternion)
          .multiplyScalar(radius),
      )
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color }),
    )

    // Cone head at the end of the sweep, oriented along the local tangent.
    const tangent = new THREE.Vector3(-Math.sin(arc), Math.cos(arc), 0).applyQuaternion(quaternion).normalize()
    const headLength = radius * 0.5
    const head = new THREE.Mesh(
      new THREE.ConeGeometry(headLength * 0.4, headLength, 12),
      new THREE.MeshBasicMaterial({ color }),
    )
    head.position.copy(points[points.length - 1]).addScaledVector(tangent, headLength * 0.4)
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent)

    group.add(line, head)
  }

  /** Convert an on-screen pixel length at a world position into world units. */
  private pixelToWorld(position: THREE.Vector3, pixels: number): number {
    const cam = this.model.camera.cam
    const height = this.model.renderer.getSize(SIZE_VECTOR).y || 1
    if ((cam as THREE.OrthographicCamera).isOrthographicCamera) {
      const ortho = cam as THREE.OrthographicCamera
      return (pixels * ((ortho.top - ortho.bottom) / (ortho.zoom || 1))) / height
    }
    const perspective = cam as THREE.PerspectiveCamera
    const distance = Math.max(perspective.position.distanceTo(position), 1e-3)
    return (pixels * 2 * distance * Math.tan((perspective.fov * Math.PI) / 360)) / height
  }
}

export default ReactionViz
