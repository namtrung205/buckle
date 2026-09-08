import type { ParametricEntityGraph } from '../../core/structural/index.ts'

export type WarehouseParameters = Record<string, unknown> & Readonly<{
  width: number
  length: number
  height: number
  pitch: number
  numBays: number
  numPurlins: number
  sectionId: number
  materialId: number
  sectionArea: number
  hasBracing: boolean
  addSelfWeight: boolean
  addWindLoad: boolean
  windMagnitude: number
  addSnowLoad: boolean
  snowMagnitude: number
  addMembrane: boolean
  membraneThickness: number
  windOnRoof: boolean
  windOnSideWalls: boolean
  windOnEndWalls: boolean
  snowOnRoof: boolean
}>

const positive = (value: number, name: string) => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be greater than zero`)
}

/** Pure warehouse domain generator. It never allocates IDs or mutates Model. */
export const generateWarehouseGraph = (params: Readonly<WarehouseParameters>): ParametricEntityGraph => {
  positive(params.width, 'width')
  positive(params.length, 'length')
  positive(params.height, 'height')
  positive(params.numBays, 'numBays')
  positive(params.numPurlins, 'numPurlins')
  if (!Number.isInteger(params.numBays) || !Number.isInteger(params.numPurlins)) throw new Error('Bay and purlin counts must be integers')
  if (params.pitch <= 0 || params.pitch >= 89) throw new Error('pitch must be between 0 and 89 degrees')
  if (params.addMembrane) positive(params.membraneThickness, 'membraneThickness')

  const nodes: NonNullable<ParametricEntityGraph['nodes']>[number][] = []
  const members: NonNullable<ParametricEntityGraph['members']>[number][] = []
  const shells: NonNullable<ParametricEntityGraph['shells']>[number][] = []
  const supports: NonNullable<ParametricEntityGraph['boundaryConditions']>[number][] = []
  const loads: NonNullable<ParametricEntityGraph['loads']>[number][] = []
  const bayLength = params.length / params.numBays
  const ridgeHeight = params.height + params.width / 2 * Math.tan(params.pitch * Math.PI / 180)
  const role = (frame: number, side: 'left' | 'right', station: number) =>
    station === 0 ? `frame-line:${frame}:${side}:eave` :
    station === params.numPurlins ? `frame-line:${frame}:ridge` :
    `frame-line:${frame}:${side}:rafter-node:${station}`
  const baseRole = (frame: number, side: 'left' | 'right') => `frame-line:${frame}:${side}:base-node`

  for (let frame = 0; frame <= params.numBays; frame++) {
    const y = frame * bayLength
    for (const side of ['left', 'right'] as const) {
      const x = side === 'left' ? 0 : params.width
      nodes.push({ role: baseRole(frame, side), record: { name: `Base-${side}-${frame}`, position: [x, y, 0] } })
      nodes.push({ role: role(frame, side, 0), record: { name: `Eave-${side}-${frame}`, position: [x, y, params.height] } })
      members.push({
        role: `frame-line:${frame}:${side}:column`, nodeIRole: baseRole(frame, side), nodeJRole: role(frame, side, 0),
        sectionId: params.sectionId, record: { label: `Column-${side}-${frame}` },
      })
      supports.push({
        role: `frame-line:${frame}:${side}:support`, targetNodeRoles: [baseRole(frame, side)],
        record: { name: `Support-${side}-${frame}`, type: 'fixed', dx: 1, dy: 1, dz: 1, rx: 1, ry: 1, rz: 1 },
      })
      for (let station = 1; station < params.numPurlins; station++) {
        const ratio = station / params.numPurlins
        const sx = side === 'left' ? params.width / 2 * ratio : params.width - params.width / 2 * ratio
        const z = params.height + (ridgeHeight - params.height) * ratio
        nodes.push({ role: role(frame, side, station), record: { name: `Rafter-${side}-${frame}-${station}`, position: [sx, y, z] } })
      }
    }
    nodes.push({ role: role(frame, 'left', params.numPurlins), record: { name: `Ridge-${frame}`, position: [params.width / 2, y, ridgeHeight] } })
    for (const side of ['left', 'right'] as const) {
      for (let station = 0; station < params.numPurlins; station++) {
        members.push({
          role: `frame-line:${frame}:${side}:rafter:${station}`,
          nodeIRole: role(frame, side, station), nodeJRole: role(frame, side, station + 1),
          sectionId: params.sectionId, record: { label: `Rafter-${side}-${frame}-${station}` },
        })
      }
    }
  }

  for (let bay = 0; bay < params.numBays; bay++) {
    for (const side of ['left', 'right'] as const) {
      const maxStation = side === 'left' ? params.numPurlins : params.numPurlins - 1
      for (let station = 0; station <= maxStation; station++) {
        members.push({
          role: `bay:${bay}:${side}:purlin:${station}`,
          nodeIRole: role(bay, side, station), nodeJRole: role(bay + 1, side, station),
          sectionId: params.sectionId, record: { label: `Purlin-${side}-${bay}-${station}` },
        })
      }
    }
    if (params.addMembrane) {
      for (const side of ['left', 'right'] as const) {
        for (let station = 0; station < params.numPurlins; station++) {
          shells.push({
            role: `bay:${bay}:${side}:roof-panel:${station}`,
            nodeRoles: [role(bay, side, station), role(bay + 1, side, station), role(bay + 1, side, station + 1), role(bay, side, station + 1)],
            materialId: params.materialId, record: { name: `Roof-${side}-${bay}-${station}`, thickness: params.membraneThickness },
          })
        }
        shells.push({
          role: `bay:${bay}:${side}:wall-panel`,
          nodeRoles: [baseRole(bay, side), baseRole(bay + 1, side), role(bay + 1, side, 0), role(bay, side, 0)],
          materialId: params.materialId, record: { name: `Wall-${side}-${bay}`, thickness: params.membraneThickness },
        })
      }
    }
  }

  if (params.hasBracing) {
    for (const bay of new Set([0, params.numBays - 1])) {
      for (const side of ['left', 'right'] as const) {
        for (const [diagonal, from, to] of [
          [1, baseRole(bay, side), role(bay + 1, side, 0)],
          [2, role(bay, side, 0), baseRole(bay + 1, side)],
          [3, role(bay, side, 0), role(bay + 1, 'left', params.numPurlins)],
          [4, role(bay, 'left', params.numPurlins), role(bay + 1, side, 0)],
        ] as const) members.push({ role: `bay:${bay}:${side}:bracing:${diagonal}`, nodeIRole: from, nodeJRole: to, sectionId: params.sectionId, record: { label: `Brace-${side}-${bay}-${diagonal}` } })
      }
    }
  }

  if (params.addMembrane) {
    for (const frame of [0, params.numBays]) shells.push({
      role: `frame-line:${frame}:end-wall-panel`,
      nodeRoles: [baseRole(frame, 'left'), baseRole(frame, 'right'), role(frame, 'right', 0), role(frame, 'left', 0)],
      materialId: params.materialId, record: { name: `End-wall-${frame}`, thickness: params.membraneThickness },
    })
  }

  if (params.addSelfWeight) loads.push({
    role: 'load:self-weight', targetRoles: members.map(member => member.role),
    record: { name: 'Self-Weight', type: 'linear', value: [0, 0, -(params.sectionArea * 7850 * 9.81) / 1000] },
  })
  if (params.addWindLoad && params.addMembrane) {
    const targets = shells.filter(shell =>
      (params.windOnRoof && shell.role.includes(':roof-panel:')) ||
      (params.windOnSideWalls && shell.role.includes(':wall-panel')) ||
      (params.windOnEndWalls && shell.role.includes(':end-wall-panel')),
    ).map(shell => shell.role)
    if (targets.length) loads.push({ role: 'load:wind-pressure', targetRoles: targets, record: { name: 'Wind-Pressure', type: 'pressure', magnitude: params.windMagnitude, value: [0, 0, 0] } })
  }
  if (params.addSnowLoad && params.addMembrane && params.snowOnRoof) {
    loads.push({ role: 'load:snow', targetRoles: shells.filter(shell => shell.role.includes(':roof-panel:')).map(shell => shell.role), record: { name: 'Snow-Load', type: 'pressure', magnitude: 0, value: [0, 0, -params.snowMagnitude] } })
  }
  return { nodes, members, shells, boundaryConditions: supports, loads }
}
