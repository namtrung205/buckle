/**
 * Midas-style "Shrink" display option: shorten every rendered element at both
 * ends by a fraction of its own length so adjacent elements read as separate
 * bodies around shared joints. Display-only — node coordinates, GPU picking
 * and analysis results are never modified.
 */

/** Fraction of the element length trimmed at EACH end (0.05 → ~10% shorter overall). */
export const SHRINK_RATIO_PER_END = 0.05

/** Clamp a shrink ratio into the safe display range [0, 0.45]. */
export const clampShrinkRatio = (perEnd: number): number =>
  Number.isFinite(perEnd) ? Math.max(0, Math.min(0.45, perEnd)) : 0

type XYZ = { x: number; y: number; z: number }

/** Endpoints (x,y,z ×2) of the segment start→end trimmed by `perEnd` at both ends. */
export const shrinkEndpoints = (start: XYZ, end: XYZ, perEnd: number): number[] => {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const deltaZ = end.z - start.z
  return [
    start.x + deltaX * perEnd, start.y + deltaY * perEnd, start.z + deltaZ * perEnd,
    end.x - deltaX * perEnd, end.y - deltaY * perEnd, end.z - deltaZ * perEnd,
  ]
}
