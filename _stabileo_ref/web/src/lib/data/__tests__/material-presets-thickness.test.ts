/**
 * A preset must not present a thickness-dependent `fy` as if it were one number.
 *
 * `structural-grades.ts` says so itself: "`fy` for hot-rolled steel FALLS with
 * thickness … `byThickness` carries it and `fy` is the thin-plate value — so a
 * caller that ignores thickness is unconservative, by about 6%, silently."
 *
 * Every production caller ignored it. `fromGrade` copied `g.fy` and dropped the
 * bands, so the picker offered S355 as a flat 355 MPa and a user sizing a 60 mm
 * plate got a yield stress 6 % above the 335 MPa that governs there. The error
 * runs in the unsafe direction, which is why it is worth carrying rather than
 * documenting.
 *
 * This does NOT change the number the model uses — plumbing the member's real
 * thickness into the design check is a larger change with its own decisions. It
 * stops the picker claiming a certainty the standard does not give.
 */
import { describe, it, expect } from 'vitest';
import { bandSummary, getMaterialPresets } from '../material-presets';
import { ALL_GRADES } from '../structural-grades';

const PRESETS = getMaterialPresets();
const BANDED = ALL_GRADES.filter((g) => g.byThickness && g.byThickness.length > 0);

describe('a preset carries its grade thickness bands', () => {
  it('keeps the bands for every grade that has them', () => {
    expect(BANDED.length, 'the fixture for this test is the data itself').toBeGreaterThan(0);

    // Counted rather than only looped: `continue` on a missing preset would
    // let this pass while checking nothing at all, the day the grade-to-preset
    // projection stops emitting one of these.
    let checked = 0;
    for (const g of BANDED) {
      const preset = PRESETS.find((p) => p.gradeId === g.id);
      if (!preset) continue; // not every grade is offered in every picker
      expect(preset.thicknessBands, `${g.designation} lost its bands`).toBeDefined();
      expect(preset.thicknessBands!.length).toBe(g.byThickness!.length);
      checked++;
    }
    expect(checked, 'every banded grade reaches a preset today').toBe(BANDED.length);
  });

  it('leaves a grade with a single tabulated value alone', () => {
    const flat = ALL_GRADES.find((g) => !g.byThickness);
    expect(flat, 'some grade is tabulated as one value').toBeDefined();
    const preset = PRESETS.find((p) => p.gradeId === flat!.id);
    expect(preset, 'the unbanded grade reaches a preset, so this checks something').toBeDefined();
    expect(preset!.thicknessBands).toBeUndefined();
    expect(bandSummary(preset!)).toBeNull();
  });

  it('the quoted fy is the FIRST band, so the bands explain the headline number', () => {
    // If these ever disagree the picker would show one number and caveat another.
    for (const p of PRESETS) {
      if (!p.thicknessBands?.length) continue;
      expect(p.fy, `${p.name}`).toBe(p.thicknessBands[0].fy);
    }
  });

  it('S355 drops to 335 MPa over 40 mm, per EN 1993-1-1 table 3.1', () => {
    // The grade the module's own docstring uses to explain the hazard.
    const s355 = PRESETS.find((p) => p.gradeId === 'en-s355');
    expect(s355?.fy).toBe(355);
    const thick = s355?.thicknessBands?.find((b) => b.overMm === 40);
    expect(thick?.fy, 'the 40–80 mm band').toBe(335);
  });
});

/**
 * Where a band comes from is not where the grade comes from.
 *
 * Every band in the catalogue is a DESIGN code's table while `standard` names
 * the PRODUCT standard, and the picker prints them side by side. Left unsaid,
 * the 40 mm step reads as EN 10025-2's — which it is not: that standard steps
 * at 16 mm and gives S355 as 345 MPa above it. Conflating the two axes is the
 * error `structural-grades.ts` exists to prevent, so it must not be reintroduced
 * by the thing that displays them.
 */
describe('a band says which standard tabulated it', () => {
  it('names a source for every banded grade', () => {
    for (const g of BANDED) {
      expect(g.bandStandard, `${g.designation} has bands from nowhere`).toBeTruthy();
    }
  });

  it('never claims the bands came from the product standard', () => {
    for (const g of BANDED) {
      expect(g.bandStandard, `${g.designation}`).not.toBe(g.productStandard);
    }
  });

  it('carries the source onto the preset, next to the bands it qualifies', () => {
    for (const g of BANDED) {
      const preset = PRESETS.find((p) => p.gradeId === g.id);
      expect(preset?.bandStandard, `${g.designation}`).toBe(g.bandStandard);
    }
  });

  it('puts the source in the tooltip text', () => {
    const s355 = PRESETS.find((p) => p.gradeId === 'en-s355')!;
    expect(bandSummary(s355)!.full).toBe(
      'EN 1993-1-1 t.3.1 · 0–40 mm: fy 355 MPa · 40–80 mm: fy 335 MPa',
    );
  });
});

/**
 * The one line the picker shows, which is the whole point of the change.
 *
 * These assert the rendered strings because the markup itself has no test:
 * there is no component-test setup in this repo and the material picker has no
 * e2e coverage, so pinning the text the template interpolates is as close to
 * the user-visible result as this suite reaches.
 */
describe('the summary the picker shows', () => {
  it('states the far value, not only the bound, so nothing needs a hover', () => {
    const s355 = PRESETS.find((p) => p.gradeId === 'en-s355')!;
    expect(bandSummary(s355)!.tail).toBe('(>40mm: 335)');
  });

  it('reads as a rise for the one grade that gets stronger with thickness', () => {
    // 6082-T6 runs the other way and EN 1999-1-1 flags it as not a misprint.
    // Quoting the far value states that without asserting a direction; wording
    // it as a fall would have been wrong here and nowhere else.
    const alu = PRESETS.find((p) => p.gradeId === 'alu-6082-t6')!;
    expect(alu.fy).toBe(250);
    expect(bandSummary(alu)!.tail).toBe('(>5mm: 260)');
  });

  it('says nothing for a grade with no bands', () => {
    expect(bandSummary({ thicknessBands: undefined })).toBeNull();
    expect(bandSummary({ thicknessBands: [] })).toBeNull();
  });

  /**
   * The summary quotes the FIRST band's bound and the LAST band's value, which
   * is exact for two bands and would skip the middle of three. Every banded
   * grade has exactly two today. Pinning that means a three-band grade fails
   * here — where the decision is — instead of silently rendering a step that
   * does not exist.
   */
  it('assumes two bands, and every catalogued grade has exactly two', () => {
    for (const g of BANDED) {
      expect(g.byThickness!.length, `${g.designation} — bandSummary would skip a step`).toBe(2);
    }
  });
});
