import type { ParametricEntityGraph } from '../../core/structural/index.ts'

export type TowerParametricParameters = Record<string, unknown> & Readonly<{
  circuit: 'single' | 'double'
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
  windForce: number
  gravity: number
  legArea: number
  braceArea: number
  legDensity: number
  braceDensity: number
}>

/** Browser-independent lattice tower graph for AI, tests and future MCP callers. */
export const generateTowerParametricGraph = (params: Readonly<TowerParametricParameters>): ParametricEntityGraph => {
  for (const [name, value] of Object.entries({ bodyHeight: params.bodyHeight, baseWidth: params.baseWidth, topWidth: params.topWidth })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be greater than zero`)
  }
  if (!Number.isSafeInteger(params.panelCount) || params.panelCount < 1) throw new Error('panelCount must be a positive integer')
  if (params.topWidth > params.baseWidth) throw new Error('topWidth cannot exceed baseWidth')
  const nodes: NonNullable<ParametricEntityGraph['nodes']>[number][] = []
  const members: NonNullable<ParametricEntityGraph['members']>[number][] = []
  const supports: NonNullable<ParametricEntityGraph['boundaryConditions']>[number][] = []
  const loads: NonNullable<ParametricEntityGraph['loads']>[number][] = []
  const positions = new Map<string, readonly [number, number, number]>()
  const nodeRole = (level: number, corner: number) => `tower:level:${level}:corner:${corner}:node`
  const addNode = (role: string, position: readonly [number, number, number]) => { nodes.push({ role, record: { name: role, position } }); positions.set(role, position) }
  const addMember = (role: string, nodeIRole: string, nodeJRole: string, sectionId: number, label: string) => members.push({ role, nodeIRole, nodeJRole, sectionId, record: { label } })
  const straight = Math.min(params.panelCount - 1, Math.max(0, params.straightPanels))
  const taperPanels = Math.max(1, params.panelCount - straight)
  const widths: number[] = []
  for (let level = 0; level <= params.panelCount; level++) {
    const ratio = Math.min(level, taperPanels) / taperPanels
    const width = params.baseWidth + (params.topWidth - params.baseWidth) * ratio
    widths.push(width)
    const half = width / 2; const z = params.bodyHeight * level / params.panelCount
    ;[[-half, -half], [half, -half], [half, half], [-half, half]].forEach(([x, y], corner) => addNode(nodeRole(level, corner), [x, y, z]))
  }
  for (let panel = 0; panel < params.panelCount; panel++) {
    for (let corner = 0; corner < 4; corner++) {
      addMember(`tower:panel:${panel}:leg:${corner}`, nodeRole(panel, corner), nodeRole(panel + 1, corner), params.legSectionId, 'Tower leg')
      addMember(`tower:level:${panel + 1}:belt:${corner}`, nodeRole(panel + 1, corner), nodeRole(panel + 1, (corner + 1) % 4), params.braceSectionId, 'Tower belt')
      addMember(`tower:panel:${panel}:brace:a:${corner}`, nodeRole(panel, corner), nodeRole(panel + 1, (corner + 1) % 4), params.braceSectionId, 'Tower brace')
      addMember(`tower:panel:${panel}:brace:b:${corner}`, nodeRole(panel, (corner + 1) % 4), nodeRole(panel + 1, corner), params.braceSectionId, 'Tower brace')
    }
  }
  if (params.peakHeight > 0) {
    const apex = 'tower:peak:apex-node'; addNode(apex, [0, 0, params.bodyHeight + params.peakHeight])
    for (let corner = 0; corner < 4; corner++) addMember(`tower:peak:${corner}`, nodeRole(params.panelCount, corner), apex, params.legSectionId, 'Tower peak')
  }
  const armCount = Math.min(3, Math.max(0, params.armCount))
  for (let arm = 0; arm < armCount; arm++) {
    const level = Math.max(1, params.panelCount - Math.round(arm * params.armSpacing / (params.bodyHeight / params.panelCount)))
    for (const side of [-1, 1] as const) {
      const sideName = side < 0 ? 'left' : 'right'; const tip = `tower:arm:${arm}:${sideName}:tip-node`
      addNode(tip, [side * (widths[level] / 2 + params.armLength), 0, params.bodyHeight * level / params.panelCount - params.armDrop])
      const corners = side < 0 ? [0, 3] : [1, 2]
      corners.forEach((corner, index) => addMember(`tower:arm:${arm}:${sideName}:${index}`, nodeRole(level, corner), tip, params.braceSectionId, 'Tower arm'))
    }
  }
  if (params.autoSupports) for (let corner = 0; corner < 4; corner++) supports.push({
    role: `tower:base:${corner}:support`, targetNodeRoles: [nodeRole(0, corner)],
    record: { name: 'Tower base', type: params.supportKind, dx: 1, dy: 1, dz: 1, rx: params.supportKind === 'fixed' ? 1 : 0, ry: params.supportKind === 'fixed' ? 1 : 0, rz: params.supportKind === 'fixed' ? 1 : 0 },
  })
  if (params.autoLoads) for (const node of nodes) {
    const altitude = node.record.position[2]
    loads.push({ role: `${node.role}:load`, targetRoles: [node.role], record: { name: 'Tower auto-load', type: 'nodal', value: [params.windForce * (0.5 + altitude / (2 * (params.bodyHeight + params.peakHeight))), 0, -params.gravity * 0.001] } })
  }
  return { nodes, members, boundaryConditions: supports, loads }
}
