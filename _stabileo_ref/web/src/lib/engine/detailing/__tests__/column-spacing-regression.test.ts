/**
 * A column cage must satisfy §25.2.3, and the generator must say so when it cannot.
 *
 * ── What this locks down ───────────────────────────────────────────
 *
 * `generateColumnStack` placed every non-corner bar on the two ±y faces and never checked
 * the resulting spacing. On the flagship that drew a 24Ø12 column as twenty bars crammed
 * onto two faces at roughly 8 mm clear, against the 40 mm the article requires — an illegal
 * cage, emitted without complaint.
 *
 * It cost more than its own correctness. Those twenty bars project onto the transverse axis
 * of every beam framing into that joint, and they are what made 120 beams report as
 * impossible to thread. A search was being handed geometry nobody would build and then
 * blamed for failing to coordinate it.
 *
 * Three guarantees here, and none is redundant: distribute the bars legally when they fit,
 * REPORT rather than draw when they do not, and read the SAME coordinates the verifier
 * certified — a legal cage at coordinates no certificate covers is still the wrong cage.
 */
import { describe, it, expect } from 'vitest';
import { generateColumnStack, type ColumnLift } from '../generate-column';
import { generateColumnCandidates } from '../column-candidates';
import { minClearSpacingColumn } from '../../../codes/cirsoc201/spacing';
import { seatedLongitudinalHalfExtents } from '../../../codes/cirsoc201/transverse-cage';

function lift(count: number, diameterMm: number, size = 0.5): ColumnLift {
  return {
    elementId: 1, baseZ: 0, topZ: 3.2, b: size, h: size,
    centre: { x: 0, y: 0 }, bars: { count, diameterMm }, tieDia: 8, cover: 0.03,
  };
}

function stack(count: number, diameterMm: number, size = 0.5, positions?: Array<{ x: number; y: number }>) {
  return generateColumnStack({
    stackId: 'S', lifts: [lift(count, diameterMm, size)],
    fc: 25, fy: 420, maxAggregateSizeMm: 19, edition: '2025',
    lapSplice: () => 0.8, beamDepthAtTop: new Map(), roofTermination: true,
    barPositions: positions,
  });
}

/** Tightest clear distance between any two longitudinal bars, m. */
function tightest(bars: ReturnType<typeof stack>['bars'], diameterMm: number): number {
  const pts = bars
    .filter((b) => b.role === 'longitudinal')
    .map((b) => b.segments[0]!.start);
  let min = Infinity;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      min = Math.min(min, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
    }
  }
  return min - diameterMm / 1000;
}

/**
 * The superseded two-face distribution, kept as an executable record of what it produced.
 *
 * Four corners, then the intermediate bars spread along ONE axis and alternated between the
 * ±y faces. It is not called by anything any more; it is here so the breach below is measured
 * rather than remembered.
 */
function twoFacePositions(count: number, diameterMm: number, size: number): Array<{ x: number; y: number }> {
  const seat = seatedLongitudinalHalfExtents(size, size, 0.03, 8, diameterMm);
  const out = [
    { x: -seat.corner.halfAcross, y: -seat.corner.halfUp },
    { x: seat.corner.halfAcross, y: -seat.corner.halfUp },
    { x: seat.corner.halfAcross, y: seat.corner.halfUp },
    { x: -seat.corner.halfAcross, y: seat.corner.halfUp },
  ];
  const extra = Math.max(0, count - 4);
  const halfB = seat.face.halfAcross;
  for (let k = 0; k < extra; k++) {
    const t = (k + 1) / (extra + 1);
    out.push(k % 2 === 0
      ? { x: -halfB + 2 * halfB * t, y: -seat.face.halfUp }
      : { x: -halfB + 2 * halfB * t, y: seat.face.halfUp });
  }
  return out;
}

describe('§25.2.3 is enforced on the column cage', () => {
  it('distributes 24Ø12 legally, where the superseded two-face scheme could not', () => {
    const required = minClearSpacingColumn('2025', {
      barDiameterMm: 12, maxAggregateSizeMm: 19,
    }).minClear;

    // What the fallback used to do, measured: twenty bars crammed onto two faces.
    const superseded = stack(24, 12, 0.5, twoFacePositions(24, 12, 0.5));
    expect(tightest(superseded.bars, 12)).toBeLessThan(required);
    // And even then it had to SAY so. Silence is what let the illegal cage through, so the
    // report is still required of any arrangement that breaches the article.
    expect(superseded.unsupported.join(' ')).toMatch(/separación libre mínima/);

    // What it does now: the certified per-face distribution, which is legal for these bars.
    const g = stack(24, 12);
    expect(tightest(g.bars, 12)).toBeGreaterThanOrEqual(required - 1e-9);
    expect(g.unsupported.join(' ')).not.toMatch(/separación libre mínima/);
  });

  it('still reports, rather than draws, a count that no distribution can hold', () => {
    // 40Ø25 in a 400 mm column. The certified distribution is not a licence to stop checking:
    // when the section genuinely cannot hold the certified bars, that is a real inadequacy and
    // the generator must name it.
    const g = stack(40, 25, 0.4);
    const required = minClearSpacingColumn('2025', {
      barDiameterMm: 25, maxAggregateSizeMm: 19,
    }).minClear;
    expect(tightest(g.bars, 25)).toBeLessThan(required);
    expect(g.unsupported.join(' ')).toMatch(/separación libre mínima/);
  });

  it('says nothing when the cage is legal', () => {
    const g = stack(8, 20);
    expect(g.unsupported.join(' ')).not.toMatch(/separación libre mínima/);
  });

  it('draws the SAME coordinates column-candidates offers as its even arrangement', () => {
    // The one-authority invariant, asserted on coordinates rather than on properties. Both
    // sides read `computeColumnLayout`; if either ever grows its own distribution again, this
    // is what catches it — a cage that is merely "also legal" is not the same cage.
    const cage = generateColumnCandidates({
      count: 24, diameterMm: 12, b: 0.5, h: 0.5, cover: 0.03, tieDiaMm: 8,
      edition: '2025', maxAggregateSizeMm: 19, placementTolerance: 0.010,
    });
    const even = cage.find((c) => c.arrangement === 'even');
    expect(even).toBeDefined();
    const offered = even!.slots.map((s) => [s.dx, s.dy]);

    const drawn = stack(24, 12).bars
      .filter((b) => b.role === 'longitudinal')
      .map((b) => [b.segments[0]!.start.x, b.segments[0]!.start.y]);
    expect(drawn).toHaveLength(offered.length);
    for (let i = 0; i < offered.length; i++) {
      expect(drawn[i][0]).toBeCloseTo(offered[i][0], 12);
      expect(drawn[i][1]).toBeCloseTo(offered[i][1], 12);
    }
  });

  it('28Ø12 in a 500 mm column IS legal, and is offered', () => {
    // This assertion used to demand the opposite, and it was wrong twice over. The
    // authoritative layout places 28Ø12 at 46.9 mm clear against the 40 mm §25.2.3
    // requires. It was refused only because the candidate check used minimum-plus-
    // tolerance as a veto — so the module contradicted the certificate the verifier had
    // already issued for the same bars.
    const cage = generateColumnCandidates({
      count: 28, diameterMm: 12, b: 0.5, h: 0.5, cover: 0.03, tieDiaMm: 8,
      edition: '2025', maxAggregateSizeMm: 19, placementTolerance: 0.010,
    });
    expect(cage.length).toBeGreaterThan(0);
    const required = minClearSpacingColumn('2025', {
      barDiameterMm: 12, maxAggregateSizeMm: 19,
    }).minClear;
    for (const c of cage) expect(c.minClear).toBeGreaterThanOrEqual(required - 1e-9);
  });

  it('a count that genuinely will not fit gets no cage at all', () => {
    // 40Ø25 in a 400 mm column: no distribution of any kind satisfies §25.2.3, and the
    // honest answer is to offer nothing rather than to draw something unbuildable.
    const cage = generateColumnCandidates({
      count: 40, diameterMm: 25, b: 0.4, h: 0.4, cover: 0.03, tieDiaMm: 8,
      edition: '2025', maxAggregateSizeMm: 19, placementTolerance: 0.010,
    });
    expect(cage).toEqual([]);
  });
});
