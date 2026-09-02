/**
 * What top steel a beam must carry when the analysis asks for none — CIRSOC 201-2025.
 *
 * ── The situation this module exists for ───────────────────────────
 *
 * A beam whose envelope never hogs gets no top steel from the design search: the top knobs of
 * `createBeamCandidateGenerator` are only built when `MuStart`, `MuEnd` or `MuSpanHog` is
 * non-zero, so `regions.topStart` and `regions.topEnd` are simply absent. On the 7-storey
 * example that is 63 of 119 beams, and `beamGroups()` in `run-detailing` then discarded the
 * BOTTOM steel too, because it required all three groups or nothing.
 *
 * A beam still needs bars up there, and not because of a moment. It needs them because it has
 * a stirrup cage, and the cage has to grip something.
 *
 * ── The authority, read rather than remembered ─────────────────────
 *
 * §25.7.1.2, verbatim:
 *
 *     "Entre los extremos anclados, cada doblez en la parte continua de los estribos en U,
 *      sencillos o múltiples, y cada doblez en un estribo cerrado, debe contener una barra
 *      longitudinal o cordón."
 *
 * A closed stirrup has two top bends, so two top bars. If the cage were U-shaped instead, the
 * top of each leg is an ANCHORED END rather than a bend in the continuous part, and §25.7.1.3(a)
 * governs it:
 *
 *     "Para barras y alambres de diámetro db = 16 mm y menores [...] un gancho normal alrededor
 *      de la armadura longitudinal."
 *
 * — a hook that must close around a longitudinal bar. Either cage form demands the same two
 * bars, which is why the count does not depend on which one the generator builds.
 *
 * §9.7.7.1(b) reaches the same number from the other direction for a perimeter beam: "al menos
 * un sexto de la armadura de tracción requerida para momento negativo en el apoyo, pero no menos
 * de DOS BARRAS, debe ser continua." The fraction is zero when the analysis requires no hogging
 * steel; the floor of two bars is not.
 *
 * ── What the regulation does NOT say, and is not made to say ───────
 *
 * §9.6.1.2's `max(0,25·√f'c/f_y, 1,4/f_y)·b_w·d` is NOT the rule here, and citing it would be
 * a scope error rather than a conservative choice. §9.6.1.1 scopes it exactly:
 *
 *     "Se debe colocar un área mínima de armadura para flexión As,min en toda sección donde el
 *      análisis requiera armadura a tracción."
 *
 * These sections do not. The top face of a beam that never hogs is not a flexural tension face,
 * so §9.6.1.2 has nothing to say about it and this module does not print a required area for it:
 * `asRequiredCm2` is null, deliberately, rather than a number an engineer could mistake for a
 * demand. Where the analysis DOES require top tension steel, §9.6.1.2 applies in full — and that
 * case never reaches here, because then the design produced a group and its purpose is
 * `flexural`.
 *
 * ── And the one number nothing in the regulation fixes ─────────────
 *
 * The DIAMETER. §25.7.1.2 requires a bar in the bend and says nothing about its size; §25.7.1.3(a)
 * requires the hook to close around a bar and says nothing about its size; §9.7.7.1(b) counts bars
 * and says nothing about their size. There is no clause to derive it from, so the choice is the
 * app's and is labelled as the app's: `diameterProvisional` is true on every group this module
 * synthesises, the bars are marked `stirrupHanger`, and no capacity is ever attributed to them.
 *
 * The choice itself is the least-steel one the rest of the generator already makes everywhere a
 * clause leaves it free — `buildRegionOptions` orders "fewer rows, then less steel, then smaller
 * diameter", `buildStirrupOptions` is "least steel first" — bounded by two things that ARE
 * measurable: the bar has to fit two-per-row at the code clear spacing, and it may not be thinner
 * than the stirrup that grips it. The second is a constructibility convention, not a clause, and
 * it says so in the note it emits.
 *
 * ── Why here and not under `codes/` ────────────────────────────────
 *
 * `lib/codes/` is the prose-free half: primitives that return numbers and `ClauseRef`s and
 * leave every sentence to a locale file, enforced by the engine-purity gate. This module
 * carries the sentence — the paragraph a reader needs when they see 2Ø10 at the top of a beam
 * and want to know what it answers for — so it belongs with `generate-beam.ts`, which writes
 * §9.7.3 out in Spanish for the same reason.
 *
 * Pure: no store, no runes, no i18n. Lengths m, areas cm², diameters mm.
 */

import { clause, type ClauseRef, type RegulationEdition } from '../../codes/regulation';
import { minClearSpacingInLayer } from '../../codes/cirsoc201/spacing';

/** What a group of longitudinal bars on the top face is FOR. */
export type TopSteelPurpose =
  /**
   * Resistant reinforcement: sized by the design search against a hogging moment and checked
   * by the authoritative verifier. Carries capacity and utilization.
   */
  | 'flexural'
  /**
   * Constructive reinforcement: the bar §25.7.1.2 requires in each top bend of the cage, on a
   * face the analysis requires no tension steel on.
   *
   * It is real steel in a real place and it is NOT a moment capacity. Nothing in this app
   * verifies a hogging moment against it, so nothing in this app may present it as resisting one.
   */
  | 'stirrupHanger';

/** Why no top steel could be produced. Structured, because silence was the original defect. */
export interface TopSteelBlock {
  /** i18n key under `detailing.topSteel.`. */
  key: string;
  params: Record<string, string | number>;
}

export interface TopSteelProvision {
  /** The group to detail, or null when `blocked` says why there is none. */
  group: { count: number; diameterMm: number } | null;
  purpose: TopSteelPurpose;
  /**
   * True when no clause fixes the DIAMETER and this app chose it.
   *
   * Separate from the member's own provisional state on purpose: a VERIFIED beam can carry a
   * hanger pair whose size is a project convention, and a PROVISIONAL_BIAXIAL beam can carry
   * hogging steel whose size the search derived. The two facts are independent and are reported
   * independently.
   */
  diameterProvisional: boolean;
  /** Area a clause requires on this face, cm². Null when NO clause sets one — see the header. */
  asRequiredCm2: number | null;
  /** Area the group provides, cm². Zero when there is no group. */
  asProvidedCm2: number;
  refs: ClauseRef[];
  blocked?: TopSteelBlock;
  /** Spanish trace line, matching the register the rest of the generator traces in. */
  note: string;
}

/** Bar area, cm², from the nominal diameter in mm. */
export function barAreaCm2(diameterMm: number): number {
  return Math.PI * (diameterMm / 10) ** 2 / 4;
}

/**
 * The two bars §25.7.1.2 requires in the top bends of a cage, when the analysis requires none.
 *
 * Returns a blocked provision rather than a fallback whenever the choice cannot be made from
 * evidence — a section too narrow to host two bars of any standard size is a real condition and
 * gets said out loud, not rounded down to one bar.
 */
export function hangerTopSteel(opts: {
  /** Section width, m. */
  b: number;
  /** Concrete cover, m. */
  cover: number;
  /** Stirrup diameter, mm. */
  stirrupDiaMm: number;
  /** Maximum aggregate size, mm — §25.2.1's third term. */
  maxAggregateSizeMm: number;
  /** Standard longitudinal diameters this project details with, ascending. */
  availableDiametersMm: readonly number[];
  edition: RegulationEdition;
}): TopSteelProvision {
  const c = (id: string, label?: string) => clause('cirsoc-201', opts.edition, id, label);
  /**
   * The count, and the three clauses that agree on it.
   *
   * Not a preference and not a minimum this module picked: a closed stirrup has two top bends,
   * a U stirrup has two anchored ends, and a perimeter beam's integrity steel has a floor of
   * two bars. Every reading of the regulation that applies to this face returns 2.
   */
  const COUNT = 2;
  const refs = [
    c('25.7.1.2', 'cada doblez del estribo debe contener una barra longitudinal'),
    c('25.7.1.3', 'el gancho del estribo se cierra alrededor de la armadura longitudinal'),
    c('9.7.7.1', 'armadura de integridad: no menos de dos barras continuas'),
  ];

  const clearWidth = opts.b - 2 * (opts.cover + opts.stirrupDiaMm / 1000);
  const ascending = [...opts.availableDiametersMm].sort((x, y) => x - y);

  for (const dia of ascending) {
    // A longitudinal bar thinner than the stirrup gripping it is not a detail anyone builds.
    // A constructibility convention, NOT a clause — and the note says so rather than letting
    // the reader assume the regulation asked for it.
    if (dia < opts.stirrupDiaMm) continue;
    const spacing = minClearSpacingInLayer(opts.edition, {
      barDiameterMm: dia, maxAggregateSizeMm: opts.maxAggregateSizeMm,
    });
    const needed = COUNT * (dia / 1000) + (COUNT - 1) * spacing.minClear;
    if (needed > clearWidth + 1e-9) continue;
    return {
      group: { count: COUNT, diameterMm: dia },
      purpose: 'stirrupHanger',
      diameterProvisional: true,
      // No clause sets an area for this face. Stating one would invent a demand.
      asRequiredCm2: null,
      asProvidedCm2: COUNT * barAreaCm2(dia),
      refs: [...refs, ...spacing.refs],
      note:
        `${COUNT}Ø${dia} superiores de armado: el análisis no requiere armadura de tracción en ` +
        'la cara superior, de modo que 9.6.1.2 no la alcanza (9.6.1.1), pero cada doblez ' +
        'superior del estribo debe contener una barra longitudinal (25.7.1.2) y el gancho del ' +
        'estribo se cierra alrededor de ella (25.7.1.3(a)). El REGLAMENTO NO FIJA EL DIÁMETRO: ' +
        `Ø${dia} es el menor de la serie del proyecto que entra de a dos con la separación ` +
        `libre mínima (${(spacing.minClear * 1000).toFixed(0)} mm) y no es más fino que el ` +
        `estribo Ø${opts.stirrupDiaMm} que lo toma — un criterio de constructibilidad, no una ` +
        'cláusula. No se le atribuye capacidad a momento negativo.',
    };
  }

  return {
    group: null,
    purpose: 'stirrupHanger',
    diameterProvisional: false,
    asRequiredCm2: null,
    asProvidedCm2: 0,
    refs,
    blocked: {
      key: 'detailing.topSteel.noDiameterFits',
      params: {
        clearWidthMm: Math.round(clearWidth * 1000),
        stirrupDiaMm: opts.stirrupDiaMm,
        tried: ascending.join(', '),
      },
    },
    note:
      `No hay diámetro de la serie del proyecto (${ascending.join(', ')}) que entre de a dos en ` +
      `un ancho libre de ${(clearWidth * 1000).toFixed(0)} mm sin bajar del Ø${opts.stirrupDiaMm} ` +
      'del estribo. La cara superior queda sin la barra que exige 25.7.1.2 y eso se informa; no ' +
      'se coloca una sola barra ni se inventa un diámetro.',
  };
}

/**
 * The provision for one support, given what the design produced there.
 *
 * Three branches and no fourth, because the fourth would be the dishonest one:
 *
 *   the design produced a group          → `flexural`. It was sized against the hogging seed and
 *                                          the verifier checked it. Nothing to add.
 *   no group, no hogging demand          → `stirrupHanger`. §25.7.1.2's bar, diameter chosen by
 *                                          this app and labelled as such.
 *   no group, hogging demand present     → BLOCKED. A face that hogs and has no steel is a
 *                                          design gap, and filling it with two constructive bars
 *                                          would put steel where a moment is and let it read as
 *                                          the answer to that moment. It is reported instead.
 */
export function resolveTopSteel(opts: {
  designed?: { count: number; diameterMm: number };
  /** Peak hogging moment magnitude at this support, kN·m. */
  hoggingMoment: number;
  b: number;
  cover: number;
  stirrupDiaMm: number;
  maxAggregateSizeMm: number;
  availableDiametersMm: readonly number[];
  edition: RegulationEdition;
}): TopSteelProvision {
  if (opts.designed && opts.designed.count > 0) {
    return {
      group: opts.designed,
      purpose: 'flexural',
      diameterProvisional: false,
      asRequiredCm2: null,
      asProvidedCm2: opts.designed.count * barAreaCm2(opts.designed.diameterMm),
      refs: [],
      note: `${opts.designed.count}Ø${opts.designed.diameterMm} superiores resistentes, `
        + 'dimensionadas por el momento negativo y verificadas.',
    };
  }

  if (opts.hoggingMoment > 0) {
    return {
      group: null,
      purpose: 'flexural',
      diameterProvisional: false,
      asRequiredCm2: null,
      asProvidedCm2: 0,
      refs: [clause('cirsoc-201', opts.edition, '9.6.1.1',
        'armadura mínima en toda sección donde el análisis requiera armadura a tracción')],
      blocked: {
        key: 'detailing.topSteel.hoggingWithoutDesign',
        params: { momentKNm: +opts.hoggingMoment.toFixed(2) },
      },
      note:
        `El apoyo tiene un momento negativo de envolvente de ${opts.hoggingMoment.toFixed(2)} kN·m ` +
        'y el diseño no produjo armadura superior. No se coloca armadura de armado en su lugar: ' +
        'dos barras de montaje en una cara traccionada se leerían como la respuesta a ese momento ' +
        'y no lo son. Se informa la falta.',
    };
  }

  return hangerTopSteel(opts);
}

/**
 * One member, one continuous top pair — so the two supports cannot report different sizes for it.
 *
 * ── The case ───────────────────────────────────────────────────────
 *
 * A beam that hogs at ONE end. The design produces `topEnd = 4Ø16` and no `topStart`, so the
 * resolver answers `flexural 4Ø16` at j and `stirrupHanger 2Ø10` at i. Then `generateBeamBars`
 * runs the pair at `max(10, 16) = 16`, because the pair is drawn from the widest group and
 * counts toward the hogging support's steel — which is right, and leaves i's provision saying
 * "2Ø10 de armado" beside a drawing showing 2Ø16.
 *
 * A trace that names a diameter the sheet does not show is worse than no trace: it is the kind
 * of disagreement a reviewer finds by measuring, halfway through a set. So the hanger side
 * adopts the diameter that will actually be drawn, and says which support it came from.
 *
 * Only upward, and only from a `flexural` partner. Two hanger faces are already one size, and a
 * hanger is never allowed to grow a designed group.
 */
export function reconcileAcrossTheMember(
  start: TopSteelProvision, end: TopSteelProvision,
): { start: TopSteelProvision; end: TopSteelProvision } {
  const adopt = (
    hanger: TopSteelProvision, other: TopSteelProvision, otherSide: string,
  ): TopSteelProvision => {
    if (hanger.purpose !== 'stirrupHanger' || !hanger.group) return hanger;
    if (other.purpose !== 'flexural' || !other.group) return hanger;
    if (other.group.diameterMm <= hanger.group.diameterMm) return hanger;
    const dia = other.group.diameterMm;
    return {
      ...hanger,
      group: { count: hanger.group.count, diameterMm: dia },
      asProvidedCm2: hanger.group.count * barAreaCm2(dia),
      note: `${hanger.note} Se dibuja Ø${dia} y no Ø${hanger.group.diameterMm}: el par corrido `
        + `es uno solo para toda la viga y lo gobierna la armadura resistente del apoyo `
        + `${otherSide}, de modo que ese apoyo no pierde área.`,
    };
  };
  return { start: adopt(start, end, 'j'), end: adopt(end, start, 'i') };
}
