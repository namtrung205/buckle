/**
 * Where each starter hook actually SITS — the physical foot of the dowel cage.
 *
 * ── What this closes ───────────────────────────────────────────
 *
 * `generateDowels` emitted a note claiming the 90° hook rested "apoyado sobre la parrilla
 * inferior" — seated on the bottom mat. Until the physical mat existed the claim could not be
 * checked. Once it existed, `footing-mat-geometry.test.ts` checked it and it was false, three
 * ways over, and the reference footing measured every one of them:
 *
 *   * the hook's horizontal leg was placed one CENTRELINE RADIUS below the tangent point of
 *     the straight stem, because that is where `buildStraightBarWithHooks` puts it and the
 *     caller passed the tangent point as if it were the lowest steel. The bend hangs 70 mm
 *     below the point the generator was reasoning about;
 *   * so the hook surface sat 20 mm above the soffit against a declared 50 mm cover, and
 *     10 mm BELOW the lower mat layer's own surface — under the mat, resting on nothing;
 *   * and all eight hooks turned toward the column centre in ONE horizontal plane, so twelve
 *     pairs interpenetrated, four of them with coincident axes (a full Ø20 diameter).
 *
 * This module places the foot instead of assuming it. Nothing here re-derives a development
 * length, a bend radius or a hook extension: those come from `anchorage.ts` and Tables 25.3.1
 * / 25.4.3.1 through `bar-geometry.ts`, exactly as before. What is new is that the seat is a
 * MEASURED elevation on real supporting steel, and the orientation is SEARCHED rather than
 * assumed.
 *
 * ── What "rests on the bottom mat" means, stated once ──────────
 *
 * The hook's horizontal leg is a cylinder. Resting on something means its OUTER surface is
 * tangent to that thing's outer surface — not that its centreline is at that elevation, and
 * not that the tangent point of the stem is. So:
 *
 *     seatZ   = top surface of the supporting mat layer
 *     legZ    = seatZ + d_b/2          (the leg's CENTRELINE)
 *     tangentZ = legZ + r              (where the straight stem ends and the bend begins)
 *
 * and the lowest steel in the whole bar is exactly `seatZ`. That identity is asserted against
 * the generated geometry in `verify`, from the sampled path rather than from these three
 * lines, because the arithmetic being right is not the same claim as the bar being there.
 *
 * ── Which layer carries the hook, and why it follows from the leg ──
 *
 * A hook leg running along x CROSSES the bars that run along y and lies ALONGSIDE the bars
 * that run along x. It can only bear on steel it crosses, so:
 *
 *     leg along x  →  carried by the Y-direction bars
 *     leg along y  →  carried by the X-direction bars
 *
 * regardless of which direction the resolved layer order put on the bottom. Two cases follow,
 * and they are physically different rather than two spellings of one thing:
 *
 *   * the carrying layer is the UPPER one — the leg lies on top of the finished grid,
 *     touching every bar it crosses. Ordinary placement;
 *   * the carrying layer is the LOWER one — the leg is parallel to the upper layer, so it
 *     drops through a gap between two of its bars and lands on the lower layer, 16 mm (one
 *     upper diameter) further down. Also ordinary placement, and it is how a fixer turns a
 *     hook the "other" way. It is only valid where the gap is actually wide enough, which is
 *     not a judgement this module makes: the candidate is measured against the real mat bars
 *     and rejected when the surfaces would share a volume.
 *
 * Contact with the carrying layer is INTENTIONAL and is recorded as such — perpendicular,
 * tangential, measured, never negative. §25.2.1 and §25.2.2 set clear distances between
 * PARALLEL bars, and a hook leg crossing a mat bar at ninety degrees is neither case, which
 * is the same reading `footing-mat-geometry.ts` already established for the mat's own
 * crossings. A declared relationship never excuses interpenetration.
 *
 * ── Why the orientation is searched ────────────────────────────
 *
 * Because on a real column it does not fit by inspection. On the reference footing the four
 * bars along one column face stand within 260 mm of each other, and a Ø20 hook reaches
 * `r + 12 d_b` = 310 mm from its own stem. Four legs of 240 mm cannot be packed into the
 * 880 mm of line any of them can reach, so at least two of the four must turn onto the other
 * axis — and which two is decided by whether the mat leaves a gap where they would land.
 * There is no local rule that gets this right; the arrangement is a property of the whole
 * cage. So candidates are enumerated per dowel, judged pairwise, and combined by a bounded
 * deterministic search.
 *
 * Nothing is shortened, no bend is tightened, no stem is moved, and no collision is absorbed
 * by a tolerance. When no complete arrangement satisfies every requirement the result is a
 * structured failure naming the dowels that conflict — an unbuildable cage that says so is
 * worth more than a drawn one that does not.
 *
 * Pure: no store, no runes. Lengths m.
 */

import { clause, type ClauseRef, type RegulationEdition } from '../../codes/regulation';
import {
  buildStraightBarWithHooks, samplePath, standardHook,
  type BarPath, type HookGeometry, type Point3,
} from '../../codes/cirsoc201/bar-geometry';
import { CONTACT_ALLOWANCE } from './classify';
import { minSurfaceClearance } from './collision';
import type { FootingMatAxis } from './footing-flexure';
import type { FootingMatLayer } from './footing-mat-geometry';

// ─── Clause references ───────────────────────────────────────────

const R_TRANSFER = clause('cirsoc-201', '2025', '16.3.4',
  'transmisión de fuerzas por armadura en la interfaz columna-base');
const R_HOOKED = clause('cirsoc-201', '2025', '25.4.3.1',
  'longitud de anclaje de ganchos normales en tracción');
const R_COVER = clause('cirsoc-201', '2025', '20.5.1.3',
  'recubrimiento mínimo del hormigón colado en contacto con el suelo');
const R_CROSSING = clause('cirsoc-201', '2025', '25.2.1',
  'separación libre mínima entre barras PARALELAS de una capa');

/** The 90° hook of Table 25.3.1. The only hook a starter out of a footing is given. */
const HOOK_ANGLE = 90 as const;

/**
 * Tolerance for calling a measured seating TANGENTIAL, m.
 *
 * `CONTACT_ALLOWANCE` is the collision classifier's own definition of the band around zero
 * that is contact rather than interpenetration, and this is deliberately the same number
 * rather than a second one: a contact this module declares intentional has to be a contact
 * the collision pass also calls contact, or the two would disagree about the same 2 mm.
 */
export const SEATING_TOLERANCE_M = CONTACT_ALLOWANCE;

/**
 * Hard ceiling on search nodes.
 *
 * Eight dowels and four directions is 65 536 arrangements and the pairwise constraints cut it
 * to a few hundred visited nodes, so this never binds on a real column. It exists so a 16-bar
 * cage cannot turn a detailing pass into an unbounded search, and when it DOES bind the result
 * says so — `searchExhaustive: false` — rather than presenting the best of a truncated sweep
 * as the best there is.
 */
export const MAX_SEARCH_NODES = 200_000;

// ─── Types ───────────────────────────────────────────────────────

/** The four directions a hook leg may run. Axis-aligned because the mat is. */
export type DowelHookDirection = '+x' | '-x' | '+y' | '-y';

/**
 * Candidate order, fixed.
 *
 * It is not a preference — the arrangement is chosen by the explicit score below — but the
 * search visits candidates in this order, so it is what makes two runs over the same footing
 * produce the same cage rather than the same score.
 */
export const DIRECTION_ORDER: readonly DowelHookDirection[] = ['+x', '-x', '+y', '-y'];

const DIRECTION_VECTOR: Readonly<Record<DowelHookDirection, Point3>> = Object.freeze({
  '+x': { x: 1, y: 0, z: 0 },
  '-x': { x: -1, y: 0, z: 0 },
  '+y': { x: 0, y: 1, z: 0 },
  '-y': { x: 0, y: -1, z: 0 },
});

/** One direction of the physical bottom mat, as the hook needs to see it. */
export interface DowelMatLayer {
  axis: FootingMatAxis;
  layer: FootingMatLayer;
  diameterMm: number;
  /** Bar-axis elevation, m, in model coordinates. */
  centreZ: number;
  /** TOP surface elevation of the layer, m — what a hook laid across it bears on. */
  topSurfaceZ: number;
}

/**
 * The physical mat a hook may seat on.
 *
 * `bars` are the generated mat paths, not a description of them. Every candidate is measured
 * against the steel that exists, which is the only way this is a verification: a check written
 * against `topSurfaceZ` alone would agree with a mat that had been generated somewhere else.
 */
export interface DowelMatSupport {
  x: DowelMatLayer;
  y: DowelMatLayer;
  bars: readonly BarPath[];
}

/** Footing plan geometry, for containment and side cover. */
export interface DowelFootingPlan {
  /** Plan centre of the footing CENTROID, m. */
  centroid: { x: number; y: number };
  B: number;
  L: number;
}

export interface DowelCageInput {
  /** Connection id, e.g. `F3-C7`. Bar ids are derived from it and are stable. */
  id: string;
  /** Plan centre of the COLUMN, m. */
  centre: { x: number; y: number };
  /** Elevation of the footing UNDERSIDE and of its top face, m. */
  soffitZ: number;
  footingTopZ: number;
  /** Clear cover to the bottom steel, m. */
  cover: number;
  diameterMm: number;
  /** Dowel plan positions in the column section frame, relative to `centre`. */
  positions: readonly { x: number; y: number }[];
  /** Lap length above the footing, m. */
  lapAbove: number;
  /** §25.4.2 straight development required in the footing, m. */
  ldFooting: number;
  /**
   * §25.4.3.1 hooked development required, m, or null when it was not computed.
   *
   * Null is not "no hook is needed": it is "the hook cannot be credited", and when the
   * straight length does not fit that is a shortfall rather than an assumption.
   */
  ldhFooting: number | null;
  elementIds: number[];
  edition: RegulationEdition;
  /** The mat to seat on. Null means there is none, and the seat falls back to the cover. */
  mat: DowelMatSupport | null;
  /** Null means containment cannot be checked, and the result says so. */
  footingPlan: DowelFootingPlan | null;
}

/** Why a candidate orientation was refused. One kind, one remedy. */
export type DowelCandidateRejection =
  /** The hook surface would be closer to the soffit than the cover. */
  | 'BOTTOM_COVER_SHORT'
  /** Some part of the bar would leave the footing, or break its side cover. */
  | 'NOT_CONTAINED'
  /** §25.4.3.1: the hook does not develop in the embedment this seat leaves. */
  | 'HOOK_DOES_NOT_DEVELOP'
  /** The hook would share a volume with a mat bar. */
  | 'MAT_OVERLAP';

export interface DowelHookCandidate {
  index: number;
  id: string;
  direction: DowelHookDirection;
  /** Which mat direction physically carries the leg, and which layer that is. */
  supportAxis: FootingMatAxis | null;
  supportLayer: FootingMatLayer | null;
  /** Elevation the hook's OUTER bottom surface bears on, m. */
  seatZ: number;
  /** Hook leg CENTRELINE elevation, m. */
  legZ: number;
  /** Where the straight stem ends and the bend begins, m. */
  tangentZ: number;
  bendCentre: Point3;
  bendRadius: number;
  /** Straight extension of the hook, m — Table 25.3.1, not a local choice. */
  extension: number;
  /** Measured clear cover from the hook surface to the soffit, m. */
  bottomCover: number;
  /** Measured clear cover from the bar surface to the nearest plan face, m. Null if unknown. */
  sideCover: number | null;
  /**
   * Embedment available from the §16.3.4 interface to the outside of the bend, m.
   *
   * §25.4.3.1's l_dh is measured from the critical section to the outside end of the hook,
   * along the direction of the straight portion. For a vertical starter seated on the mat the
   * outside of the bend IS the lowest steel, so this is `footingTopZ − seatZ` — the same number
   * a straight bar reaching the same seat would have available. Measured from the seat rather
   * than from a proxy: the previous code compared l_dh against `thickness − cover − 50 mm`,
   * a stand-in for "the mat is in the way" that was written before there was a mat to measure.
   */
  availableEmbedment: number;
  /** Mat bars this hook is INTENTIONALLY seated on: perpendicular, tangential contacts. */
  seatedOn: string[];
  /**
   * Least clear distance to any mat bar it is NOT seated on, m.
   *
   * The seating contacts are excluded on purpose. They are zero by design, and including them
   * would make every arrangement score zero and the comparison useless.
   */
  matClearance: number;
  bar: BarPath;
  rejections: DowelCandidateRejection[];
  /** True when nothing rejected it. Only these enter the search. */
  valid: boolean;
}

export type DowelCageStatus =
  /** A complete arrangement was found and every hook is placed. */
  | 'PLACED'
  /** One or more dowels have no valid orientation at all. */
  | 'NO_CANDIDATE'
  /** Every dowel has candidates and no complete combination is free of overlaps. */
  | 'NO_ARRANGEMENT';

export interface DowelCagePlacement {
  index: number;
  id: string;
  position: { x: number; y: number };
  direction: DowelHookDirection;
  /** The direction the previous generator would have chosen, for the departure count. */
  intendedDirection: DowelHookDirection;
  supportAxis: FootingMatAxis | null;
  supportLayer: FootingMatLayer | null;
  seatZ: number;
  legZ: number;
  tangentZ: number;
  bendCentre: Point3;
  bendRadius: number;
  extension: number;
  bottomCover: number;
  sideCover: number | null;
  availableEmbedment: number;
  requiredEmbedment: number;
  seatedOn: string[];
  /** Least clear distance to any OTHER dowel in the chosen arrangement, m. */
  hookClearance: number;
  matClearance: number;
}

export interface DowelCageSelection {
  /** Arrangements visited. Bounded by `MAX_SEARCH_NODES`. */
  nodes: number;
  /** False when the node ceiling bound the search — stated, never silent. */
  searchExhaustive: boolean;
  /** Complete arrangements that satisfied every requirement. */
  feasible: number;
  /** The chosen arrangement's least clearance between two pieces that must stand apart, m. */
  minClearance: number;
  /** How many hooks turned somewhere other than the previous generator's inward default. */
  departures: number;
}

export interface DowelCageResult {
  status: DowelCageStatus;
  bars: BarPath[];
  placements: DowelCagePlacement[];
  /** Every candidate that was considered, valid or not — the audit trail of the search. */
  candidates: DowelHookCandidate[];
  selection: DowelCageSelection | null;
  /** True when the straight l_d does not fit and the bar is hooked. */
  hooked: boolean;
  hook: HookGeometry;
  /** Blocking conditions, in the generator's own prose. */
  failures: string[];
  /** Non-blocking statements about what was built. */
  notes: string[];
  refs: ClauseRef[];
}

// ─── Seating ─────────────────────────────────────────────────────

/** The direction the superseded generator turned each hook: inward, along x. */
export function intendedDirection(position: { x: number; y: number }): DowelHookDirection {
  return position.x > 0 ? '-x' : '+x';
}

/** Does a leg along this direction run along x? */
function runsAlongX(direction: DowelHookDirection): boolean {
  return direction === '+x' || direction === '-x';
}

/**
 * Which mat layer carries a leg running in `direction`.
 *
 * The leg bears on steel it CROSSES, so a leg along x is carried by the bars that run along
 * y and vice versa. Independent of which layer the order put underneath — that only decides
 * whether the leg lies on top of the grid or drops through it.
 */
export function carryingLayer(
  direction: DowelHookDirection, mat: DowelMatSupport,
): DowelMatLayer {
  return runsAlongX(direction) ? mat.y : mat.x;
}

/**
 * The deepest elevation any starter foot may bear on, m.
 *
 * With a mat it is the LOWER layer's top surface — the deepest seat a candidate uses, reached
 * by a leg that drops through the upper layer. Without a mat it is the cover plane, which is
 * the deepest a bar may go with nothing to bear on.
 *
 * Exported because the footing record states whether the starter is hooked BEFORE the assembly
 * builds the cage, and the two must not answer that question from different arithmetic. The
 * superseded answer was `thickness − cover − 50 mm`: a proxy for "the mat is in the way",
 * written before there was a mat to measure.
 */
export function deepestStarterSeat(
  mat: DowelMatSupport | null, soffitZ: number, cover: number,
): number {
  return mat
    ? Math.min(mat.x.topSurfaceZ, mat.y.topSurfaceZ)
    : soffitZ + cover;
}

/**
 * Does the straight §25.4.2 development fit above the seat?
 *
 * When it does not, the bar is hooked — the one place the 90° hook of Table 25.3.1 enters this
 * pass. Whether that HOOK develops is a separate question, answered per candidate against the
 * embedment its own seat leaves.
 */
export function starterNeedsHook(
  ldFooting: number, footingTopZ: number, seatZ: number,
): boolean {
  return ldFooting > footingTopZ - seatZ;
}

// ─── Candidates ──────────────────────────────────────────────────

function buildCandidate(
  input: DowelCageInput, index: number, direction: DowelHookDirection,
  hook: HookGeometry, hooked: boolean,
  /** The deepest elevation any starter foot may bear on. See `placeFootingDowelCage`. */
  deepestSeat: number,
): DowelHookCandidate {
  const p = input.positions[index];
  const db = input.diameterMm / 1000;
  const id = `${input.id}-dowel-${index}`;
  const carrier = input.mat ? carryingLayer(direction, input.mat) : null;

  /**
   * The seat.
   *
   * With a mat, it is the carrying layer's top surface — the steel the leg lies on. Without
   * one, it is the cover plane, which is the deepest a bar may go with no mat to bear on.
   * A hook that is not seated on anything is a limitation reported by the caller, not a
   * licence to put the bend into the cover.
   */
  const seatZ = hooked && carrier ? carrier.topSurfaceZ : deepestSeat;
  const legZ = seatZ + db / 2;
  const tangentZ = hooked ? legZ + hook.centrelineRadius : legZ;

  const start: Point3 = {
    x: input.centre.x + p.x, y: input.centre.y + p.y,
    z: hooked ? tangentZ : legZ,
  };
  const bar = buildStraightBarWithHooks({
    id, diameterMm: input.diameterMm, role: 'longitudinal',
    start,
    end: { x: start.x, y: start.y, z: input.footingTopZ + input.lapAbove },
    axis: { x: 0, y: 0, z: 1 },
    hookNormal: DIRECTION_VECTOR[direction],
    startHook: hooked ? HOOK_ANGLE : undefined,
    ownerElementIds: input.elementIds, edition: input.edition,
  });

  // ── Measured, from the path that exists ──────────────────
  const points = samplePath(bar);
  const inFooting = points.filter((q) => q.z <= input.footingTopZ + 1e-9);
  const lowest = Math.min(...points.map((q) => q.z)) - db / 2;
  const bottomCover = lowest - input.soffitZ;

  let sideCover: number | null = null;
  if (input.footingPlan) {
    const { centroid, B, L } = input.footingPlan;
    sideCover = Math.min(...inFooting.flatMap((q) => [
      B / 2 - Math.abs(q.x - centroid.x) - db / 2,
      L / 2 - Math.abs(q.y - centroid.y) - db / 2,
    ]));
  }

  const availableEmbedment = input.footingTopZ - seatZ;

  const rejections: DowelCandidateRejection[] = [];
  if (bottomCover < input.cover - 1e-9) rejections.push('BOTTOM_COVER_SHORT');
  if (sideCover !== null && sideCover < input.cover - 1e-9) rejections.push('NOT_CONTAINED');
  if (hooked && (input.ldhFooting === null || input.ldhFooting > availableEmbedment + 1e-9)) {
    rejections.push('HOOK_DOES_NOT_DEVELOP');
  }

  // ── Against the mat that exists ──────────────────────────
  const seatedOn: string[] = [];
  let matClearance = Infinity;
  if (input.mat && carrier) {
    for (const matBar of input.mat.bars) {
      const approach = minSurfaceClearance(bar, matBar);
      if (approach.clearance < -SEATING_TOLERANCE_M) {
        rejections.push('MAT_OVERLAP');
        matClearance = Math.min(matClearance, approach.clearance);
        continue;
      }
      /**
       * Seated, and it has to EARN the word.
       *
       * Three conditions, and none of them is "this bar belongs to the carrying layer":
       * the surfaces have to actually meet within the tolerance, they have to meet
       * perpendicularly, and the bar has to be one of the ones the leg crosses. A hook
       * declared to rest on a layer it passes 10 mm under is exactly the defect this
       * module exists to remove.
       */
      const touching = Math.abs(approach.clearance) <= SEATING_TOLERANCE_M;
      const perpendicular = approach.tangentA && approach.tangentB
        ? Math.abs(approach.tangentA.x * approach.tangentB.x
          + approach.tangentA.y * approach.tangentB.y
          + approach.tangentA.z * approach.tangentB.z) < 0.5
        : false;
      const ownLayer = matBar.layerId?.endsWith(`:${carrier.axis}`) ?? false;
      if (touching && perpendicular && ownLayer) {
        seatedOn.push(matBar.id);
        continue;
      }
      matClearance = Math.min(matClearance, approach.clearance);
    }
    seatedOn.sort();
  }

  return {
    index, id, direction,
    supportAxis: carrier?.axis ?? null,
    supportLayer: carrier?.layer ?? null,
    seatZ, legZ, tangentZ,
    // The bend, when there is one. A straight starter has no bend, and reporting a centre one
    // radius to the side of a bar that does not turn would describe geometry nobody built.
    bendCentre: hooked
      ? {
        x: start.x + DIRECTION_VECTOR[direction].x * hook.centrelineRadius,
        y: start.y + DIRECTION_VECTOR[direction].y * hook.centrelineRadius,
        z: tangentZ,
      }
      : { ...start },
    bendRadius: hooked ? hook.centrelineRadius : 0,
    extension: hooked ? hook.extension : 0,
    bottomCover, sideCover, availableEmbedment,
    seatedOn, matClearance,
    bar,
    rejections: [...new Set(rejections)].sort(),
    valid: rejections.length === 0,
  };
}


// ─── The search ──────────────────────────────────────────────────

/** Quantise a length to the micrometre, so two symmetric arrangements cannot tie unstably. */
function micron(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 1e6) : v;
}

/** Key identifying one candidate, and one ordered pair of them. */
function candidateKey(c: DowelHookCandidate): string {
  return `${c.index}${c.direction}`;
}
function pairKey(a: DowelHookCandidate, b: DowelHookCandidate): string {
  return a.index < b.index
    ? `${candidateKey(a)}|${candidateKey(b)}`
    : `${candidateKey(b)}|${candidateKey(a)}`;
}

/**
 * Every candidate pair, measured once.
 *
 * The clearances are needed twice — to prune the search and to score its leaves — and
 * measuring them per leaf would repeat the same segment sweep for every arrangement that
 * happens to share a pair. Thirty-two candidates is 496 pairs; the arrangements are tens of
 * thousands.
 */
function measurePairs(candidates: DowelHookCandidate[]): {
  overlaps: Set<string>; clearance: Map<string, number>;
} {
  const overlaps = new Set<string>();
  const clearance = new Map<string, number>();
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      // Two orientations of the SAME dowel are never in an arrangement together, so their
      // distance is meaningless — the two paths share a stem and would always read as an
      // overlap of one full diameter.
      if (a.index === b.index) continue;
      const measured = minSurfaceClearance(a.bar, b.bar).clearance;
      const key = pairKey(a, b);
      clearance.set(key, measured);
      /**
       * ZERO, not `−CONTACT_ALLOWANCE`.
       *
       * `CONTACT_ALLOWANCE` is the band in which two surfaces that are MEANT to touch are
       * called touching rather than clashing — a tie around its longitudinals, a hook on the
       * mat bar that carries it. Two starter hooks are in no such relationship: nothing in the
       * detail puts them in contact, so any negative clearance between them is steel in the
       * same place and not a fabrication allowance.
       *
       * Measured: seating the hooks on the mat and searching orientations against the looser
       * threshold produced an arrangement whose worst hook-to-hook clearance was −1,55 mm —
       * no longer one of the twelve gross interpenetrations, and still two bars overlapping,
       * passed only because the number fell inside a tolerance that was not about them. That
       * is the defect this whole pass exists to remove, one order of magnitude smaller.
       */
      if (measured < -1e-9) overlaps.add(key);
    }
  }
  return { overlaps, clearance };
}

/**
 * Choose one orientation per dowel.
 *
 * Depth-first over a FIXED candidate order, pruning on pairwise overlap, scoring every
 * complete arrangement and keeping the best. The score is lexicographic and every term is an
 * integer, so the winner cannot depend on the order floating-point comparisons happen in:
 *
 *   1. greatest minimum clearance between two pieces that must stand apart (negated, so
 *      "smaller key is better" holds for every term);
 *   2. fewest departures from the superseded generator's inward hook;
 *   3. lowest candidate-index sequence in dowel order — the final tie-break, which exists
 *      only so that a genuinely symmetric footing still produces exactly one answer.
 *
 * The first two requirements of the stated preference — every code and cover requirement
 * satisfied, and zero prohibited intersections — are not scores. They are the validity filter
 * on candidates and the pruning constraint on pairs, so an arrangement that reaches the
 * scoring step has already satisfied both, and no score can trade either of them away.
 */
function search(
  candidates: readonly DowelHookCandidate[][],
  overlaps: Set<string>,
  clearance: Map<string, number>,
  intended: readonly DowelHookDirection[],
): { chosen: DowelHookCandidate[] | null; selection: DowelCageSelection } {
  const n = candidates.length;
  let nodes = 0;
  let feasible = 0;
  let exhaustive = true;
  /**
   * The best arrangement so far, in a holder.
   *
   * A plain `let best: … | null = null` is assigned only inside `scoreLeaf`, and TypeScript
   * does not track assignments made in a nested closure — it narrows the variable to `null`
   * at every use after the initialiser, so reading the result needs a cast that asserts
   * something the compiler could not check. A holder keeps the type honest instead.
   */
  const best: {
    value: { chosen: DowelHookCandidate[]; key: number[]; min: number; departures: number }
      | null;
  } = { value: null };
  const stack: DowelHookCandidate[] = [];

  const scoreLeaf = (): void => {
    feasible++;
    let min = Infinity;
    for (const c of stack) min = Math.min(min, c.matClearance);
    for (let i = 0; i < stack.length; i++) {
      for (let j = i + 1; j < stack.length; j++) {
        min = Math.min(min, clearance.get(pairKey(stack[i], stack[j])) ?? Infinity);
      }
    }
    const departures = stack.filter((c) => c.direction !== intended[c.index]).length;
    const key = [
      -micron(min),
      departures,
      ...stack.map((c) => DIRECTION_ORDER.indexOf(c.direction)),
    ];
    if (best.value === null || lessThan(key, best.value.key)) {
      best.value = { chosen: [...stack], key, min, departures };
    }
  };

  const recurse = (idx: number): void => {
    if (!exhaustive) return;
    if (idx === n) { scoreLeaf(); return; }
    for (const candidate of candidates[idx]) {
      if (nodes >= MAX_SEARCH_NODES) { exhaustive = false; return; }
      nodes++;
      let compatible = true;
      for (const placed of stack) {
        if (overlaps.has(pairKey(placed, candidate))) { compatible = false; break; }
      }
      if (!compatible) continue;
      stack.push(candidate);
      recurse(idx + 1);
      stack.pop();
      if (!exhaustive) return;
    }
  };

  recurse(0);

  const found = best.value;
  return {
    chosen: found ? found.chosen : null,
    selection: {
      nodes,
      searchExhaustive: exhaustive,
      feasible,
      minClearance: found ? found.min : Infinity,
      departures: found ? found.departures : 0,
    },
  };
}

/** Lexicographic comparison of two equal-length integer keys. */
function lessThan(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

// ─── The cage ────────────────────────────────────────────────────

/**
 * Place the starter hooks of one footing.
 *
 * Returns NO_CANDIDATE or NO_ARRANGEMENT — with reasons, the full candidate audit and NO bars
 * — when the cage cannot be built. The two are separate because they have different remedies:
 * the first is a dowel that cannot be seated anywhere at all (a footing too shallow, a hook
 * that does not develop, a bar that cannot be contained), and the remedy is the footing; the
 * second is a set of dowels that can each be seated and cannot be seated TOGETHER, and the
 * remedy is the column layout or the bar diameter.
 */
export function placeFootingDowelCage(input: DowelCageInput): DowelCageResult {
  const hook = standardHook(input.diameterMm, HOOK_ANGLE, 'longitudinal');
  const refs = [R_TRANSFER, R_COVER, R_CROSSING];
  const failures: string[] = [];
  const notes: string[] = [];

  /**
   * Does the straight bar fit, measured against the seat rather than a proxy?
   *
   * One decision for the whole cage, from the DEEPEST seat any candidate uses. Deciding it per
   * orientation would let the same footing hook one dowel and not another for no reason a
   * reader could follow.
   */
  const deepestSeat = deepestStarterSeat(input.mat, input.soffitZ, input.cover);
  const straightAvailable = input.footingTopZ - deepestSeat;
  const hooked = starterNeedsHook(input.ldFooting, input.footingTopZ, deepestSeat);

  /**
   * True once §25.4.3.1 has been named as a condition of the WHOLE footing.
   *
   * Used below to keep the per-dowel starvation report from restating it once per dowel: eight
   * copies of one sentence is not eight findings.
   */
  let ldhReported = false;
  if (hooked) {
    refs.push(R_HOOKED);
    if (input.ldhFooting === null) {
      failures.push(
        '§25.4.3.1: la longitud de anclaje recta no entra en la zapata y no se pudo verificar ' +
        'la longitud de anclaje con gancho (ldh no calculada): el remate a 90° no se acredita.');
      ldhReported = true;
    } else if (input.ldhFooting > straightAvailable + 1e-9) {
      /**
       * The hook does not develop in ANY orientation, and that is a property of the footing.
       *
       * `straightAvailable` is measured to the DEEPEST seat a foot can reach, so it is the
       * largest embedment any candidate can have. When l_dh exceeds it no orientation of any
       * dowel develops, and the remedy is the footing's thickness or the bar's diameter — not
       * a different hook direction. Stated here, once, with both numbers.
       */
      failures.push(
        `§25.4.3.1: la longitud de anclaje con gancho requerida ` +
        `(${(input.ldhFooting * 1000).toFixed(0)} mm) excede el empotramiento disponible hasta ` +
        `el asiento más profundo (${(straightAvailable * 1000).toFixed(0)} mm): ni la barra ` +
        'recta ni el gancho a 90° desarrollan la espera en ninguna orientación — aumentar el ' +
        'espesor o reducir el diámetro.');
      ldhReported = true;
    }
  }
  if (!input.mat) {
    notes.push(
      'No hay parrilla inferior física sobre la que apoyar los ganchos: se los asienta sobre ' +
      `el plano de recubrimiento (${(input.cover * 1000).toFixed(0)} mm sobre la cara ` +
      'inferior). El apoyo declarado por §16.3.4 no está verificado contra acero real.');
  }
  if (!input.footingPlan) {
    notes.push(
      'No se recibieron las dimensiones en planta de la zapata: no se verificó que las esperas ' +
      'queden contenidas en el hormigón con su recubrimiento lateral.');
  }

  // ── Candidates ───────────────────────────────────────────
  const all: DowelHookCandidate[] = [];
  const perDowel: DowelHookCandidate[][] = [];
  const intended = input.positions.map(intendedDirection);
  /**
   * A straight starter has no orientation to choose.
   *
   * `hookNormal` is only read when a hook is generated, so all four directions would produce
   * the identical vertical bar and the search would compare four copies of one candidate. The
   * intended direction is kept so the reported orientation stays meaningful rather than
   * becoming an artefact of the tie-break.
   */
  for (let index = 0; index < input.positions.length; index++) {
    const own: DowelHookCandidate[] = [];
    for (const direction of hooked ? DIRECTION_ORDER : [intended[index]]) {
      const candidate = buildCandidate(input, index, direction, hook, hooked, deepestSeat);
      all.push(candidate);
      if (candidate.valid) own.push(candidate);
    }
    perDowel.push(own);
  }

  const starved = perDowel
    .map((own, index) => ({ own, index }))
    .filter((entry) => entry.own.length === 0);
  if (starved.length > 0) {
    /**
     * One message per FINDING, not per dowel.
     *
     * A per-dowel sentence earns its place only when it distinguishes that dowel. When every
     * starter is starved for the identical reason the condition belongs to the footing, and
     * eight identical sentences make a single shortfall read as eight — which is how the
     * §25.4.3.1 shortfall came to be reported nine times over: once correctly, then once per
     * dowel. So the shared case is stated once, and suppressed entirely when the clause check
     * above has already named it.
     */
    const reasonsOf = (index: number): string[] => [...new Set(all
      .filter((c) => c.index === index)
      .flatMap((c) => c.rejections))].sort();
    const starvedReasons = starved.map((entry) => reasonsOf(entry.index));
    const shared = new Set(starvedReasons.map((r) => r.join(',')));

    if (starved.length === input.positions.length && shared.size === 1) {
      const reasons = starvedReasons[0];
      const onlyHookDevelopment = reasons.length === 1 && reasons[0] === 'HOOK_DOES_NOT_DEVELOP';
      if (!(onlyHookDevelopment && ldhReported)) {
        failures.push(
          `Ninguna de las ${input.positions.length} esperas admite una orientación de gancho ` +
          `válida: ${reasons.join(', ')}. No se emite una jaula que no se puede construir.`);
      }
    } else {
      for (let k = 0; k < starved.length; k++) {
        failures.push(
          `La espera ${input.id}-dowel-${starved[k].index} no admite ninguna orientación de ` +
          `gancho válida: ${starvedReasons[k].join(', ')}. No se emite una jaula que no se ` +
          'puede construir.');
      }
    }
    return {
      status: 'NO_CANDIDATE', bars: [], placements: [], candidates: all,
      selection: null, hooked, hook, failures, notes, refs,
    };
  }

  // ── Pairwise, then the arrangement ───────────────────────
  const valid = all.filter((c) => c.valid);
  const { overlaps, clearance } = measurePairs(valid);
  const { chosen, selection } = search(perDowel, overlaps, clearance, intended);

  if (!chosen) {
    /**
     * Name the dowels that cannot coexist, not just the failure.
     *
     * A dowel is reported as conflicting when EVERY one of its valid orientations overlaps
     * some orientation of another dowel. That is the set a detailer can act on — the bars
     * whose spacing or diameter has to change — and it is derived from the measured pairs
     * rather than from the order the search happened to fail in.
     */
    const conflicting = perDowel
      .map((own, index) => ({
        index,
        blocked: own.every((c) => valid.some((other) => other.index !== c.index
          && overlaps.has(pairKey(c, other)))),
      }))
      .filter((entry) => entry.blocked)
      .map((entry) => `${input.id}-dowel-${entry.index}`);
    failures.push(
      `No existe ninguna disposición de los ${input.positions.length} ganchos de espera que ` +
      'satisfaga a la vez el recubrimiento, el anclaje con gancho y la ausencia de ' +
      'interpenetraciones' +
      (conflicting.length > 0 ? `. Esperas en conflicto: ${conflicting.join(', ')}` : '') +
      `. Se examinaron ${selection.nodes} combinación(es)` +
      (selection.searchExhaustive ? ' (búsqueda exhaustiva)' : ' antes de agotar el límite') +
      '. No se emite una jaula que no se puede construir.');
    return {
      status: 'NO_ARRANGEMENT', bars: [], placements: [], candidates: all,
      selection, hooked, hook, failures, notes, refs,
    };
  }

  // ── The chosen cage, measured again as a whole ───────────
  const placements: DowelCagePlacement[] = chosen.map((c) => {
    let hookClearance = Infinity;
    for (const other of chosen) {
      if (other.index === c.index) continue;
      hookClearance = Math.min(hookClearance, clearance.get(pairKey(c, other)) ?? Infinity);
    }
    return {
      index: c.index, id: c.id,
      position: input.positions[c.index],
      direction: c.direction,
      intendedDirection: intended[c.index],
      supportAxis: c.supportAxis, supportLayer: c.supportLayer,
      seatZ: c.seatZ, legZ: c.legZ, tangentZ: c.tangentZ,
      bendCentre: c.bendCentre, bendRadius: c.bendRadius, extension: c.extension,
      bottomCover: c.bottomCover, sideCover: c.sideCover,
      availableEmbedment: c.availableEmbedment,
      requiredEmbedment: hooked ? (input.ldhFooting ?? 0) : input.ldFooting,
      seatedOn: c.seatedOn,
      hookClearance, matClearance: c.matClearance,
    };
  });

  const seatedCount = placements.filter((p) => p.seatedOn.length > 0).length;
  if (hooked) {
    notes.push(
      `La longitud de anclaje recta requerida (${(input.ldFooting * 1000).toFixed(0)} mm) ` +
      `excede el empotramiento disponible hasta el asiento ` +
      `(${(straightAvailable * 1000).toFixed(0)} mm): las ${placements.length} esperas rematan ` +
      `con gancho a 90° (r = ${(hook.centrelineRadius * 1000).toFixed(0)} mm, prolongación ` +
      `${(hook.extension * 1000).toFixed(0)} mm = 12 d_b, Tabla 25.3.1), con ldh = ` +
      `${((input.ldhFooting ?? 0) * 1000).toFixed(0)} mm verificado contra un empotramiento ` +
      `medido de ${(Math.min(...placements.map((p) => p.availableEmbedment)) * 1000).toFixed(0)}` +
      ' mm hasta el exterior del doblez (§25.4.3.1).');
  }
  if (input.mat) {
    notes.push(
      `${seatedCount} de ${placements.length} gancho(s) apoyan sobre la parrilla inferior con ` +
      'contacto tangencial medido: la superficie EXTERIOR de la pata horizontal es tangente a ' +
      'la superficie superior de la capa que la cruza. Recubrimiento inferior medido ' +
      `${(Math.min(...placements.map((p) => p.bottomCover)) * 1000).toFixed(1)} mm contra ` +
      `${(input.cover * 1000).toFixed(0)} mm requeridos.`);
  }
  notes.push(
    `Orientación de ganchos elegida entre ${selection.feasible} disposición(es) completa(s) ` +
    `sin interpenetración, sobre ${selection.nodes} nodo(s) de búsqueda` +
    (selection.searchExhaustive ? ' (exhaustiva)' : ' (límite de búsqueda alcanzado)') +
    `: separación libre mínima ${(selection.minClearance * 1000).toFixed(1)} mm, ` +
    `${selection.departures} gancho(s) girado(s) respecto de la orientación hacia el eje.`);

  return {
    status: 'PLACED',
    bars: chosen.map((c) => c.bar),
    placements, candidates: all, selection, hooked, hook,
    failures, notes, refs,
  };
}

/** Build the mat support description from the generated mat, or null when there is none. */
export function dowelMatSupportFrom(
  bars: readonly BarPath[],
  layers: readonly {
    axis: FootingMatAxis; layer: FootingMatLayer; diameterMm: number; centreZ: number;
  }[],
): DowelMatSupport | null {
  const of = (axis: FootingMatAxis): DowelMatLayer | null => {
    const found = layers.find((l) => l.axis === axis);
    if (!found) return null;
    return {
      axis: found.axis, layer: found.layer, diameterMm: found.diameterMm,
      centreZ: found.centreZ,
      topSurfaceZ: found.centreZ + found.diameterMm / 2000,
    };
  };
  const x = of('X');
  const y = of('Y');
  // Both directions or none. A hook cannot be seated on half a grid, and the module's whole
  // claim is that the leg bears on steel it crosses — which requires the crossed direction to
  // exist. Reported by the caller as the mat's own NOT_MODELED reason, not invented here.
  if (!x || !y || bars.length === 0) return null;
  return { x, y, bars };
}

// ─── The record's view ───────────────────────────────────────────

/**
 * What the footing record and the UI state about the seating.
 *
 * Every field is a MEASUREMENT taken off the placed geometry, not a restatement of an input.
 * The reason it is a flat snapshot rather than the whole `DowelCageResult` is that the record
 * is persisted and compared for staleness: the candidate audit is large, it is derived, and a
 * stored copy of it would change whenever the search's internals did.
 */
export interface DowelSeatingSnapshot {
  status: DowelCageStatus;
  /** True when the straight l_d does not fit and the bars are hooked. */
  hooked: boolean;
  /** Table 25.3.1 bend radius and straight extension of the hook, m. */
  bendRadius: number;
  extension: number;
  /** Hook leg CENTRELINE elevations actually used, m, ascending. Two at most. */
  legElevations: number[];
  /** Least measured clear cover from a hook surface to the soffit, m. */
  bottomCover: number;
  /** Least measured clear cover to a plan face, m. Null when the plan was not supplied. */
  sideCover: number | null;
  /** §25.4.3.1 hooked development required, m, or null when no hook is credited. */
  requiredLdh: number | null;
  /** Least measured embedment to the outside of the bend, m. */
  availableEmbedment: number;
  /** Least measured clear distance between two hooks, m. Infinity with fewer than two. */
  minHookClearance: number;
  /** Least measured clear distance to a mat bar no hook is seated on, m. */
  minMatClearance: number;
  /** How many hooks bear on real mat steel, and which layers carry them. */
  seatedCount: number;
  carriedBy: FootingMatLayer[];
  /** Chosen orientation per dowel, in dowel order. */
  orientations: DowelHookDirection[];
  /** Complete overlap-free arrangements found, and whether the sweep was exhaustive. */
  feasibleArrangements: number;
  searchExhaustive: boolean;
  /** Hooks turned somewhere other than the superseded inward default. */
  departures: number;
}

/** Project a placed cage into the record's snapshot. */
export function dowelSeatingSnapshot(cage: DowelCageResult): DowelSeatingSnapshot {
  const p = cage.placements;
  const finite = (values: number[]) => values.reduce((m, v) => Math.min(m, v), Infinity);
  return {
    status: cage.status,
    hooked: cage.hooked,
    bendRadius: cage.hooked ? cage.hook.centrelineRadius : 0,
    extension: cage.hooked ? cage.hook.extension : 0,
    legElevations: [...new Set(p.map((q) => +q.legZ.toFixed(6)))].sort((a, b) => a - b),
    bottomCover: finite(p.map((q) => q.bottomCover)),
    sideCover: p.some((q) => q.sideCover === null)
      ? null
      : finite(p.map((q) => q.sideCover as number)),
    requiredLdh: cage.hooked && p.length > 0 ? p[0].requiredEmbedment : null,
    availableEmbedment: finite(p.map((q) => q.availableEmbedment)),
    minHookClearance: finite(p.map((q) => q.hookClearance)),
    minMatClearance: finite(p.map((q) => q.matClearance)),
    seatedCount: p.filter((q) => q.seatedOn.length > 0).length,
    carriedBy: [...new Set(p
      .filter((q) => q.seatedOn.length > 0 && q.supportLayer !== null)
      .map((q) => q.supportLayer as FootingMatLayer))].sort(),
    orientations: p.map((q) => q.direction),
    feasibleArrangements: cage.selection?.feasible ?? 0,
    searchExhaustive: cage.selection?.searchExhaustive ?? true,
    departures: cage.selection?.departures ?? 0,
  };
}
