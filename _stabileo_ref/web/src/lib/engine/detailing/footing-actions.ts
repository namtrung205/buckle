/**
 * Actions at the supported node, transformed to actions about the footing centroid.
 *
 * ── The defect this module exists to fix ───────────────────────
 *
 * `checkBearing` computed its eccentricity as `serviceMomentB / N`. That is the eccentricity
 * of the APPLIED MOMENT about the supported node, and it is only the whole eccentricity when
 * the footing centroid and the node are the same point.
 *
 * They frequently are not. `model/footing.ts` defines `eccentricityB`/`eccentricityL` as the
 * plan offset of the footing CENTROID from the supported node, and its own doc comment says
 * why the field exists: "a footing beside a property line is deliberately eccentric, and the
 * resulting moment is part of its bearing check". That moment — `N · e`, the axial reaction
 * acting at a lever arm from the centroid it is being reduced to — was never formed. A footing
 * offset 0,40 m under 900 kN carries 360 kN·m about its own centroid, and the bearing check
 * saw zero of it.
 *
 * `punchingPosition` had always read the field (it measures each column face to its own
 * footing edge), and `footing-flexure.ts` reads it too. So the model carried the offset, two
 * consumers used it, and the pressure field every strength check integrates did not. That is
 * the disagreement this module removes: ONE transformation, consumed by all of them.
 *
 * ── Convention, stated once and completely ─────────────────────
 *
 * Local right-handed frame, origin at the footing CENTROID:
 *
 *   u   along the footing's B dimension, m, u ∈ [−B/2, +B/2]
 *   v   along the footing's L dimension, m, v ∈ [−L/2, +L/2]
 *   w   up
 *
 * A rotated footing (`rotationDeg ≠ 0`) is refused upstream in `run-footing-design.ts`, so
 * local and global plan axes coincide wherever this module is reached.
 *
 *   `axial`            N > 0, the MAGNITUDE of the axial force the column delivers at the
 *                      node. Downward: the force vector is (0, 0, −N). The solver's sign for
 *                      a support reaction depends on the support type, and the caller has
 *                      already taken the magnitude — see `runFootingDesign`.
 *
 *   `eccentricityB`    Plan offset of the footing CENTROID from the supported NODE, m, local
 *   `eccentricityL`    axes. So the NODE — and with it the column — sits at
 *
 *                          u_node = −eccentricityB      v_node = −eccentricityL
 *
 *                      in centroid coordinates. Positive `eccentricityB` therefore moves the
 *                      base toward +u and leaves the column on the −u side of it, which is
 *                      exactly how `punchingPosition` already reads the field: its two
 *                      cantilevers are `(B − b)/2 ∓ eccentricityB`.
 *
 *   `momentB`          Moment delivered AT THE NODE, kN·m, in the convention the rest of the
 *   `momentL`          footing code already uses: the moment whose quotient by N is the
 *                      eccentricity ALONG that axis. `momentB` shifts the resultant along u,
 *                      `momentL` along v.
 *
 * ── The vector-equilibrium relation ───────────────────────────
 *
 * The axial force applied at the node, r = (u_node, v_node, 0), F = (0, 0, −N), has moment
 * about the centroid
 *
 *     M = r × F = (u_node, v_node, 0) × (0, 0, −N) = (−N·v_node, +N·u_node, 0)
 *
 * Its component about the v axis, +N·u_node, is the one that shifts pressure along u; its
 * component about the u axis, −N·v_node, shifts pressure along v. Re-expressed in the
 * codebase's "moment ÷ N is the eccentricity along that axis" convention — which absorbs both
 * cross-product signs — the two components are `+N·u_node` and `+N·v_node`, so the actions
 * about the centroid are
 *
 *     M_B,centroid = momentB + N · u_node = momentB − N · eccentricityB
 *     M_L,centroid = momentL + N · v_node = momentL − N · eccentricityL
 *
 * and the pressure resultant stands at
 *
 *     u_R = M_B,centroid / N = momentB/N − eccentricityB
 *     v_R = M_L,centroid / N = momentL/N − eccentricityL
 *
 * The `N` cancels, which is the useful part: the geometric offset contributes to the
 * eccentricity at FULL WEIGHT regardless of how heavily the footing is loaded.
 *
 * ── Why the applied moment is enveloped and the offset is not ──
 *
 * `N · e` is sign-RESOLVED. The offset is geometry, its direction is known, and it enters
 * with that direction.
 *
 * The applied moment is not. It arrives as a reaction moment on GLOBAL axes (`mx`, `my`) and
 * mapping its sign onto a footing-local axis is a separate piece of work this codebase has
 * not done — `footing-flexure.ts` established that position and discards the sign for the
 * same reason. So `momentB`/`momentL` contribute their magnitude in BOTH orientations and
 * every consumer takes the worst of the two. One of those orientations reinforces `N · e` and
 * the other opposes it, which is why the enveloped answer is never the arithmetic sum of two
 * magnitudes and never their difference — it is whichever is worse for the quantity asked.
 *
 * This is also why no consumer may apply `Math.abs` to a moment before asking which footing
 * edge is the heavy one: the two orientations put the heavy edge on OPPOSITE sides, and the
 * cantilever reaching each side is a different length once the column is off centre.
 *
 * Pure: no store, no runes. Forces kN, moments kN·m, lengths m, pressures kPa.
 */

/** The two orientations an unresolved applied moment is enveloped over. */
export const MOMENT_ORIENTATIONS: readonly [1, -1] = [1, -1];

/**
 * Column centre in centroid coordinates along one axis, m.
 *
 * One line, and it is a named function on purpose: `−eccentricity` appearing bare at four call
 * sites is how the sign came to be read two different ways in the first place.
 */
export function columnOffsetFromCentroid(eccentricity: number): number {
  return -eccentricity;
}

/**
 * Eccentricity contributed by an applied moment, m — magnitude only.
 *
 * The guard is on the DENOMINATOR only. A footing with no axial load has no linear pressure
 * distribution to speak of, and callers test `axial > 0` before trusting any of this.
 */
export function momentEccentricity(moment: number, axial: number): number {
  return Math.abs(moment) / Math.max(axial, 1e-12);
}

/** One axis of the transformed actions. */
export interface AxisActions {
  /** Column centre from the centroid, m — the sign-resolved geometric term. */
  columnOffset: number;
  /** `|M| / N`, m — the sign-unresolved applied-moment term. */
  momentEccentricity: number;
  /**
   * Resultant offset from the centroid for each moment orientation, m.
   *
   * Two entries, in `MOMENT_ORIENTATIONS` order. Equal to each other exactly when the applied
   * moment is zero, which is the only case in which the envelope costs nothing.
   */
  resultantOffsets: readonly [number, number];
  /** The offset of largest magnitude — the one that sets the peak pressure and the kern test. */
  worstResultantOffset: number;
  /** Moment about the CENTROID for each orientation, kN·m. `N · resultantOffset`. */
  centroidMoments: readonly [number, number];
  /** Kern half-width on this axis, m — `S/6`. */
  kernLimit: number;
}

export interface FootingCentroidActionsInput {
  /** Plan dimensions, m. */
  B: number;
  L: number;
  /** Axial force magnitude at the supported node, kN. */
  axial: number;
  /** Moment at the NODE producing eccentricity along B / along L, kN·m. */
  momentB?: number;
  momentL?: number;
  /** Plan offset of the footing centroid from the node, m, local axes. */
  eccentricityB?: number;
  eccentricityL?: number;
}

export interface FootingCentroidActions {
  axial: number;
  b: AxisActions;
  l: AxisActions;
  /**
   * Peak and least pressure over the whole envelope, kPa — every orientation, every corner.
   *
   * `qMin < 0` is the full-contact test and it is the reason these are computed here rather
   * than per consumer: see `fullContact`.
   */
  q0: number;
  qMax: number;
  qMin: number;
  /**
   * True when the base keeps full contact under EVERY orientation.
   *
   * The test is `qMin ≥ 0`, not `|e_B| ≤ B/6 or |e_L| ≤ L/6`.
   *
   * The per-axis kern test is the correct one for UNIAXIAL eccentricity and it is wrong for
   * biaxial: the full-contact region of a rectangle is the rhombus
   *
   *     6|e_B|/B + 6|e_L|/L ≤ 1
   *
   * whose corners are the per-axis limits, so a resultant can satisfy both axes separately and
   * still lift a corner. `e_B = e_L = B/8` on a square base gives `q_min = −q0/6`: the old
   * test passed it and the old code then reported a NEGATIVE bearing pressure as a valid
   * result. Soil does not pull.
   *
   * `qMin ≥ 0` refuses a strict superset of what the per-axis test refused, so nothing that
   * used to be refused now passes. Both per-axis limits are still reported on `b`/`l` because
   * they are what a reader checks by hand.
   */
  fullContact: boolean;
  /** Per-axis kern excursion, for the memo. True when this axis alone leaves the kern. */
  axisOutsideKern: { b: boolean; l: boolean };
}

function axisActions(
  S: number, axial: number, moment: number, eccentricity: number,
): AxisActions {
  const columnOffset = columnOffsetFromCentroid(eccentricity);
  const mEcc = momentEccentricity(moment, axial);
  const offsets = MOMENT_ORIENTATIONS.map((o) => columnOffset + o * mEcc) as
    unknown as [number, number];
  // Largest magnitude, with the SIGN kept: which side the resultant is on decides which
  // cantilever is under the heavy pressure, and that is the whole point of not taking `abs`.
  const worst = Math.abs(offsets[0]) >= Math.abs(offsets[1]) ? offsets[0] : offsets[1];
  return {
    columnOffset,
    momentEccentricity: mEcc,
    resultantOffsets: offsets,
    worstResultantOffset: worst,
    centroidMoments: [axial * offsets[0], axial * offsets[1]],
    kernLimit: S / 6,
  };
}

/**
 * Transform the node actions onto the footing centroid.
 *
 * The one authoritative transformation. `foundation-check.ts` and `footing-flexure.ts` both
 * consume it, so a footing cannot be checked against one pressure field and reinforced for
 * another.
 */
export function footingCentroidActions(
  input: FootingCentroidActionsInput,
): FootingCentroidActions {
  const { B, L } = input;
  const axial = input.axial;
  const area = B * L;
  const b = axisActions(B, axial, input.momentB ?? 0, input.eccentricityB ?? 0);
  const l = axisActions(L, axial, input.momentL ?? 0, input.eccentricityL ?? 0);

  const q0 = area > 0 ? axial / area : 0;
  // The two axes' orientations are INDEPENDENT unknowns, so the worst corner takes the
  // largest magnitude on each axis separately rather than a single joint orientation.
  const kB = B > 0 ? 6 * Math.abs(b.worstResultantOffset) / B : 0;
  const kL = L > 0 ? 6 * Math.abs(l.worstResultantOffset) / L : 0;

  return {
    axial,
    b,
    l,
    q0,
    qMax: q0 * (1 + kB + kL),
    qMin: q0 * (1 - kB - kL),
    // A resultant sitting EXACTLY on the kern boundary keeps contact — `q_min` is zero there,
    // not negative. `6 · (S/6) / S` is not exactly 1 in binary, so the boundary needs a
    // tolerance or the marginal case is refused by rounding rather than by mechanics.
    fullContact: q0 > 0 ? 1 - kB - kL >= -1e-12 : false,
    axisOutsideKern: {
      b: Math.abs(b.worstResultantOffset) > b.kernLimit,
      l: Math.abs(l.worstResultantOffset) > l.kernLimit,
    },
  };
}

/**
 * The linear pressure field on one axis, kPa, as a function of position from the centroid.
 *
 *     q(u) = q0 · (1 + 12 · u_R · u / S²)
 *
 * At `u = ±S/2` this is `q0 · (1 ± 6 e/S)`, the `1 ± k` form the footing checks have always
 * printed — so a centred resultant reproduces the previous numbers exactly, to the bit.
 *
 * Written about the CENTROID rather than off an edge because that is the only origin in which
 * an off-centre resultant is expressible at all: the previous edge-referenced form
 * (`1 + k·(2x/S − 1)` with `x` from the low edge and `k` built from an absolute eccentricity)
 * can only ever put the heavy edge at +S/2.
 */
export function axisPressure(q0: number, S: number, resultantOffset: number) {
  return (u: number): number =>
    q0 * (1 + (S > 0 ? 12 * resultantOffset * u / (S * S) : 0));
}

/**
 * Pressure at one plan point, kPa, from the centroid, under one orientation pair.
 *
 * The bilinear field. Used where a quantity depends on a POINT rather than on an axis — the
 * punching deduction being the case that matters: the critical perimeter is centred on the
 * COLUMN, and the mean of a linear field over a region is its value at that region's
 * centroid, which is the column centre and not the footing's.
 */
export function planPressure(
  q0: number, B: number, L: number, uR: number, vR: number,
) {
  return (u: number, v: number): number =>
    q0 * (
      1
      + (B > 0 ? 12 * uR * u / (B * B) : 0)
      + (L > 0 ? 12 * vR * v / (L * L) : 0)
    );
}

// ─── The unbalanced moment at the column–footing connection ──────

/**
 * First moment of the enclosed soil pressure about the enclosed region's own centre, kN·m.
 *
 * ── The integral, exactly ──────────────────────────────────────
 *
 * The region is the `enclosedSpan × enclosedWidth` rectangle bounded by the critical
 * perimeter, centred on the COLUMN axis. Substituting `u = u_col + s` into the SAME bilinear
 * field `planPressure` returns,
 *
 *     ∫∫ q(u,v) · s dA
 *       = q0 · (12 u_R / B²) · ∫∫ s² dA        (every other term integrates to zero over s)
 *       = q0 · (12 u_R / B²) · (span³ · width / 12)
 *       = q0 · u_R · span³ · width / B²
 *
 * The constant part of `q` and the cross term in `v` both vanish because `∫ s dA = 0` over a
 * region centred on `u_col`; that is also why the result does not depend on `u_col` itself.
 * Exact for a linear field, not a quadrature — and it is the same field every other check
 * integrates, so the relief credited here is the relief the pressure actually delivers.
 */
function enclosedPressureMoment(
  q0: number, S: number, resultantOffset: number,
  enclosedSpan: number, enclosedWidth: number,
): number {
  if (!(S > 0)) return 0;
  return q0 * resultantOffset * enclosedSpan ** 3 * enclosedWidth / (S * S);
}

/** One axis of the transferred unbalanced moment. */
export interface AxisUnbalancedMoment {
  /** Magnitude of the moment the critical section must carry, kN·m — the envelope. */
  Msc: number;
  /**
   * The applied moment, kN·m, magnitude — what the column delivers at the connection.
   *
   * Sign-unresolved, exactly as everywhere else in this module: it arrives as a reaction
   * moment on GLOBAL axes and mapping its sign onto a footing-local axis is work this
   * codebase has not done.
   */
  applied: number;
  /**
   * The soil relief the enclosed pressure provides, kN·m, at the governing orientation.
   *
   * Signed relative to `applied` in the orientation that governed, so `Msc` is
   * `|applied ∓ relief|` and a reader can see which of the two it was.
   */
  relief: number;
  /** Which moment orientation produced `Msc`. */
  orientation: 1 | -1;
}

export interface FootingUnbalancedMoment {
  b: AxisUnbalancedMoment;
  l: AxisUnbalancedMoment;
}

/**
 * The unbalanced moment transferred at a column–footing connection, by free-body equilibrium.
 *
 * ── What is being solved, and about which point ────────────────
 *
 * The free body is the block of footing INSIDE the critical perimeter. Three things act on it:
 *
 *   * the column, delivering its axial force AT the column axis and its moment;
 *   * the soil, pushing up over the enclosed area with a pressure that is NOT uniform once
 *     the resultant is off centre;
 *   * the critical section, delivering the shear `V_u` and the unbalanced moment `M_sc`.
 *
 * Moments are taken about the centre of the enclosed region, which for an UNTRUNCATED
 * perimeter is the column axis itself — so the axial force contributes nothing, and
 * equilibrium on one axis reads
 *
 *     M_sc = M_applied − ∫∫ q · s dA
 *
 * This is the same free body `derivePunchingDemand` already solves for the force: "the
 * unbalanced moment M_sc transferred to the connection is likewise the step in the column end
 * moments across the joint", stated in that module's own header. Forming it here is that
 * statement carried out, not a new method — and it is emphatically NOT the §8.4.4.2 eccentric
 * shear calculation, which is the separate question of what `M_sc` then does to the shear
 * stress distribution around the perimeter. That remains unimplemented.
 *
 * ── Why the enclosed pressure relieves, and why it is not ignored ──
 *
 * Part of the applied moment is balanced by the soil standing directly under the column, so
 * the section carries less than the column delivers. For a centred column the relief is
 * `M_applied · span³·width/(B³·L)` — about 3 % on a reference footing, small but real.
 *
 * The case it is NOT small in is the one with NO applied moment at all. A footing whose
 * centroid is offset from its column carries a non-uniform pressure under that column, whose
 * resultant does not pass through the column axis, so the critical section carries a moment
 * that the applied-moment term alone reports as zero. Omitting the term would let exactly
 * those footings — the deliberately eccentric ones — read as pure direct shear.
 *
 * ── The envelope ───────────────────────────────────────────────
 *
 * The applied moment's sign is not usable (see this module's header), and it enters the relief
 * term too, through `u_R`. So both orientations are formed and the LARGER magnitude governs.
 * That cannot under-state the moment, and it costs nothing when the applied moment is zero:
 * the two orientations then coincide.
 *
 * `enclosedSpanB × enclosedSpanL` are the plan dimensions of the region the critical
 * perimeter encloses, which the caller reads off `criticalSection`. This function is valid
 * only for a perimeter centred on the column axis; a TRUNCATED perimeter encloses a region
 * whose centre is elsewhere, the axial force then contributes, and the caller must refuse
 * rather than call this.
 */
export function footingUnbalancedMoment(input: {
  /** Plan dimensions, m. */
  B: number;
  L: number;
  /** Uniform-equivalent factored pressure `N/(B·L)`, kPa. */
  q0: number;
  axial: number;
  /** Applied moments at the NODE, kN·m, in this module's eccentricity convention. */
  momentB?: number;
  momentL?: number;
  /** Plan offset of the footing centroid from the node, m. */
  eccentricityB?: number;
  eccentricityL?: number;
  /** Plan dimensions of the region the critical perimeter encloses, m. */
  enclosedSpanB: number;
  enclosedSpanL: number;
}): FootingUnbalancedMoment {
  const axis = (
    S: number, moment: number, eccentricity: number,
    enclosedSpan: number, enclosedWidth: number,
  ): AxisUnbalancedMoment => {
    const columnOffset = columnOffsetFromCentroid(eccentricity);
    const applied = Math.abs(moment);
    const mEcc = momentEccentricity(moment, input.axial);
    let best: AxisUnbalancedMoment | null = null;
    for (const o of MOMENT_ORIENTATIONS) {
      const resultantOffset = columnOffset + o * mEcc;
      const relief = enclosedPressureMoment(
        input.q0, S, resultantOffset, enclosedSpan, enclosedWidth);
      const Msc = Math.abs(o * applied - relief);
      if (best === null || Msc > best.Msc) {
        best = { Msc, applied, relief: o * relief, orientation: o };
      }
    }
    return best as AxisUnbalancedMoment;
  };

  return {
    // `enclosedSpanB` is the dimension the moment bends ACROSS on this axis, and
    // `enclosedSpanL` the one it is distributed over — the same span/width split every
    // per-axis quantity in the footing code uses.
    b: axis(input.B, input.momentB ?? 0, input.eccentricityB ?? 0,
      input.enclosedSpanB, input.enclosedSpanL),
    l: axis(input.L, input.momentL ?? 0, input.eccentricityL ?? 0,
      input.enclosedSpanL, input.enclosedSpanB),
  };
}
