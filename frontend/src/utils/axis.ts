import * as THREE from 'three';

/**
 * Single source of truth for the coordinate-system conversion between the
 * JSON/OpenSees engineering frame and the Three.js scene frame.
 *
 *   JSON / OpenSees  : right-handed, Z-up.  X horizontal, Y horizontal,
 *                      Z vertical (Midas/SAP/ETABS convention). The backend
 *                      maps these straight into OpenSees with NO axis swap.
 *   Three.js scene   : right-handed, Y-up (WebGL convention).
 *
 * The mapping is a pure permutation WITHOUT sign flip:
 *   jsonToThree(x, y, z) = (x, z, y)
 *   threeToJson(v)       = (v.x, v.z, v.y)
 *
 * This is its own inverse, which makes the conversion safe to apply at the
 * UI/3D boundary in both directions.
 */

/** Convert a JSON/OpenSees (Z-up) point to a Three.js (Y-up) vector. */
export function jsonToThree(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, z, y);
}

/** Convert a JSON/OpenSees (Z-up) component array [x, y, z] to Three.js. */
export function jsonArrayToThree(c: number[]): THREE.Vector3 {
  return new THREE.Vector3(c[0] ?? 0, c[2] ?? 0, c[1] ?? 0);
}

/** Convert a Three.js (Y-up) vector back to JSON/OpenSees (Z-up) coordinates. */
export function threeToJson(v: THREE.Vector3): [number, number, number] {
  return [v.x, v.z, v.y];
}