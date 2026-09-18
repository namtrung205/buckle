/**
 * Pure builder for the instanced GPU load batch (Rendering/LoadGpuRenderer).
 *
 * It mirrors the visual language of the legacy per-load Object3D code —
 * red end arrows + semi-transparent band for distributed loads, axis-coloured
 * arrows for nodal loads, wind/snow arrows for shell pressure — but emits
 * plain instance descriptors instead of scene objects, so a model's entire
 * load set renders in 3 constant draw calls.
 */

export type Vec3 = readonly [number, number, number]
export type LoadRgb = readonly [number, number, number]

export type LoadInstanceLoad = {
  id: number
  type: 'nodal' | 'linear' | 'area' | 'pressure'
  targets: readonly number[]
  value: { x: number; y: number; z: number }
  magnitude?: number
}

export type LoadInstanceNode = { id: number; x: number; y: number; z: number }
export type LoadInstanceMember = { id: number; nodes: readonly LoadInstanceNode[] }
export type LoadInstanceShell = { id: number; nodes: readonly LoadInstanceNode[] }

/** Minimal structural view of Model — keeps this builder pure and testable. */
export type LoadInstanceModel = {
  loads: readonly LoadInstanceLoad[]
  nodes: readonly LoadInstanceNode[]
  members: readonly LoadInstanceMember[]
  shells: readonly LoadInstanceShell[]
}

export type LoadArrowInstance = {
  /** Tail of the arrow (opposite the load direction, outside the entity). */
  origin: Vec3
  /** Head tip — lands on the loaded entity (node / member end / shell centre). */
  tip: Vec3
  headLength: number
  headWidth: number
  color: LoadRgb
}

export type LoadBandInstance = {
  /** Member axis endpoints; the band spans start→end and start+offset→end+offset. */
  start: Vec3
  end: Vec3
  offset: Vec3
  color: LoadRgb
}

export type LoadInstances = { arrows: LoadArrowInstance[]; bands: LoadBandInstance[] }

export const hexToRgb = (hex: number): LoadRgb => [
  ((hex >> 16) & 255) / 255,
  ((hex >> 8) & 255) / 255,
  (hex & 255) / 255,
]

// Visual constants mirrored 1:1 from the legacy Load.ts drawing code.
const DISTRIBUTED_COLOR = hexToRgb(0xff0000)
const NODAL_AXIS_COLORS: readonly LoadRgb[] = [hexToRgb(0xff0000), hexToRgb(0x00ff00), hexToRgb(0x0000ff)]
const WIND_COLOR = hexToRgb(0x9c27b0)
const SNOW_COLOR = hexToRgb(0x00bcd4)

const ARROW_LEN_MAX = 1.0
const ARROW_LEN_MIN = 0.3
const NODAL_ARROW_LENGTH = 1.0
const PRESSURE_ARROW_LENGTH = 1.0

/** Sharp CAD-style arrowheads: a slim radius (~15% of the length) reads much
 *  lighter than the legacy ArrowHelper cones, whose radius equalled their
 *  height (a fat 45° half-angle). */
const slimHead = (length: number) => ({ length, width: length * 0.15 })
const DISTRIBUTED_HEAD = slimHead(0.1)
const NODAL_HEAD = slimHead(0.15)
const PRESSURE_HEAD = slimHead(0.35)

export const vecSub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const vecAdd = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const vecScale = (a: Vec3, factor: number): Vec3 => [a[0] * factor, a[1] * factor, a[2] * factor]
export const vecLength = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
export const vecCross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
export const vecNormalize = (a: Vec3): Vec3 => {
  const length = vecLength(a)
  return length > 1e-12 ? vecScale(a, 1 / length) : ([0, 0, 0] as Vec3)
}

const buildDistributedInstances = (
  loads: readonly LoadInstanceLoad[],
  members: readonly LoadInstanceMember[],
  arrows: LoadArrowInstance[],
  bands: LoadBandInstance[],
) => {
  // Same max/min normalisation the legacy per-load create used (evaluated over
  // every load), now computed once per sync so all arrows share one consistent
  // scale regardless of creation order.
  const magnitudes = loads.map(load => vecLength([load.value.x, load.value.y, load.value.z]))
  const maxLoad = magnitudes.reduce((max, value) => (value > max ? value : max), 0)
  const minLoad = magnitudes.reduce((min, value) => (value < min ? value : min), maxLoad)
  const arrowLengthFor = (magnitude: number) => {
    if (maxLoad === minLoad) return (ARROW_LEN_MAX + ARROW_LEN_MIN) / 2
    return ARROW_LEN_MIN + ((magnitude - minLoad) / (maxLoad - minLoad)) * (ARROW_LEN_MAX - ARROW_LEN_MIN)
  }
  for (const load of loads) {
    if (load.type !== 'linear') continue
    const value: Vec3 = [load.value.x, load.value.y, load.value.z]
    const valueLength = vecLength(value)
    if (valueLength < 1e-12) continue // no direction to draw
    const direction = vecScale(value, 1 / valueLength)
    const arrowLength = arrowLengthFor(valueLength)
    // Midas-style display: only the first/last arrows plus the band (the band
    // conveys the distribution between the two ends).
    const offset = vecScale(direction, -arrowLength)
    for (const target of load.targets) {
      const member = members.find(item => item.id === target)
      if (!member || member.nodes.length < 2) continue
      const startNode = member.nodes[0]
      const endNode = member.nodes[1]
      const axis = vecSub([endNode.x, endNode.y, endNode.z], [startNode.x, startNode.y, startNode.z])
      if (vecLength(axis) < 1e-12) continue // degenerate (zero-length) member
      for (const node of [startNode, endNode]) {
        const position: Vec3 = [node.x, node.y, node.z]
        arrows.push({
          origin: vecAdd(position, offset),
          tip: position,
          headLength: DISTRIBUTED_HEAD.length,
          headWidth: DISTRIBUTED_HEAD.width,
          color: DISTRIBUTED_COLOR,
        })
      }
      // Legacy hides the band when the load runs parallel to the member axis.
      if (vecLength(vecCross(axis, direction)) >= 0.001) {
        bands.push({
          start: [startNode.x, startNode.y, startNode.z],
          end: [endNode.x, endNode.y, endNode.z],
          offset,
          color: DISTRIBUTED_COLOR,
        })
      }
    }
  }
}

const buildNodalInstances = (
  loads: readonly LoadInstanceLoad[],
  nodes: readonly LoadInstanceNode[],
  arrows: LoadArrowInstance[],
) => {
  for (const load of loads) {
    if (load.type !== 'nodal') continue
    for (const target of load.targets) {
      const node = nodes.find(item => item.id === target)
      if (!node) continue
      const position: Vec3 = [node.x, node.y, node.z]
      const components: Vec3 = [load.value.x, load.value.y, load.value.z]
      for (let axisIndex = 0; axisIndex < 3; axisIndex++) {
        const value = components[axisIndex]
        if (Math.abs(value) <= 0.001) continue
        const axisDirection: Vec3 = axisIndex === 0 ? [1, 0, 0] : axisIndex === 1 ? [0, 1, 0] : [0, 0, 1]
        // Improvement over legacy: each arrow runs along ITS OWN axis and dives
        // into the node from the opposite side (legacy pointed all three along
        // the resultant, contradicting the per-axis colour coding).
        const drawDirection = vecScale(axisDirection, Math.sign(value))
        arrows.push({
          origin: vecAdd(position, vecScale(drawDirection, -NODAL_ARROW_LENGTH)),
          tip: position,
          headLength: NODAL_HEAD.length,
          headWidth: NODAL_HEAD.width,
          color: NODAL_AXIS_COLORS[axisIndex],
        })
      }
    }
  }
}

const buildPressureInstances = (
  loads: readonly LoadInstanceLoad[],
  shells: readonly LoadInstanceShell[],
  arrows: LoadArrowInstance[],
) => {
  for (const load of loads) {
    if (load.type !== 'pressure') continue
    for (const targetId of load.targets) {
      const shell = shells.find(item => item.id === targetId)
      if (!shell || shell.nodes.length < 3) continue
      const sum = shell.nodes.reduce<Vec3>(
        (acc, node) => [acc[0] + node.x, acc[1] + node.y, acc[2] + node.z],
        [0, 0, 0],
      )
      const nodeCount = shell.nodes.length
      const center: Vec3 = [sum[0] / nodeCount, sum[1] / nodeCount, sum[2] / nodeCount]
      const p0: Vec3 = [shell.nodes[0].x, shell.nodes[0].y, shell.nodes[0].z]
      const p1: Vec3 = [shell.nodes[1].x, shell.nodes[1].y, shell.nodes[1].z]
      const p2: Vec3 = [shell.nodes[2].x, shell.nodes[2].y, shell.nodes[2].z]
      const normal = vecNormalize(vecCross(vecSub(p1, p0), vecSub(p2, p0)))
      let direction: Vec3
      let color: LoadRgb
      if (load.magnitude !== undefined && Math.abs(load.magnitude) > 0) {
        direction = vecScale(normal, Math.sign(load.magnitude)) // wind: surface normal
        color = WIND_COLOR
      } else {
        direction = vecNormalize([load.value.x, load.value.y, load.value.z]) // snow: global direction
        color = SNOW_COLOR
      }
      if (vecLength(direction) < 0.1) continue // legacy guard for a zero direction
      arrows.push({
        origin: vecAdd(center, vecScale(direction, -PRESSURE_ARROW_LENGTH)),
        tip: center,
        headLength: PRESSURE_HEAD.length,
        headWidth: PRESSURE_HEAD.width,
        color,
      })
    }
  }
}

/** Builds every arrow/band instance for the model's current load set. */
export const buildLoadInstances = (model: LoadInstanceModel): LoadInstances => {
  const arrows: LoadArrowInstance[] = []
  const bands: LoadBandInstance[] = []
  buildDistributedInstances(model.loads, model.members, arrows, bands)
  buildNodalInstances(model.loads, model.nodes, arrows)
  buildPressureInstances(model.loads, model.shells, arrows)
  return { arrows, bands }
}


export type ReactionComponentName = 'Fx' | 'Fy' | 'Fz' | 'Mx' | 'My' | 'Mz'

export type ReactionInstanceRow = {
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

export type ReactionInstanceDeps = {
  /** Scene nodes (three.js Y-up) - the arrow tip lands on the node position. */
  nodes: readonly LoadInstanceNode[]
  /** Raw solver rows (OpenSees Z-up: ops X/Y horizontal, ops Z vertical). */
  reactions: readonly ReactionInstanceRow[]
  /** Checked reaction components; only these are drawn. */
  components: readonly ReactionComponentName[]
}

/** Support reactions reuse the nodal-load arrow language: one shaft + slim
 *  cone diving INTO the support node (tip on the node = the reaction acts on
 *  the structure). Backend rows are OpenSees Z-up while the scene is
 *  three.js Y-up, so both the axis and the position are converted
 *  (ops X->X, ops Y->Z, ops Z->Y); the scene node position is authoritative
 *  and the raw row coordinates are only a fallback. Moment reactions draw a
 *  double-headed arrow (two staggered cones) along the moment axis. */
export const buildReactionInstances = ({ nodes, reactions, components }: ReactionInstanceDeps): LoadArrowInstance[] => {
  const arrows: LoadArrowInstance[] = []
  if (!components.length) return arrows
  for (const reaction of reactions) {
    const sceneNode = nodes.find(node => node.id === reaction.id)
    const tip: Vec3 = sceneNode
      ? [sceneNode.x, sceneNode.y, sceneNode.z]
      : [reaction.x ?? 0, reaction.z ?? 0, reaction.y ?? 0] // Z-up -> Y-up fallback
    for (const component of components) {
      const value = Number(reaction[component] ?? 0)
      if (!Number.isFinite(value) || Math.abs(value) < 1e-9) continue
      // ops X -> scene X, ops Y -> scene Z, ops Z (vertical) -> scene Y.
      const axis: Vec3 = component[1] === 'x' ? [1, 0, 0] : component[1] === 'y' ? [0, 0, 1] : [0, 1, 0]
      const direction = vecScale(axis, value >= 0 ? 1 : -1)
      const color: LoadRgb = component[0] === 'M' ? [1, .62, .05] : [0.2, .45, 1]
      if (component[0] !== 'M') {
        arrows.push({
          origin: vecAdd(tip, vecScale(direction, -NODAL_ARROW_LENGTH)),
          tip,
          headLength: NODAL_HEAD.length,
          headWidth: NODAL_HEAD.width,
          color,
        })
        continue
      }
      // Double head: outer cone tip on the node, inner cone staggered behind
      // it - both point into the node (right-hand-rule direction).
      arrows.push(
        {
          origin: vecAdd(tip, vecScale(direction, -NODAL_ARROW_LENGTH)),
          tip,
          headLength: NODAL_HEAD.length,
          headWidth: NODAL_HEAD.width,
          color,
        },
        {
          origin: vecAdd(tip, vecScale(direction, -0.55)),
          tip: vecAdd(tip, vecScale(direction, -0.25)),
          headLength: NODAL_HEAD.length,
          headWidth: NODAL_HEAD.width,
          color,
        },
      )
    }
  }
  return arrows
}
