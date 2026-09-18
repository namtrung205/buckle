export const DEFAULT_SOLID_RETAIN_LIMIT = 2_000

export const shouldEvictSolidResources = (memberCount: number, retainLimit = DEFAULT_SOLID_RETAIN_LIMIT) =>
  memberCount > retainLimit

export const estimateSolidTriangles = (memberCount: number, nodeCount: number) =>
  memberCount * 96 + nodeCount * 256

export const materializationChunks = (entityCount: number, chunkSize = 200) =>
  Math.ceil(Math.max(0, entityCount) / Math.max(1, chunkSize))
