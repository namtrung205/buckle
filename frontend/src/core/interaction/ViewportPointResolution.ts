import type { Vector3Record } from '../structural/types.ts'
import type { InteractionSnapOption } from './InteractionSession.ts'

/** A resolved, snap-annotated pointer point. */
export type ViewportPoint = Readonly<{
  position: Vector3Record
  snappedNodeId?: number
  memberId?: number
  memberRatio?: number
}>

/** Active picking plane (normal + signed distance, THREE Plane conventions). */
export type ViewportPlane = Readonly<{ normal: Vector3Record; distance: number }>

/** Raw snap candidates gathered by the host (Snapper) for the current pointer. */
export type SnapCandidate = Readonly<{
  /** Node/endpoint snap. `onPlane` is false when the node is off the active
   *  workplane; `exact` means the node actually lies on the plane. */
  node?: Readonly<{ id: number; position: Vector3Record; onPlane: boolean; exact: boolean }>
  /** Member interior point snap (ratio in ]0,1[). */
  member?: Readonly<{ id: number; ratio: number; position: Vector3Record; onPlane: boolean }>
  /** Grid snap (only meaningful when a workplane is active). */
  grid?: Vector3Record
}>

export type PointResolveContext = Readonly<{
  /** Active workplane; null in true 3D mode (no user workplane). */
  plane: ViewportPlane | null
  /** Pointer raycast onto the active plane; null in 3D — never a free point. */
  planePosition: Vector3Record | null
  candidate: SnapCandidate
  /** Snap families the requesting interaction allows; undefined = all. */
  snap?: readonly InteractionSnapOption[]
  planeThreshold?: number
}>

/**
 * Resolve one pointer to a world point with snap provenance, encoding the
 * host Snapper's rules without ANY THREE dependency (slice 3.2):
 *
 * - with a workplane: on-plane node/endpoint snap first, then on-plane member
 *   point, then grid, then the free raycast point on the plane;
 * - true 3D (no workplane): only existing geometry — an off-plane node or
 *   member point is still valid, grid/free points never are;
 * - the `snap` option list restricts the families the interaction may use
 *   (default: everything).
 */
export const resolveViewportPoint = (context: PointResolveContext): ViewportPoint | null => {
  const snaps = context.snap
  const allowNode = snaps === undefined || snaps.includes('node') || snaps.includes('endpoint')
  const allowMember = snaps === undefined || snaps.includes('member')
  const allowGrid = snaps === undefined || snaps.includes('grid')

  const node = context.candidate.node
  const member = context.candidate.member
  if (node !== undefined && node.onPlane && allowNode) {
    // The exact on-plane node keeps its identity; a projected near-node is
    // used only as a plain position (matches Snapper's 1e-4 exactness rule).
    return node.exact
      ? { position: node.position, snappedNodeId: node.id }
      : { position: node.position }
  }
  if (member !== undefined && member.onPlane && allowMember) {
    return {
      position: member.position,
      memberId: member.id,
      memberRatio: member.ratio,
    }
  }
  if (context.plane !== null) {
    if (allowGrid && context.candidate.grid) return { position: context.candidate.grid }
    // A free plane point exists only with the host defaults (snap undefined):
    // an explicit snap list must capture one of its own families.
    if (context.planePosition && snaps === undefined) return { position: context.planePosition }
    return null
  }
  // True 3D — never invent free points on the world plane.
  if (allowNode && node !== undefined) {
    return { position: node.position, snappedNodeId: node.id }
  }
  if (allowMember && member !== undefined) {
    return {
      position: member.position,
      memberId: member.id,
      memberRatio: member.ratio,
    }
  }
  return null
}

export const pickMin = (spec: { min?: number }, fallback: number): number =>
  spec.min === undefined ? fallback : spec.min