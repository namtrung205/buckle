/**
 * The starter cage's foot: where each hook sits, and whether the eight of them fit together.
 *
 * ── What this file is for ──────────────────────────────────────────
 *
 * The column's longitudinal layout and the footing's dowels are ONE arrangement, and the two
 * questions this file settles are the two that arrangement has to answer:
 *
 *   * is every hook physically seated on the mat layer it crosses, with its cover, its
 *     §25.4.3.1 development and no shared volume with anything;
 *   * and does a complete arrangement of all eight EXIST.
 *
 * The second is not implied by the first. On the reference footing the superseded two-face
 * distribution gives every dowel valid orientations on its own and NO combination of them:
 * feasible = 0 over an exhaustive sweep. The certified per-face layout gives 100. That gap is
 * the whole reason the column layout had to move, so both halves of it are measured here rather
 * than described — a claim that the old cage "did not fit" is worth nothing without the count.
 */
import { describe, it, expect } from 'vitest';
import { designFootingMat, type FootingMatDesign } from '../footing-flexure';
import { generateFootingMat, type FootingMatPlacement } from '../footing-mat-geometry';
import { minClearSpacingInLayer } from '../../../codes/cirsoc201/spacing';
import { seatedLongitudinalHalfExtents } from '../../../codes/cirsoc201/transverse-cage';
import { columnBarPositions } from '../generate-column';
import {
  dowelMatSupportFrom, placeFootingDowelCage, dowelSeatingSnapshot,
  type DowelCageInput, type DowelHookDirection, type DowelMatSupport,
} from '../footing-dowel-cage';
import { minSurfaceClearance } from '../collision';

/**
 * The reference footing, the same one `footing-mat-geometry.test.ts` uses.
 *
 * 2,50 × 2,50 × 0,60 m, 50 mm cover, a 0,40 m square column carrying 8Ø20, Ø16 mat both ways,
 * AUTO layer order — which resolves X below Y, so:
 *
 *   X (LOWER): centre 58 mm above the soffit, top surface 66 mm
 *   Y (UPPER): centre 74 mm,                  top surface 82 mm
 *
 * A hook leg running along x is carried by the Y bars it crosses and seats at 82 mm; one
 * running along y is carried by the X bars and drops through the upper layer to 66 mm. Those
 * two elevations are the only seats on this footing, and they are both above the 50 mm cover.
 */
const SOFFIT_Z = -1.2;
const FOOTING_TOP_Z = -0.60;
const COVER = 0.05;

const design = (): FootingMatDesign => designFootingMat({
  B: 2.5, L: 2.5, thickness: 0.60, cover: COVER,
  columnB: 0.40, columnH: 0.40,
  eccentricityB: 0, eccentricityL: 0,
  fc: 25, fy: 420,
  factoredAxial: 1250, factoredMomentB: 0, factoredMomentL: 0,
  maxAggregateSizeMm: 20, edition: '2025',
  preferences: {
    bottomMatDiameterXmm: 16, bottomMatDiameterYmm: 16,
    bottomMatSpacingPolicy: 'AUTO_CODE_COMPLIANT',
    bottomMatLayerOrder: 'AUTO',
  },
});

const placement: FootingMatPlacement = {
  footingId: 'F1', centroid: { x: 0, y: 0 }, soffitZ: SOFFIT_Z,
  B: 2.5, L: 2.5, thickness: 0.60, cover: COVER,
  elementIds: [3], designRevision: 4, detailingRevision: 7,
  sourceScheduleRef: 'footing:F1',
};

/** The generated mat, and the support description the cage measures against. */
function referenceMat(): { bars: ReturnType<typeof generateFootingMat>; mat: DowelMatSupport } {
  const d = design();
  const clear = {
    x: minClearSpacingInLayer('2025', { barDiameterMm: 16, maxAggregateSizeMm: 20 }).minClear,
    y: minClearSpacingInLayer('2025', { barDiameterMm: 16, maxAggregateSizeMm: 20 }).minClear,
  };
  const g = generateFootingMat(placement, d, clear);
  const mat = dowelMatSupportFrom(g.bars, [
    {
      axis: 'X', diameterMm: 16, centreZ: SOFFIT_Z + d.x.centreElevation,
      layer: g.lowerLayerAxis === 'X' ? 'LOWER' : 'UPPER',
    },
    {
      axis: 'Y', diameterMm: 16, centreZ: SOFFIT_Z + d.y.centreElevation,
      layer: g.lowerLayerAxis === 'Y' ? 'LOWER' : 'UPPER',
    },
  ]);
  expect(mat).not.toBeNull();
  return { bars: g, mat: mat! };
}

/**
 * The certified eight-bar layout: four corners plus one intermediate bar centred on each face.
 *
 * Read from `columnBarPositions`, not restated, because the point of the arrangement is that
 * the dowels and the column bars come from the same call.
 */
const certifiedPositions = () => columnBarPositions(0.40, 0.40, COVER, 8, 20, 8);

/**
 * The superseded distribution, kept as an executable record.
 *
 * Four corners, then the four intermediate bars spread along ONE axis and alternated between
 * the ±y faces. Nothing calls this any more; it exists so the feasible count below is measured
 * against real coordinates rather than remembered.
 */
function twoFacePositions(): Array<{ x: number; y: number }> {
  const seat = seatedLongitudinalHalfExtents(0.40, 0.40, COVER, 8, 20);
  const out = [
    { x: -seat.corner.halfAcross, y: -seat.corner.halfUp },
    { x: seat.corner.halfAcross, y: -seat.corner.halfUp },
    { x: seat.corner.halfAcross, y: seat.corner.halfUp },
    { x: -seat.corner.halfAcross, y: seat.corner.halfUp },
  ];
  const halfB = seat.face.halfAcross;
  for (let k = 0; k < 4; k++) {
    const t = (k + 1) / 5;
    out.push(k % 2 === 0
      ? { x: -halfB + 2 * halfB * t, y: -seat.face.halfUp }
      : { x: -halfB + 2 * halfB * t, y: seat.face.halfUp });
  }
  return out;
}

function cageFor(
  positions: ReadonlyArray<{ x: number; y: number }>,
  over: Partial<DowelCageInput> = {},
) {
  const { mat } = referenceMat();
  return placeFootingDowelCage({
    id: 'F1-C3', centre: { x: 0, y: 0 },
    soffitZ: SOFFIT_Z, footingTopZ: FOOTING_TOP_Z, cover: COVER,
    diameterMm: 20, positions,
    lapAbove: 1.99, ldFooting: 1.527, ldhFooting: 0.45,
    elementIds: [3], edition: '2025',
    mat, footingPlan: { centroid: { x: 0, y: 0 }, B: 2.5, L: 2.5 },
    ...over,
  });
}

// ─── Feasibility: the reason the layout had to change ─────────────

describe('starter cage feasibility', () => {
  it('finds NO arrangement for the superseded two-face layout, exhaustively', () => {
    const cage = cageFor(twoFacePositions());

    expect(cage.status).toBe('NO_ARRANGEMENT');
    // Not "the search gave up": every combination was visited and none worked.
    expect(cage.selection!.searchExhaustive).toBe(true);
    expect(cage.selection!.feasible).toBe(0);

    // Each dowel does have valid orientations on its own — which is exactly why a per-bar
    // check cannot find this. Two of the eight are already down to the ±x pair, because a leg
    // along y would land in the mat.
    const perDowel = new Map<number, number>();
    for (const c of cage.candidates.filter((q) => q.valid)) {
      perDowel.set(c.index, (perDowel.get(c.index) ?? 0) + 1);
    }
    expect([...perDowel.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(Math.min(...perDowel.values())).toBe(2);

    // Nothing is drawn, and the failure names the bars a detailer has to move.
    expect(cage.bars).toEqual([]);
    expect(cage.placements).toEqual([]);
    for (let i = 0; i < 8; i++) {
      expect(cage.failures.join(' ')).toContain(`F1-C3-dowel-${i}`);
    }
    expect(cage.failures.join(' ')).toMatch(/búsqueda exhaustiva/);
  });

  it('finds 100 complete arrangements for the certified per-face layout', () => {
    const cage = cageFor(certifiedPositions());
    expect(cage.status).toBe('PLACED');
    expect(cage.failures).toEqual([]);
    expect(cage.selection!.searchExhaustive).toBe(true);
    // The count itself, because "at least one" and "a hundred" are different engineering
    // facts: the second says the cage has slack, the first says it is on a knife edge.
    expect(cage.selection!.feasible).toBe(100);
    expect(cage.bars).toHaveLength(8);
    expect(cage.placements).toHaveLength(8);
    // Every orientation of every dowel is individually valid here — the layout removed the
    // constraint rather than merely satisfying it.
    expect(cage.candidates.filter((c) => c.valid)).toHaveLength(32);
  });
});

// ─── The placed cage, measured ────────────────────────────────────

describe('the placed cage', () => {
  it('seats all 8 hooks on the mat layer their leg actually crosses', () => {
    const { mat } = referenceMat();
    const cage = cageFor(certifiedPositions());
    const snapshot = dowelSeatingSnapshot(cage);

    expect(snapshot.seatedCount).toBe(8);
    for (const p of cage.placements) {
      // One bar of the carrying layer per hook, named — not a declared relationship.
      expect(p.seatedOn.length).toBeGreaterThanOrEqual(1);
      const alongX = p.direction === '+x' || p.direction === '-x';
      // A leg along x bears on the bars running along y, and vice versa. This is the identity
      // the superseded generator got wrong: it declared a seat on a layer the hook passed
      // 10 mm UNDER.
      expect(p.supportAxis).toBe(alongX ? 'Y' : 'X');
      expect(p.seatZ).toBeCloseTo(alongX ? mat.y.topSurfaceZ : mat.x.topSurfaceZ, 12);
      // Tangency, from the sampled path: the leg's centreline is one radius above the seat.
      expect(p.legZ - p.seatZ).toBeCloseTo(0.010, 12);
      expect(p.bendRadius).toBeCloseTo(0.070, 12);
      expect(p.extension).toBeCloseTo(0.240, 12);
    }
    // Both layers are used, which is what makes the arrangement possible at all.
    expect(snapshot.carriedBy.sort()).toEqual(['LOWER', 'UPPER']);
  });

  it('keeps the measured 66 / 82 mm bottom covers, both above the 50 mm required', () => {
    const cage = cageFor(certifiedPositions());
    const covers = [...new Set(cage.placements.map((p) => +(p.bottomCover * 1000).toFixed(6)))]
      .sort((a, b) => a - b);
    expect(covers).toEqual([66, 82]);
    for (const p of cage.placements) {
      expect(p.bottomCover).toBeGreaterThanOrEqual(COVER - 1e-9);
      // Side cover and containment, against the real plan rather than an assumption.
      expect(p.sideCover).not.toBeNull();
      expect(p.sideCover!).toBeGreaterThanOrEqual(COVER - 1e-9);
    }
  });

  it('develops every hook under §25.4.3.1 against a measured embedment', () => {
    const cage = cageFor(certifiedPositions());
    expect(cage.hooked).toBe(true);
    for (const p of cage.placements) {
      expect(p.requiredEmbedment).toBeCloseTo(0.45, 12);
      expect(p.availableEmbedment).toBeGreaterThanOrEqual(p.requiredEmbedment - 1e-9);
    }
    // The two seats give the two embedments, both clear of l_dh = 450 mm.
    const embed = [...new Set(cage.placements
      .map((p) => +(p.availableEmbedment * 1000).toFixed(6)))].sort((a, b) => a - b);
    expect(embed).toEqual([518, 534]);
    expect(cage.refs.some((r) => r.clause === '25.4.3.1')).toBe(true);
  });

  it('leaves zero negative hook/hook clearance and zero prohibited mat clearance', () => {
    const cage = cageFor(certifiedPositions());

    // Hook to hook: STRICTLY positive. Nothing in this detail puts two starters in contact, so
    // a zero here would not be a fabrication allowance — it would be steel in one place.
    for (const p of cage.placements) {
      expect(p.hookClearance).toBeGreaterThan(0);
      expect(p.matClearance).toBeGreaterThan(0);
    }
    expect(Math.min(...cage.placements.map((p) => p.hookClearance))).toBeCloseTo(0.11024, 5);

    // And again from the geometry rather than from the search's own bookkeeping: every pair of
    // emitted bars, measured surface to surface.
    let worst = Infinity;
    for (let i = 0; i < cage.bars.length; i++) {
      for (let j = i + 1; j < cage.bars.length; j++) {
        worst = Math.min(worst, minSurfaceClearance(cage.bars[i], cage.bars[j]).clearance);
      }
    }
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeCloseTo(Math.min(...cage.placements.map((p) => p.hookClearance)), 9);
  });
});

// ─── Determinism ─────────────────────────────────────────────────

describe('determinism of the orientation search', () => {
  it('is byte-identical across runs', () => {
    const a = cageFor(certifiedPositions());
    const b = cageFor(certifiedPositions());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('gives each POSITION the same orientation whatever order the dowels arrive in', () => {
    // Permutation independence is a stronger claim than determinism, and the search's final
    // tie-break is a sequence in dowel order — so it is exactly the property that could
    // quietly stop holding. Asserted per position, since the ids are index-derived.
    const base = certifiedPositions();
    const key = (p: { x: number; y: number }) =>
      `${Math.round(p.x * 1e6)}:${Math.round(p.y * 1e6)}`;
    const reference = cageFor(base);
    const expected = new Map<string, DowelHookDirection>(
      reference.placements.map((p) => [key(p.position), p.direction]));

    const permutations = [
      [7, 6, 5, 4, 3, 2, 1, 0],
      [4, 5, 6, 7, 0, 1, 2, 3],
      [0, 2, 4, 6, 1, 3, 5, 7],
      [3, 1, 7, 5, 2, 0, 6, 4],
    ];
    for (const perm of permutations) {
      const cage = cageFor(perm.map((i) => base[i]));
      expect(cage.status).toBe('PLACED');
      expect(cage.selection!.feasible).toBe(reference.selection!.feasible);
      expect(cage.selection!.minClearance)
        .toBeCloseTo(reference.selection!.minClearance, 12);
      for (const p of cage.placements) {
        expect(p.direction).toBe(expected.get(key(p.position)));
      }
    }
  });
});

// ─── The whole-footing conditions, stated once ────────────────────

describe('§25.4.3.1 shortfalls are footing conditions, not per-dowel ones', () => {
  it('states an l_dh that no orientation can develop exactly once', () => {
    // 700 mm of hooked development against 534 mm at the deepest seat: no orientation of any
    // starter develops, so this is one finding about the footing and not eight about the bars.
    const cage = cageFor(certifiedPositions(), { ldhFooting: 0.70 });
    expect(cage.status).toBe('NO_CANDIDATE');
    expect(cage.failures).toHaveLength(1);
    expect(cage.failures[0]).toMatch(/25\.4\.3\.1/);
    expect(cage.failures[0]).toMatch(/excede el empotramiento disponible/);
    expect(cage.bars).toEqual([]);
  });

  it('fails closed, once, when l_dh was never computed', () => {
    const cage = cageFor(certifiedPositions(), { ldhFooting: null });
    expect(cage.status).toBe('NO_CANDIDATE');
    expect(cage.failures).toHaveLength(1);
    expect(cage.failures[0]).toMatch(/no se pudo verificar/);
  });
});
