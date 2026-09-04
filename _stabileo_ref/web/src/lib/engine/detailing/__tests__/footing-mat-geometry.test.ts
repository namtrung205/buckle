import { describe, it, expect } from 'vitest';
import {
  designFootingMat, matBarLength,
  type FootingMatDesignInput, type FootingMatDesign,
} from '../footing-flexure';
import {
  generateFootingMat, type FootingMatPlacement,
} from '../footing-mat-geometry';
import { verifyFootingMatAnchorage } from '../footing-mat-anchorage';
import { minClearSpacingInLayer } from '../../../codes/cirsoc201/spacing';
import {
  barMass, buildStraightBarWithHooks, type BarPath,
} from '../../../codes/cirsoc201/bar-geometry';
import { detectCollisions } from '../collision';
import { classifyPair } from '../classify';
import { generateDowels } from '../floor-design';
import { dowelMatSupportFrom } from '../footing-dowel-cage';

/**
 * The reference footing, chosen so every number below is hand-checkable.
 *
 * 2,50 × 2,50 × 0,60 m, 50 mm cover, 0,40 m square column, centred, N_u = 1250 kN, no applied
 * moment, Ø16 both ways, AUTO layer order.
 *
 *   q_u        = 1250 / 6,25 = 200 kPa
 *   cantilever = (2,50 − 0,40)/2 = 1,05 m
 *   A_s,min    = 0,0018 × 2,50 × 0,60 = 27,00 cm²  (§7.6.1, and it governs here)
 *   bar length = 2,50 − 2 × 0,05 = 2,40 m
 *
 * X below Y by the deterministic tie-break, so:
 *
 *   X: centre 50 + 0 + 8 = 58 mm above the soffit, clear cover 50 mm, d = 542 mm
 *   Y: centre 50 + 16 + 8 = 74 mm above the soffit, clear cover 66 mm, d = 526 mm
 */
const design = (over: Partial<FootingMatDesignInput> = {}): FootingMatDesign =>
  designFootingMat({
    B: 2.5, L: 2.5, thickness: 0.60, cover: 0.05,
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
    ...over,
  });

const place = (over: Partial<FootingMatPlacement> = {}): FootingMatPlacement => ({
  footingId: 'F1',
  centroid: { x: 0, y: 0 },
  soffitZ: -1.2,
  B: 2.5, L: 2.5, thickness: 0.60, cover: 0.05,
  elementIds: [3],
  designRevision: 4, detailingRevision: 7,
  sourceScheduleRef: 'footing:F1',
  ...over,
});

/** The §25.2.1 minimum each direction was laid out to, from the same authority. */
const clear = (dx = 16, dy = 16) => ({
  x: minClearSpacingInLayer('2025', { barDiameterMm: dx, maxAggregateSizeMm: 20 }).minClear,
  y: minClearSpacingInLayer('2025', { barDiameterMm: dy, maxAggregateSizeMm: 20 }).minClear,
});

const gen = (
  d: FootingMatDesign = design(), p: FootingMatPlacement = place(), dia: [number, number] = [16, 16],
) => generateFootingMat(p, d, clear(dia[0], dia[1]));

// ─── Coordinate authority and elevations ─────────────────────────

describe('physical mat — axes and elevations', () => {
  it('runs X bars parallel to B and distributes them across L, and Y the other way', () => {
    const g = gen();
    const xs = g.provenance.filter((b) => b.axis === 'X');
    const ys = g.provenance.filter((b) => b.axis === 'Y');
    expect(xs.length).toBeGreaterThan(0);
    expect(ys.length).toBeGreaterThan(0);
    for (const b of xs) {
      // Constant y, varying x: the bar runs along B.
      expect(b.start.y).toBeCloseTo(b.end.y, 12);
      expect(b.end.x - b.start.x).toBeCloseTo(2.40, 12);
    }
    for (const b of ys) {
      expect(b.start.x).toBeCloseTo(b.end.x, 12);
      expect(b.end.y - b.start.y).toBeCloseTo(2.40, 12);
    }
    // Distinct offsets across the perpendicular dimension, one per bar.
    expect(new Set(xs.map((b) => b.start.y)).size).toBe(xs.length);
    expect(new Set(ys.map((b) => b.start.x)).size).toBe(ys.length);
  });

  it('places the two layers at the exact elevations the design was made at', () => {
    const d = design();
    const g = gen(d);
    expect(g.layerOrder).toBe('X_BELOW_Y');
    expect(g.lowerLayerAxis).toBe('X');

    // Independently: 50 + 0 + 16/2 and 50 + 16 + 16/2, above a soffit at −1,20 m.
    const zx = -1.2 + 0.058;
    const zy = -1.2 + 0.074;
    for (const b of g.provenance) {
      const expected = b.axis === 'X' ? zx : zy;
      expect(b.start.z).toBeCloseTo(expected, 12);
      expect(b.end.z).toBeCloseTo(expected, 12);
      // `thickness − centreElevation` IS the design depth, by construction.
      expect(0.60 - b.centreElevation).toBeCloseTo(b.axis === 'X' ? d.x.d : d.y.d, 12);
    }
    expect(g.provenance.find((b) => b.axis === 'X')!.clearCoverToSoffit).toBeCloseTo(0.05, 12);
    expect(g.provenance.find((b) => b.axis === 'Y')!.clearCoverToSoffit).toBeCloseTo(0.066, 12);
  });

  it('honours unequal diameters in both layers', () => {
    // Ø25 X, Ø12 Y. Whichever the order resolves to, the LOWER direction's centre is
    // `cover + d_b/2` and the UPPER one's is `cover + d_b,lower + d_b/2`.
    const d = design({
      preferences: {
        bottomMatDiameterXmm: 25, bottomMatDiameterYmm: 12,
        bottomMatSpacingPolicy: 'AUTO_CODE_COMPLIANT', bottomMatLayerOrder: 'AUTO',
      },
    });
    const g = gen(d, place(), [25, 12]);
    expect(g.status).toBe('MODELED');
    const lower = g.lowerLayerAxis!;
    const dia = (a: 'X' | 'Y') => (a === 'X' ? 25 : 12);
    const other = lower === 'X' ? 'Y' : 'X';
    const zLower = -1.2 + 0.05 + dia(lower) / 2000;
    const zUpper = -1.2 + 0.05 + dia(lower) / 1000 + dia(other) / 2000;
    expect(g.provenance.find((b) => b.axis === lower)!.start.z).toBeCloseTo(zLower, 12);
    expect(g.provenance.find((b) => b.axis === other)!.start.z).toBeCloseTo(zUpper, 12);
  });

  it('follows a manual override, both ways', () => {
    for (const order of ['X_BELOW_Y', 'Y_BELOW_X'] as const) {
      const d = design({
        preferences: {
          bottomMatDiameterXmm: 16, bottomMatDiameterYmm: 20,
          bottomMatSpacingPolicy: 'AUTO_CODE_COMPLIANT', bottomMatLayerOrder: order,
        },
      });
      const g = gen(d, place(), [16, 20]);
      expect(g.layerOrder).toBe(order);
      expect(g.lowerLayerAxis).toBe(order === 'X_BELOW_Y' ? 'X' : 'Y');
      const lowerBar = g.provenance.find((b) => b.axis === g.lowerLayerAxis)!;
      expect(lowerBar.layer).toBe('LOWER');
      expect(lowerBar.clearCoverToSoffit).toBeCloseTo(0.05, 12);
    }
  });

  it('models nothing when no layer order could be established', () => {
    // A 0,20 m footing at Ø16 leaves d below §13.3.1.2's 150 mm in both arrangements.
    const g = gen(design({ thickness: 0.20 }), place({ thickness: 0.20 }));
    expect(g.status).toBe('NOT_MODELED');
    expect(g.bars).toEqual([]);
    expect(g.notModeled.map((m) => m.key)).toContain('footing.geometry.noLayerOrder');
  });
});

// ─── Endpoints and cover ─────────────────────────────────────────

describe('physical mat — endpoints and cover', () => {
  it('puts every endpoint exactly one cover in from the formwork', () => {
    const g = gen();
    // Independently: ±(2,50/2 − 0,05) = ±1,20 m about a centroid at the origin.
    for (const b of g.provenance) {
      const [lo, hi] = b.axis === 'X'
        ? [b.start.x, b.end.x] : [b.start.y, b.end.y];
      expect(lo).toBeCloseTo(-1.20, 12);
      expect(hi).toBeCloseTo(1.20, 12);
      expect(b.length).toBeCloseTo(matBarLength(2.5, 0.05), 12);
      expect(b.length).toBeCloseTo(2.40, 12);
    }
  });

  it('offsets the centroid, and the bars with it', () => {
    // The centroid is `node + eccentricity`, so a footing whose centroid is at (1,30, −0,40)
    // has its bars there and not at the node.
    const g = gen(design(), place({ centroid: { x: 1.3, y: -0.4 } }));
    const x = g.provenance.find((b) => b.axis === 'X')!;
    expect(x.start.x).toBeCloseTo(1.3 - 1.2, 12);
    expect(x.end.x).toBeCloseTo(1.3 + 1.2, 12);
    expect(x.start.y).toBeCloseTo(-0.4 + x.distributionOffset, 12);
    expect(g.findings).toEqual([]);
  });

  it('measures side cover to the bar SURFACE, and hits it exactly on a full-width mat', () => {
    const g = gen();
    // Outermost X bar: 2,50/2 − 0,05 − 16/2000 = 1,192 m from the centroid, so the surface
    // stands at 1,200 m and the face at 1,250 m — exactly 50 mm.
    const offsets = g.provenance.filter((b) => b.axis === 'X')
      .map((b) => b.distributionOffset).sort((a, b) => a - b);
    expect(offsets[0]).toBeCloseTo(-1.192, 12);
    expect(offsets[offsets.length - 1]).toBeCloseTo(1.192, 12);
    const surfaceToFace = 1.25 - 1.192 - 0.008;
    expect(surfaceToFace).toBeCloseTo(0.05, 12);
    expect(g.findings).toEqual([]);
  });

  it('keeps every bar inside the concrete, in all three dimensions', () => {
    const g = gen();
    for (const b of g.provenance) {
      const r = b.diameterMm / 2000;
      // Plan: the bar's whole length and its own thickness.
      for (const p of [b.start, b.end]) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1.25 - 0.05 + 1e-12);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1.25 - 0.05 + 1e-12);
        // Section: soffit to top face.
        expect(p.z - r).toBeGreaterThanOrEqual(-1.2 - 1e-12);
        expect(p.z + r).toBeLessThanOrEqual(-1.2 + 0.60 + 1e-12);
      }
      expect(b.clearCoverToSoffit).toBeGreaterThanOrEqual(0.05 - 1e-12);
    }
    expect(g.findings).toEqual([]);
  });

  it('reports a side-cover shortfall rather than nudging the bar', () => {
    // §13.3.3.3's outside zones use a TRIBUTARY pitch, so their outermost bar sits half a
    // pitch from the formwork rather than one cover in. On a thick rectangular footing the
    // minimum steel makes that pitch small enough to break the cover — a real condition, and
    // the check that catches it is therefore reachable rather than dead.
    const over = {
      B: 1.5, L: 3.0, thickness: 1.6,
      preferences: {
        bottomMatDiameterXmm: 16, bottomMatDiameterYmm: 16,
        bottomMatSpacingPolicy: 'AUTO_CODE_COMPLIANT', bottomMatLayerOrder: 'AUTO',
      },
    } as const;
    const g = gen(design(over), place({ B: 1.5, L: 3.0, thickness: 1.6 }));
    const short = g.findings.filter((f) => f.kind === 'SIDE_COVER_SHORT');
    expect(short.length).toBeGreaterThan(0);
    expect(g.status).toBe('RECONCILIATION_FAILED');
    // No bars are emitted: geometry that does not reconcile must not reach the model, the
    // drawing or the export.
    expect(g.bars).toEqual([]);
    expect(g.schedule).toEqual([]);
  });
});

// ─── Region placement ────────────────────────────────────────────

describe('physical mat — region placement', () => {
  it('lays a square footing out uniformly across the full width, both ways', () => {
    const d = design();
    const g = gen(d);
    for (const dir of [d.x, d.y]) {
      expect(dir.distribution).toBe('UNIFORM_FULL_WIDTH');
      expect(dir.regions).toHaveLength(1);
      const own = g.provenance.filter((b) => b.axis === dir.axis)
        .sort((a, b) => a.distributionOffset - b.distributionOffset);
      expect(own).toHaveLength(dir.regions[0].barCount);
      // The pitch is `(W − 2c − d_b)/(n − 1)`, computed here from the count that was placed.
      const pitch = (2.5 - 2 * 0.05 - dir.diameterMm / 1000) / (own.length - 1);
      for (let i = 1; i < own.length; i++) {
        expect(own[i].distributionOffset - own[i - 1].distributionOffset)
          .toBeCloseTo(pitch, 12);
      }
      expect(pitch).toBeCloseTo(dir.regions[0].spacingCentre, 12);
    }
  });

  it('reproduces the §13.3.3.3 band and its two exterior zones', () => {
    // 1,50 × 3,00: the SHORT-direction bars (parallel to B = 1,50) are banded across L = 3,00.
    const d = design({ B: 1.5, L: 3.0 });
    const g = gen(d, place({ B: 1.5, L: 3.0 }));
    expect(g.status).toBe('MODELED');
    expect(d.x.distribution).toBe('BANDED_SHORT_DIRECTION');
    expect(d.y.distribution).toBe('UNIFORM_FULL_WIDTH');

    const band = g.provenance.filter((b) => b.region === 'CENTRAL_BAND');
    const outside = g.provenance.filter((b) => b.region === 'OUTSIDE_BAND');
    expect(band.length).toBeGreaterThan(0);
    expect(outside.length).toBeGreaterThan(0);
    // The band is as wide as the SHORT side and centred on the column axis (here the
    // centroid), so every band bar lies within ±0,75 m and every exterior bar outside it.
    for (const b of band) expect(Math.abs(b.distributionOffset)).toBeLessThan(0.75);
    for (const b of outside) expect(Math.abs(b.distributionOffset)).toBeGreaterThan(0.75);
    // Two exterior zones, symmetric on a centred column.
    expect(outside.filter((b) => b.distributionOffset < 0)).toHaveLength(outside.length / 2);
  });

  it('leaves no duplicate and no short gap at a band boundary', () => {
    const d = design({ B: 1.5, L: 3.0 });
    const g = gen(d, place({ B: 1.5, L: 3.0 }));
    expect(g.findings).toEqual([]);

    // The boundary gap is the AVERAGE of the two tributary pitches, because each region's
    // outermost bar stands half its own pitch from the shared boundary. Derived here from the
    // region widths and counts, not read off the module.
    const bandRegion = d.x.regions.find((r) => r.kind === 'CENTRAL_BAND')!;
    const outRegion = d.x.regions.find((r) => r.kind === 'OUTSIDE_BAND')!;
    const expectedGap = (bandRegion.width / bandRegion.barCount
      + outRegion.width / outRegion.barCount) / 2;

    const offsets = g.provenance.filter((b) => b.axis === 'X')
      .map((b) => b.distributionOffset).sort((a, b) => a - b);
    // The gap straddling −0,75 m.
    const i = offsets.findIndex((o) => o > -0.75);
    expect(offsets[i] - offsets[i - 1]).toBeCloseTo(expectedGap, 12);
    expect(offsets[i] - offsets[i - 1]).toBeGreaterThan(0.016);
    // Every gap is distinct and positive: no two bars share a position.
    for (let k = 1; k < offsets.length; k++) {
      expect(offsets[k] - offsets[k - 1]).toBeGreaterThan(1e-6);
    }
  });
});

// ─── Identity, schedule, reconciliation ──────────────────────────

describe('physical mat — identity and schedule', () => {
  it('gives every bar a deterministic id and full provenance', () => {
    const a = gen();
    const b = gen();
    expect(a.provenance.map((p) => p.id)).toEqual(b.provenance.map((p) => p.id));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // Unique, and derived from footing / axis / region / sequence rather than from prose or
    // from iteration order.
    expect(new Set(a.provenance.map((p) => p.id)).size).toBe(a.provenance.length);
    expect(a.provenance[0].id).toMatch(/^F1-mat[XY]-(fw|cb|ob)\d+-\d+$/);
    for (const p of a.provenance) {
      expect(p.footingId).toBe('F1');
      expect(p.designRevision).toBe(4);
      expect(p.detailingRevision).toBe(7);
      expect(p.sourceScheduleRef).toBe('footing:F1');
      // The mark is filled by the assembly's mark pass, so it is honestly null here rather
      // than a placeholder string.
      expect(p.mark).toBeNull();
    }
  });

  it('separates the mat from the dowels by layer and zone identity', () => {
    const g = gen();
    for (const bar of g.bars) {
      expect(bar.layerId).toMatch(/^F1:bottom:[XY]$/);
      expect(bar.zoneId).toMatch(/^F1:mat:[XY]:/);
      expect(bar.role).toBe('longitudinal');
      // A straight bar: one segment, no hook invented.
      expect(bar.segments).toHaveLength(1);
      expect(bar.startTreatment).toEqual({ kind: 'straight' });
      expect(bar.endTreatment).toEqual({ kind: 'straight' });
    }
  });

  it('reconciles the schedule count with the bars that exist', () => {
    const g = gen(design({ B: 1.5, L: 3.0 }), place({ B: 1.5, L: 3.0 }));
    expect(g.schedule.reduce((n, r) => n + r.barCount, 0)).toBe(g.bars.length);
    for (const row of g.schedule) {
      expect(row.barIds).toHaveLength(row.barCount);
      const own = g.provenance.filter((p) => p.axis === row.axis
        && p.regionIndex === row.regionIndex);
      expect(own.map((p) => p.id).sort()).toEqual([...row.barIds].sort());
    }
  });

  it('reconciles provided steel, cutting length and mass with the geometry', () => {
    const d = design({ B: 1.5, L: 3.0 });
    const g = gen(d, place({ B: 1.5, L: 3.0 }));
    const area = (mm: number) => Math.PI * (mm / 2000) ** 2;

    for (const dir of [d.x, d.y]) {
      const own = g.provenance.filter((p) => p.axis === dir.axis);
      // Provided steel is the bars that exist times one bar area — the design's `asProvided`
      // is a claim, this is a measurement, and they must be the same number.
      expect(own.length * area(dir.diameterMm)).toBeCloseTo(dir.asProvided, 15);
      expect(dir.asProvided).toBeGreaterThanOrEqual(dir.asGoverning - 1e-15);
    }

    for (const row of g.schedule) {
      // One bar's cutting length: the span it runs along, less one cover at each end.
      const span = row.axis === 'X' ? 1.5 : 3.0;
      expect(row.cuttingLength).toBeCloseTo(span - 0.10, 12);
      expect(row.totalLength).toBeCloseTo(row.barCount * row.cuttingLength, 12);
      // Mass through the project's one authority: area × length × 7850.
      expect(row.totalMassKg).toBeCloseTo(
        row.barCount * barMass(row.cuttingLength, row.diameterMm), 12);
      expect(row.totalMassKg).toBeCloseTo(
        area(row.diameterMm) * row.totalLength * 7850, 10);
      // The bars themselves carry that length.
      for (const p of g.provenance.filter((q) => row.barIds.includes(q.id))) {
        expect(p.length).toBeCloseTo(row.cuttingLength, 12);
      }
    }
  });

  it('declares the orthogonal crossings it contains as intentional', () => {
    const d = design();
    const g = gen(d);
    expect(g.intendedCrossings).toBe(d.x.barCount * d.y.barCount);
    // The design's own permission, restated per direction, is what makes them intentional.
    expect(d.x.contactAtCrossingsPermitted).toBe(true);
    expect(d.y.contactAtCrossingsPermitted).toBe(true);
    expect(g.steps.join(' ')).toMatch(/INTENCIONAL/);
  });
});

// ─── Anchorage ───────────────────────────────────────────────────

describe('physical mat — straight development', () => {
  const anchor = (d: FootingMatDesign, p: FootingMatPlacement, ecc = { B: 0, L: 0 }) =>
    verifyFootingMatAnchorage({
      place: p, design: d, geometry: generateFootingMat(p, d, clear()),
      columnB: 0.40, columnH: 0.40,
      eccentricityB: ecc.B, eccentricityL: ecc.L,
      fc: 25, fy: 420, edition: '2025',
    });

  it('passes when the available length reaches ld', () => {
    // Independently, Table 25.4.2.3 "other cases", Ø16 ≤ 16 mm → coefficient 1,4:
    //   ld = 420/(1,4·√25)·16 = 60 × 16 = 960 mm.
    // Available: cantilever (2,50 − 0,40)/2 = 1,05 m, less one cover → 1,00 m.
    const a = anchor(design(), place());
    expect(a.outcome).toBe('VERIFIED');
    expect(a.x!.requiredLd).toBeCloseTo(0.960, 6);
    expect(a.x!.available).toBeCloseTo(1.00, 12);
    expect(a.x!.margin).toBeCloseTo(0.040, 12);
    expect(a.x!.tableRow).toBe('other');
    expect(a.failures).toEqual([]);
    // Both sides are reported, not only the governing one.
    expect(a.x!.sides.map((s) => s.side)).toEqual(['low', 'high']);
    expect(a.x!.sides[0].available).toBeCloseTo(a.x!.sides[1].available, 12);
  });

  it('fails, names the side and blocks, when it does not', () => {
    // A 2,00 m footing gives a 0,80 m cantilever and 0,75 m of available length against the
    // same 0,960 m — 210 mm short.
    const a = anchor(design({ B: 2.0, L: 2.0 }), place({ B: 2.0, L: 2.0 }));
    expect(a.outcome).toBe('FAILED');
    expect(a.x!.available).toBeCloseTo(0.75, 12);
    expect(a.x!.margin).toBeCloseTo(-0.210, 12);
    expect(a.failures.map((m) => m.key)).toContain('footing.anchorage.insufficient');
    expect(a.x!.controllingSide).toBe('low');
    // No hook is invented to rescue it.
    expect(a.x!.steps.join(' ')).toMatch(/No se inventa gancho/);
  });

  it('measures from the physical endpoint, so a plan eccentricity moves the answer', () => {
    // The centroid is offset 0,30 m from the node, so the column stands at −0,30 m in centroid
    // coordinates: the low cantilever shortens to 1,05 − 0,30 = 0,75 m and the high one grows
    // to 1,35 m. Available lengths are those less one cover.
    const d = design({ eccentricityB: 0.30 });
    const a = anchor(d, place(), { B: 0.30, L: 0 });
    expect(a.x!.sides.find((s) => s.side === 'low')!.available).toBeCloseTo(0.70, 12);
    expect(a.x!.sides.find((s) => s.side === 'high')!.available).toBeCloseTo(1.30, 12);
    expect(a.x!.controllingSide).toBe('low');
    expect(a.x!.outcome).toBe('FAILED');
    // The other direction is untouched by an eccentricity on this one.
    expect(a.y!.available).toBeCloseTo(1.00, 12);
    expect(a.y!.outcome).toBe('VERIFIED');
  });

  it('is NOT_EVALUATED, not FAILED, when there is no mat to measure', () => {
    const p = place({ thickness: 0.20 });
    const a = anchor(design({ thickness: 0.20 }), p);
    expect(a.outcome).toBe('NOT_EVALUATED');
    expect(a.x).toBeNull();
    expect(a.failures.map((m) => m.key)).toEqual(['footing.anchorage.noGeometry']);
  });

  it('states the two numbers a favourable-row evaluation would turn on', () => {
    // The conservative row is taken because the favourable row's condition is not implemented
    // anywhere in this repository. The measured clear spacing and clear cover are reported so
    // a reviewer evaluating it does not have to re-derive them.
    const a = anchor(design(), place());
    expect(a.x!.measuredClearSpacing).toBeGreaterThan(0);
    expect(a.x!.measuredClearCover).toBeCloseTo(0.05, 12);
    expect(a.x!.steps.join(' ')).toMatch(/fila favorable no está implementada/);
  });
});

// ─── Constructibility ────────────────────────────────────────────

/**
 * The mat through the AUTHORITATIVE classifier, not a local restatement of it.
 *
 * `buildFloorAssembly` runs exactly this pair of calls over the whole floor. Driving them here
 * with the footing's own steel keeps the assertions readable while testing the production path;
 * a second set of rules written in this file would prove nothing about what the app does.
 */
describe('physical mat — constructibility', () => {
  const ctx = (matIds: Set<string>) => ({
    edition: '2025' as const,
    maxAggregateSizeMm: 20,
    // A footing's elements are declared as COLUMNS, because its dowels are column bars.
    memberKindOf: () => 'column' as const,
    barKindOf: (bar: BarPath) => (matIds.has(bar.id) ? 'footing' as const : undefined),
  });

  const detect = (bars: BarPath[], matIds: Set<string>) => detectCollisions(bars, {
    classifyFor: (a, b, surface, ta, tb) => classifyPair(a, b, ctx(matIds), surface, ta, tb),
  });

  it('classifies the X/Y crossings as intentional contacts and reports none', () => {
    const g = gen();
    const ids = new Set(g.bars.map((b) => b.id));
    const r = detect(g.bars, ids);
    expect(r.conflicts).toEqual([]);
    expect(r.constructible).toBe(true);
    // Every X/Y pair that came close is a crossing, and a crossing has no clear-spacing rule:
    // §25.2.1 and §25.2.2 govern PARALLEL bars, in a layer and between parallel layers.
    const crossing = classifyPair(
      g.bars.find((b) => b.layerId!.endsWith(':X'))!,
      g.bars.find((b) => b.layerId!.endsWith(':Y'))!,
      ctx(ids), 0,
      { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 },
    );
    expect(crossing.pairClass).toBe('orthogonalCrossing');
    expect(crossing.reportable).toBe(false);
    expect(crossing.requiredClear).toBe(0);
  });

  it('judges parallel mat bars by §25.2.1 and not by the column rule', () => {
    // This is the generator/verifier disagreement the `barKindOf` hook removes. A footing's
    // elements map to `column`, whose §25.2.3 minimum is max(40 mm, 1,5 d_b, 4/3 d_agg) = 40 mm
    // for Ø16; the mat was laid out to §25.2.1's max(25 mm, d_b, 4/3 d_agg) = 26,67 mm, which
    // §13.3.3.1 → §7.7.2.1 → §25.2 is what makes applicable.
    const g = gen();
    const ids = new Set(g.bars.map((b) => b.id));
    const two = g.bars.filter((b) => b.layerId!.endsWith(':X')).slice(0, 2);
    const withHook = classifyPair(two[0], two[1], ctx(ids), 0.05,
      { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(withHook.pairClass).toBe('sameLayerSpacing');
    expect(withHook.requiredClear).toBeCloseTo(0.02667, 5);
    expect(withHook.refs.some((r) => r.clause === '25.2.1')).toBe(true);

    // Without the hook the SAME pair would be held to §25.2.3's 40 mm — the wrong clause.
    const without = classifyPair(two[0], two[1], { ...ctx(ids), barKindOf: undefined }, 0.05,
      { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(without.requiredClear).toBeCloseTo(0.040, 6);
  });

  /**
   * The claim the mat made checkable, now measured true.
   *
   * `generateDowels` noted that a starter whose straight l_d does not fit "remata con gancho a
   * 90° apoyado sobre la parrilla inferior" — turns 90° RESTING ON the bottom mat. Until the mat
   * existed there was nothing to rest on and the claim could not be checked; once it existed the
   * claim was false three ways over: the leg sat one bend radius BELOW the tangent point the
   * generator was reasoning about, which put it 10 mm under the lower layer with 20 mm of cover
   * against a declared 50 mm, and all eight hooks turned toward the column centre in one
   * horizontal plane, so twelve pairs interpenetrated and four had coincident axes.
   *
   * All three are now closed, and the closure is one thing rather than three: the seat is a
   * measured elevation on the mat layer the leg actually crosses, and the orientation is
   * searched over the certified bar layout instead of assumed. The counts below — 8 seated,
   * 0 prohibited — are what replaced the pinned 12.
   */
  it('seats every dowel hook on the mat it crosses, with no prohibited overlap left', () => {
    const dsg = design();
    const g = gen(dsg);
    const mat = dowelMatSupportFrom(g.bars, [
      {
        axis: 'X', diameterMm: 16, centreZ: -1.2 + dsg.x.centreElevation,
        layer: g.lowerLayerAxis === 'X' ? 'LOWER' : 'UPPER',
      },
      {
        axis: 'Y', diameterMm: 16, centreZ: -1.2 + dsg.y.centreElevation,
        layer: g.lowerLayerAxis === 'Y' ? 'LOWER' : 'UPPER',
      },
    ]);
    const d = generateDowels({
      id: 'F1-C3', centre: { x: 0, y: 0 },
      footingTopZ: -1.2 + 0.60, footingThickness: 0.60, footingCover: 0.05,
      columnB: 0.40, columnH: 0.40, cover: 0.05, tieDia: 8,
      bars: { count: 8, diameterMm: 20 },
      ldFooting: 1.527, ldhFooting: 0.45, lapAbove: 1.99,
      elementIds: [3], edition: '2025',
      bottomMat: mat!, footingPlan: { centroid: { x: 0, y: 0 }, B: 2.5, L: 2.5 },
    });

    expect(d.cage.status).toBe('PLACED');
    expect(d.unsupported).toEqual([]);
    expect(d.bars).toHaveLength(8);

    // The lowest steel in every bar IS its seat: 66 mm above the soffit for a leg carried by
    // the LOWER layer, 82 mm for one carried by the UPPER, both clear of the 50 mm cover. The
    // superseded geometry put this at 20 mm.
    for (const p of d.cage.placements) {
      // From the emitted path, not from the arithmetic that produced it: the outer surface of
      // the lowest steel in the bar is exactly the seat.
      const bar = d.bars.find((b) => b.id === p.id)!;
      const lowestSurface = Math.min(
        ...bar.segments.flatMap((s) => [s.start.z, s.end.z])) - 0.010;
      expect(lowestSurface).toBeCloseTo(p.seatZ, 12);
      expect(p.seatedOn.length).toBeGreaterThanOrEqual(1);
    }
    const covers = [...new Set(d.cage.placements
      .map((p) => +(p.bottomCover * 1000).toFixed(6)))].sort((a, b) => a - b);
    expect(covers).toEqual([66, 82]);
    expect(d.cage.placements.filter((p) => p.seatedOn.length > 0)).toHaveLength(8);

    // No hook is under the mat any more: every seat is at or above the lower layer's top face.
    const lowerTopZ = Math.min(mat!.x.topSurfaceZ, mat!.y.topSurfaceZ);
    for (const p of d.cage.placements) {
      expect(p.seatZ).toBeGreaterThanOrEqual(lowerTopZ - 1e-12);
    }

    // And the twelve interpenetrations are gone — mat/dowel and dowel/dowel alike.
    const matIds = new Set(g.bars.map((b) => b.id));
    const r = detect([...g.bars, ...d.bars], matIds);
    const prohibited = r.conflicts.filter((c) => c.pairClass === 'prohibitedOverlap');
    expect(prohibited).toEqual([]);

    /**
     * What the repaired seat SURFACES, exposed here rather than absorbed.
     *
     * Four §25.2.3 clear-spacing shortfalls remain, and they are a different finding from the
     * twelve interpenetrations this replaces. A corner starter's leg turns along x and is seated
     * on the UPPER (Y) layer, so it runs PARALLEL to the LOWER layer's X bars 24 mm beneath it
     * and offset 45,5 mm across — 33,40 mm of clear distance against the 40 mm the article
     * requires of a pair containing a column bar.
     *
     * It cannot be fixed by turning the hook: both ±x orientations put the leg at the same y and
     * therefore the same distance from the same mat bar, and the search's job is orientation, not
     * position. Closing it means coordinating the mat's bar spacing with the column's bar
     * positions, or reading a different clause for a hook leg crossing above a mat — neither of
     * which is a change this pass is authorised to make. So it is measured and named, and the
     * floor is honestly NOT constructible until it is answered.
     */
    const spacing = r.conflicts.filter((c) => c.pairClass === 'sameLayerSpacing');
    expect(spacing).toHaveLength(4);
    for (const c of spacing) {
      expect(c.barA).toMatch(/dowel|matX/);
      expect(c.barB).toMatch(/dowel|matX/);
      expect(c.clearance).toBeCloseTo(0.0334, 4);
      expect(c.required).toBeCloseTo(0.040, 6);
      // A shortfall, not an overlap: there is clear concrete between the two surfaces.
      expect(c.clearance).toBeGreaterThan(0);
    }
    expect(r.constructible).toBe(false);
  });

  it('reports a mat/dowel interpenetration as prohibited, with ids and clearance', () => {
    // A dowel driven onto a mat bar, placed deterministically ON one so the expected clearance
    // is hand-computable rather than left to whether a real dowel happened to line up.
    const g = gen();
    const target = g.provenance.find((p) => p.axis === 'Y')!;
    const bar = g.bars.find((b) => b.id === target.id)!;
    const intruder = buildStraightBarWithHooks({
      id: 'F1-C3-dowel-0', diameterMm: 20, role: 'longitudinal',
      // Vertical, at the mat bar's own plan position, driven down to its centreline.
      start: { x: target.start.x, y: 0, z: target.start.z },
      end: { x: target.start.x, y: 0, z: target.start.z + 1.0 },
      axis: { x: 0, y: 0, z: 1 }, hookNormal: { x: 1, y: 0, z: 0 },
      ownerElementIds: [3], edition: '2025',
    });
    const r = detect([...g.bars, intruder], new Set(g.bars.map((b) => b.id)));
    const overlaps = r.conflicts.filter((c) => c.pairClass === 'prohibitedOverlap');
    expect(overlaps.length).toBeGreaterThan(0);
    const own = overlaps.find((c) => c.barA === bar.id || c.barB === bar.id)!;
    expect(own).toBeDefined();
    // Axes coincident at the crossing, so the surfaces overlap by the sum of the two radii:
    // 20/2 + 16/2 = 18 mm.
    expect(own.clearance).toBeCloseTo(-0.018, 4);
    // Interpenetration is prohibited BEFORE any relationship is consulted — a crossing may
    // touch, it may not share a volume.
    expect(r.constructible).toBe(false);
    expect(own.barA).toMatch(/^F1-/);
    expect(own.barB).toMatch(/^F1-/);
    expect(own.at).toBeDefined();
  });
});
