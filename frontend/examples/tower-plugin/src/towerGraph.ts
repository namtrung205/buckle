/**
 * Pure lattice-tower graph generator — third-party plugin port of the built-in
 * `generateTowerGraph` (frontend/src/model/Generators/TowerGenerator.ts).
 * No model access: the panel feeds in the selected section ids and gets back a
 * semantic graph whose roles are namespaced under `tpl:` so it never collides
 * with the built-in `Tower` kind. Coordinates use the document's Z-up record
 * convention ([x, y, z]).
 */

export type Vec3 = readonly [number, number, number]

export type TowerPlanInput = Readonly<{
  circuit: string
  bodyHeight: number
  peakHeight: number
  baseWidth: number
  topWidth: number
  panelCount: number
  straightPanels: number
  taper: 'linear' | 'step'
  armCount: number
  armLength: number
  armDrop: number
  armSpacing: number
  legSectionId: number
  braceSectionId: number
  autoSupports: boolean
  supportKind: 'pinned' | 'fixed'
  autoLoads: boolean
  windX: number
  windY: number
  windZ: number
  windForce: number
  gravity: number
}>

export type PlanNode = { role: string; record: { name: string; position: Vec3 } }
export type PlanMember = {
  role: string
  nodeIRole: string
  nodeJRole: string
  sectionId: number
  record: { label: string }
}
export type PlanSupport = {
  role: string
  targetNodeRoles: readonly string[]
  record: {
    name: string
    type: 'pinned' | 'fixed'
    dx: number; dy: number; dz: number
    rx: number; ry: number; rz: number
  }
}
export type PlanLoad = {
  role: string
  targetRoles: readonly string[]
  record: { name: string; type: 'nodal'; value: Vec3 }
}

export type TowerGraph = {
  nodes: PlanNode[]
  members: PlanMember[]
  boundaryConditions: PlanSupport[]
  loads: PlanLoad[]
}

/** Validate the raw form values before any geometry math runs. */
export function validateTowerParams(p: TowerPlanInput): string | null {
  for (const [name, value] of Object.entries({
    bodyHeight: p.bodyHeight, baseWidth: p.baseWidth, topWidth: p.topWidth,
  })) {
    if (!Number.isFinite(value) || value <= 0) return `${name} phải lớn hơn 0`
  }
  if (!Number.isSafeInteger(p.panelCount) || p.panelCount < 1) return 'Số tầng phải là số nguyên dương'
  if (p.topWidth > p.baseWidth) return 'Độ rộng đỉnh không được vượt quá độ rộng chân'
  if (p.straightPanels < 0 || p.straightPanels >= p.panelCount) return 'Số tầng thẳng phải nằm trong [0, số tầng - 1]'
  if (p.armCount < 0 || p.armCount > 3) return 'Số tai đỡ phải từ 0 đến 3'
  if (p.peakHeight < 0) return 'Chiều cao đỉnh không được âm'
  return null
}

/** Cross-sectional gross area (m²) — port of the built-in `sectionArea`. */
export function sectionArea(section: Record<string, unknown> | undefined): number {
  if (!section) return 0
  const num = (...keys: string[]): number => {
    for (const key of keys) {
      const value = section[key]
      if (typeof value === 'number' && Number.isFinite(value)) return value
    }
    return 0
  }
  switch (section.type) {
    case 'Rectangular': return num('width') * num('height') * 1e-6
    case 'Circular': return Math.PI * (num('diameter') / 2) ** 2 * 1e-6
    case 'HollowCircular': {
      const r = num('diameter') / 2 - num('thickness')
      return Math.PI * ((num('diameter') / 2) ** 2 - r * r) * 1e-6
    }
    case 'I':
    case 'IPN':
      return (2 * num('width') * num('tf') + (num('depth') - 2 * num('tf')) * num('tw')) * 1e-6
    case 'RectangularHollow': {
      const wi = num('width') - 2 * num('thickness')
      const hi = num('height') - 2 * num('thickness')
      return (num('width') * num('height') - wi * hi) * 1e-6
    }
    case 'Channel':
    case 'UPN':
      return (2 * num('width') * num('tf') + (num('depth') - 2 * num('tf')) * num('tw')) * 1e-6
    case 'Angle': {
      const t = num('thickness')
      return (2 * num('width') * t - t * t) * 1e-6
    }
    case 'Tee':
      return (num('width') * num('tf') + (num('depth') - num('tf')) * num('tw')) * 1e-6
    default:
      return 0
  }
}

/**
 * Generate the semantic graph. Same shape rules as the built-in generator:
 * belts (levels) → legs + belts + X-braces per panel, optional peak,
 * delta arms bolted to the straight head, per-foot supports and
 * self-weight + altitude-ramped wind nodal loads grouped by vector.
 */
export function generateTowerGraph(params: TowerPlanInput): TowerGraph {
  const panels = Math.max(1, Math.round(params.panelCount))
  const straight = Math.max(0, Math.min(panels - 1, Math.round(params.straightPanels)))
  const taperPanels = panels - straight
  const halfWidthAt = (i: number): number => {
    const t = taperPanels <= 0 ? 1 : Math.min(Math.max(i, 0), taperPanels) / taperPanels
    return (params.baseWidth + (params.topWidth - params.baseWidth) * t) / 2
  }

  type Level = { y: number; halfW: number }
  let levels: Level[] = []
  const bodyLevelIdx: number[] = []
  for (let i = 0; i <= panels; i++) {
    bodyLevelIdx.push(levels.length)
    levels.push({ y: (params.bodyHeight * i) / panels, halfW: halfWidthAt(i) })
  }
  if (params.taper === 'step') {
    const stepped: Level[] = []
    for (let i = 0; i < panels; i++) {
      const a = levels[i]
      const b = levels[i + 1]
      stepped.push(a)
      stepped.push({ y: a.y + (b.y - a.y) * 0.6, halfW: a.halfW })
    }
    stepped.push(levels[levels.length - 1])
    levels = stepped
  }

  const nodes: PlanNode[] = []
  const members: PlanMember[] = []
  const nodeRole = (level: number, corner: number) => `tpl:level:${level}:corner:${corner}`
  const addNode = (role: string, position: Vec3): PlanNode => {
    const node: PlanNode = { role, record: { name: role, position } }
    nodes.push(node)
    return node
  }
  const addMember = (role: string, a: PlanNode, b: PlanNode, sectionId: number, label: string) => {
    members.push({ role, nodeIRole: a.role, nodeJRole: b.role, sectionId, record: { label } })
  }
  // Belts: 4 corner nodes per level, then panel legs/belts/X-braces.
  const belts: PlanNode[][] = levels.map((lv, li) => [
    addNode(nodeRole(li, 0), [-lv.halfW, -lv.halfW, lv.y]),
    addNode(nodeRole(li, 1), [lv.halfW, -lv.halfW, lv.y]),
    addNode(nodeRole(li, 2), [lv.halfW, lv.halfW, lv.y]),
    addNode(nodeRole(li, 3), [-lv.halfW, lv.halfW, lv.y]),
  ])

  const faces: readonly [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0]]
  for (let j = 0; j < belts.length - 1; j++) {
    const lo = belts[j]
    const hi = belts[j + 1]
    for (let c = 0; c < 4; c++) addMember(`tpl:panel:${j}:leg:${c}`, lo[c], hi[c], params.legSectionId, 'Tower leg')
    for (let c = 0; c < 4; c++) addMember(`tpl:level:${j + 1}:belt:${c}`, hi[c], hi[(c + 1) % 4], params.braceSectionId, 'Tower belt')
    for (const [a, b] of faces) {
      addMember(`tpl:panel:${j}:brace:a:${a}`, lo[a], hi[b], params.braceSectionId, 'Tower brace')
      addMember(`tpl:panel:${j}:brace:b:${a}`, lo[b], hi[a], params.braceSectionId, 'Tower brace')
    }
  }

  // Peak (shield-wire support)
  if (params.peakHeight > 0) {
    const top = belts[belts.length - 1]
    const apex = addNode('tpl:peak:apex', [0, 0, params.bodyHeight + params.peakHeight])
    for (let c = 0; c < 4; c++) addMember(`tpl:peak:${c}`, top[c], apex, params.legSectionId, 'Tower peak')
  }

  // Delta arms bolted to the straight head (tầng 2), như built-in.
  const armCount = Math.max(0, Math.min(3, Math.round(params.armCount)))
  if (armCount > 0) {
    const armCandidates = straight > 0
      ? levels.map((_, i) => i).filter((i) => Math.abs(levels[i].halfW - params.topWidth / 2) < 1e-6)
      : bodyLevelIdx
    const armBelts: number[] = []
    for (let k = 0; k < armCount; k++) {
      const targetY = params.bodyHeight - k * params.armSpacing
      let best = -1
      for (const bi of armCandidates) {
        const lv = levels[bi]
        if (lv.y <= targetY + 1e-6 && (best === -1 || lv.y > levels[best].y)) best = bi
      }
      if (best === -1 || armBelts.includes(best)) break
      armBelts.push(best)
    }
    for (const bi of armBelts) {
      const lv = levels[bi]
      const belt = belts[bi]
      const lowerBelt = bi > 0 ? belts[bi - 1] : null
      for (const side of [-1, 1] as const) {
        const name = side > 0 ? 'right' : 'left'
        const [c1, c2] = side > 0 ? [belt[1], belt[2]] : [belt[3], belt[0]]
        const tip = addNode(`tpl:arm:${bi}:${name}:tip`,
          [side * (lv.halfW + params.armLength), 0, lv.y - params.armDrop])
        addMember(`tpl:arm:${bi}:${name}:top:${c1.role}`, c1, tip, params.braceSectionId, 'Tower arm')
        addMember(`tpl:arm:${bi}:${name}:bot:${c2.role}`, c2, tip, params.braceSectionId, 'Tower arm')
        if (lowerBelt) {
          const l1 = side > 0 ? lowerBelt[1] : lowerBelt[3]
          addMember(`tpl:arm:${bi}:${name}:stay:${l1.role}`, l1, tip, params.braceSectionId, 'Tower arm')
        }
      }
    }
  }

  // Supports: one per base node (giống built-in — 1 BC/foot).
  const boundaryConditions: PlanSupport[] = []
  if (params.autoSupports) {
    const fixed = params.supportKind === 'fixed'
    for (let c = 0; c < belts[0].length; c++) {
      boundaryConditions.push({
        role: `tpl:base:${c}:support`,
        targetNodeRoles: [belts[0][c].role],
        record: {
          name: 'Tower base', type: fixed ? 'fixed' : 'pinned',
          dx: 1, dy: 1, dz: 1,
          rx: fixed ? 1 : 0, ry: fixed ? 1 : 0, rz: fixed ? 1 : 0,
        },
      })
    }
  }

  // Loads: wind (altitude-ramped) grouped by vector + gravity lumped per node.
  const loads: PlanLoad[] = []
  if (params.autoLoads) {
    const totalH = params.bodyHeight + params.peakHeight
    const windNorm = Math.hypot(params.windX, params.windY, params.windZ) || 1
    const windBase = params.windForce > 0 ? params.windForce : 0
    const keyOf = (node: PlanNode): string => {
      const [, , y] = node.record.position
      const factor = 0.5 + 0.5 * (totalH > 0 ? Math.max(0, Math.min(1, y / totalH)) : 0)
      const wx = (params.windX / windNorm) * windBase * factor / 1000
      const wy = (params.windY / windNorm) * windBase * factor / 1000
      const wz = (params.windZ / windNorm) * windBase * factor / 1000
      return `${wx.toFixed(3)}|${wy.toFixed(3)}|${wz.toFixed(3)}`
    }
    const valueOf = (key: string): [number, number, number] => key.split('|').map(Number) as [number, number, number]
    const groups = new Map<string, string[]>()
    for (const node of nodes) {
      const key = keyOf(node)
      const targets = groups.get(key)
      if (targets) targets.push(node.role)
      else groups.set(key, [node.role])
    }
    let index = 0
    for (const [key, targets] of groups) {
      const [wx, wy, wz] = valueOf(key)
      loads.push({
        role: `tpl:load:${index++}`,
        targetRoles: targets,
        record: { name: 'Tower auto-load', type: 'nodal', value: [wx, wy, wz - params.gravity * 0.001] },
      })
    }
  }

  return { nodes, members, boundaryConditions, loads }
}
