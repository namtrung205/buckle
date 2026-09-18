import type { ParametricEntityGraph } from '../../core/structural/index.ts'

export type TrussParameters = Record<string, unknown> & Readonly<{
  span: number
  height: number
  panelCount: number
  sectionId: number
  origin?: readonly [number, number, number]
}>

const positive = (value: number, name: string) => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be greater than zero`)
}

/** Pure pitched roof truss in canonical Z-up coordinates. */
export const generateTrussGraph = (params: Readonly<TrussParameters>): ParametricEntityGraph => {
  positive(params.span, 'span')
  positive(params.height, 'height')
  if (!Number.isSafeInteger(params.panelCount) || params.panelCount < 2) throw new Error('panelCount must be an integer greater than or equal to 2')
  const [ox, oy, oz] = params.origin ?? [0, 0, 0]
  const bottomRole = (index: number) => `truss:bottom:${index}:node`
  const topRole = (index: number) => `truss:top:${index}:node`
  const nodes: NonNullable<ParametricEntityGraph['nodes']>[number][] = []
  const members: NonNullable<ParametricEntityGraph['members']>[number][] = []
  for (let index = 0; index <= params.panelCount; index++) {
    const x = params.span * index / params.panelCount
    nodes.push({ role: bottomRole(index), record: { name: `Truss bottom ${index}`, position: [ox + x, oy, oz] } })
    if (index > 0 && index < params.panelCount) {
      const ratio = index / params.panelCount
      const z = params.height * (1 - Math.abs(2 * ratio - 1))
      nodes.push({ role: topRole(index), record: { name: `Truss top ${index}`, position: [ox + x, oy, oz + z] } })
    }
  }
  const add = (role: string, nodeIRole: string, nodeJRole: string, label: string) => members.push({
    role, nodeIRole, nodeJRole, sectionId: params.sectionId, record: { label },
  })
  for (let panel = 0; panel < params.panelCount; panel++) {
    add(`truss:bottom-chord:${panel}`, bottomRole(panel), bottomRole(panel + 1), 'Bottom chord')
    const topI = panel === 0 ? bottomRole(0) : topRole(panel)
    const topJ = panel + 1 === params.panelCount ? bottomRole(params.panelCount) : topRole(panel + 1)
    add(`truss:top-chord:${panel}`, topI, topJ, 'Top chord')
  }
  for (let index = 1; index < params.panelCount; index++) {
    add(`truss:vertical:${index}`, bottomRole(index), topRole(index), 'Vertical')
  }
  for (let panel = 1; panel < params.panelCount - 1; panel++) {
    const from = panel <= params.panelCount / 2 ? bottomRole(panel) : topRole(panel)
    const to = panel <= params.panelCount / 2 ? topRole(panel + 1) : bottomRole(panel + 1)
    add(`truss:diagonal:${panel}`, from, to, 'Diagonal')
  }
  return { nodes, members }
}
