import { describe, it, expect } from 'vitest';
import { crackControlMaxSpacing } from '../crack-control';

/**
 * Table 24.3.2 of the enacted CIRSOC 201-2025 Annex IV.
 *
 * The anchor is the Reglamento's OWN worked example, in commentary C 24.3.2: a beam with
 * f_y = 420 MPa, 50 mm clear cover and f_s = 280 MPa has a maximum spacing of 250 mm. The
 * table's exact arithmetic gives 380 − 2,5×50 = 255 mm; the commentary's 250 is the round
 * inch-pound figure (10 in = 254 mm) the clause was translated from. So the test asserts the
 * exact 255 and pins the commentary within its rounding, which is the honest way to use a
 * worked example as a fixture.
 */
describe('§24.3.2 — maximum spacing for crack control', () => {
  it('reproduces the Reglamento\'s own commentary example', () => {
    const r = crackControlMaxSpacing('2025', { fy: 420, clearCoverToTensionFace: 0.05 });
    // §24.3.2.1's permission: f_s = (2/3)·420 = 280 MPa, which is the example's stress.
    expect(r.fs).toBeCloseTo(280, 9);
    expect(r.fsSource).toBe('permittedTwoThirdsFy');
    expect(r.terms.coverTermMm).toBeCloseTo(255, 9);   // 380·(280/280) − 2,5×50
    expect(r.terms.capTermMm).toBeCloseTo(300, 9);     // 300·(280/280)
    expect(r.governedBy).toBe('coverTerm');
    expect(r.maxSpacing * 1000).toBeCloseTo(255, 9);
    // Within the commentary's rounding of the same rule.
    expect(Math.abs(r.maxSpacing * 1000 - 250)).toBeLessThan(6);
  });

  it('takes the LESSER of the two terms, and which one that is depends on the cover', () => {
    // The cover term passes the 300 mm cap only below c_c = 32 mm, so thin cover is the case
    // where the cap governs and thick cover the case where the cover term does.
    const thin = crackControlMaxSpacing('2025', { fy: 420, clearCoverToTensionFace: 0.02 });
    expect(thin.terms.coverTermMm).toBeCloseTo(330, 9);
    expect(thin.governedBy).toBe('cap');
    expect(thin.maxSpacing * 1000).toBeCloseTo(300, 9);

    const thick = crackControlMaxSpacing('2025', { fy: 420, clearCoverToTensionFace: 0.07 });
    expect(thick.terms.coverTermMm).toBeCloseTo(205, 9);
    expect(thick.governedBy).toBe('coverTerm');
    expect(thick.maxSpacing * 1000).toBeCloseTo(205, 9);
  });

  it('tightens as the cover grows — the whole reason this limit exists', () => {
    const spacings = [0.03, 0.05, 0.07, 0.09]
      .map((cc) => crackControlMaxSpacing('2025', { fy: 420, clearCoverToTensionFace: cc }).maxSpacing);
    for (let i = 1; i < spacings.length; i++) {
      expect(spacings[i]).toBeLessThan(spacings[i - 1]);
    }
  });

  it('uses a computed service stress when the caller has one', () => {
    // §24.3.2.1 offers the (2/3)f_y permission as an alternative to the unfactored-moment
    // calculation, and a lower stress permits wider spacing. Which route was used has to be
    // readable off the result, because it changes the number.
    const computed = crackControlMaxSpacing('2025', {
      fy: 420, clearCoverToTensionFace: 0.05, fs: 200,
    });
    expect(computed.fsSource).toBe('computed');
    expect(computed.fs).toBe(200);
    // 380·(280/200) − 125 = 532 − 125 = 407 against the cap 300·1,4 = 420 ⇒ 407 mm.
    expect(computed.terms.coverTermMm).toBeCloseTo(407, 9);
    expect(computed.maxSpacing * 1000).toBeCloseTo(407, 9);
    expect(computed.maxSpacing).toBeGreaterThan(
      crackControlMaxSpacing('2025', { fy: 420, clearCoverToTensionFace: 0.05 }).maxSpacing);
  });

  it('floors the cover term at zero rather than returning a negative spacing', () => {
    // An absurd cover makes 380 − 2,5c_c negative. Zero is a maximum no layout can satisfy,
    // which surfaces as a design failure — the honest outcome for a section that cannot be
    // crack-controlled at that cover.
    const r = crackControlMaxSpacing('2025', { fy: 420, clearCoverToTensionFace: 0.2 });
    expect(r.terms.coverTermMm).toBe(0);
    expect(r.maxSpacing).toBe(0);
  });

  it('cites §24.3.2, and §24.3.2.1 only when the permission was used', () => {
    const permitted = crackControlMaxSpacing('2025', { fy: 420, clearCoverToTensionFace: 0.05 });
    expect(permitted.refs.map((c) => c.clause)).toEqual(['24.3.2', '24.3.2.1']);
    const computed = crackControlMaxSpacing('2025', {
      fy: 420, clearCoverToTensionFace: 0.05, fs: 200,
    });
    expect(computed.refs.map((c) => c.clause)).toEqual(['24.3.2']);
  });
});
