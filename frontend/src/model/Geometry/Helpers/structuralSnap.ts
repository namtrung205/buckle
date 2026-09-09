import * as THREE from 'three'

export type StructuralSnapCandidate = Readonly<{
  id: number
  position: THREE.Vector3
}>

export type StructuralMemberPoint = StructuralSnapCandidate & Readonly<{
  ratio: number
}>

export const MEMBER_SNAP_RATIOS = [0.25, 0.5, 0.75] as const

/** Select the endpoint nearest to the pointer in screen space. Keeping this
 * independent of render objects lets centerline/thin-shell tools snap by
 * stable domain node ID instead of relying on hidden legacy meshes. */
export const closestProjectedStructuralNode = (
  pointer: THREE.Vector2,
  camera: THREE.Camera,
  candidates: readonly StructuralSnapCandidate[],
  threshold: number,
) => {
  let closest: StructuralSnapCandidate | null = null
  let closestDistance = Infinity
  for (const candidate of candidates) {
    const projected = candidate.position.clone().project(camera)
    const distance = pointer.distanceTo(new THREE.Vector2(projected.x, projected.y))
    if (distance < closestDistance) {
      closest = candidate
      closestDistance = distance
    }
  }
  return closest && closestDistance < threshold ? closest : null
}

/** Resolve a useful station on a picked member. The member itself is first
 * resolved by the GPU ID pass; this helper then chooses only an intentional
 * engineering station instead of accepting an arbitrary point on the line. */
export const closestProjectedMemberPoint = (
  pointer: THREE.Vector2,
  camera: THREE.Camera,
  memberId: number,
  start: THREE.Vector3,
  end: THREE.Vector3,
  threshold: number,
  ratios: readonly number[] = MEMBER_SNAP_RATIOS,
): StructuralMemberPoint | null => {
  const delta = end.clone().sub(start)
  return closestProjectedStructuralNode(pointer, camera, ratios.map(ratio => ({
    id: memberId,
    ratio,
    position: start.clone().addScaledVector(delta, ratio),
  })), threshold) as StructuralMemberPoint | null
}

export const memberSnapRatioLabel = (ratio: number) => {
  if (Math.abs(ratio - 0.25) < 1e-9) return '1/4'
  if (Math.abs(ratio - 0.5) < 1e-9) return '1/2'
  if (Math.abs(ratio - 0.75) < 1e-9) return '3/4'
  return `${Math.round(ratio * 100)}%`
}
