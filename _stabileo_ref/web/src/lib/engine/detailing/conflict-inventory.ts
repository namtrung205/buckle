/**
 * An auditable inventory of the open conflicts. A report, not a verdict.
 *
 * ── The number this exists to make investigable ────────────────────
 *
 * `Edificio H.A. 7 pisos — PRO` closes its detailing run with roughly forty thousand open
 * conflicts. That number is unusable in both directions. Nobody can review forty thousand
 * items, and nobody can dismiss them either: somewhere inside is the handful that would stop
 * a cage being built, and there is no way to tell which without a way to sort them.
 *
 * The temptation is to make the number smaller — raise a tolerance, exempt a pair class,
 * suppress the marginal ones. Every one of those is a change to what the app CLAIMS about
 * constructibility, made to improve a statistic. So none of them is made here.
 *
 * What is made here is the thing that has to come first: a classification, stated rule by
 * rule, that says what KIND each conflict is. It changes no verdict, moves no threshold,
 * hides nothing and resolves nothing. `openConflicts` is exactly as long after this module
 * runs as before it. What changes is that the forty thousand become a table an engineer can
 * work down, and that the question "which of these are real?" becomes answerable with
 * evidence rather than with an opinion.
 *
 * ── Why not reuse `PairClass` ──────────────────────────────────────
 *
 * `PairClass` answers "what geometric relationship is this pair in", which is what the
 * SPACING RULE needs to know. The audit asks a different question — "what should a reviewer
 * do about this item" — and the two do not map one to one. A `sameLayerSpacing` shortfall of
 * 1 mm and one of 40 mm are the same pair class and completely different reviews; an
 * `orthogonalCrossing` measured against a spacing rule is a measurement artefact whatever
 * its pair class says. So this is its own taxonomy, derived from the pair class and from the
 * measurement together, and every derivation is stated below and testable.
 *
 * Pure: no store, no runes, no i18n, no DOM.
 */

import type { OpenConflict } from './document-model';

/**
 * What a reviewer is looking at. Ordered by how much attention it needs, most first.
 *
 * Exactly one category per conflict — a conflict that could be two is assigned the first that
 * matches in this order, so the table has no double-counting and its totals add up to the
 * conflict count. `evidence` on each row says which rule fired, so an assignment can be
 * argued with rather than merely trusted.
 */
export type ConflictCategory =
  /** Bars whose surfaces interpenetrate. Physically unbuildable, whatever the class. */
  | 'interpenetration'
  /**
   * A shortfall against a spacing rule between bars that genuinely run alongside each other.
   * The category that means "this is a real detailing problem".
   */
  | 'realSpacing'
  /**
   * Bars that CROSS rather than run alongside, measured against a clear-spacing rule.
   *
   * The clause governs bars standing beside one another in a layer. Two bars crossing at an
   * angle are tied in contact, and the distance between them at the crossing is a projection
   * of two different things onto one number. Reported so it can be decided, not silently
   * exempted: only the app's own classifier says these are crossings, and the classifier can
   * be wrong.
   */
  | 'projection'
  /** Bars belonging to different members — a joint or support congestion question. */
  | 'crossFamily'
  /** Two pieces of one member's own cage. */
  | 'intraFamily'
  /**
   * Contact that the design intends: a stirrup holding the bars it confines, a lap.
   *
   * Present in the inventory even though contact is the point, because the classifier decided
   * it was intentional and that decision is worth auditing.
   */
  | 'intentional'
  /**
   * The governing clause is a normative question this app does not settle.
   *
   * `cageSpacing` and `crossMemberSpacing` are the two: CIRSOC states no minimum clear
   * distance between successive stirrups, and the rule for bars of different members meeting
   * at a joint is not one this app claims to have resolved.
   */
  | 'needsCodeDecision'
  /**
   * The same unordered bar pair reported more than once.
   *
   * Not assumed to be a bug. A pair CAN legitimately conflict at two distinct places along
   * its length. The rule below only flags repeats at nearly the same point, which is the case
   * that is much more likely to be one conflict counted twice.
   */
  | 'possibleDuplicate';

export const CONFLICT_CATEGORIES: readonly ConflictCategory[] = [
  'interpenetration', 'realSpacing', 'projection', 'crossFamily', 'intraFamily',
  'intentional', 'needsCodeDecision', 'possibleDuplicate',
];

/** Distance below which two reports of one pair are treated as the same place, m. */
export const DUPLICATE_RADIUS = 0.01;

export interface InventoryRow {
  category: ConflictCategory;
  /** The rule that assigned the category, in one phrase. Not user-facing prose. */
  evidence: string;
  assemblyId: string;
  barIds: [string, string];
  elementIds: number[];
  at: { x: number; y: number; z: number };
  clearance: number;
  required: number;
  shortfall: number;
  severity: OpenConflict['severity'];
  pairClass: string;
}

export interface CategorySummary {
  category: ConflictCategory;
  count: number;
  /** Distinct bars involved. A thousand conflicts over ten bars is a different problem. */
  bars: number;
  /** Distinct members involved. */
  members: number;
  /** Worst shortfall in the category, m. */
  worstShortfall: number;
  /** Median shortfall, m — a mean is dragged around by the tail. */
  medianShortfall: number;
  /**
   * The pair classes inside this category, commonest first.
   *
   * Added because the first run of this inventory over the flagship reported 38 486
   * interpenetrations with a MEDIAN shortfall of 4 mm across 12 183 bars. Thirty-eight
   * thousand independent detailing errors that all happen to be four millimetres is not what
   * that is; it is one or two systematic geometric causes repeated. The category alone cannot
   * say which, and the pair class is the first place to look — so the summary carries it
   * rather than making a reader re-derive it from forty thousand rows.
   */
  byPairClass: Array<{ pairClass: string; count: number; medianShortfall: number }>;
}

export interface ConflictInventory {
  rows: InventoryRow[];
  summary: CategorySummary[];
  /** Equal to `rows.length`. Stated so a reader can check nothing was dropped. */
  total: number;
  /**
   * The categories that describe an item a reviewer must resolve before building.
   *
   * NOT a filter applied to the list — the list keeps everything. This names which parts of
   * it block, so a report can say "of 40 065, these 7 246 block construction" without anybody
   * re-deriving the distinction.
   */
  blocking: readonly ConflictCategory[];
}

const BLOCKING: readonly ConflictCategory[] = ['interpenetration', 'realSpacing'];

/** Members owning family (slab/wall/footing) bars, keyed by bar id, when the caller knows. */
export interface InventoryContext {
  /** Bar id → the floor family that owns it, when one does. Frame steel has none. */
  familyOfBar?: ReadonlyMap<string, string>;
}

function unorderedKey(c: OpenConflict): string {
  const [a, b] = c.barIds;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function near(a: OpenConflict['at'], b: OpenConflict['at']): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= DUPLICATE_RADIUS;
}

/**
 * Classify one conflict.
 *
 * First match wins, in the declared order, so every conflict has exactly one category. The
 * `evidence` string names the rule that fired — it is a key for a human reading the table,
 * not a sentence for the UI.
 */
function categorise(
  c: OpenConflict, duplicate: boolean, ctx: InventoryContext,
): { category: ConflictCategory; evidence: string } {
  if (duplicate) {
    return { category: 'possibleDuplicate', evidence: `same pair within ${DUPLICATE_RADIUS * 1000} mm` };
  }
  if (c.severity === 'overlap' || c.clearance < 0) {
    return { category: 'interpenetration', evidence: `clearance ${(c.clearance * 1000).toFixed(1)} mm < 0` };
  }
  switch (c.pairClass) {
    case 'requiredContainment':
    case 'spliceLap':
      return { category: 'intentional', evidence: `pairClass ${c.pairClass}` };
    case 'orthogonalCrossing':
      return { category: 'projection', evidence: 'crossing bars measured against a clear-spacing rule' };
    case 'cageSpacing':
    case 'crossMemberSpacing':
      return { category: 'needsCodeDecision', evidence: `pairClass ${c.pairClass}` };
    default:
      break;
  }
  // Family vs frame, when the caller supplied the mapping. Without it the question cannot be
  // answered, and it is left to fall through to `realSpacing` rather than guessed at.
  const famA = ctx.familyOfBar?.get(c.barIds[0]);
  const famB = ctx.familyOfBar?.get(c.barIds[1]);
  if (famA !== undefined || famB !== undefined) {
    return famA === famB
      ? { category: 'intraFamily', evidence: `both bars in family ${famA}` }
      : { category: 'crossFamily', evidence: `families ${famA ?? 'frame'} / ${famB ?? 'frame'}` };
  }
  if (c.elementIds.length > 1) {
    return { category: 'crossFamily', evidence: `bars owned by members ${c.elementIds.join(', ')}` };
  }
  return {
    category: 'realSpacing',
    evidence: `${c.pairClass}: ${(c.clearance * 1000).toFixed(1)} mm against ${(c.required * 1000).toFixed(1)} mm`,
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

/**
 * Build the inventory.
 *
 * Every input conflict produces exactly one row. Nothing is filtered, merged or resolved —
 * `rows.length === conflicts.length` is asserted by the test suite, because a classifier that
 * quietly drops what it cannot classify is how forty thousand becomes a smaller and less
 * honest number.
 */
export function buildConflictInventory(
  conflicts: readonly OpenConflict[],
  ctx: InventoryContext = {},
): ConflictInventory {
  const seen = new Map<string, OpenConflict[]>();
  const rows: InventoryRow[] = [];

  for (const c of conflicts) {
    const key = unorderedKey(c);
    const before = seen.get(key) ?? [];
    const duplicate = before.some((p) => near(p.at, c.at));
    seen.set(key, [...before, c]);

    const { category, evidence } = categorise(c, duplicate, ctx);
    rows.push({
      category,
      evidence,
      assemblyId: c.assemblyId,
      barIds: [c.barIds[0], c.barIds[1]],
      elementIds: [...c.elementIds],
      at: { ...c.at },
      clearance: c.clearance,
      required: c.required,
      shortfall: c.shortfall,
      severity: c.severity,
      pairClass: c.pairClass,
    });
  }

  const summary: CategorySummary[] = [];
  for (const category of CONFLICT_CATEGORIES) {
    const mine = rows.filter((r) => r.category === category);
    if (mine.length === 0) continue;
    const bars = new Set<string>();
    const members = new Set<number>();
    for (const r of mine) {
      bars.add(r.barIds[0]); bars.add(r.barIds[1]);
      for (const id of r.elementIds) members.add(id);
    }
    const shortfalls = mine.map((r) => r.shortfall);
    const byClass = new Map<string, number[]>();
    for (const r of mine) byClass.set(r.pairClass, [...(byClass.get(r.pairClass) ?? []), r.shortfall]);
    summary.push({
      category,
      count: mine.length,
      bars: bars.size,
      members: members.size,
      worstShortfall: Math.max(...shortfalls),
      medianShortfall: median(shortfalls),
      byPairClass: [...byClass.entries()]
        .map(([pairClass, xs]) => ({ pairClass, count: xs.length, medianShortfall: median(xs) }))
        .sort((a, b) => b.count - a.count),
    });
  }

  return { rows, summary, total: rows.length, blocking: BLOCKING };
}

/** How many rows fall in a blocking category. The one number a report leads with. */
export function blockingCount(inv: ConflictInventory): number {
  return inv.summary
    .filter((s) => inv.blocking.includes(s.category))
    .reduce((n, s) => n + s.count, 0);
}
