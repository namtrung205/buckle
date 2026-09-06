export type StructuralBenchmarkFixtureOptions = {
  beamCount: number
  seed?: number
  spacing?: number
  storeyHeight?: number
}

export type StructuralFixtureNode = {
  id: number
  name: string
  x: number
  y: number
  z: number
}

export type StructuralFixtureMember = {
  id: number
  label: string
  nodei: StructuralFixtureNode
  nodej: StructuralFixtureNode
  section: number
  vecxz: [number, number, number]
  release: string
}

export type StructuralBenchmarkFixture = {
  nodes: StructuralFixtureNode[]
  materials: Array<Record<string, unknown>>
  sections: Array<Record<string, unknown>>
  members: StructuralFixtureMember[]
  shells: never[]
  boundary_conditions: never[]
  loads: never[]
  metadata: {
    fixture: 'structural-grid'
    version: 1
    seed: number
    requestedBeamCount: number
    nodeCount: number
    beamCount: number
  }
}

const DEFAULT_SEED = 0x4255434b

const assertPositiveInteger = (value: number, name: string) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; received ${value}`)
  }
}

const xorshift32 = (seed: number) => {
  let state = seed | 0
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state >>> 0
  }
}

/**
 * Produces an exact-size, deterministic Z-up lattice fixture without storing a
 * multi-megabyte JSON file in the repository. The topology is representative of
 * a building/frame model: nodes are shared and members run in all three axes.
 */
export const generateStructuralBenchmarkFixture = (
  options: StructuralBenchmarkFixtureOptions,
): StructuralBenchmarkFixture => {
  const { beamCount, seed = DEFAULT_SEED, spacing = 6, storeyHeight = 3.5 } = options
  assertPositiveInteger(beamCount, 'beamCount')
  if (!(spacing > 0) || !(storeyHeight > 0)) throw new Error('Fixture spacing must be positive')

  // A cubic lattice with n^3 nodes has 3*n^2*(n-1) unique axis-aligned edges.
  const side = Math.max(2, Math.ceil(Math.cbrt(beamCount / 3)) + 1)
  const nodes: StructuralFixtureNode[] = []
  const nodeAt = (x: number, y: number, z: number) => z * side * side + y * side + x

  for (let z = 0; z < side; z++) {
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const id = nodes.length + 1
        nodes.push({ id, name: `N${id}`, x: x * spacing, y: y * spacing, z: z * storeyHeight })
      }
    }
  }

  const steel = { id: 1, name: 'Benchmark Steel', E: 210e9, nu: 0.3, density: 7850 }
  const sections = [
    { id: 1, name: 'H300', type: 'I', depth: 300, width: 300, tw: 10, tf: 15, r: 18, material: steel },
    { id: 2, name: 'H400', type: 'I', depth: 400, width: 400, tw: 13, tf: 21, r: 22, material: steel },
    { id: 3, name: 'I300', type: 'I', depth: 300, width: 150, tw: 7.1, tf: 10.7, r: 15, material: steel },
    { id: 4, name: 'BOX300', type: 'RectangularHollow', height: 300, width: 300, thickness: 12, material: steel },
    { id: 5, name: 'C250', type: 'Channel', depth: 250, width: 90, tw: 8, tf: 12, r: 10, material: steel },
    { id: 6, name: 'L100x10', type: 'Angle', width: 100, thickness: 10, material: steel },
    { id: 7, name: 'PIPE220', type: 'HollowCircular', diameter: 220, thickness: 10, material: steel },
  ]
  const nextRandom = xorshift32(seed)
  const edges: Array<[number, number]> = []

  // Interleave X/Y/Z families so a truncated edge list remains spatially mixed.
  outer: for (let z = 0; z < side; z++) {
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const source = nodeAt(x, y, z)
        const candidates: Array<[number, number]> = []
        if (x + 1 < side) candidates.push([source, nodeAt(x + 1, y, z)])
        if (y + 1 < side) candidates.push([source, nodeAt(x, y + 1, z)])
        if (z + 1 < side) candidates.push([source, nodeAt(x, y, z + 1)])
        for (const edge of candidates) {
          edges.push(edge)
          if (edges.length === beamCount) break outer
        }
      }
    }
  }

  if (edges.length !== beamCount) {
    throw new Error(`Fixture capacity error: requested ${beamCount}, generated ${edges.length}`)
  }

  const members = edges.map(([startIndex, endIndex], index): StructuralFixtureMember => {
    const id = index + 1
    return {
      id,
      label: `M${id}`,
      nodei: nodes[startIndex],
      nodej: nodes[endIndex],
      section: (nextRandom() % sections.length) + 1,
      vecxz: [0, 0, 1],
      release: '',
    }
  })

  // Drop lattice nodes that the exact truncated edge set never references.
  const usedNodeIds = new Set<number>()
  for (const member of members) {
    usedNodeIds.add(member.nodei.id)
    usedNodeIds.add(member.nodej.id)
  }
  const usedNodes = nodes.filter(node => usedNodeIds.has(node.id))

  return {
    nodes: usedNodes,
    materials: [steel],
    sections,
    members,
    shells: [],
    boundary_conditions: [],
    loads: [],
    metadata: {
      fixture: 'structural-grid',
      version: 1,
      seed,
      requestedBeamCount: beamCount,
      nodeCount: usedNodes.length,
      beamCount: members.length,
    },
  }
}
