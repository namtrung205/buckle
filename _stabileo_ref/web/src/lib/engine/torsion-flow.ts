/**
 * torsion-flow.ts — the shear stress a torque produces, and where it acts.
 *
 * # Why this is not one formula
 *
 * Torsion is the place where "it depends on the section" stops being a caveat
 * and becomes the whole subject. Three genuinely different theories apply, they
 * give answers that differ by ORDERS OF MAGNITUDE for the same section area,
 * and which one applies is decided by the topology of the wall — not by its
 * size, its material or its inertia:
 *
 *   * **Circular** (`tau = T·r/J`, `J = Ip`). The only case where plane
 *     sections stay plane and the elementary derivation is exact. Stress runs
 *     linearly from zero at the centre to a maximum at the outside.
 *
 *   * **Bredt**, for a CLOSED thin wall (`tau = T / (2·Am·t)`). The torque is
 *     carried by a shear flow circulating around the enclosed area, constant
 *     along the perimeter where the thickness is. `Am` is the area enclosed by
 *     the MID-LINE of the wall — not the outside, and not the section's own
 *     area — and getting that wrong is the classic error.
 *
 *   * **Saint-Venant**, for an OPEN thin wall (`J = (1/3)·sum(b·t³)`,
 *     `tau_max = T·t_max/J`). With no closed circuit to run around, the flow
 *     must turn back on itself across the thickness, which is why `t` enters
 *     CUBED and why an open section is so bad at resisting torsion.
 *
 * The last two are the comparison worth showing a student: slit a square tube
 * lengthwise and its torsional stiffness collapses by a factor of hundreds,
 * while nothing about its area, its bending inertia or its appearance changes
 * appreciably. A C-channel and a square tube of the same weight are not
 * remotely the same member in torsion.
 *
 * # What this module is for
 *
 * The canonical engine solves Saint-Venant torsion numerically on the section
 * mesh and is the authority for a stress AT A POINT. This produces the
 * DISTRIBUTION for drawing, from the closed forms, for the same reason the
 * Jourawski module does: a diagram needs the shape of the field along the wall,
 * and the closed forms give it directly and name the theory they came from.
 */

import type { ResolvedSection } from './section-stress';

export type TorsionTheory = 'circular' | 'bredt' | 'openThinWall' | 'solidRect';

export interface TorsionFlowPoint {
  /** Horizontal offset from the centroid, metres. */
  z: number;
  /** Vertical offset from the centroid, metres. */
  y: number;
  /** Shear stress from torsion at this point, MPa. */
  tau: number;
}

export interface TorsionFlowSegment {
  points: TorsionFlowPoint[];
  /** Whether the flow circulates around a closed circuit (Bredt). */
  closed?: boolean;
}

export interface TorsionFlow {
  theory: TorsionTheory;
  /** Peak shear stress from the torque, MPa. */
  tauMax: number;
  /** Torsion constant used, m⁴. Reported so the theory can be checked. */
  j: number;
  segments: TorsionFlowSegment[];
  /** i18n key naming the theory, for the panel to label the diagram. */
  labelKey: string;
}

/**
 * Saint-Venant torsion of a SOLID rectangle, `a` long side and `b` short.
 *
 * A solid rectangle has no elementary closed form — the exact answer is an
 * infinite series — so these are the standard engineering approximations to it:
 *
 *   J        = a·b³·[1/3 - 0.21·(b/a)·(1 - (b/a)⁴/12)]
 *   tau_max  = T·(3a + 1.8b) / (a²·b²)
 *
 * Chosen over a lookup table with interpolation, which was the first attempt:
 * a table has to be clamped at its last row, so a 50:1 strip came out with the
 * 10:1 coefficient and was 5% stiff. These are continuous over the whole range
 * and land on the tabulated values where the table exists — 0.1408 against
 * 0.141 for a square — while tending correctly to the thin-strip limit of 1/3.
 *
 * The peak sits at the middle of the LONG side, not at a corner: at a corner
 * two free surfaces meet and the shear stress must vanish, which is the
 * opposite of the circular intuition.
 */
function rectTorsion(a: number, b: number): { j: number; tauPerTorque: number } {
  const r = b / a; // <= 1
  const j = a * b ** 3 * (1 / 3 - 0.21 * r * (1 - r ** 4 / 12));
  return { j, tauPerTorque: (3 * a + 1.8 * b) / (a * a * b * b) };
}

/** kN·m and metres in, MPa out. */
const toMPa = (kPa: number) => kPa / 1000;

/**
 * The torsional shear distribution for a section under a torque.
 *
 * `T` in kN·m. Returns `null` when there is no torque or the section is
 * degenerate — a diagram of nothing is worse than no diagram.
 */
export function computeTorsionFlow(T: number, rs: ResolvedSection): TorsionFlow | null {
  if (Math.abs(T) < 1e-9) return null;
  const absT = Math.abs(T);

  switch (rs.shape) {
    case 'CHS': return circular(absT, rs);
    case 'RHS': return bredt(absT, rs);
    case 'I': case 'H': case 'U': case 'C': case 'L': case 'T': case 'invL':
      return openThinWall(absT, rs);
    default: return solidRect(absT, rs);
  }
}

// ── Circular: the exact case ──────────────────────────────────────

function circular(absT: number, rs: ResolvedSection): TorsionFlow | null {
  const R = rs.h / 2;
  if (R <= 0) return null;
  // A wall thickness means a tube; its absence means a solid bar.
  const Ri = rs.t > 0 ? Math.max(0, R - rs.t) : 0;
  const j = (Math.PI / 2) * (R ** 4 - Ri ** 4);
  if (j <= 0) return null;

  // tau = T·r/J — linear in the radius, zero at the centre. Sampled along a
  // radius, which is the whole distribution: it is axisymmetric.
  const N = 12;
  const points: TorsionFlowPoint[] = [];
  for (let i = 0; i <= N; i++) {
    const r = Ri + (i / N) * (R - Ri);
    points.push({ z: r, y: 0, tau: toMPa((absT * r) / j) });
  }
  return {
    theory: 'circular',
    tauMax: toMPa((absT * R) / j),
    j,
    segments: [{ points }],
    labelKey: 'stress.torsionCircular',
  };
}

// ── Bredt: closed thin wall ───────────────────────────────────────

function bredt(absT: number, rs: ResolvedSection): TorsionFlow | null {
  const t = rs.t;
  if (t <= 0) return solidRect(absT, rs);
  // Enclosed area is bounded by the wall's MID-LINE, so each dimension loses
  // one full thickness, not two. Using the outside dimensions overestimates
  // Am and under-reports the stress.
  const bm = rs.b - t;
  const hm = rs.h - t;
  if (bm <= 0 || hm <= 0) return solidRect(absT, rs);
  const am = bm * hm;
  const perimeter = 2 * (bm + hm);
  // Bredt's second formula, for a uniform wall.
  const j = (4 * am * am) / (perimeter / t);
  const tau = toMPa(absT / (2 * am * t));

  // Constant around the circuit for a uniform wall, so the diagram is the
  // mid-line itself — which is also the honest picture: the flow runs around
  // the perimeter rather than varying across it.
  const hz = bm / 2, hy = hm / 2;
  const loop: TorsionFlowPoint[] = [
    { z: -hz, y: hy, tau }, { z: hz, y: hy, tau },
    { z: hz, y: -hy, tau }, { z: -hz, y: -hy, tau },
    { z: -hz, y: hy, tau },
  ];
  return {
    theory: 'bredt',
    tauMax: tau,
    j,
    segments: [{ points: loop, closed: true }],
    labelKey: 'stress.torsionBredt',
  };
}

// ── Saint-Venant: open thin wall ──────────────────────────────────

/** The rectangles an open profile is made of: [length, thickness]. */
function openStrips(rs: ResolvedSection): Array<[number, number]> {
  switch (rs.shape) {
    case 'I': case 'H':
      return [[rs.b, rs.tf], [rs.b, rs.tf], [rs.h - 2 * rs.tf, rs.tw]];
    case 'U':
      return [[rs.b, rs.tf], [rs.b, rs.tf], [rs.h - 2 * rs.tf, rs.tw]];
    case 'C':
      // Lipped channel: two flanges, a web, and two lips.
      return [
        [rs.b, rs.tf], [rs.b, rs.tf], [rs.h - 2 * rs.tf, rs.tw],
        [rs.t, rs.tl || rs.tf], [rs.t, rs.tl || rs.tf],
      ];
    case 'T':
      return [[rs.b, rs.tf], [rs.h - rs.tf, rs.tw]];
    case 'L': case 'invL':
      return [[rs.b, rs.tf || rs.t], [rs.h - (rs.tf || rs.t), rs.tw || rs.t]];
    default:
      return [[rs.h, rs.tw || rs.t]];
  }
}

function openThinWall(absT: number, rs: ResolvedSection): TorsionFlow | null {
  const strips = openStrips(rs).filter(([b, t]) => b > 0 && t > 0);
  if (strips.length === 0) return null;
  // J = (1/3) sum(b·t³). The cube is the point: halving a wall's thickness
  // cuts its torsional stiffness EIGHTFOLD.
  const j = strips.reduce((acc, [b, t]) => acc + b * t ** 3, 0) / 3;
  if (j <= 0) return null;

  // tau = T·t/J, so the THICKEST element governs — usually the flange, which
  // is why an I-beam's worst torsional shear is not in its web.
  const tMax = Math.max(...strips.map(([, t]) => t));
  const tauMax = toMPa((absT * tMax) / j);

  // Across any one strip the stress runs linearly from -tau at one face,
  // through zero on the mid-line, to +tau at the other: the flow turns back on
  // itself, which is exactly what having no closed circuit costs.
  const segments: TorsionFlowSegment[] = strips.map(([, t], i) => {
    const tau = toMPa((absT * t) / j);
    const span = 0.35 * rs.h;
    const y = (i - (strips.length - 1) / 2) * (span / Math.max(1, strips.length));
    return {
      points: [
        { z: -span / 2, y, tau: -tau },
        { z: 0, y, tau: 0 },
        { z: span / 2, y, tau },
      ],
    };
  });

  return { theory: 'openThinWall', tauMax, j, segments, labelKey: 'stress.torsionOpen' };
}

// ── Solid rectangle ───────────────────────────────────────────────

function solidRect(absT: number, rs: ResolvedSection): TorsionFlow | null {
  const a = Math.max(rs.h, rs.b);
  const b = Math.min(rs.h, rs.b);
  if (a <= 0 || b <= 0) return null;
  const { j, tauPerTorque } = rectTorsion(a, b);
  if (j <= 0) return null;
  const tauMax = toMPa(absT * tauPerTorque);

  const N = 10;
  const points: TorsionFlowPoint[] = [];
  for (let i = 0; i <= N; i++) {
    const f = (i / N) * 2 - 1;
    // Roughly elliptical falloff along the long side, zero at the corners
    // where a free surface meets a free surface and the stress must vanish.
    points.push({ z: (f * a) / 2, y: 0, tau: tauMax * Math.sqrt(Math.max(0, 1 - f * f)) });
  }
  return { theory: 'solidRect', tauMax, j, segments: [{ points }], labelKey: 'stress.torsionSolid' };
}

/**
 * How much stiffer the same wall would be if the section were closed.
 *
 * The single most instructive number in the subject: slitting a tube costs a
 * factor of hundreds in torsional stiffness while changing nothing else about
 * it that a drawing would show. Returns `null` unless the comparison is
 * meaningful — it only means something for a closed section.
 */
export function closedVersusOpen(rs: ResolvedSection): number | null {
  if (rs.shape !== 'RHS' || rs.t <= 0) return null;
  const closed = bredt(1, rs);
  const strips: Array<[number, number]> = [
    [rs.b - rs.t, rs.t], [rs.b - rs.t, rs.t],
    [rs.h - rs.t, rs.t], [rs.h - rs.t, rs.t],
  ];
  const jOpen = strips.reduce((acc, [b, t]) => acc + b * t ** 3, 0) / 3;
  if (!closed || jOpen <= 0) return null;
  return closed.j / jOpen;
}

// ── The three theories, side by side ──────────────────────────────

/**
 * The named theories, as a structural course states them.
 *
 * `computeTorsionFlow` above picks ONE — the one that governs — and draws it.
 * That is what a design value needs, but it hides the thing worth
 * understanding: these are different physical models of the same twist, they
 * are each valid over a different topology of wall, and where two of them
 * overlap they do NOT give the same number.
 *
 *   * **Cauchy** — circular sections, solid or hollow. `tau = T·r/Ip`. The one
 *     case with an exact elementary solution: circular symmetry means plane
 *     sections stay plane, there is no warping at all, and the stress runs
 *     linearly from zero at the centre to a maximum at the outside fibre.
 *
 *   * **Bredt** — closed thin walls. `tau = T/(2·Am·t)`. A shear FLOW
 *     `q = tau·t` circulates around the closed circuit and is constant along
 *     it, so the thinnest wall carries the highest stress. `Am` is the area
 *     enclosed by the wall's MID-LINE.
 *
 *   * **Saint-Venant** — the general theory of uniform torsion, valid for any
 *     shape. `tau = T·t/J` with `J` depending on the shape: `(1/3)·sum(b·t³)`
 *     for an open thin wall, Roark's series for a solid rectangle, and — this
 *     is the part usually left unsaid — Bredt's own expression for a closed
 *     thin wall, because Bredt IS the thin-wall solution of Saint-Venant's
 *     problem, not a rival to it.
 *
 * Which is why they are shown together with their differences rather than one
 * at a time: on a circular tube, Cauchy and Bredt differ by a few per cent
 * because Bredt assumes the stress is constant across a thickness that Cauchy
 * knows varies linearly, and seeing that gap is what tells a reader what "thin
 * wall" is actually assuming.
 */
export type TorsionTheoryId = 'cauchy' | 'bredt' | 'saintVenant';

export interface TorsionTheoryTerm {
  /** Symbol as it appears in the formula. */
  symbol: string;
  value: number;
  unit: string;
}

export interface TorsionTheoryResult {
  id: TorsionTheoryId;
  /** Whether this theory is valid for THIS section. */
  applies: boolean;
  /** Peak shear from the torque, MPa. Null when the theory does not apply. */
  tauMax: number | null;
  /** Torsion constant, m⁴. */
  j: number | null;
  /** The quantities that go into the formula, so the number can be checked. */
  terms: TorsionTheoryTerm[];
  /**
   * i18n key explaining why it applies here, or why it does not.
   *
   * The "does not" case is the one that matters: applying Bredt to an open
   * section is the classic error, and it is unconservative by two orders of
   * magnitude — so the panel has to say so rather than silently omit the row.
   */
  reasonKey: string;
  /** True for the theory whose value should be used for this section. */
  governs: boolean;
}

/** Whether a resolved section is a closed circuit at all. */
function isClosed(rs: ResolvedSection): boolean {
  return (rs.shape === 'RHS' || rs.shape === 'CHS') && rs.t > 0;
}

function isCircular(rs: ResolvedSection): boolean {
  return rs.shape === 'CHS';
}

/**
 * Every theory evaluated for this section and torque, applicable or not.
 *
 * `T` in kN·m. Always returns three entries in a fixed order — general first,
 * then the two special cases — so the panel never reorders itself between
 * sections and a reader can compare two members at a glance.
 */
export function compareTorsionTheories(T: number, rs: ResolvedSection): TorsionTheoryResult[] {
  const absT = Math.abs(T);
  return [saintVenantEntry(absT, rs), bredtEntry(absT, rs), cauchyEntry(absT, rs)];
}

function saintVenantEntry(absT: number, rs: ResolvedSection): TorsionTheoryResult {
  /*
   * Evaluated at a UNIT torque and scaled. tau is linear in T, so this gives
   * the section's J and its stress-per-torque even when the station carries no
   * torque at all — which is what lets the panel show what the section WOULD
   * do, rather than going blank.
   */
  const unit = computeTorsionFlow(1, rs);
  const closed = isClosed(rs);
  const circular = isCircular(rs);

  const terms: TorsionTheoryTerm[] = [];
  if (!closed && !circular) {
    const strips = openStrips(rs).filter(([b, t]) => b > 0 && t > 0);
    if (strips.length > 1) {
      terms.push({ symbol: 'Σb·t³', value: strips.reduce((a, [b, t]) => a + b * t ** 3, 0) * 1e12, unit: 'mm⁴' });
      terms.push({ symbol: 'tₘₐₓ', value: Math.max(...strips.map(([, t]) => t)) * 1000, unit: 'mm' });
    }
  }
  if (unit) terms.push({ symbol: 'J', value: unit.j * 1e8, unit: 'cm⁴' });

  return {
    id: 'saintVenant',
    // A null `unit` means computeTorsionFlow refused the section outright —
    // degenerate geometry with no wall, no area, no J. Claiming the theory
    // applies while every value is null would draw a row that asserts a
    // result it does not have.
    applies: unit !== null,
    tauMax: unit ? unit.tauMax * absT : null,
    j: unit ? unit.j : null,
    terms,
    /*
     * Saint-Venant always applies — it is the theory, not a special case — but
     * WHICH closed form evaluates it depends on the wall, so the note names
     * the one in use rather than pretending there is a single formula.
     */
    reasonKey: !unit ? 'stress.tt.na'
      : circular ? 'stress.tt.svCircular'
      : closed ? 'stress.tt.svClosed'
      : unit.theory === 'openThinWall' ? 'stress.tt.svOpen'
      : 'stress.tt.svSolid',
    governs: unit !== null && !closed && !circular,
  };
}

function bredtEntry(absT: number, rs: ResolvedSection): TorsionTheoryResult {
  if (!isClosed(rs)) {
    return {
      id: 'bredt', applies: false, tauMax: null, j: null, terms: [],
      reasonKey: rs.shape === 'RHS' || rs.shape === 'CHS'
        ? 'stress.tt.bredtNoWall'
        : 'stress.tt.bredtOpen',
      governs: false,
    };
  }

  const t = rs.t;
  let am: number;
  let perimeter: number;
  if (isCircular(rs)) {
    // Mid-line radius: halfway through the wall, not the outside.
    const rm = (rs.h - t) / 2;
    am = Math.PI * rm * rm;
    perimeter = 2 * Math.PI * rm;
  } else {
    am = (rs.b - t) * (rs.h - t);
    perimeter = 2 * ((rs.b - t) + (rs.h - t));
  }
  if (am <= 0 || perimeter <= 0) {
    return {
      id: 'bredt', applies: false, tauMax: null, j: null, terms: [],
      reasonKey: 'stress.tt.bredtNoWall', governs: false,
    };
  }

  const j = (4 * am * am) / (perimeter / t);
  return {
    id: 'bredt',
    applies: true,
    tauMax: absT > 0 ? toMPa(absT / (2 * am * t)) : 0,
    j,
    terms: [
      { symbol: 'Aₘ', value: am * 1e6, unit: 'mm²' },
      { symbol: 't', value: t * 1000, unit: 'mm' },
      { symbol: 'q', value: absT > 0 ? absT / (2 * am) : 0, unit: 'kN/m' },
      { symbol: 'J', value: j * 1e8, unit: 'cm⁴' },
    ],
    reasonKey: isCircular(rs) ? 'stress.tt.bredtCircular' : 'stress.tt.bredtClosed',
    governs: !isCircular(rs),
  };
}

function cauchyEntry(absT: number, rs: ResolvedSection): TorsionTheoryResult {
  if (!isCircular(rs)) {
    return {
      id: 'cauchy', applies: false, tauMax: null, j: null, terms: [],
      reasonKey: 'stress.tt.cauchyNotCircular', governs: false,
    };
  }
  const R = rs.h / 2;
  const Ri = rs.t > 0 ? Math.max(0, R - rs.t) : 0;
  const ip = (Math.PI / 2) * (R ** 4 - Ri ** 4);
  if (ip <= 0) {
    return {
      id: 'cauchy', applies: false, tauMax: null, j: null, terms: [],
      reasonKey: 'stress.tt.cauchyNotCircular', governs: false,
    };
  }
  return {
    id: 'cauchy',
    applies: true,
    tauMax: absT > 0 ? toMPa((absT * R) / ip) : 0,
    j: ip,
    terms: [
      { symbol: 'r', value: R * 1000, unit: 'mm' },
      { symbol: 'Iₚ', value: ip * 1e8, unit: 'cm⁴' },
    ],
    reasonKey: Ri > 0 ? 'stress.tt.cauchyTube' : 'stress.tt.cauchySolid',
    governs: true,
  };
}
