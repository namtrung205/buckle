import type { ParametricEntityGraph } from '../../core/structural/index.ts'

export type GridParameters = Record<string, unknown> & Readonly<{
  name?: string
  xSpacings: readonly number[]
  ySpacings: readonly number[]
}>

export type PortalFrameParameters = Record<string, unknown> & Readonly<{
  width: number
  height: number
  pitch: number
  sectionId: number
  origin?: readonly [number, number, number]
  frameRole?: string
}>

export type FrameArrayParameters = PortalFrameParameters & Readonly<{
  length: number
  numBays: number
  longitudinalSectionId?: number
}>

const requirePositive = (value: number, name: string) => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be greater than zero`)
}

export const generateGridGraph = (params: Readonly<GridParameters>): ParametricEntityGraph => {
  if (!params.xSpacings.length || !params.ySpacings.length) throw new Error('Grid requires X and Y axes')
  params.xSpacings.forEach((spacing, index) => requirePositive(spacing, `xSpacings[${index}]`))
  params.ySpacings.forEach((spacing, index) => requirePositive(spacing, `ySpacings[${index}]`))
  return {
    grids: [{
      role: 'grid:primary',
      record: { name: params.name ?? 'Grid', kind: 'orthogonal', data: { xSpacings: [...params.xSpacings], ySpacings: [...params.ySpacings] } },
    }],
  }
}

export const generatePortalFrameGraph = (params: Readonly<PortalFrameParameters>): ParametricEntityGraph => {
  requirePositive(params.width, 'width')
  requirePositive(params.height, 'height')
  if (!Number.isFinite(params.pitch) || params.pitch <= 0 || params.pitch >= 89) throw new Error('pitch must be between 0 and 89 degrees')
  const [ox, oy, oz] = params.origin ?? [0, 0, 0]
  const prefix = params.frameRole ?? 'frame-line:0'
  const ridgeZ = oz + params.height + params.width / 2 * Math.tan(params.pitch * Math.PI / 180)
  const node = (role: string, position: readonly [number, number, number]) => ({ role: `${prefix}:${role}`, record: { name: `${prefix}:${role}`, position } })
  return {
    nodes: [
      node('left:base-node', [ox, oy, oz]), node('right:base-node', [ox + params.width, oy, oz]),
      node('left:eave', [ox, oy, oz + params.height]), node('right:eave', [ox + params.width, oy, oz + params.height]),
      node('ridge', [ox + params.width / 2, oy, ridgeZ]),
    ],
    members: [
      { role: `${prefix}:left:column`, nodeIRole: `${prefix}:left:base-node`, nodeJRole: `${prefix}:left:eave`, sectionId: params.sectionId, record: { label: 'Column L' } },
      { role: `${prefix}:right:column`, nodeIRole: `${prefix}:right:base-node`, nodeJRole: `${prefix}:right:eave`, sectionId: params.sectionId, record: { label: 'Column R' } },
      { role: `${prefix}:left:rafter`, nodeIRole: `${prefix}:left:eave`, nodeJRole: `${prefix}:ridge`, sectionId: params.sectionId, record: { label: 'Rafter L' } },
      { role: `${prefix}:right:rafter`, nodeIRole: `${prefix}:right:eave`, nodeJRole: `${prefix}:ridge`, sectionId: params.sectionId, record: { label: 'Rafter R' } },
    ],
  }
}

export const generateFrameArrayGraph = (params: Readonly<FrameArrayParameters>): ParametricEntityGraph => {
  requirePositive(params.length, 'length')
  requirePositive(params.numBays, 'numBays')
  if (!Number.isInteger(params.numBays)) throw new Error('numBays must be an integer')
  const nodes: NonNullable<ParametricEntityGraph['nodes']>[number][] = []
  const members: NonNullable<ParametricEntityGraph['members']>[number][] = []
  for (let frame = 0; frame <= params.numBays; frame++) {
    const frameRole = `frame-line:${frame}`
    const graph = generatePortalFrameGraph({ ...params, origin: [params.origin?.[0] ?? 0, (params.origin?.[1] ?? 0) + params.length * frame / params.numBays, params.origin?.[2] ?? 0], frameRole })
    nodes.push(...(graph.nodes ?? [])); members.push(...(graph.members ?? []))
  }
  const sectionId = params.longitudinalSectionId ?? params.sectionId
  for (let bay = 0; bay < params.numBays; bay++) {
    for (const role of ['left:eave', 'right:eave', 'ridge']) members.push({
      role: `bay:${bay}:${role}:longitudinal`, nodeIRole: `frame-line:${bay}:${role}`, nodeJRole: `frame-line:${bay + 1}:${role}`,
      sectionId, record: { label: `Bay ${bay} longitudinal` },
    })
  }
  return { nodes, members }
}
