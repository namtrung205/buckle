import { Model } from "../Model"

import * as THREE from 'three'
import { makeAutoObservable } from 'mobx'
import { jsonArrayToThree } from '../../utils/axis'
import type { Label } from '../Labeler/Labeler'

export const REACTION_COMPONENTS = ['Fx', 'Fy', 'Fz', 'Mx', 'My', 'Mz'] as const
export type ReactionComponent = (typeof REACTION_COMPONENTS)[number]

const POS_COLOR = '#2f6fed'    // positive force - same accent as the effort labels
const NEG_COLOR = '#e5484d'    // negative force
const MOMENT_COLOR = '#f59e0b' // moment arcs

// Screen-space sizing of the moment symbol: constant on-screen radius (in
// CSS pixels) no matter how far the camera is, plus a small pill gap.
const MOMENT_ARC_PIXEL_RADIUS = 20
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

/**
 * Renders support reactions in the 3D scene, Midas-Civil style: one thin
 * arrow (same language as the load arrows) per checked force component
 * (Fx/Fy/Fz) and one thin arc per checked moment component (Mx/My/Mz) at
 * every restrained node. Every arrow points INTO its node - it starts
 * outside and the head lands on the node - with optional CSS2D value pills.
 * Arrow sizes auto-normalize between the smallest and largest shown value.
 * Nothing is drawn until the dialog hits Apply.
 */
class ReactionViz {
  model: Model
  private group: THREE.Group | null = null

  // Live moment arcs, rescaled every frame so they keep a constant on-screen
  // size regardless of zoom / pan / camera switches (ortho <-> perspective).
  private arcs: {
    group: THREE.Group
    origin: THREE.Vector3
    startDir: THREE.Vector3
    baseRadius: number
    labelId?: string
    labelText?: string
  }[] = []

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

  /** (Re)build the arrows + labels from the current analysis output. */
  render() {
    this.clearScene()

    const reactions: ReactionEntry[] = this.model.output?.reactions ?? []
    if (!reactions.length || !this.isAnyActive) return

    const active = REACTION_COMPONENTS.filter((component) => this.show[component])

    // Magnitude range of the shown values - Load-style min/max normalization.
    let maxValue = 0
    let minValue = Infinity
    for (const reaction of reactions) {
      for (const component of active) {
        const value = Math.abs(reaction[component] ?? 0)
        if (value < 1e-9) continue
        if (value > maxValue) maxValue = value
        if (value < minValue) minValue = value
      }
    }
    if (maxValue <= 0) return
    if (!isFinite(minValue) || maxValue === minValue) minValue = maxValue

    const modelSize = this.computeModelSize()
    const sizeMin = modelSize * 0.08
    const sizeMax = modelSize * 0.18

    const group = new THREE.Group()
    const labels: Label[] = []

    for (const reaction of reactions) {
      const origin = jsonArrayToThree([reaction.x ?? 0, reaction.y ?? 0, reaction.z ?? 0])
      let labelIndex = 0
      for (const component of active) {
        const value = reaction[component] ?? 0
        if (Math.abs(value) < 1e-9) continue

        const isMoment = component[0] === 'M'
        const normalized = (Math.abs(value) - minValue) / (maxValue - minValue)
        const size = sizeMin + normalized * (sizeMax - sizeMin)
        const dir = AXIS_BY_COMPONENT[component].clone().multiplyScalar(value >= 0 ? 1 : -1)
        const color = isMoment ? MOMENT_COLOR : (value >= 0 ? POS_COLOR : NEG_COLOR)

        if (isMoment) {
          // Screen-sized symbol: the arc keeps a constant on-screen radius
          // (rescaled every frame) and hugs the support node.
          const arcRadius = this.pixelToWorld(origin, MOMENT_ARC_PIXEL_RADIUS)
          const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize())
          const arcGroup = new THREE.Group()
          arcGroup.position.copy(origin)
          this.buildMomentArc(arcGroup, dir, arcRadius, color)
          group.add(arcGroup)
          this.arcs.push({
            group: arcGroup,
            origin,
            startDir: new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion),
            baseRadius: arcRadius,
            labelId: this.showLabels ? `reaction-${component}-${reaction.id}` : undefined,
            labelText: `${component} ${fmt(value)}`,
          })
          if (this.showLabels) {
            labels.push({
              id: `reaction-${component}-${reaction.id}`,
              position: origin.clone().addScaledVector(
                new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion),
                arcRadius + this.pixelToWorld(origin, MOMENT_LABEL_GAP_PIXELS),
              ),
              text: `${component} ${fmt(value)}`,
              type: 'reaction',
              backgroundColor: color,
            })
          }
        } else {
          // Thin ArrowHelper like the load arrows: it starts outside and the
          // head lands on the node, pointing into it.
          const arrow = new THREE.ArrowHelper(
            dir,
            origin.clone().addScaledVector(dir, -size),
            size,
            new THREE.Color(color),
            size * 0.28,
            size * 0.18,
          )
          group.add(arrow)

          if (this.showLabels) {
            // Stack the pills of a shared node outward along their own axis so
            // several checked components never overlap on the same anchor.
            const stackOffset = labelIndex * modelSize * 0.022
            labels.push({
              id: `reaction-${component}-${reaction.id}`,
              position: origin.clone().addScaledVector(dir, -(size * 1.15 + stackOffset)),
              text: `${component} ${fmt(value)}`,
              type: 'reaction',
              backgroundColor: color,
            })
            labelIndex += 1
          }
        }
      }
    }

    if (labels.length) this.model.labeler.create(labels)
    this.model.scene.add(group)
    this.group = group
  }

  /** Remove every arrow/label of this visualisation from the scene. */
  dispose() {
    this.clearScene()
  }

  /** Per-frame hook (Model.update): keep the moment arcs pixel-sized. */
  onFrame() {
    if (!this.arcs.length) return
    for (const arc of this.arcs) {
      const target = this.pixelToWorld(arc.origin, MOMENT_ARC_PIXEL_RADIUS)
      arc.group.scale.setScalar(target / arc.baseRadius)
      if (arc.labelId) {
        this.model.labeler.updateOne({
          id: arc.labelId,
          position: arc.origin
            .clone()
            .addScaledVector(arc.startDir, target + this.pixelToWorld(arc.origin, MOMENT_LABEL_GAP_PIXELS)),
          text: arc.labelText ?? '',
          type: 'reaction',
        })
      }
    }
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
    this.model.labeler.deleteAll('reaction')
    this.arcs = []
  }

  private buildMomentArc(group: THREE.Group, dir: THREE.Vector3, radius: number, color: string) {
    const arc = 4.9 // ~280 degree sweep

    // The arc sweeps in the plane perpendicular to the moment axis, in the
    // right-hand-rule sense (mapping the arc plane normal onto the axis).
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

  /** Largest extent of the analysed model, used to auto-scale the arrows. */
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
}

export default ReactionViz
