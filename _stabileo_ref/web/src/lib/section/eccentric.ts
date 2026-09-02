/**
 * eccentric.ts — loads applied away from the centroid and the shear centre.
 *
 * # Why this is its own module
 *
 * A section's internal forces are always expressed about two specific points,
 * and they are not the same point:
 *
 *   * axial force acts about the **centroid** — moved off it, it adds bending;
 *   * transverse shear acts about the **shear centre** — moved off it, it adds
 *     torsion.
 *
 * Confusing the two is the classic error the subject exists to teach. A channel
 * loaded through its web looks perfectly reasonable on a drawing and twists in
 * reality, because its shear centre sits outside the section entirely, on the
 * far side of the web from the flanges. Nothing about the picture says so.
 *
 * Translating an eccentric load into `{n, my, mz, vy, vz, t}` is three lines of
 * arithmetic. Putting it here rather than inlining it means the two reference
 * points are named once, the reason they differ is written down once, and a
 * panel can show a student the resulting torsion instead of it appearing from
 * nowhere.
 */

/** A load applied somewhere on (or off) the section. */
export interface EccentricLoad {
  /** Axial force, kN. Positive is tension. */
  n?: number;
  /** Transverse force along the horizontal centroidal axis, kN. */
  vy?: number;
  /** Transverse force along the vertical centroidal axis, kN. */
  vz?: number;
  /**
   * Where it acts, CENTROID-RELATIVE, in metres.
   *
   * Omitted means through the centroid for `n` and through the SHEAR CENTRE for
   * `vy`/`vz` — the two "no extra effect" positions, which are different points.
   */
  at?: [number, number];
  /** Torsion applied directly, on top of anything the eccentricity produces. */
  t?: number;
  /** Bending applied directly, on top of anything the eccentricity produces. */
  my?: number;
  mz?: number;
}

export interface ResolvedForces {
  n: number;
  my: number;
  mz: number;
  vy: number;
  vz: number;
  t: number;
}

/** What the eccentricity added, so a panel can show its working. */
export interface EccentricityEffect {
  /** Bending from axial eccentricity, kN·m. */
  myFromN: number;
  mzFromN: number;
  /** Torsion from shear applied away from the shear centre, kN·m. */
  tFromShear: number;
  /** Offset of the application point from the SHEAR CENTRE, metres. */
  shearArm: [number, number];
}

export interface EccentricResult {
  forces: ResolvedForces;
  effect: EccentricityEffect;
}

/**
 * Resolve an eccentric load into section forces about the standard points.
 *
 * `shearCentre` is centroid-relative, as the shear solver reports it. Passing
 * `[0, 0]` treats the shear centre as coincident with the centroid, which is
 * true for a doubly-symmetric profile and wrong for everything else — so a
 * caller that has the real value should pass it.
 */
export function resolveEccentric(
  load: EccentricLoad,
  shearCentre: [number, number] = [0, 0],
): EccentricResult {
  const n = load.n ?? 0;
  const vy = load.vy ?? 0;
  const vz = load.vz ?? 0;
  const [ay, az] = load.at ?? [0, 0];

  // ── Axial eccentricity, measured from the CENTROID ───────────
  //
  // N at (ay, az) is statically the same as N at the centroid plus two moments.
  // Signs follow the bending convention the engine uses: `sigma = N/A + kz·z −
  // ky·y`, so a positive N at positive z must raise the stress at positive z.
  const myFromN = load.at ? n * az : 0;
  const mzFromN = load.at ? -n * ay : 0;

  // ── Shear eccentricity, measured from the SHEAR CENTRE ───────
  //
  // This is the part that is easy to get wrong: the arm is NOT the distance to
  // the centroid. A channel's shear centre lies outside the section, so a load
  // applied on the web — visually "in the middle" — has a large arm and twists
  // the member.
  const armY = load.at ? ay - shearCentre[0] : 0;
  const armZ = load.at ? az - shearCentre[1] : 0;
  // Torque about the member axis from a force offset in-plane.
  const tFromShear = vz * armY - vy * armZ;

  return {
    forces: {
      n,
      my: (load.my ?? 0) + myFromN,
      mz: (load.mz ?? 0) + mzFromN,
      vy,
      vz,
      t: (load.t ?? 0) + tFromShear,
    },
    effect: { myFromN, mzFromN, tFromShear, shearArm: [armY, armZ] },
  };
}

/**
 * Clear solver noise out of a shear centre.
 *
 * For a doubly-symmetric section the shear centre IS the centroid — exactly,
 * by symmetry. A numerical solve reaches that answer to within a few microns,
 * which is fine as a coordinate and poisonous as an ARM: a 10 µm offset times
 * a 60 kN shear is a torque, and a caller that treats "any torque at all" as
 * an eccentric case will see one where there is none.
 *
 * Snapped relative to the section's own size so the rule holds for a 60 mm
 * angle and a 900 mm plate girder alike. A real offset — a channel's, which
 * lies outside the section entirely — is orders of magnitude larger and passes
 * through untouched.
 */
export function snapShearCentre(
  sc: [number, number] | undefined | null,
  sectionSize: number,
  relTol = 1e-4,
): [number, number] {
  if (!sc) return [0, 0];
  const tol = Math.abs(sectionSize) * relTol;
  return [Math.abs(sc[0]) < tol ? 0 : sc[0], Math.abs(sc[1]) < tol ? 0 : sc[1]];
}

/**
 * The kern — the region where an axial load causes no tension anywhere.
 *
 * Reported as the largest eccentricity along each centroidal axis that keeps
 * the whole section in one sign under pure compression. For a rectangle this
 * gives the familiar middle third; for anything else it follows from the
 * section's own moduli, which is the point of computing it rather than quoting
 * a rule of thumb.
 *
 * `a`, `iy`, `iz` are the section's own properties in SI, and the extreme fibre
 * distances come from its bounding box.
 *
 * The formula σ = N/A (1 + e·c/r²) assumes the geometric axes are PRINCIPAL
 * axes. With a nonzero product of inertia `iyz` — an angle, a Z profile — the
 * neutral axis under an eccentric load is not parallel to either geometric
 * axis and these limits are simply wrong, so the function declines (null)
 * rather than report them. A relative threshold, because a symmetric section's
 * iyz is solver noise orders of magnitude below its inertias, while a real
 * product of inertia is a substantial fraction of them.
 */
export function kernLimits(
  a: number,
  iy: number,
  iz: number,
  iyz: number,
  extremes: { zMax: number; zMin: number; yMax: number; yMin: number },
): { z: [number, number]; y: [number, number] } | null {
  if (!(a > 0) || !(iy > 0) || !(iz > 0)) return null;
  if (Math.abs(iyz) > 1e-6 * Math.sqrt(iy * iz)) return null;
  const safe = (v: number) => (Math.abs(v) > 1e-12 ? v : null);
  const zTop = safe(extremes.zMax);
  const zBot = safe(extremes.zMin);
  const yRight = safe(extremes.yMax);
  const yLeft = safe(extremes.yMin);
  if (zTop === null || zBot === null || yRight === null || yLeft === null) return null;
  // sigma = N/A (1 + e·c/r²) stays one-signed while |e| <= r²/c on each side.
  const ry2 = iy / a;
  const rz2 = iz / a;
  return {
    z: [-Math.abs(ry2 / zTop), Math.abs(ry2 / zBot)],
    y: [-Math.abs(rz2 / yRight), Math.abs(rz2 / yLeft)],
  };
}
