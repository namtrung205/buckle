/**
 * Cauchy, Bredt and Saint-Venant, checked against each other and against hand
 * calculations.
 *
 * These are three models of the same twist, each valid over a different wall
 * topology, and they do NOT agree where they overlap. That disagreement is the
 * subject: it is what "thin wall" costs, and a reader who cannot see it has no
 * way to judge when the assumption stops being safe.
 *
 * So the assertions here are of two kinds. Absolute ones, against numbers
 * worked out by hand from the section dimensions — a formula that reproduces
 * itself proves nothing. And relative ones, pinning the direction and rough
 * size of the gap between theories, since a sign error there would show as two
 * plausible numbers rather than as an obvious failure.
 */

import { describe, it, expect } from 'vitest';
import { compareTorsionTheories, type TorsionTheoryId } from '../torsion-flow';
import type { ResolvedSection } from '../section-stress';

const section = (over: Partial<ResolvedSection>): ResolvedSection => ({
  shape: 'rect', h: 0.3, b: 0.2, tw: 0.01, tf: 0.015, t: 0, ...over,
} as ResolvedSection);

const pick = (rs: ResolvedSection, T: number, id: TorsionTheoryId) =>
  compareTorsionTheories(T, rs).find((r) => r.id === id)!;

describe('a circular tube: all three theories have something to say', () => {
  // 200 mm outside diameter, 10 mm wall. Ri = 90 mm, Rm = 95 mm.
  const chs = section({ shape: 'CHS', h: 0.2, b: 0.2, t: 0.01 });
  const T = 20; // kN·m

  it('Cauchy matches the hand calculation', () => {
    // Ip = pi/2 (0.1^4 - 0.09^4) = pi/2 * 3.439e-5 = 5.4020e-5 m^4
    // tau = T r / Ip = 20 * 0.1 / 5.4020e-5 = 37 024 kPa = 37.0 MPa
    const c = pick(chs, T, 'cauchy');
    expect(c.applies).toBe(true);
    expect(c.j! * 1e8).toBeCloseTo(5402.0, 0);   // cm^4
    expect(c.tauMax!).toBeCloseTo(37.0, 1);
  });

  it('Bredt matches its own hand calculation', () => {
    // Am = pi * 0.095^2 = 0.028353 m^2
    // tau = T / (2 Am t) = 20 / (2 * 0.028353 * 0.01) = 35 271 kPa = 35.3 MPa
    const b = pick(chs, T, 'bredt');
    expect(b.applies).toBe(true);
    expect(b.tauMax!).toBeCloseTo(35.3, 1);
  });

  it('and Bredt reads LOW against Cauchy, which is what thin-wall costs', () => {
    const c = pick(chs, T, 'cauchy').tauMax!;
    const b = pick(chs, T, 'bredt').tauMax!;
    /*
     * Bredt averages the stress across the thickness; Cauchy knows it grows
     * with the radius and reports the outside fibre. So Bredt is the smaller
     * number — a fact worth pinning, because it means using Bredt on a stocky
     * tube is UNCONSERVATIVE, not merely approximate.
     */
    expect(b).toBeLessThan(c);
    expect(b / c).toBeGreaterThan(0.7);
  });

  it('the gap closes as the wall gets thinner', () => {
    // Same diameter, 2 mm wall instead of 10.
    const thin = section({ shape: 'CHS', h: 0.2, b: 0.2, t: 0.002 });
    const ratio = (rs: ResolvedSection) =>
      pick(rs, T, 'bredt').tauMax! / pick(rs, T, 'cauchy').tauMax!;
    expect(ratio(thin)).toBeGreaterThan(ratio(chs));
    expect(ratio(thin)).toBeCloseTo(1, 1);
  });

  it('Saint-Venant gives the exact circular answer, not an approximation', () => {
    // Circular symmetry means no warping at all, so Saint-Venant's problem has
    // the elementary solution — the two must agree to the last digit.
    expect(pick(chs, T, 'saintVenant').tauMax!).toBeCloseTo(pick(chs, T, 'cauchy').tauMax!, 9);
  });

  it('names Cauchy as the one to use', () => {
    expect(pick(chs, T, 'cauchy').governs).toBe(true);
    expect(pick(chs, T, 'bredt').governs).toBe(false);
  });
});

describe('a square tube: Bredt governs and Cauchy has no meaning', () => {
  // 200 x 200 x 10 RHS. Mid-line 190 x 190.
  const rhs = section({ shape: 'RHS', h: 0.2, b: 0.2, t: 0.01 });
  const T = 20;

  it('matches the hand calculation', () => {
    // Am = 0.19^2 = 0.0361 m^2; tau = 20 / (2 * 0.0361 * 0.01) = 27 701 kPa
    const b = pick(rhs, T, 'bredt');
    expect(b.tauMax!).toBeCloseTo(27.7, 1);
    // J = 4 Am^2 / (perimeter / t) = 4 * 0.0361^2 / (0.76 / 0.01) = 6.859e-5
    expect(b.j! * 1e8).toBeCloseTo(6859, 0);
  });

  it('reports the shear FLOW, which is what is constant around the circuit', () => {
    const q = pick(rhs, T, 'bredt').terms.find((t) => t.symbol === 'q')!;
    // q = T / (2 Am) = 20 / 0.0722 = 277 kN/m
    expect(q.value).toBeCloseTo(277, 0);
  });

  it('refuses Cauchy rather than returning a plausible number', () => {
    const c = pick(rhs, T, 'cauchy');
    expect(c.applies).toBe(false);
    expect(c.tauMax).toBeNull();
  });

  it('uses the MID-LINE area, not the outside dimensions', () => {
    // Outside would give Am = 0.04 and tau = 25.0 MPa — 10% low, in the
    // unconservative direction, which is the classic Bredt mistake.
    expect(pick(rhs, T, 'bredt').tauMax!).toBeGreaterThan(25.5);
  });
});

describe('an open section: Bredt must be refused, loudly', () => {
  // IPE 300-ish: h 300, b 150, tw 7.1, tf 10.7.
  const ipe = section({ shape: 'I', h: 0.3, b: 0.15, tw: 0.0071, tf: 0.0107 });
  const T = 5;

  it('Saint-Venant matches the hand calculation', () => {
    // J = (1/3)[2 * 0.15 * 0.0107^3 + 0.2786 * 0.0071^3]
    //   = (1/3)(3.6746e-7 + 9.972e-8) = 1.5574e-7 m^4 = 15.6 cm^4
    // tau = T t_max / J = 5 * 0.0107 / 1.5574e-7 = 343 500 kPa = 343 MPa
    //
    // A real IPE 300 lists It = 20.1 cm^4; the difference is the root fillets,
    // which the rectangles model has no way to know about. Reporting 15.6 as
    // if it were the catalogue value would be the error — the number belongs
    // to the idealisation, and the idealisation is the conservative one.
    const sv = pick(ipe, T, 'saintVenant');
    expect(sv.j! * 1e8).toBeCloseTo(15.6, 1);   // cm^4
    expect(sv.tauMax!).toBeCloseTo(343.5, 0);
  });

  it('does not offer Bredt at all', () => {
    const b = pick(ipe, T, 'bredt');
    expect(b.applies).toBe(false);
    expect(b.tauMax).toBeNull();
    expect(b.reasonKey).toBe('stress.tt.bredtOpen');
  });

  it('and Saint-Venant is the one that governs', () => {
    expect(pick(ipe, T, 'saintVenant').governs).toBe(true);
  });

  it('the thickest element governs, not the deepest', () => {
    // tau = T·t/J with the flange thicker than the web, so the flange is the
    // worst place — the opposite of where bending shear peaks.
    const t = pick(ipe, T, 'saintVenant').terms.find((x) => x.symbol === 'tₘₐₓ')!;
    expect(t.value).toBeCloseTo(10.7, 6);
  });
});

describe('a solid rectangle', () => {
  const rect = section({ shape: 'rect', h: 0.3, b: 0.2 });

  it('is Saint-Venant only', () => {
    const all = compareTorsionTheories(10, rect);
    expect(all.filter((r) => r.applies).map((r) => r.id)).toEqual(['saintVenant']);
  });

  it('uses the solid-rectangle solution, far stiffer than the same box open', () => {
    const sv = pick(rect, 10, 'saintVenant');
    // J = a b^3 [1/3 - 0.21 (b/a)(1 - (b/a)^4/12)], a = 0.3, b = 0.2
    // = 2.4e-3 * [0.33333 - 0.21 * 0.66667 * 0.98354] = 2.4e-3 * 0.19563
    // = 4.6953e-4 m^4 = 46 953 cm^4
    expect(sv.j! * 1e8).toBeCloseTo(46953, -1);
  });
});

describe('shape of the answer', () => {
  it('always returns the three theories, in the same order', () => {
    for (const rs of [
      section({ shape: 'CHS', h: 0.2, b: 0.2, t: 0.01 }),
      section({ shape: 'RHS', h: 0.2, b: 0.1, t: 0.008 }),
      section({ shape: 'I', h: 0.3, b: 0.15, tw: 0.007, tf: 0.011 }),
      section({ shape: 'rect', h: 0.4, b: 0.2 }),
    ]) {
      expect(compareTorsionTheories(7, rs).map((r) => r.id))
        .toEqual(['saintVenant', 'bredt', 'cauchy']);
    }
  });

  it('exactly one theory governs, whatever the section', () => {
    for (const rs of [
      section({ shape: 'CHS', h: 0.2, b: 0.2, t: 0.01 }),
      section({ shape: 'CHS', h: 0.06, b: 0.06, t: 0 }),   // solid round bar
      section({ shape: 'RHS', h: 0.2, b: 0.1, t: 0.008 }),
      section({ shape: 'U', h: 0.2, b: 0.08, tw: 0.006, tf: 0.01 }),
      section({ shape: 'rect', h: 0.4, b: 0.2 }),
    ]) {
      expect(compareTorsionTheories(7, rs).filter((r) => r.governs)).toHaveLength(1);
    }
  });

  it('is linear in the torque, as the theory says', () => {
    const rhs = section({ shape: 'RHS', h: 0.2, b: 0.2, t: 0.01 });
    expect(pick(rhs, 40, 'bredt').tauMax!).toBeCloseTo(2 * pick(rhs, 20, 'bredt').tauMax!, 9);
  });

  it('still reports the section properties at zero torque', () => {
    // J belongs to the section, not to the load. Going blank when a station
    // happens to carry no torque would hide it for no reason.
    const sv = pick(section({ shape: 'I', h: 0.3, b: 0.15, tw: 0.007, tf: 0.011 }), 0, 'saintVenant');
    expect(sv.j).toBeGreaterThan(0);
    expect(sv.tauMax).toBe(0);
  });

  it('a solid round bar gets Cauchy but not Bredt: there is no wall', () => {
    const bar = section({ shape: 'CHS', h: 0.06, b: 0.06, t: 0 });
    expect(pick(bar, 3, 'cauchy').applies).toBe(true);
    expect(pick(bar, 3, 'bredt').applies).toBe(false);
    // Ip = pi/2 * 0.03^4 = 1.2723e-6; tau = 3*0.03/1.2723e-6 = 70 738 kPa
    expect(pick(bar, 3, 'cauchy').tauMax!).toBeCloseTo(70.7, 1);
  });

  it('a degenerate section does not claim Saint-Venant applies', () => {
    // No wall anywhere: computeTorsionFlow refuses it, and the entry must say
    // so — applies: true with null values would draw a row asserting a result
    // it does not have.
    const degenerate = section({ shape: 'I', h: 0.3, b: 0.15, tw: 0, tf: 0 });
    const sv = pick(degenerate, 5, 'saintVenant');
    expect(sv.applies).toBe(false);
    expect(sv.tauMax).toBeNull();
    expect(sv.j).toBeNull();
    expect(sv.governs).toBe(false);
    expect(sv.reasonKey).toBe('stress.tt.na');
  });
});
