/**
 * tensors.ts — the full stress and strain state at a point of a section.
 *
 * # What beam theory actually gives you
 *
 * A section analysis produces three numbers at a point: a normal stress along
 * the member axis and two transverse shears. Those are not "the stress" — they
 * are three components of a tensor whose other components beam theory asserts
 * are zero:
 *
 * ```text
 *          | sigma_x  tau_xy  tau_xz |
 *   sigma = | tau_xy      0       0  |
 *          | tau_xz      0       0  |
 * ```
 *
 * Writing it out is not decoration. It is what makes principal directions,
 * invariants and the strain state computable, and it is what a student needs to
 * see to connect "the beam formula" with the elasticity they are taught
 * alongside it. The zeros are a MODELLING ASSUMPTION — a real member under
 * transverse load does carry small sigma_y near a load point — and stating them
 * explicitly is more honest than leaving them implicit.
 *
 * # Strain
 *
 * Hooke's law for an isotropic material, in full:
 *
 * ```text
 *   eps_x  = sigma_x / E
 *   eps_y  = eps_z = -nu * sigma_x / E      (Poisson contraction)
 *   gam_xy = tau_xy / G,   gam_xz = tau_xz / G,   G = E / (2(1+nu))
 * ```
 *
 * The transverse strains are the part people forget: a bar in pure tension gets
 * thinner, and that is where Poisson's ratio becomes something other than a
 * number in a material table.
 */

/** A symmetric 3×3 tensor, in the section's own axes: x along the member. */
export interface Tensor3 {
  xx: number;
  yy: number;
  zz: number;
  xy: number;
  xz: number;
  yz: number;
}

export interface PrincipalState {
  /** Principal values, sorted descending. */
  values: [number, number, number];
  /**
   * Angle from the member axis to the major principal direction, in the x–z
   * plane, in degrees. This is the direction a crack opens perpendicular to.
   */
  angleDeg: number;
  /** Largest shear on any plane — half the spread of the principal values. */
  maxShear: number;
}

export interface StressTensorState {
  stress: Tensor3;
  strain: Tensor3;
  principalStress: PrincipalState;
  principalStrain: PrincipalState;
  invariants: {
    /** First invariant, the trace: proportional to the volumetric part. */
    i1: number;
    /** Second deviatoric invariant; von Mises is sqrt(3 J2). */
    j2: number;
    /** Hydrostatic (mean) stress — the part that changes volume, not shape. */
    hydrostatic: number;
  };
  /** Volumetric strain, `eps_x + eps_y + eps_z`. Zero when nu = 0.5. */
  volumetricStrain: number;
}

/**
 * Build the tensors from what a beam analysis produces.
 *
 * `sigmaX`, `tauXy`, `tauXz` in MPa; `e` in MPa; `nu` dimensionless. Strains
 * come out dimensionless, so a caller reporting microstrain multiplies by 1e6.
 */
export function stressTensorState(
  sigmaX: number,
  tauXy: number,
  tauXz: number,
  e: number,
  nu: number,
): StressTensorState {
  const stress: Tensor3 = { xx: sigmaX, yy: 0, zz: 0, xy: tauXy, xz: tauXz, yz: 0 };

  // ── Strain, by Hooke's law for an isotropic material ─────────
  const g = e / (2 * (1 + nu));
  const strain: Tensor3 = {
    xx: sigmaX / e,
    // The transverse contractions. Omitting them is the common shortcut, and it
    // makes the volumetric strain wrong and Poisson's ratio invisible.
    yy: (-nu * sigmaX) / e,
    zz: (-nu * sigmaX) / e,
    // Engineering shear strain gamma = tau/G; the tensor component is gamma/2.
    xy: tauXy / g / 2,
    xz: tauXz / g / 2,
    yz: 0,
  };

  return {
    stress,
    strain,
    principalStress: principalOf(sigmaX, 0, Math.hypot(tauXy, tauXz)),
    // For this stress state the principal strain directions coincide with the
    // principal stress directions — isotropy — so the same reduction applies to
    // the strain expressed as (eps_x, gamma_resultant/2). But the reduction is
    // NOT the stress one: Poisson contraction makes the transverse strains
    // eps_y = eps_z = -nu·sigma_x/E nonzero, so the out-of-plane principal
    // strain is eps_t, not zero, and the in-plane block is (eps_x, eps_t).
    principalStrain: principalOf(strain.xx, strain.yy, Math.hypot(strain.xy, strain.xz)),
    invariants: invariantsOf(sigmaX, Math.hypot(tauXy, tauXz)),
    volumetricStrain: strain.xx + strain.yy + strain.zz,
  };
}

/**
 * Principal values of a state with two normal components and one resultant
 * shear in the plane between them.
 *
 * The tensor reduces to a 2×2 problem in the plane containing the axis and the
 * shear direction, plus a third principal value equal to the OTHER normal
 * component — the out-of-plane direction carries no shear. For the stress
 * state `otherNormal` is zero (beam theory's modelling assumption); for the
 * strain state it is the Poisson contraction, which is NOT zero, and pretending
 * otherwise misplaces both the principal values and the maximum shear.
 */
function principalOf(normal: number, otherNormal: number, shear: number): PrincipalState {
  const centre = (normal + otherNormal) / 2;
  const radius = Math.hypot((normal - otherNormal) / 2, shear);
  const raw: number[] = [centre + radius, centre - radius, otherNormal];
  raw.sort((a, b) => b - a);
  return {
    values: [raw[0], raw[1], raw[2]],
    // Mohr's pole angle, halved because a rotation of 2θ in Mohr space is θ in
    // the material.
    angleDeg: (0.5 * Math.atan2(2 * shear, normal - otherNormal) * 180) / Math.PI,
    maxShear: (raw[0] - raw[2]) / 2,
  };
}

function invariantsOf(sigma: number, tau: number): StressTensorState['invariants'] {
  const i1 = sigma; // sigma_y and sigma_z are zero
  // For this state, von Mises = sqrt(sigma² + 3 tau²), so J2 follows from it.
  const vonMises2 = sigma * sigma + 3 * tau * tau;
  return { i1, j2: vonMises2 / 3, hydrostatic: i1 / 3 };
}

/** Format a tensor for display, in the row order a textbook writes it. */
export function tensorRows(t: Tensor3): number[][] {
  return [
    [t.xx, t.xy, t.xz],
    [t.xy, t.yy, t.yz],
    [t.xz, t.yz, t.zz],
  ];
}
