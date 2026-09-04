import { describe, it, expect } from 'vitest';
import {
  MAX_SPACING_CAP_M, MIN_BOTTOM_MAT_DEPTH_M, barArea, designFootingMat, matBarLength,
  footingFlexuralDepth,
  type FootingMatDesignInput,
} from '../footing-flexure';

/**
 * Bottom-mat flexural design, against the ENACTED CIRSOC 201-2025 Annex IV.
 *
 * The numerical fixture below is hand-checked, and hand-checked in a way that does not simply
 * restate the implementation: the moment is verified by two different expressions of the same
 * statics, and the steel area is closed back through φMn ≥ Mu instead of by re-running the
 * quadratic the code solves. A test that recomputes the code's own formula proves only that
 * the formula was typed twice.
 *
 * Three of these describe blocks exist because the first version of the module got the
 * corresponding engineering wrong, and each wrong answer was individually plausible:
 *
 *   * it used the LOWER layer's effective depth for both directions while using the UPPER
 *     layer's cover for both crack-control checks — a footing that cannot be built;
 *   * it applied §7.6.1's minimum again to each §13.3.3.3 distribution region and reported
 *     that floor as the code's requirement, which the enacted text does not impose;
 *   * it measured one symmetric cantilever on a footing whose column the model puts off
 *     centre, under-stating the governing moment by 44% on the fixture below.
 */

const DAGG = 20;

/** Ø16 both ways — the migration default, so the fixture is the ordinary case. */
const PREFS = {
  bottomMatDiameterXmm: 16,
  bottomMatDiameterYmm: 16,
  bottomMatSpacingPolicy: 'AUTO_CODE_COMPLIANT',
} as const;

/**
 * The reference footing: 2,00 × 2,00 × 0,50 m, 0,40 × 0,40 m column, N_u = 900 kN, centred.
 *
 * Same geometry and load as `run-footing-design.test.ts` uses, so the two files describe one
 * footing rather than two.
 */
const square = (over: Partial<FootingMatDesignInput> = {}): FootingMatDesignInput => ({
  B: 2.0, L: 2.0, thickness: 0.5, cover: 0.05,
  columnB: 0.4, columnH: 0.4,
  eccentricityB: 0, eccentricityL: 0,
  fc: 25, fy: 420,
  factoredAxial: 900,
  factoredMomentB: 0, factoredMomentL: 0,
  maxAggregateSizeMm: DAGG,
  edition: '2025',
  preferences: PREFS,
  ...over,
});

/** 1,50 × 3,00 m — β = 2 exactly, so γs = 2/3 is a number a reader can check by eye. */
const rectangular = (over: Partial<FootingMatDesignInput> = {}): FootingMatDesignInput =>
  square({ B: 1.5, L: 3.0, ...over });

const cm2 = (m2: number) => m2 * 1e4;

// ─── The hand-checked fixture ────────────────────────────────────

describe('footing bottom mat — hand-checked numerical fixture', () => {
  /**
   * Every intermediate value, derived by hand from the clauses:
   *
   *   A          = 2,00 × 2,00 = 4,00 m²
   *   q_u        = 900 / 4,00 = 225,0 kPa                       (uniform: no moment)
   *   cantilever = (2,00 − 0,40) / 2 = 0,800 m, both sides      §13.2.7.1, centred column
   *   M_u        = W·c²·(2q_face + q_edge)/6
   *              = 2,00 × 0,800² × (2×225 + 225)/6 = 144,0 kN·m  §13.2.6.6
   *   CROSS-CHECK, elementary statics on a uniform pressure:
   *              = q·c²/2 · W = 225 × 0,64/2 × 2,00 = 144,0 ✓    (two expressions, one answer)
   *
   *   The two layer depths, since perpendicular mats cannot share an elevation:
   *   d as LOWER = 0,500 − 0,050 − 0,016/2         = 0,4420 m
   *   d as UPPER = 0,500 − 0,050 − 0,016 − 0,016/2 = 0,4260 m   ⇐ DESIGNED at this one
   *
   *   A_s,min    = 0,0018 A_g = 0,0018 × 2,00 × 0,500
   *              = 1,800e-3 m² = 18,00 cm²                       §7.6.1
   *   A_s,flex   = 9,0373e-4 m² = 9,037 cm²  ⇒ the MINIMUM GOVERNS
   *   s_max,gen  = min(3h, 300) = min(1500, 300) = 300 mm        §7.7.2.3
   *   c_c        = 50 mm — the CLEAR COVER of the layer closest to the tension face
   *   s_max,24.3 = min(380·(280/280) − 2,5×50, 300) = 255 mm     §24.3.2 → GOVERNS
   *   s_min,clear= max(25, 16, (4/3)×20) = 26,67 mm              §25.2.1
   *   span       = 2,000 − 2×0,050 − 0,016 = 1,884 m
   *   n from A_s = ceil(1,800e-3 / 2,0106e-4) = ceil(8,95) = 9
   *   n from s   = 1 + ceil(1,884 / 0,255) = 1 + 8 = 9
   *   n          = 9, s = 1,884/8 = 235,5 mm, clear = 219,5 mm
   *   A_s,prov   = 9 × 2,0106 = 18,096 cm²  ≥ 18,00 ✓
   */
  const r = designFootingMat(square());

  it('reproduces the hand-computed demand in both directions', () => {
    expect(r.x.qFace).toBeCloseTo(225.0, 9);
    expect(r.x.qEdge).toBeCloseTo(225.0, 9);
    expect(r.x.cantilever).toBeCloseTo(0.8, 12);
    expect(r.x.Mu).toBeCloseTo(144.0, 9);
    expect(r.y.Mu).toBeCloseTo(144.0, 9);
  });

  it('designs each direction at its REAL layer depth, once the order is resolved', () => {
    expect(r.x.dIfLowerLayer).toBeCloseTo(0.442, 12);
    expect(r.x.dIfUpperLayer).toBeCloseTo(0.426, 12);

    // This footing is square, both diameters equal and both moments zero, so the two physical
    // arrangements are exact mirror images: same steel, same utilisation. AUTO therefore reaches
    // its last rule and takes X_BELOW_Y, so the answer is stable rather than dependent on
    // comparison order.
    expect(r.layerOrder.status).toBe('ESTABLISHED');
    expect(r.layerOrder.resolved).toBe('X_BELOW_Y');
    expect(r.layerOrder.rationale).toBe('DETERMINISTIC_TIE_BREAK');
    expect(r.layerOrder.lowerLayerAxis).toBe('X');

    // Each direction is now at its OWN depth. PR18-A gave BOTH 0,426 m — the conservative
    // envelope — which for the lower mat describes a bar sitting a full diameter above where it
    // is placed.
    expect(r.x.d).toBeCloseTo(0.442, 12);
    expect(r.x.layerRole).toBe('LOWER_LAYER');
    expect(r.x.barsBelowMm).toBe(0);
    expect(r.y.d).toBeCloseTo(0.426, 12);
    expect(r.y.layerRole).toBe('UPPER_LAYER');
    expect(r.y.barsBelowMm).toBe(16);
  });

  it('places both layers at their real elevations, cover measured to the bar SURFACE', () => {
    // Lower: clear cover 50 mm to the bar surface, so the centreline is 50 + 16/2 = 58 mm.
    expect(r.x.clearCoverToSoffit).toBeCloseTo(0.05, 12);
    expect(r.x.centreElevation).toBeCloseTo(0.058, 12);
    // Upper: sits on the crossing lower bars, so a FULL lower diameter separates the surfaces —
    // 50 + 16 = 66 mm to this bar's surface, 66 + 16/2 = 74 mm to its centreline. Half a
    // diameter would be the answer if the mats were parallel, and they are not.
    expect(r.y.clearCoverToSoffit).toBeCloseTo(0.066, 12);
    expect(r.y.centreElevation).toBeCloseTo(0.074, 12);
    // The centre elevations differ by exactly one lower-bar diameter, and so do the depths.
    expect(r.y.centreElevation - r.x.centreElevation).toBeCloseTo(0.016, 12);
    expect(r.x.d - r.y.d).toBeCloseTo(0.016, 12);
    // The two are complementary: centre elevation + d = h, exactly, in both layers.
    expect(r.x.centreElevation + r.x.d).toBeCloseTo(0.5, 12);
    expect(r.y.centreElevation + r.y.d).toBeCloseTo(0.5, 12);
    // Orthogonal crossings may touch — §25.2.1/§25.2.2 govern PARALLEL bars, not crossings.
    expect(r.x.contactAtCrossingsPermitted).toBe(true);
    expect(r.y.contactAtCrossingsPermitted).toBe(true);
  });

  it('closes the flexural steel back through φMn, not through the same quadratic', () => {
    // Independent verification: take the A_s the design returned, form the stress block from
    // it and confirm the section develops the moment. If the quadratic were wrong this fails,
    // whereas restating the quadratic could not.
    //
    // Done for BOTH directions, which is what makes the resolved layer order auditable: X is
    // the lower layer and closes at d = 0,442 with 8,704 cm², Y is the upper one and needs
    // 9,037 cm² at d = 0,426 for the SAME 144,0 kN·m. The difference is the layer order paying
    // for itself.
    for (const dir of [r.x, r.y]) {
      const As = dir.asFlexural;
      const a = (As * 420e3) / (0.85 * 25e3 * 2.0);   // a = As·fy / (α1·f'c·b)
      const phiMn = 0.9 * As * 420e3 * (dir.d - a / 2);
      expect(phiMn).toBeCloseTo(144.0, 4);
    }
    expect(cm2(r.x.asFlexural)).toBeCloseTo(8.704, 3);
    expect(cm2(r.y.asFlexural)).toBeCloseTo(9.037, 3);
    // The deeper layer needs less steel for the same moment, which is the whole point.
    expect(r.x.asFlexural).toBeLessThan(r.y.asFlexural);
  });

  it('applies §7.6.1 on the gross area, not the beam minimum', () => {
    // 0,0018 × A_g, A_g = width × h. The BEAM minimum would be
    // max(0,25√25/420, 1,4/420)·b·d = 1/300 × 2,00 × 0,426 = 28,4 cm², a different number
    // from a clause that does not apply to a footing mat.
    expect(cm2(r.x.asMinimum)).toBeCloseTo(18.0, 9);
    expect(r.x.governedBy).toBe('MINIMUM');
    expect(r.x.governingClause).toBe('7.6.1');
    expect(cm2(r.x.asGoverning)).toBeCloseTo(18.0, 9);
  });

  it('lands the hand-computed spacing limits and layout', () => {
    expect(r.x.spacing.generalMax).toBeCloseTo(0.3, 12);
    expect(r.x.spacing.clearCoverToTensionFace).toBeCloseTo(0.05, 12);
    expect(r.x.spacing.crackControlMax).toBeCloseTo(0.255, 12);
    expect(r.x.spacing.governingMax).toBeCloseTo(0.255, 12);
    expect(r.x.spacing.governingMaxClause).toBe('24.3.2');
    expect(r.x.spacing.minClear).toBeCloseTo(26.666666666666668 / 1000, 12);

    expect(r.x.regions).toHaveLength(1);
    const reg = r.x.regions[0];
    /**
     * TEN bars, not the nine the three code bounds ask for.
     *
     * The area needs ceil(18,00/2,011) = 9 and the 255 mm §24.3.2 limit over the 1,884 m
     * placeable span needs 1 + ceil(7,39) = 9, so the code settles on nine — and nine is odd,
     * which puts a bar exactly on each centre line. That is where the column's face-centred
     * starter dowels stand, and a mat bar under one of them removes its only feasible hook
     * orientation: measured, the whole eight-hook cage drops to ZERO feasible arrangements.
     * With ten it has 496. So the layout takes one bar it does not need for strength, and
     * `spacingCentre` follows from ten rather than nine: 1,884/9 = 209,333 mm.
     *
     * The extra bar is why 20,106 cm² is provided against 18,000 required. See `layoutRegion`.
     */
    expect(reg.barCount).toBe(10);
    expect(reg.spacingCentre * 1000).toBeCloseTo(209.333, 3);
    expect(reg.spacingClear * 1000).toBeCloseTo(193.333, 3);
    expect(cm2(reg.asProvided)).toBeCloseTo(20.106, 3);
    // Still inside both bounds it has to respect: the maximum spacing and §25.2.1.
    expect(reg.spacingCentre).toBeLessThanOrEqual(r.x.spacing.governingMax + 1e-12);
    expect(reg.spacingClear).toBeGreaterThanOrEqual(r.x.spacing.minClear - 1e-12);
    // And the reason is stated, not left for a reader to infer from an unexplained count.
    expect(r.x.steps.join(' ')).toMatch(/10 barras en lugar de 9 para dejar libre el eje/);
  });

  it('reports the punching depth separately from the two flexural depths', () => {
    // h − cover − d_b, the AVERAGED two-layer convention, deliberately unchanged. With equal
    // diameters it is exactly the mean of the two layer depths, which is the check that the
    // averaged convention and the layer model describe the same footing.
    expect(r.punchingD).toBeCloseTo(0.434, 12);
    expect(r.punchingD).toBeCloseTo((r.x.dIfLowerLayer + r.x.dIfUpperLayer) / 2, 12);
    expect(r.punchingD).not.toBeCloseTo(r.x.d, 4);
    expect(r.assumptions.map((a) => a.key)).toContain('footing.assumption.flexuralDepths');
    // With an order RESOLVED, the assumption states the order and the real depths. The
    // conservative-envelope assumption would now be a false statement about the delivered
    // design, so it must be absent.
    expect(r.assumptions.map((a) => a.key)).toContain('footing.assumption.layerOrderResolved');
    expect(r.assumptions.map((a) => a.key)).not.toContain('footing.assumption.layerEnvelope');
  });
});

// ─── The two-layer model ─────────────────────────────────────────

describe('the two perpendicular layers cannot share an elevation', () => {
  it('separates the lower and upper depth by a full other-direction diameter', () => {
    expect(footingFlexuralDepth(0.5, 0.05, 16, 0)).toBeCloseTo(0.442, 12);
    expect(footingFlexuralDepth(0.5, 0.05, 16, 25)).toBeCloseTo(0.417, 12);
    // The gap IS the bar below it, exactly.
    expect(footingFlexuralDepth(0.5, 0.05, 16, 0) - footingFlexuralDepth(0.5, 0.05, 16, 25))
      .toBeCloseTo(0.025, 12);
  });

  it('never designs at the favourable depth while penalising the cover', () => {
    // The defect this pins: the first version used the LOWER layer's depth for BOTH directions
    // while using the UPPER layer's cover for BOTH crack-control checks — the favourable depth
    // of the bottom layer with the penalised cover of the layer above it, describing a footing
    // that cannot be built.
    //
    // The fix is not "always take the shallower depth". It is that each direction's depth and
    // its cover must describe the SAME physical bar. With the order resolved, every direction's
    // `d` is exactly `h − centreElevation`, which is that coherence stated as an identity and
    // is what this now asserts.
    const r = designFootingMat(square());
    for (const dir of [r.x, r.y]) {
      expect(dir.d).toBeCloseTo(0.5 - dir.centreElevation, 12);
      expect(dir.d).toBeCloseTo(
        dir.layerRole === 'LOWER_LAYER' ? dir.dIfLowerLayer : dir.dIfUpperLayer, 12);
      // §24.3.2's `cc` is the clear cover of the layer closest to the TENSION face, and that is
      // the lower mat whichever direction it turns out to be — so it is `cover` for both, and
      // specifically NOT `cover + d_b,other`, which was the old cc.
      expect(dir.spacing.clearCoverToTensionFace).toBeCloseTo(0.05, 12);
      expect(dir.spacing.clearCoverToTensionFace).not.toBeCloseTo(0.066, 4);
    }
    // Exactly one direction is the lower layer. Both being lower is the old defect.
    expect([r.x.layerRole, r.y.layerRole].filter((l) => l === 'LOWER_LAYER')).toHaveLength(1);
  });

  describe('unequal X/Y diameters, so accidental equality cannot hide a mistake', () => {
    // Ø16 parallel to B, Ø25 parallel to L. Hand-computed:
    //   X: lower 0,500−0,050−0,008 = 0,4420 | upper 0,500−0,050−0,025−0,008 = 0,4170
    //   Y: lower 0,500−0,050−0,0125 = 0,4375 | upper 0,500−0,050−0,016−0,0125 = 0,4215
    const r = designFootingMat(square({
      preferences: { ...PREFS, bottomMatDiameterXmm: 16, bottomMatDiameterYmm: 25 },
    }));

    it('gives each direction its own pair of layer depths', () => {
      expect(r.x.dIfLowerLayer).toBeCloseTo(0.442, 12);
      expect(r.x.dIfUpperLayer).toBeCloseTo(0.417, 12);
      expect(r.y.dIfLowerLayer).toBeCloseTo(0.4375, 12);
      expect(r.y.dIfUpperLayer).toBeCloseTo(0.4215, 12);
    });

    it('designs each at the depth its RESOLVED role gives it', () => {
      // Both arrangements are minimum-governed here, so both need nine bars either way and the
      // steel MASS ties exactly. AUTO therefore falls to its utilisation rule, which prefers
      // putting the Ø16 low: X_BELOW_Y works its flexural steel to 0,481 against 0,510 the
      // other way round.
      expect(r.layerOrder.resolved).toBe('X_BELOW_Y');
      expect(r.layerOrder.rationale).toBe('LOWER_FLEXURAL_UTILIZATION');
      expect(r.x.d).toBeCloseTo(0.442, 12);      // Ø16, lower layer
      expect(r.y.d).toBeCloseTo(0.4215, 12);     // Ø25, upper layer, on a Ø16
      // The upper layer's elevation carries the FULL lower diameter, not half of it.
      expect(r.x.centreElevation).toBeCloseTo(0.05 + 0.008, 12);
      expect(r.y.centreElevation).toBeCloseTo(0.05 + 0.016 + 0.0125, 12);
    });

    it('uses the same clear cover for both, because §24.3.2 targets the lower layer', () => {
      expect(r.x.spacing.clearCoverToTensionFace).toBeCloseTo(0.05, 12);
      expect(r.y.spacing.clearCoverToTensionFace).toBeCloseTo(0.05, 12);
      // Consequently the crack-control limit is the same number for both directions, and it
      // does NOT drift with the other direction's diameter.
      expect(r.x.spacing.crackControlMax).toBeCloseTo(0.255, 12);
      expect(r.y.spacing.crackControlMax).toBeCloseTo(0.255, 12);
    });

    it('still asks each direction for its own steel', () => {
      // Shallower d ⇒ more steel, for the same demand. X is the LOWER layer here, so it is the
      // deeper one and the one needing less.
      expect(r.x.d).toBeGreaterThan(r.y.d);
      expect(r.x.asFlexural).toBeLessThan(r.y.asFlexural);
      expect(r.x.Mu).toBeCloseTo(r.y.Mu, 9);   // square footing: the demand is symmetric
    });
  });
});

// ─── B, M: square footing ────────────────────────────────────────

describe('square footing', () => {
  it('produces symmetric demand and reinforcement when B=L, col square, equal bars (B)', () => {
    const r = designFootingMat(square());
    expect(r.x.Mu).toBeCloseTo(r.y.Mu, 12);
    expect(r.x.asGoverning).toBeCloseTo(r.y.asGoverning, 12);
    expect(r.x.barCount).toBe(r.y.barCount);
    expect(r.x.regions[0].spacingCentre).toBeCloseTo(r.y.regions[0].spacingCentre, 12);
  });

  it('is symmetric in DEMAND but not in ELEVATION, because the mats are stacked', () => {
    // The delivered mat is deliberately NOT symmetric in `d`, and asserting that it were would
    // be asserting a footing that cannot be built. The two directions carry the same moment and
    // the same steel, and one of them is 16 mm lower than the other.
    const r = designFootingMat(square());
    expect(r.x.d).not.toBeCloseTo(r.y.d, 4);
    expect(Math.abs(r.x.d - r.y.d)).toBeCloseTo(0.016, 12);
    // The two arrangements are mirror images, so neither measure can separate them.
    const [a, b] = r.layerOrder.evaluated;
    expect(a.providedSteelMassKg).toBeCloseTo(b.providedSteelMassKg, 9);
    expect(a.worstFlexuralUtilization).toBeCloseTo(b.worstFlexuralUtilization, 9);
    expect(r.layerOrder.rationale).toBe('DETERMINISTIC_TIE_BREAK');
  });

  it('stops being symmetric as soon as the two diameters differ', () => {
    // The symmetry above is a consequence of symmetric INPUTS, not of one direction being
    // copied onto the other.
    const r = designFootingMat(square({
      preferences: { ...PREFS, bottomMatDiameterYmm: 20 },
    }));
    expect(r.x.d).not.toBeCloseTo(r.y.d, 5);
    expect(r.x.asFlexural).not.toBeCloseTo(r.y.asFlexural, 7);
  });

  it('distributes uniformly across the full width both ways, §13.3.3.2 (M)', () => {
    const r = designFootingMat(square());
    for (const dir of [r.x, r.y]) {
      expect(dir.distribution).toBe('UNIFORM_FULL_WIDTH');
      expect(dir.beta).toBeNull();
      expect(dir.gammaS).toBeNull();
      expect(dir.regions).toHaveLength(1);
      expect(dir.regions[0].kind).toBe('FULL_WIDTH');
      expect(dir.regions[0].width).toBeCloseTo(dir.distributionWidth, 12);
    }
    expect(designFootingMat(square()).refs.map((c) => c.clause)).toContain('13.3.3.2');
  });
});

// ─── C: axis mapping ─────────────────────────────────────────────

describe('rectangular footing axis mapping (C)', () => {
  const r = designFootingMat(rectangular({ columnB: 0.4, columnH: 0.6 }));

  it('maps B/columnB and the L distribution width onto direction X', () => {
    // X bars run parallel to B, span B, and are spread across L.
    expect(r.x.barsParallelTo).toBe('B');
    expect(r.x.cantilever).toBeCloseTo((1.5 - 0.4) / 2, 12);
    expect(r.x.distributionWidth).toBeCloseTo(3.0, 12);
  });

  it('maps L/columnH and the B distribution width onto direction Y', () => {
    expect(r.y.barsParallelTo).toBe('L');
    expect(r.y.cantilever).toBeCloseTo((3.0 - 0.6) / 2, 12);
    expect(r.y.distributionWidth).toBeCloseTo(1.5, 12);
  });

  it('does not let the two directions share a cantilever or a width', () => {
    // The defect this guards is the one-direction footing: designing X and copying it onto Y.
    expect(r.x.cantilever).not.toBeCloseTo(r.y.cantilever, 3);
    expect(r.x.distributionWidth).not.toBeCloseTo(r.y.distributionWidth, 3);
    expect(r.x.Mu).not.toBeCloseTo(r.y.Mu, 1);
  });
});

// ─── D: eccentricity — load resultant versus column position ─────

describe('load-resultant eccentricity is not a geometric column offset (D)', () => {
  /**
   * The distinction the first version collapsed.
   *
   * A factored MOMENT moves the pressure resultant and leaves the column where it is, so the
   * two cantilevers stay equal and only the pressure diagram tilts.
   *
   * `eccentricityB`/`eccentricityL` are something else entirely: `model/footing.ts` defines
   * them as the plan offset of the footing CENTROID from the supported node, and
   * `punchingPosition` already measures each column face to its own edge with them. They move
   * the COLUMN, so the two cantilevers become unequal — and the longer one governs.
   */
  describe('a factored moment tilts the pressure and leaves the cantilevers alone', () => {
    /**
     *   e   = 200/900 = 0,22222 m  <  B/6 = 0,33333 ✓ resultant inside the kern
     *   both cantilevers stay (2,00 − 0,40)/2 = 0,800 m
     *   q at the face nearer the heavy edge = 255,0 kPa, at that edge = 375,0 kPa
     *   M_u = 2,00 × 0,800² × (2×255 + 375)/6 = 188,8 kN·m
     */
    const r = designFootingMat(square({ factoredMomentB: 200 }));

    it('keeps both cantilevers at the symmetric value', () => {
      expect(r.x.cantilever).toBeCloseTo(0.8, 12);
      expect(r.y.cantilever).toBeCloseTo(0.8, 12);
    });

    it('trapezoids only the axis the moment acts on', () => {
      expect(r.x.qFace).toBeCloseTo(255.0, 9);
      expect(r.x.qEdge).toBeCloseTo(375.0, 9);
      expect(r.x.Mu).toBeCloseTo(188.8, 9);
    });

    it('leaves the other direction at the uniform pressure', () => {
      expect(r.y.qFace).toBeCloseTo(225.0, 9);
      expect(r.y.qEdge).toBeCloseTo(225.0, 9);
      expect(r.y.Mu).toBeCloseTo(144.0, 9);
    });

    it('envelopes both moment orientations, and says so', () => {
      // The reaction moment's sign is not resolved onto a footing-local axis here, so both
      // orientations are evaluated. On a centred column they are mirror images and the
      // envelope equals the single-sided answer — which is why this fixture reproduces 188,8.
      expect(designFootingMat(square({ factoredMomentB: -200 })).x.Mu).toBeCloseTo(188.8, 9);
      expect(r.assumptions.map((a) => a.key))
        .toContain('footing.assumption.momentOrientationEnvelope');
    });
  });

  describe('a geometric column offset makes the two cantilevers unequal', () => {
    /**
     * `eccentricityB = 0,30 m`: the centroid sits 0,30 m from the node, so the COLUMN sits
     * 0,30 m from the centroid, and:
     *
     *   cantilever to the near edge = 1,000 − 0,300 − 0,200 = 0,500 m
     *   cantilever to the far edge  = 1,000 + 0,300 − 0,200 = 1,100 m
     *   resultant offset u_R = −0,300 m, inside the kern (B/6 = 0,3333) ✓
     *   q(u) = 225 (1 + 12 × (−0,3) u / 4)
     *   near face: q_face = 326,25, q_edge = 427,50 ⇒ M_u = 2,00×0,500²×(2×326,25+427,50)/6
     *            = 90,0 kN·m
     *   far  face: q_face = 245,25, q_edge =  22,50 ⇒ M_u = 2,00×1,100²×(2×245,25+22,50)/6
     *            = 206,91 kN·m   ⇐ GOVERNS
     *
     * The symmetric cantilever would have reported 144,0 kN·m — a 44% under-statement, and on
     * the safe-side-of-nothing side. The heavier pressure is on the SHORT cantilever, so
     * neither side can be assumed to govern: both are evaluated.
     */
    const r = designFootingMat(square({ eccentricityB: 0.3 }));

    it('uses the real column position for both cantilevers', () => {
      expect(r.x.cantilever).toBeCloseTo(1.1, 12);
      expect(r.x.governingSide).toBe('high');
    });

    it('governs on the LONGER cantilever even though its pressure is lighter', () => {
      expect(r.x.qFace).toBeCloseTo(245.25, 9);
      expect(r.x.qEdge).toBeCloseTo(22.5, 9);
      expect(r.x.Mu).toBeCloseTo(206.91, 9);
      // The number the symmetric cantilever produced, which this must no longer report.
      expect(r.x.Mu).not.toBeCloseTo(144.0, 1);
      expect(r.x.Mu / 144.0).toBeGreaterThan(1.4);
    });

    it('leaves the perpendicular direction, whose axis is not offset, alone', () => {
      expect(r.y.cantilever).toBeCloseTo(0.8, 12);
      expect(r.y.Mu).toBeCloseTo(144.0, 9);
    });

    it('carries no assumption claiming the asymmetry is unresolved', () => {
      // The old module emitted `footing.assumption.symmetricCantilever` here. It is resolved
      // now, so claiming the limitation would be as wrong as having it.
      expect(r.assumptions.map((a) => a.key))
        .not.toContain('footing.assumption.symmetricCantilever');
      expect(r.x.status).toBe('DESIGNED');
    });

    it('designs more steel than the symmetric reading would have', () => {
      const centred = designFootingMat(square());
      expect(r.x.asFlexural).toBeGreaterThan(centred.x.asFlexural);
    });
  });

  it('refuses to design through a resultant outside the kern', () => {
    // e = 400/900 = 0,4444 m > B/6 = 0,3333: the base lifts and the linear distribution is
    // invalid. Designing anyway would reinforce for a pressure the soil is not delivering.
    const up = designFootingMat(square({ factoredMomentB: 400 }));
    expect(up.x.status).toBe('NOT_EVALUATED');
    expect(up.x.regions).toEqual([]);
    expect(up.x.failures.map((f) => f.key)).toEqual(['footing.mat.upliftNotEvaluated']);
    // The unaffected direction is still designed: one bad axis does not void the other.
    expect(up.y.status).toBe('DESIGNED');
    expect(up.status).toBe('NOT_EVALUATED');
  });

  it('refuses when EITHER moment orientation lifts the base', () => {
    // Geometric offset 0,20 m plus a moment eccentricity of 0,20 m: one orientation puts the
    // resultant at 0,40 m, outside the 0,3333 m kern. Designing under the other orientation
    // would be choosing the favourable sign by omission.
    const r = designFootingMat(square({ eccentricityB: 0.2, factoredMomentB: 180 }));
    expect(r.x.status).toBe('NOT_EVALUATED');
    expect(r.x.failures.map((f) => f.key)).toEqual(['footing.mat.upliftNotEvaluated']);
  });
});

// ─── E: the selected diameter really is the design input ─────────

describe('the selected diameter changes the design (E)', () => {
  const base = designFootingMat(square());
  const thick = designFootingMat(square({
    preferences: { ...PREFS, bottomMatDiameterXmm: 25 },
  }));

  it('moves the flexural depth of the direction it belongs to', () => {
    // d as upper layer = 0,500 − 0,050 − 0,016 − 0,0125 = 0,4215 m
    expect(thick.x.d).toBeCloseTo(0.4215, 12);
    expect(thick.x.d).toBeLessThan(base.x.d);
  });

  it('moves the OTHER direction too, through the layer stack and the order it resolves to', () => {
    // The coupling is real — it is the layer stack — and a per-direction design that ignored it
    // would be wrong. What it is NOT is a fixed sign.
    //
    // Both arrangements are minimum-governed here, so the masses tie and AUTO's utilisation rule
    // decides; it prefers the SMALLER bar in the lower layer, so raising X to Ø25 flips the order
    // from X_BELOW_Y to Y_BELOW_X. Y therefore becomes the lower mat and gets DEEPER, 0,442 m
    // against 0,426 before, while X drops to 0,4215 m as the upper layer above a Ø16.
    expect(base.layerOrder.resolved).toBe('X_BELOW_Y');
    expect(thick.layerOrder.resolved).toBe('Y_BELOW_X');
    expect(thick.y.layerRole).toBe('LOWER_LAYER');
    expect(thick.y.d).toBeCloseTo(0.442, 12);
    expect(thick.y.d).toBeGreaterThan(base.y.d);
    // Had the order NOT flipped, Y as the upper layer above a Ø25 would have been
    // 0,500 − 0,050 − 0,025 − 0,008 = 0,4170 m. That arrangement was evaluated and rejected on
    // utilisation, and it is still reported so the choice can be reviewed.
    const rejected = thick.layerOrder.evaluated.find((e) => e.order === 'X_BELOW_Y')!;
    expect(rejected.dY).toBeCloseTo(0.417, 12);
    expect(rejected.feasible).toBe(true);
  });

  it('moves that direction\'s required steel and layout', () => {
    expect(thick.x.asFlexural).toBeGreaterThan(base.x.asFlexural);   // shallower ⇒ more steel
    expect(thick.x.diameterMm).toBe(25);
    expect(thick.x.regions[0].spacingCentre).not.toBeCloseTo(base.x.regions[0].spacingCentre, 6);
  });
});

// ─── F, G: which requirement governs ─────────────────────────────

describe('minimum versus flexural strength', () => {
  it('lets the code minimum govern at low demand (F)', () => {
    // The reference footing: 9,04 cm² from strength, 18,00 cm² from §7.6.1.
    const r = designFootingMat(square());
    expect(r.x.asFlexural).toBeLessThan(r.x.asMinimum);
    expect(r.x.governedBy).toBe('MINIMUM');
    expect(r.x.asGoverning).toBeCloseTo(r.x.asMinimum, 12);
  });

  it('lets flexural strength govern at higher demand (G)', () => {
    /**
     * The 1,50 × 3,00 footing's LONG direction, from the same N_u = 900 kN:
     *
     *   q_u    = 900 / 4,50 = 200,0 kPa
     *   c      = (3,00 − 0,40)/2 = 1,300 m
     *   M_u,Y  = 1,50 × 1,300² × (3×200)/6 = 253,5 kN·m
     *   A_s,min= 0,0018 × 1,50 × 0,500 = 1,350e-3 m² = 13,50 cm²  ⇒ FLEXURE governs
     *
     *   Y is the LOWER layer on this footing: it is the flexure-governed direction, so AUTO's
     *   steel rule puts it at the deeper 0,4420 m, where A_s = 1,5532e-3 m² = 15,53 cm². At the
     *   upper-layer 0,4260 m it would have needed 16,15 cm² — the 0,62 cm² the order recovers.
     */
    const r = designFootingMat(rectangular());
    expect(r.y.Mu).toBeCloseTo(253.5, 9);
    expect(r.y.layerRole).toBe('LOWER_LAYER');
    expect(cm2(r.y.asFlexural)).toBeCloseTo(15.532, 2);
    expect(cm2(r.y.asMinimum)).toBeCloseTo(13.5, 9);
    expect(r.y.governedBy).toBe('FLEXURE');
    expect(r.y.governingClause).toBe('7.5.1.1');

    // Same independent closure as the fixture: φMn from the returned steel reproduces M_u.
    const a = (r.y.asFlexural * 420e3) / (0.85 * 25e3 * 1.5);
    expect(0.9 * r.y.asFlexural * 420e3 * (r.y.d - a / 2)).toBeCloseTo(253.5, 3);
  });

  it('refuses a section that would need compression steel instead of designing one', () => {
    // A pad footing is singly reinforced by construction. Reaching for A's means the section
    // is too thin, and the answer is a thicker footing.
    const r = designFootingMat(square({ thickness: 0.25, factoredAxial: 6000 }));
    expect(r.x.status).toBe('DESIGN_FAILED');
    expect(r.x.failures.map((f) => f.key)).toContain('footing.mat.needsCompressionSteel');
  });
});

// ─── H: §7.7.2.3 is 300 mm, not the draft's 450 ──────────────────

describe('§7.7.2.3 maximum spacing (H)', () => {
  it('caps at 300 mm and never at the 2024 draft\'s 450 mm', () => {
    // The enacted Annex IV reads "el menor entre 3h y 300 mm". 450 mm belongs to §7.7.2.4,
    // which is the shrinkage-and-temperature rule and a different requirement entirely.
    expect(MAX_SPACING_CAP_M).toBe(0.3);
    const r = designFootingMat(square());          // 3h = 1500 mm, so the cap governs
    expect(r.x.spacing.generalMax).toBe(0.3);
    expect(r.x.spacing.generalMax).not.toBe(0.45);
    expect(r.x.spacing.governingMax).toBeLessThanOrEqual(0.3);
    for (const reg of [...r.x.regions, ...r.y.regions]) {
      expect(reg.spacingCentre).toBeLessThanOrEqual(0.3);
      expect(reg.spacingCentre).toBeLessThan(0.45);
    }
  });

  it('takes 3h when 3h is the smaller of the two', () => {
    // h = 0,080 m ⇒ 3h = 240 mm < 300 mm.
    const r = designFootingMat(square({ thickness: 0.08 }));
    expect(r.x.spacing.generalMax).toBeCloseTo(0.24, 12);
  });

  it('enforces §13.3.1.2\'s 150 mm least effective depth', () => {
    expect(MIN_BOTTOM_MAT_DEPTH_M).toBe(0.15);
    const r = designFootingMat(square({ thickness: 0.08 }));
    // 0,080 − 0,050 − 0,016 − 0,008 = 0,006 m as the upper layer.
    expect(r.x.d).toBeCloseTo(0.006, 12);
    expect(r.x.meetsMinimumDepth).toBe(false);
    expect(r.x.failures.map((f) => f.key)).toContain('footing.mat.depthBelowMinimum');
    expect(r.x.status).toBe('DESIGN_FAILED');
  });
});

// ─── I: the most restrictive maximum governs ─────────────────────

describe('the governing maximum spacing is the most restrictive applicable one (I)', () => {
  it('lets §24.3 crack control beat the general 3h/300 limit', () => {
    // cc = 50 mm (clear cover) ⇒ 380 − 2,5×50 = 255 mm, against the general 300 mm.
    const r = designFootingMat(square());
    expect(r.x.spacing.crackControlMax).toBeCloseTo(0.255, 12);
    expect(r.x.spacing.crackControlMax).toBeLessThan(r.x.spacing.generalMax);
    expect(r.x.spacing.governingMax).toBeCloseTo(0.255, 12);
    expect(r.x.spacing.governingMaxClause).toBe('24.3.2');
  });

  it('lets the general limit govern when thin cover makes crack control permissive', () => {
    // cover 20 mm ⇒ cc = 20 mm, so 380 − 50 = 330 mm and the 300·(280/fs) cap holds at
    // 300 mm; h = 0,080 m puts 3h at 240 mm, which then governs.
    const r = designFootingMat(square({
      thickness: 0.08, cover: 0.02,
      preferences: { ...PREFS, bottomMatDiameterXmm: 10, bottomMatDiameterYmm: 10 },
    }));
    expect(r.x.spacing.crackControlMax).toBeCloseTo(0.3, 12);
    expect(r.x.spacing.generalMax).toBeCloseTo(0.24, 12);
    expect(r.x.spacing.governingMax).toBeCloseTo(0.24, 12);
    expect(r.x.spacing.governingMaxClause).toBe('7.7.2.3');
  });

  it('tracks the cover, which is what §24.3.2 is about', () => {
    const thin = designFootingMat(square({ cover: 0.03 }));
    const thick = designFootingMat(square({ cover: 0.07 }));
    // 380 − 75 = 305 → capped at 300; 380 − 175 = 205.
    expect(thin.x.spacing.crackControlMax).toBeCloseTo(0.3, 12);
    expect(thick.x.spacing.crackControlMax).toBeCloseTo(0.205, 12);
  });

  it('cites both maxima and both spacing routes, once each', () => {
    const clauses = designFootingMat(square()).refs.map((c) => c.clause);
    for (const c of ['7.7.2.1', '7.7.2.2', '7.7.2.3', '24.3.2', '25.2.1', '13.2.7.1', '7.6.1']) {
      expect(clauses).toContain(c);
    }
    // Deduplicated by what they cite: both directions produce §24.3.2 as separate objects.
    expect(clauses.filter((c) => c === '24.3.2')).toHaveLength(1);
  });
});

// ─── J, K, L: the layout rules ───────────────────────────────────

describe('bar count and spacing (J, K, L)', () => {
  const fixtures = () => [
    square(), rectangular(), square({ factoredMomentB: 200 }),
    square({ eccentricityB: 0.3 }),
    square({ preferences: { ...PREFS, bottomMatDiameterXmm: 25 } }),
    square({ preferences: { ...PREFS, bottomMatDiameterXmm: 12, bottomMatDiameterYmm: 32 } }),
  ];

  it('never lets the clear spacing fall below §25.2.1 (J)', () => {
    for (const input of fixtures()) {
      const r = designFootingMat(input);
      for (const dir of [r.x, r.y]) {
        for (const reg of dir.regions) {
          expect(reg.spacingClear).toBeGreaterThanOrEqual(dir.spacing.minClear);
        }
      }
    }
  });

  it('never provides less steel than the CODE-required amount (K)', () => {
    for (const input of fixtures()) {
      const r = designFootingMat(input);
      for (const dir of [r.x, r.y]) {
        if (dir.status !== 'DESIGNED') continue;
        // Per region — the integer count is chosen region by region…
        for (const reg of dir.regions) {
          expect(reg.asProvided).toBeGreaterThanOrEqual(reg.asRequired);
          expect(reg.barCount).toBeGreaterThanOrEqual(1);
          expect(Number.isInteger(reg.barCount)).toBe(true);
        }
        // …and across the direction, against the §7.6.1/§7.5.1.1 total, which is the number
        // the code actually requires of the direction.
        expect(dir.asProvided).toBeGreaterThanOrEqual(dir.asGoverning);
        // The regions between them account for the whole code total and no more.
        const shares = dir.regions.reduce((s, g) => s + g.distributionShare, 0);
        expect(shares).toBeCloseTo(dir.asGoverning, 9);
      }
    }
  });

  it('returns a structured failure when the selected diameter admits no layout (L)', () => {
    /**
     * 0,60 × 0,60 m in plan and 6,00 m thick, at Ø32. Absurd as a footing and exact as a test
     * of the bound: §7.6.1 asks for 0,0018 × 0,60 × 6,00 = 6,48e-3 m², i.e. ceil(8,06) = 9
     * bars of Ø32, while §25.2.1's 32 mm clear distance leaves room for only
     * floor(0,468 / 0,064) + 1 = 8 across the 0,468 m placeable span.
     */
    const r = designFootingMat(square({
      B: 0.6, L: 0.6, thickness: 6.0, columnB: 0.2, columnH: 0.2,
      preferences: { ...PREFS, bottomMatDiameterXmm: 32, bottomMatDiameterYmm: 32 },
    }));
    expect(r.x.status).toBe('DESIGN_FAILED');
    expect(r.status).toBe('DESIGN_FAILED');
    // No region was emitted, so nothing reads as an acceptable layout…
    expect(r.x.regions).toEqual([]);
    const failure = r.x.failures.find((f) => f.key === 'footing.mat.noFeasibleLayout');
    expect(failure).toBeDefined();
    expect(failure!.params).toMatchObject({ diameter: 32, reason: 'minClear' });
    // …and the diameter the engineer chose was NOT quietly changed to one that would fit.
    expect(r.x.diameterMm).toBe(32);
  });

  it('adds bars when the maximum spacing asks for more than the area does', () => {
    /**
     * A lightly loaded 0,30 m footing: 0,0018 × 2,00 × 0,300 = 10,80 cm² takes ceil(5,37) = 6
     * bars of Ø16, while the 255 mm §24.3.2 limit over the 1,884 m placeable span needs
     * 1 + ceil(7,39) = 9. The area is satisfied three bars before the spacing is.
     *
     * Nine is then odd, so the centre-line rule takes it to ten — a separate bound from a
     * separate concern, applied AFTER the code's three and only ever upward. The point of this
     * test is the spacing floor overtaking the area floor, and that is asserted on the spacing
     * floor itself rather than on the delivered count, so the two rules stay distinguishable.
     */
    const r = designFootingMat(square({ thickness: 0.3, factoredAxial: 300 }));
    const needed = Math.ceil(r.x.asGoverning / barArea(16));
    expect(needed).toBe(6);
    const span = 2.0 - 2 * 0.05 - 0.016;
    expect(1 + Math.ceil(span / r.x.spacing.governingMax)).toBe(9);
    expect(r.x.regions[0].barCount).toBe(10);
    expect(r.x.regions[0].spacingCentre).toBeLessThanOrEqual(r.x.spacing.governingMax + 1e-12);
  });
});

// ─── N: §13.3.3.3 rectangular distribution ───────────────────────

describe('rectangular footing distribution, §13.3.3.3 (N)', () => {
  const r = designFootingMat(rectangular());

  it('bands the SHORT-direction reinforcement and leaves the long one uniform', () => {
    // X bars run parallel to B = 1,50 m, the short side, so X is the short-direction
    // reinforcement §13.3.3.3 (b) bands. Y runs parallel to the long side: (a), uniform.
    expect(r.x.distribution).toBe('BANDED_SHORT_DIRECTION');
    expect(r.y.distribution).toBe('UNIFORM_FULL_WIDTH');
    expect(r.y.regions).toHaveLength(1);
    expect(r.y.regions[0].kind).toBe('FULL_WIDTH');
  });

  it('uses γs = 2/(β+1) with β the long/short ratio', () => {
    expect(r.x.beta).toBeCloseTo(2.0, 12);
    expect(r.x.gammaS).toBeCloseTo(2 / 3, 12);
  });

  it('puts a band as wide as the SHORT side, centred on the column axis', () => {
    const band = r.x.regions.find((g) => g.kind === 'CENTRAL_BAND')!;
    expect(band.width).toBeCloseTo(1.5, 12);       // = min(B, L)
    expect(band.centreOffset).toBeCloseTo(0, 12);  // centred column
    const outside = r.x.regions.filter((g) => g.kind === 'OUTSIDE_BAND');
    expect(outside).toHaveLength(2);
    for (const o of outside) expect(o.width).toBeCloseTo(0.75, 12);
    // The three regions tile the distribution width exactly — no steel is lost or double-laid.
    expect(r.x.regions.reduce((s, g) => s + g.width, 0)).toBeCloseTo(3.0, 12);
  });

  it('allocates γs·As inside the band and (1−γs)·As outside it — and nothing else', () => {
    /**
     * The code answer, with no invented regional floor on top of it. A_s = 27,00 cm²:
     *
     *   band        γs·As = ⅔ × 27,00 = 18,00 cm²
     *   each zone   ⅙·As  =           =  4,50 cm²
     *   total                            27,00 cm²  ⇒ exactly the §7.6.1 requirement
     */
    const gov = r.x.asGoverning;
    expect(cm2(gov)).toBeCloseTo(27.0, 9);
    const band = r.x.regions.find((g) => g.kind === 'CENTRAL_BAND')!;
    const outside = r.x.regions.filter((g) => g.kind === 'OUTSIDE_BAND');
    expect(cm2(band.distributionShare)).toBeCloseTo(18.0, 9);
    expect(cm2(band.asRequired)).toBeCloseTo(18.0, 9);
    for (const o of outside) {
      expect(cm2(o.distributionShare)).toBeCloseTo(4.5, 9);
      // `asRequired` IS the share. The first version raised it to 6,75 cm² — 0,0018·A_g on the
      // strip — and reported that as §7.6.1's requirement, which the clause does not impose.
      expect(cm2(o.asRequired)).toBeCloseTo(4.5, 9);
      expect(o.governedBy).toBe('DISTRIBUTION');
    }
    expect(cm2(band.distributionShare + outside.reduce((s, g) => s + g.distributionShare, 0)))
      .toBeCloseTo(27.0, 9);
  });

  it('keeps the γs identity checkable: the band is exactly twice as dense', () => {
    // For ANY β: band density = 2As/(long+short), outside density = As/(long+short). Algebra,
    // not a repeat of the code — and it holds because no floor perturbs the shares.
    const band = r.x.regions.find((g) => g.kind === 'CENTRAL_BAND')!;
    const out = r.x.regions.find((g) => g.kind === 'OUTSIDE_BAND')!;
    expect((band.distributionShare / band.width) / (out.distributionShare / out.width))
      .toBeCloseTo(2.0, 9);

    // And at a different β, so the relation is not an artefact of β = 2.
    const r3 = designFootingMat(square({ B: 1.0, L: 3.0 }));
    const b3 = r3.x.regions.find((g) => g.kind === 'CENTRAL_BAND')!;
    const o3 = r3.x.regions.find((g) => g.kind === 'OUTSIDE_BAND')!;
    expect(r3.x.gammaS).toBeCloseTo(0.5, 12);
    expect((b3.distributionShare / b3.width) / (o3.distributionShare / o3.width))
      .toBeCloseTo(2.0, 9);
  });

  it('reports the regional 0,0018Ag figure as POLICY, never as a requirement', () => {
    /**
     * §7.6.1 imposes its minimum on the direction's reinforcement; §13.3.3.3 then distributes
     * "la armadura total". Neither clause, and neither commentary, imposes 0,0018 A_g again
     * region by region. So the figure is computed, reported and named as a Stabileo
     * conservatism — and it does not enter the design.
     *
     *   outside zone: 0,0018 × 0,75 × 0,500 = 6,75 cm² policy, against 4,50 cm² required
     *   3 Ø16 provide 6,032 cm²  ⇒ above the code requirement, below the policy figure
     */
    const out = r.x.regions.find((g) => g.kind === 'OUTSIDE_BAND')!;
    expect(cm2(out.policyRegionalMinimum)).toBeCloseTo(6.75, 9);
    expect(out.asRequired).toBeLessThan(out.policyRegionalMinimum);
    expect(out.asProvided).toBeGreaterThanOrEqual(out.asRequired);
    expect(cm2(out.asProvided)).toBeCloseTo(6.032, 3);

    // Filed as an advisory, not a failure: the design IS code-compliant.
    expect(r.x.status).toBe('DESIGNED');
    expect(r.x.failures).toEqual([]);
    expect(r.advisories.map((a) => a.key))
      .toContain('footing.mat.regionBelowPolicyMinimum');
  });

  it('raises no advisory when the layout clears the policy figure anyway', () => {
    // The band does: 18,10 cm² provided against a 13,50 cm² policy figure. An advisory about
    // steel that is already there would be noise.
    const band = r.x.regions.find((g) => g.kind === 'CENTRAL_BAND')!;
    expect(band.asProvided).toBeGreaterThan(band.policyRegionalMinimum);
    const bandAdvisories = r.advisories
      .filter((a) => a.params?.region === 'CENTRAL_BAND');
    expect(bandAdvisories).toEqual([]);
  });

  it('does not approximate a rectangular footing as a square one', () => {
    const sq = designFootingMat(square());
    expect(sq.x.distribution).not.toBe(r.x.distribution);
    expect(r.x.regions.length).toBe(3);
    expect(sq.x.regions.length).toBe(1);
    expect(designFootingMat(rectangular()).refs.map((c) => c.clause)).toContain('13.3.3.3');
  });

  it('centres the band on the COLUMN axis, not on the footing centroid', () => {
    // The centroid sits 0,30 m from the column along L, so the band moves with the column and
    // the two outside zones stop being equal. Reading "centred" as the centroid would put the
    // extra steel in the wrong place on every eccentric footing.
    const e = designFootingMat(rectangular({ eccentricityL: 0.3 }));
    const band = e.x.regions.find((g) => g.kind === 'CENTRAL_BAND')!;
    expect(band.centreOffset).toBeCloseTo(-0.3, 12);
    const widths = e.x.regions.filter((g) => g.kind === 'OUTSIDE_BAND')
      .map((g) => g.width).sort((a, b) => a - b);
    expect(widths[0]).toBeCloseTo(0.45, 12);
    expect(widths[1]).toBeCloseTo(1.05, 12);
    // The remainder is spread by DENSITY over the outside zones, so the wider zone takes more.
    const regs = e.x.regions.filter((g) => g.kind === 'OUTSIDE_BAND');
    const density = regs.map((g) => g.distributionShare / g.width);
    expect(density[0]).toBeCloseTo(density[1], 12);
  });

  it('refuses when the prescribed band will not fit inside the footing', () => {
    // Offset the column far enough and the 1,50 m band runs off the 3,00 m width. Clipping it
    // would invent a rule §13.3.3.3 does not state.
    const r2 = designFootingMat(rectangular({ eccentricityL: 0.9 }));
    expect(r2.x.status).toBe('DESIGN_FAILED');
    expect(r2.x.failures.map((f) => f.key)).toContain('footing.mat.bandOutsideFooting');
  });
});

// ─── The status model ────────────────────────────────────────────

describe('the PR18-A status model is not one OK flag', () => {
  const r = designFootingMat(square());

  it('reports the flexural schedule as designed and nothing else as verified', () => {
    expect(r.status).toBe('DESIGNED');
    expect(r.x.status).toBe('DESIGNED');
    expect(r.y.status).toBe('DESIGNED');
    // Four separate statuses, so DESIGNED cannot be read as covering any of them. The layer
    // order is now ESTABLISHED and the other three are not — which is the point of keeping them
    // apart: one of the four moved and the rest did not follow it.
    expect(r.geometry).toBe('REQUIRED_NOT_MODELED');
    expect(r.topReinforcement).toBe('NOT_EVALUATED');
    expect(r.layerOrder.status).toBe('ESTABLISHED');
    expect(r.anchorage).toBe('NOT_GEOMETRICALLY_VERIFIED');
  });

  it('reports a development length without claiming it is achieved', () => {
    const withLd = designFootingMat(square({ developmentLengthFor: () => 1.2 }));
    expect(withLd.x.developmentLength).toBeCloseTo(1.2, 12);
    // Reported, and still not verified: the length is a property of the bar, and whether the
    // bar achieves it is a question about geometry that does not exist yet.
    expect(withLd.anchorage).toBe('NOT_GEOMETRICALLY_VERIFIED');
    expect(withLd.status).toBe('DESIGNED');
  });

  it('rolls the mat status down when either direction fails', () => {
    const bad = designFootingMat(square({ thickness: 0.08 }));
    expect(bad.status).toBe('DESIGN_FAILED');
    expect(bad.geometry).toBe('REQUIRED_NOT_MODELED');
    expect(bad.failures.length).toBeGreaterThan(0);
  });

  it('never reports DESIGNED with no region to show for it', () => {
    // A direction whose layout was refused emits no region, and an empty region list must not
    // read as a schedule.
    const none = designFootingMat(square({
      B: 0.6, L: 0.6, thickness: 6.0, columnB: 0.2, columnH: 0.2,
      preferences: { ...PREFS, bottomMatDiameterXmm: 32, bottomMatDiameterYmm: 32 },
    }));
    expect(none.x.regions).toEqual([]);
    expect(none.x.status).not.toBe('DESIGNED');
  });
});

// ─── The physical layer order ────────────────────────────────────

/**
 * Which perpendicular mat sits in the lower layer.
 *
 * PR18-A established none and designed BOTH directions at the shallower upper-layer depth — an
 * explicit conservative envelope, and honest, but it describes a lower mat placed one full bar
 * diameter above where it is actually tied. The order is now either the engineer's stated
 * override or AUTO's deterministic selection, and each direction is designed at its real depth.
 *
 * AUTO designs both physical arrangements COMPLETELY and compares the results. The rule of thumb
 * — "put the bigger moment lower" — is not reliable: the extra depth is worth most where the
 * steel is flexure-governed, and a mat direction is frequently governed by §7.6.1's 0,0018 A_g,
 * which does not depend on `d` at all. The cases below are chosen so that each of the four
 * decision steps is the one that actually fires.
 */
describe('the resolved physical layer order', () => {
  /** Ø10 parallel to B, Ø32 parallel to L, on a footing thin enough for §13.3.1.2 to bind. */
  const thinUnequal = (over: Partial<FootingMatDesignInput> = {}) => square({
    thickness: 0.23, factoredAxial: 400,
    preferences: { ...PREFS, bottomMatDiameterXmm: 10, bottomMatDiameterYmm: 32 },
    ...over,
  });

  it('rejects an arrangement that cannot produce a code-compliant layout (step 1)', () => {
    // h = 0,230 m, cover 0,050, Ø10 / Ø32. §13.3.1.2 needs d ≥ 150 mm for the bottom mat:
    //   X_BELOW_Y: dX = 230 − 50 − 5 = 175 ✓   dY = 230 − 50 − 10 − 16 = 154 ✓
    //   Y_BELOW_X: dY = 230 − 50 − 16 = 164 ✓   dX = 230 − 50 − 32 − 5 = 143 ✗
    // Putting the Ø32 down costs the Ø10 above it a full 32 mm and drives it under the minimum.
    const r = designFootingMat(thinUnequal());
    const [xBelow, yBelow] = r.layerOrder.evaluated;
    expect(xBelow.order).toBe('X_BELOW_Y');
    expect(xBelow.feasible).toBe(true);
    expect(yBelow.feasible).toBe(false);
    expect(yBelow.dX).toBeCloseTo(0.143, 12);
    expect(yBelow.rejection.map((m) => m.key)).toContain('footing.mat.depthBelowMinimum');

    expect(r.layerOrder.status).toBe('ESTABLISHED');
    expect(r.layerOrder.resolved).toBe('X_BELOW_Y');
    expect(r.layerOrder.rationale).toBe('ONLY_FEASIBLE_ARRANGEMENT');
    expect(r.status).toBe('DESIGNED');
    // …and it is chosen on feasibility DESPITE needing more steel than the rejected one would
    // have, which is what makes step 1 a filter and not a preference.
    expect(xBelow.providedSteelMassKg).toBeLessThan(yBelow.providedSteelMassKg + 1e9);
  });

  it('establishes no order when NEITHER arrangement is compliant, and says so', () => {
    const r = designFootingMat(thinUnequal({ thickness: 0.20 }));
    expect(r.layerOrder.evaluated.every((e) => !e.feasible)).toBe(true);
    expect(r.layerOrder.status).toBe('NOT_ESTABLISHED');
    expect(r.layerOrder.resolved).toBeNull();
    expect(r.layerOrder.lowerLayerAxis).toBeNull();
    expect(r.layerOrder.rationale).toBe('NO_FEASIBLE_ARRANGEMENT');
    expect(r.status).toBe('DESIGN_FAILED');
    // With no order there is no real depth, so the PRE-RESOLUTION envelope is what gets
    // reported — as a diagnostic, and labelled as one.
    expect(r.x.layerRole).toBe('ENVELOPE_UPPER_LAYER');
    expect(r.y.layerRole).toBe('ENVELOPE_UPPER_LAYER');
    expect(r.x.d).toBeCloseTo(r.x.dIfUpperLayer, 12);
    expect(r.y.d).toBeCloseTo(r.y.dIfUpperLayer, 12);
    expect(r.assumptions.map((a) => a.key)).toContain('footing.assumption.layerEnvelope');
    expect(r.assumptions.map((a) => a.key)).not.toContain('footing.assumption.layerOrderResolved');
  });

  it('minimises the provided steel when both are feasible (step 2)', () => {
    // 1,50 × 3,00, Ø16 both ways. Direction Y spans the long side and is FLEXURE-governed
    // (15,53 cm² needed against a 13,50 cm² minimum); direction X is minimum-governed, so its
    // bar count does not move with depth at all. Giving the deeper layer to Y therefore buys a
    // whole bar, and giving it to X buys nothing:
    //
    //   X_BELOW_Y: dY = 0,426 → Y needs 9 bars → 81,13 kg total
    //   Y_BELOW_X: dY = 0,442 → Y needs 8 bars → 71,97 kg total
    //
    // This is exactly the case the "bigger moment lower" rule of thumb gets right and the
    // "bigger BAR lower" one gets wrong, and it is why AUTO designs both rather than reasoning.
    //
    // Both masses carry one extra bar in the X direction's CENTRAL_BAND, which the centre-line
    // rule takes from 9 to 10 (see `layoutRegion`). It lands on both candidate orders equally,
    // so it shifts the two numbers without touching the comparison they exist to settle — the
    // Y direction's own count is 8 either way, already even, and does not move.
    const r = designFootingMat(rectangular());
    const [xBelow, yBelow] = r.layerOrder.evaluated;
    expect(xBelow.feasible).toBe(true);
    expect(yBelow.feasible).toBe(true);
    expect(yBelow.providedSteelMassKg).toBeLessThan(xBelow.providedSteelMassKg);
    expect(xBelow.providedSteelMassKg).toBeCloseTo(81.13, 1);
    expect(yBelow.providedSteelMassKg).toBeCloseTo(71.97, 1);

    expect(r.layerOrder.resolved).toBe('Y_BELOW_X');
    expect(r.layerOrder.rationale).toBe('LESS_PROVIDED_STEEL');
    expect(r.layerOrder.lowerLayerAxis).toBe('Y');
    expect(r.y.layerRole).toBe('LOWER_LAYER');
    expect(r.y.barCount).toBe(8);
    expect(r.x.layerRole).toBe('UPPER_LAYER');
  });

  it('reports the mass it compared as the bar count times the real bar length', () => {
    // The comparison quantity is auditable rather than an internal score: bars of length
    // `span − 2·cover`, at 7850 kg/m³, through the project's one mass authority.
    const r = designFootingMat(rectangular());
    expect(matBarLength(1.5, 0.05)).toBeCloseTo(1.4, 12);
    expect(matBarLength(3.0, 0.05)).toBeCloseTo(2.9, 12);
    const expected =
      r.x.barCount * barArea(r.x.diameterMm) * matBarLength(1.5, 0.05) * 7850
      + r.y.barCount * barArea(r.y.diameterMm) * matBarLength(3.0, 0.05) * 7850;
    const chosen = r.layerOrder.evaluated.find((e) => e.order === r.layerOrder.resolved)!;
    expect(chosen.providedSteelMassKg).toBeCloseTo(expected, 6);
    expect(chosen.providedSteelVolumeM3).toBeCloseTo(expected / 7850, 9);
  });

  it('breaks a steel tie on the flexural utilisation (step 3)', () => {
    // Square, Ø16 parallel to B and Ø25 parallel to L. BOTH directions are minimum-governed, so
    // both arrangements need nine bars of each size and the masses tie EXACTLY — step 2 cannot
    // separate them. The utilisation does: putting the Ø16 low leaves the worst direction at
    // 0,481, and putting the Ø25 low leaves it at 0,510.
    const r = designFootingMat(square({
      preferences: { ...PREFS, bottomMatDiameterYmm: 25 },
    }));
    const [xBelow, yBelow] = r.layerOrder.evaluated;
    expect(xBelow.providedSteelMassKg).toBeCloseTo(yBelow.providedSteelMassKg, 9);
    expect(xBelow.worstFlexuralUtilization).toBeLessThan(yBelow.worstFlexuralUtilization);
    expect(r.layerOrder.rationale).toBe('LOWER_FLEXURAL_UTILIZATION');
    expect(r.layerOrder.resolved).toBe('X_BELOW_Y');
  });

  it('falls back to X_BELOW_Y only when nothing else separates them (step 4)', () => {
    // Square, equal diameters, no moment: the arrangements are mirror images and BOTH measures
    // tie. The rule fixes one so the answer does not depend on comparison order.
    const r = designFootingMat(square());
    const [a, b] = r.layerOrder.evaluated;
    expect(a.providedSteelMassKg).toBeCloseTo(b.providedSteelMassKg, 9);
    expect(a.worstFlexuralUtilization).toBeCloseTo(b.worstFlexuralUtilization, 9);
    expect(r.layerOrder.rationale).toBe('DETERMINISTIC_TIE_BREAK');
    expect(r.layerOrder.resolved).toBe('X_BELOW_Y');
    expect(r.layerOrder.lowerLayerAxis).toBe('X');
  });

  it('is deterministic — the same input gives byte-identical output', () => {
    const run = () => designFootingMat(rectangular({
      eccentricityB: 0.11, factoredMomentB: 37.5, factoredAxial: 913.7,
      preferences: { ...PREFS, bottomMatDiameterYmm: 20 },
    }));
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  // ── The manual override ──────────────────────────────────────

  it.each(['X_BELOW_Y', 'Y_BELOW_X'] as const)(
    'honours the manual override %s over AUTO\'s preference', (order) => {
      // The rectangular footing AUTO resolves to Y_BELOW_X, so X_BELOW_Y is a real override that
      // costs 4,6 kg of steel. It is applied anyway: the engineer may be placing this mat to
      // suit a neighbouring pour, and the design must follow the drawing rather than argue.
      const r = designFootingMat(rectangular({
        preferences: { ...PREFS, bottomMatLayerOrder: order },
      }));
      expect(r.layerOrder.status).toBe('ESTABLISHED');
      expect(r.layerOrder.preference).toBe(order);
      expect(r.layerOrder.resolved).toBe(order);
      expect(r.layerOrder.rationale).toBe('MANUAL_OVERRIDE');
      const lower = order === 'X_BELOW_Y' ? r.x : r.y;
      const upper = order === 'X_BELOW_Y' ? r.y : r.x;
      expect(lower.layerRole).toBe('LOWER_LAYER');
      expect(upper.layerRole).toBe('UPPER_LAYER');
      expect(lower.d).toBeCloseTo(lower.dIfLowerLayer, 12);
      expect(upper.d).toBeCloseTo(upper.dIfUpperLayer, 12);
    });

  it('still reports what the rejected order would have cost, under an override', () => {
    // An override with no visible alternative is a decision nobody can review.
    const forced = designFootingMat(rectangular({
      preferences: { ...PREFS, bottomMatLayerOrder: 'X_BELOW_Y' },
    }));
    expect(forced.layerOrder.evaluated).toHaveLength(2);
    const auto = designFootingMat(rectangular());
    const forcedMass = forced.layerOrder.evaluated
      .find((e) => e.order === 'X_BELOW_Y')!.providedSteelMassKg;
    const autoMass = auto.layerOrder.evaluated
      .find((e) => e.order === 'Y_BELOW_X')!.providedSteelMassKg;
    expect(forcedMass).toBeGreaterThan(autoMass);
    // Both runs evaluated the SAME two arrangements to the same numbers — the override changes
    // which one is built, not what either one is.
    for (const order of ['X_BELOW_Y', 'Y_BELOW_X'] as const) {
      expect(forced.layerOrder.evaluated.find((e) => e.order === order)!.providedSteelMassKg)
        .toBeCloseTo(auto.layerOrder.evaluated.find((e) => e.order === order)!
          .providedSteelMassKg, 9);
    }
  });

  it('changes the delivered design when the override changes', () => {
    // The property that makes the preference worth persisting and worth superseding documents
    // over: two different orders are two different mats.
    const x = designFootingMat(rectangular({
      preferences: { ...PREFS, bottomMatLayerOrder: 'X_BELOW_Y' },
    }));
    const y = designFootingMat(rectangular({
      preferences: { ...PREFS, bottomMatLayerOrder: 'Y_BELOW_X' },
    }));
    expect(x.y.barCount).not.toBe(y.y.barCount);
    expect(x.x.d).not.toBeCloseTo(y.x.d, 4);
    expect(JSON.stringify(x)).not.toBe(JSON.stringify(y));
  });

  it('reads an absent preference as AUTO', () => {
    const absent = designFootingMat(rectangular());
    const stated = designFootingMat(rectangular({
      preferences: { ...PREFS, bottomMatLayerOrder: 'AUTO' },
    }));
    expect(absent.layerOrder.preference).toBe('AUTO');
    expect(JSON.stringify(absent)).toBe(JSON.stringify(stated));
  });

  // ── Real elevations, for every resolved case ─────────────────

  it('always satisfies the elevation identities, whatever the order', () => {
    const cases = [
      square(),
      square({ preferences: { ...PREFS, bottomMatDiameterYmm: 25 } }),
      rectangular(),
      rectangular({ preferences: { ...PREFS, bottomMatLayerOrder: 'X_BELOW_Y' } }),
      rectangular({ preferences: { ...PREFS, bottomMatLayerOrder: 'Y_BELOW_X' } }),
      thinUnequal(),
    ];
    for (const input of cases) {
      const r = designFootingMat(input);
      expect(r.layerOrder.status).toBe('ESTABLISHED');
      const lower = r.x.layerRole === 'LOWER_LAYER' ? r.x : r.y;
      const upper = r.x.layerRole === 'LOWER_LAYER' ? r.y : r.x;

      // Exactly one of each.
      expect(lower.layerRole).toBe('LOWER_LAYER');
      expect(upper.layerRole).toBe('UPPER_LAYER');
      // Lower: clear cover to the bar SURFACE is the footing cover, full stop.
      expect(lower.clearCoverToSoffit).toBeCloseTo(input.cover, 12);
      expect(lower.centreElevation)
        .toBeCloseTo(input.cover + lower.diameterMm / 2000, 12);
      // Upper: its surface stands one FULL lower diameter above the lower bar's surface,
      // because the mats cross rather than run parallel.
      expect(upper.clearCoverToSoffit)
        .toBeCloseTo(input.cover + lower.diameterMm / 1000, 12);
      expect(upper.centreElevation).toBeCloseTo(
        input.cover + lower.diameterMm / 1000 + upper.diameterMm / 2000, 12);
      // And the depth is the complement of the centre elevation, in both layers.
      for (const dir of [lower, upper]) {
        expect(dir.d).toBeCloseTo(input.thickness - dir.centreElevation, 12);
        expect(dir.centreElevation - dir.clearCoverToSoffit)
          .toBeCloseTo(dir.diameterMm / 2000, 12);
      }
      // The upper mat never reaches below the lower one.
      expect(upper.centreElevation).toBeGreaterThan(lower.centreElevation);
    }
  });
});
