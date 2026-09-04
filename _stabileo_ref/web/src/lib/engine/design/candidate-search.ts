/**
 * The bounded, deterministic candidate search.
 *
 * Every candidate is verified by the ADAPTER'S OWN authoritative verifier — the
 * same function the UI renders — so a "designed" member cannot have been certified
 * by a different standard than the one the engineer sees.
 *
 * Feasibility vs. exhaustion is decided honestly:
 *   - the whole code-permitted envelope was enumerated  → SECTION_INADEQUATE
 *   - a budget stopped the search first                  → SEARCH_EXHAUSTED (truncated)
 * We never claim infeasibility we did not establish (approved decision O1).
 *
 * Pure: no store access, no side effects, no timers beyond reading a clock.
 */

import type { DesignCodeAdapter } from './code-adapter';
import type { MemberContext } from './member-context';
import type { Candidate, CandidateFeedback } from './candidate-generator';
import { compareCandidates, compareFailures } from './objective';
import { rebarHash } from './rebar-hash';
import {
  assertOutcomeInvariants, tallyRunSummary,
  DESIGN_TARGET_UTILIZATION, UTILIZATION_CONVENTION,
  UTIL_FAIL_THRESHOLD, UTIL_EPSILON,
  type DesignAttempt, type DesignReason, type DesignRunSummary,
  type LimitingConstraint, type MemberDesignOutcome, type SearchStats,
} from './outcome';

export interface SearchBudget {
  /** Maximum candidates generated for one member. */
  maxCandidates: number;
  /** Maximum authoritative verifier calls for one member. */
  maxVerifierCalls: number;
}

/**
 * Per-member bounds are COUNT-BASED ONLY, never wall-clock.
 *
 * A time-based per-member cutoff makes the OUTCOME CLASS depend on machine load: the
 * same member could come back VERIFIED on an idle run and SEARCH_EXHAUSTED under a
 * busy test worker. That breaks the determinism contract, so wall-clock survives only
 * as a whole-run safety valve (`RunOptions.maxRunMs`), where its effect is confined to
 * `aborted` + `notReached` — both explicitly reported, never a silent verdict change.
 */
export const BEAM_BUDGET: SearchBudget = { maxCandidates: 240, maxVerifierCalls: 300 };
export const COLUMN_BUDGET: SearchBudget = { maxCandidates: 120, maxVerifierCalls: 150 };

export function budgetFor(ctx: MemberContext): SearchBudget {
  return ctx.elementType === 'column' ? COLUMN_BUDGET : BEAM_BUDGET;
}

/** Injected clock so tests are deterministic and the module stays pure-ish. */
export type Clock = () => number;
const defaultClock: Clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function attemptFrom(adapter: DesignCodeAdapter, ctx: MemberContext, c: Candidate): DesignAttempt {
  const verdict = adapter.verify(ctx, c.reinforcement);
  const failing = verdict.checks.filter(k => k.status === 'fail').length;
  const limiting = adapter.classifyFailure(verdict, ctx);
  return {
    candidate: c.reinforcement,
    verdict,
    worstUtilization: verdict.worstUtilization,
    failingCheckCount: failing,
    governing: limiting[0] ?? null,
    cost: c.meta.cost,
  };
}

/** True when a verdict is a genuine pass under the approved convention. */
export function isPassingVerdict(a: DesignAttempt): boolean {
  if (a.verdict.strengthCheckCount === 0) return false;   // nothing checked ≠ pass
  if (a.verdict.checks.some(c => c.status === 'fail')) return false;
  return a.worstUtilization <= UTIL_FAIL_THRESHOLD + UTIL_EPSILON;
}

/**
 * Design one member.
 *
 * Search shape: keep taking candidates while the generator escalates on feedback.
 * Collect ALL passing candidates (they are cheap once found — the generator stops
 * escalating a satisfied knob) and return the best by the staged objective. The
 * first pass is not automatically accepted, because the design target is 0.95 and a
 * slightly heavier candidate may reach it at no extra reinforcement step (O5).
 */
export function designMember(
  adapter: DesignCodeAdapter,
  ctx: MemberContext,
  opts: { budget?: SearchBudget; clock?: Clock } = {},
): MemberDesignOutcome {
  const clock = opts.clock ?? defaultClock;
  const t0 = clock();
  const budget = opts.budget ?? budgetFor(ctx);
  const prov = adapter.provenance();
  const base = {
    elementId: ctx.elementId,
    elementType: ctx.elementType,
    codeId: prov.codeId,
    codeVersion: prov.codeVersion,
    axes: ctx.axes,
  };
  const stats = (candidatesTried: number, verifierCalls: number, truncated: boolean, envelopeExhausted: boolean): SearchStats => ({
    candidatesTried, verifierCalls, ms: +(clock() - t0).toFixed(3), truncated, envelopeExhausted,
  });

  const finish = (o: MemberDesignOutcome): MemberDesignOutcome => {
    assertOutcomeInvariants(o);
    return o;
  };

  // ── 1. Capability gate ──
  const unsupported = adapter.unsupported(ctx);
  if (unsupported.length > 0) {
    /**
     * A beam refused ONLY for biaxial bending gets a proposal instead of nothing.
     *
     * ── What the refusal was, and why it stays ─────────────────────
     *
     * On `Edificio H.A. 7 pisos — PRO` this gate refuses 117 of 119 beams. Every refusal is
     * correct: `resolveDesignAxes` measures a secondary moment above the 10 % threshold, and
     * no verifier in this app evaluates a beam's secondary axis. Certifying would pass a
     * member whose significant secondary bending nobody checked, and that has not changed.
     *
     * What HAD to change is the consequence. A refusal designed nothing at all, so those 117
     * beams had no reinforcement in the model, no bars in the document, no steel in the 3-D
     * view and no rows on any schedule — bare orange concrete, with the explanation available
     * only to a reviewer who clicked into a status panel. The engineer could not see what
     * their building would need, could not size anything from it, and had nothing to design
     * the secondary axis ON TOP of by hand.
     *
     * ── What the proposal is ───────────────────────────────────────
     *
     * The ordinary bounded search, run against the PRIMARY axis, with nothing else altered:
     * the threshold is untouched, the verifier is untouched, every check that does run runs
     * in full, and no capacity is invented for the axis nobody checks. The context handed to
     * it is this one with `axes.biaxial` cleared — which is exactly the statement "design
     * this as the uniaxial beam it is about its primary axis", made once, in one place, so
     * that it cannot be mistaken for a lowered threshold.
     *
     * The result is returned as PROVISIONAL_BIAXIAL: geometry in the `provisional` field,
     * which the invariants already forbid from carrying a certificate, plus a
     * `ProvisionalBasis` naming the unchecked axis, its size in kN·m, the combination that
     * governs it and the method used. It cannot be counted as a pass, and it cannot satisfy
     * the constructibility gate, which counts certificates.
     *
     * ── Why not real biaxial design ────────────────────────────────
     *
     * Audited before this was written; the answer is `docs/audits/biaxial-beam-design.md`.
     * Briefly: a beam's reinforcement model has no side-face bars, in the schema, the
     * generator, the geometry, the drawings or the schedule — so a weak-axis check that
     * FAILED would leave the search no knob to turn. Bresler is formulated in 1/Pn and is
     * unusable at N≈0. Two-way shear on a beam is not implemented. And in this very
     * population the median torsion (1,33 kN·m) exceeds the median secondary moment
     * (1,00 kN·m) while torsion is not verified at all, so certifying these members would
     * move the false pass rather than remove it.
     */
    if (unsupported.length === 1 && unsupported[0] === 'biaxial' && ctx.elementType !== 'column') {
      const proposal = proposeOnPrimaryAxis(adapter, ctx, opts, base, clock, t0);
      if (proposal) return finish(proposal);
    }
    /**
     * Name the biaxial refusal specifically, because it is actionable and the generic one
     * is not.
     *
     * "Member 19 is not supported by CIRSOC 201-2025" is true and leads nowhere. The
     * secondary-axis refusal has a cause the engineer can see in their own model — a beam
     * carrying real bending about both axes — and a remedy that is theirs to choose: brace
     * it, re-orient it, or design that axis by hand. Telling them the ratio is what makes
     * the difference between a dead end and a decision.
     */
    const biaxial = unsupported.includes('biaxial');
    return finish({
      ...base, outcome: 'UNSUPPORTED', limiting: unsupported,
      reasons: [biaxial
        ? {
          key: 'design.reason.secondaryAxisUnchecked',
          params: {
            elementId: ctx.elementId,
            percent: Math.round((ctx.axes?.secondaryRatio ?? 0) * 100),
            secondary: ctx.axes?.secondaryFlexure ?? '',
            primary: ctx.axes?.flexure ?? '',
          },
        }
        : { key: 'design.reason.memberUnsupported', params: { elementId: ctx.elementId, code: adapter.name } }],
      searchStats: stats(0, 0, false, false),
    });
  }

  // ── 2. Input validation (combinations, forces, section, material) ──
  const iv = adapter.validateInputs(ctx);
  if (!iv.ok) {
    const onlyUnsupported = iv.blocking.every(b => b === 'unsupportedCheck');
    return finish({
      ...base,
      outcome: onlyUnsupported ? 'UNSUPPORTED' : 'DEMAND_UNAVAILABLE',
      limiting: iv.blocking,
      reasons: iv.reasons.length > 0 ? iv.reasons : [{ key: 'design.reason.missingDemand', params: { elementId: ctx.elementId } }],
      searchStats: stats(0, 0, false, false),
    });
  }

  // ── 3. Orientation refusal (approved decision O6) ──
  if (ctx.orientationSuspect) {
    return finish({
      ...base, outcome: 'SEARCH_EXHAUSTED', limiting: ['memberOrientationSuspect'],
      reasons: [{ key: 'design.reason.orientationSuspect', params: { elementId: ctx.elementId } }],
      searchStats: stats(0, 0, false, false),
    });
  }

  // ── 4. Bounded search ──
  const gen = adapter.createGenerator(ctx);
  if (!gen) {
    return finish({
      ...base, outcome: 'UNSUPPORTED', limiting: ['unsupportedCheck'],
      reasons: [{ key: 'design.reason.noGenerator', params: { elementId: ctx.elementId, code: adapter.name } }],
      searchStats: stats(0, 0, false, false),
    });
  }

  const passing: Array<{ attempt: DesignAttempt; index: number; cost: DesignAttempt['cost'] }> = [];
  let bestFailure: { attempt: DesignAttempt; index: number } | null = null;
  let tried = 0;
  let verifierCalls = 0;
  let truncated = false;
  let feedback: CandidateFeedback | null = null;

  for (;;) {
    if (tried >= budget.maxCandidates || verifierCalls >= budget.maxVerifierCalls) { truncated = true; break; }
    const cand = gen.next(feedback);
    if (!cand) break;
    tried++;
    const attempt = attemptFrom(adapter, ctx, cand);
    verifierCalls++;
    if (isPassingVerdict(attempt)) {
      passing.push({ attempt, index: cand.meta.index, cost: attempt.cost });
      // Stop escalating once the design target is met — heavier candidates cannot
      // improve the staged objective (they cost more steel at equal constructability).
      if (attempt.worstUtilization <= DESIGN_TARGET_UTILIZATION + UTIL_EPSILON) break;
    } else if (!bestFailure || compareFailures(
      { ...attempt, index: cand.meta.index },
      { ...bestFailure.attempt, index: bestFailure.index },
    ) < 0) {
      bestFailure = { attempt, index: cand.meta.index };
    }
    feedback = {
      verdict: attempt.verdict,
      worstUtilization: attempt.worstUtilization,
      limiting: adapter.classifyFailure(attempt.verdict, ctx),
    };
  }

  const envelopeExhausted = gen.envelopeExhausted && !truncated;

  // ── 5. Best passing candidate wins ──
  if (passing.length > 0) {
    passing.sort((a, b) => compareCandidates(a, b));
    const win = passing[0].attempt;
    const certificate = {
      verifierId: prov.verifierId,
      codeId: prov.codeId,
      codeVersion: prov.codeVersion,
      analysisRevision: ctx.analysisRevision,
      demandRevision: ctx.demandRevision,
      rebarHash: rebarHash(win.candidate),
      worstUtilization: +win.worstUtilization.toFixed(4),
      designTarget: DESIGN_TARGET_UTILIZATION,
      checkCount: win.verdict.strengthCheckCount,
      checkedAxes: [...win.verdict.checkedAxes],
      axisBasis: ctx.axes.basis,
      utilizationConvention: UTILIZATION_CONVENTION,
    };
    return finish({
      ...base, outcome: 'VERIFIED',
      accepted: win.candidate, certificate,
      limiting: [], reasons: [],
      searchStats: stats(tried, verifierCalls, truncated, envelopeExhausted),
    });
  }

  // ── 6. Nothing passed — classify honestly ──
  const limiting: LimitingConstraint[] = bestFailure
    ? adapter.classifyFailure(bestFailure.attempt.verdict, ctx)
    : ['searchBudget'];
  if (truncated && !limiting.includes('searchBudget')) limiting.push('searchBudget');
  if (limiting.length === 0) limiting.push('searchBudget');

  const reasons: DesignReason[] = [];
  if (bestFailure) {
    reasons.push({
      key: 'design.reason.bestCandidateFails',
      params: {
        elementId: ctx.elementId,
        utilization: Number.isFinite(bestFailure.attempt.worstUtilization)
          ? +bestFailure.attempt.worstUtilization.toFixed(2) : '∞',
        failing: bestFailure.attempt.failingCheckCount,
        governing: bestFailure.attempt.governing ?? '—',
      },
    });
  }
  if (truncated) reasons.push({ key: 'design.reason.searchTruncated', params: { tried, elementId: ctx.elementId } });
  if (reasons.length === 0) reasons.push({ key: 'design.reason.noCandidate', params: { elementId: ctx.elementId } });

  const advice = envelopeExhausted ? adapter.recommendSection(ctx, limiting) : undefined;

  // The envelope was fully enumerated and nothing fits/verifies → the section, not
  // the reinforcement, is the limit. Requires a recommendation to be honest.
  if (envelopeExhausted && advice) {
    return finish({
      ...base, outcome: 'SECTION_INADEQUATE',
      provisional: bestFailure?.attempt,
      limiting, reasons, sectionAdvice: advice,
      searchStats: stats(tried, verifierCalls, truncated, true),
    });
  }

  return finish({
    ...base, outcome: 'SEARCH_EXHAUSTED',
    provisional: bestFailure?.attempt,
    limiting, reasons,
    sectionAdvice: advice ?? undefined,
    // Never report envelopeExhausted on a SEARCH_EXHAUSTED result: the invariant
    // guard treats that combination as a contract violation.
    searchStats: stats(tried, verifierCalls, truncated, false),
  });
}

/**
 * Design the primary axis of a beam the biaxial gate refused, and return it as a PROPOSAL.
 *
 * Returns null when the primary axis cannot be designed either. A member that has nothing to
 * propose is a refusal, and it is reported as one — inventing a proposal out of a failed
 * search would be the dishonesty this whole state exists to avoid.
 *
 * The recursion terminates: the context handed down has `axes.biaxial === false`, so
 * `adapter.unsupported` cannot return `['biaxial']` for it and this branch is not re-entered.
 */
function proposeOnPrimaryAxis(
  adapter: DesignCodeAdapter,
  ctx: MemberContext,
  opts: { budget?: SearchBudget; clock?: Clock },
  base: Pick<MemberDesignOutcome, 'elementId' | 'elementType' | 'codeId' | 'codeVersion' | 'axes'>,
  clock: Clock,
  t0: number,
): MemberDesignOutcome | null {
  const primaryCtx: MemberContext = { ...ctx, axes: { ...ctx.axes, biaxial: false } };
  const inner = designMember(adapter, primaryCtx, opts);
  if (inner.outcome !== 'VERIFIED' || !inner.accepted || !inner.certificate) return null;

  const axes = ctx.axes;
  const secondaryPeak = peakFor(ctx, axes.secondaryFlexure);

  /**
   * The verdict recorded is the REAL one, re-read from the verifier against the member as it
   * actually is — biaxial flag and all — not the primary-axis run's certificate wearing a
   * different type. So `provisional.verdict.checks` holds the biaxial refusal alongside the
   * primary-axis checks that passed, and a panel rendering it shows both without this
   * function having to summarise either.
   */
  const verdict = adapter.verify(ctx, inner.accepted);
  return {
    ...base,
    outcome: 'PROVISIONAL_BIAXIAL',
    // The geometry, in the field that by contract cannot be certified.
    provisional: {
      candidate: inner.accepted,
      verdict,
      worstUtilization: verdict.worstUtilization,
      failingCheckCount: verdict.checks.filter((c) => c.status === 'fail').length,
      governing: 'biaxial',
      cost: { layers: 0, distinctDiameters: 0, nonStandardSteps: 0, steelMassKg: 0,
        congestion: 0, arrangementCount: 0, spacingPracticality: 0, weighted: 0 },
    },
    provisionalBasis: {
      method: 'primaryAxisDesign',
      designedAxis: axes.flexure,
      designedShear: axes.shear,
      uncheckedAxis: axes.secondaryFlexure,
      uncheckedShear: axes.secondaryShear,
      secondaryRatio: axes.secondaryRatio,
      primaryMoment: +peakFor(ctx, axes.flexure).value.toFixed(2),
      secondaryMoment: +secondaryPeak.value.toFixed(2),
      secondaryCombo: secondaryPeak.combo,
      primaryUtilization: inner.certificate.worstUtilization,
      checkedAxes: [...inner.certificate.checkedAxes],
    },
    limiting: ['biaxial'],
    reasons: [
      {
        key: 'design.reason.provisionalBiaxial',
        params: {
          elementId: ctx.elementId,
          designed: axes.flexure,
          unchecked: axes.secondaryFlexure,
          uncheckedShear: axes.secondaryShear,
          secondary: +secondaryPeak.value.toFixed(2),
          primary: +peakFor(ctx, axes.flexure).value.toFixed(2),
          percent: Math.round(axes.secondaryRatio * 100),
        },
      },
      {
        key: 'design.reason.secondaryAxisUnchecked',
        params: {
          elementId: ctx.elementId,
          percent: Math.round(axes.secondaryRatio * 100),
          secondary: axes.secondaryFlexure,
          primary: axes.flexure,
        },
      },
    ],
    searchStats: {
      ...inner.searchStats,
      ms: +(clock() - t0).toFixed(3),
    },
  };
}

/** Peak |M| about one axis, with the combination that governs it. */
function peakFor(ctx: MemberContext, axis: 'My' | 'Mz'): { value: number; combo: string | null } {
  const demands = ctx.demands?.demands ?? [];
  let best: { value: number; combo: string | null } = { value: 0, combo: null };
  for (const d of demands) {
    if (d.category !== `${axis}+` && d.category !== `${axis}-`) continue;
    if (d.absValue > best.value) best = { value: d.absValue, combo: d.comboName };
  }
  return best;
}

export interface RunProgress {
  done: number;
  total: number;
  verified: number;
  elementId: number;
}

export interface RunOptions {
  budget?: SearchBudget;
  clock?: Clock;
  /** Cooperative cancellation. */
  signal?: { aborted: boolean };
  /** Wall-clock cap for the whole run (ms). */
  maxRunMs?: number;
  /** Called every `progressEvery` members. */
  onProgress?: (p: RunProgress) => void;
  progressEvery?: number;
}

export const DEFAULT_RUN_MS = 20_000;

/**
 * Design many members. Honest about partial runs: members not reached are counted
 * in `notReached` and the summary is flagged `aborted`.
 */
export function runDesign(
  adapter: DesignCodeAdapter,
  contexts: Iterable<MemberContext>,
  opts: RunOptions = {},
): DesignRunSummary {
  const clock = opts.clock ?? defaultClock;
  const t0 = clock();
  const maxRunMs = opts.maxRunMs ?? DEFAULT_RUN_MS;
  const every = Math.max(1, opts.progressEvery ?? 25);
  const list = [...contexts].sort((a, b) => a.elementId - b.elementId);
  const outcomes: MemberDesignOutcome[] = [];
  let aborted = false;

  for (let i = 0; i < list.length; i++) {
    if (opts.signal?.aborted) { aborted = true; break; }
    if (clock() - t0 > maxRunMs) { aborted = true; break; }
    const ctx = list[i];
    outcomes.push(designMember(adapter, ctx, { budget: opts.budget, clock }));
    if (opts.onProgress && ((i + 1) % every === 0 || i === list.length - 1)) {
      opts.onProgress({
        done: i + 1, total: list.length,
        verified: outcomes.reduce((n, o) => n + (o.outcome === 'VERIFIED' ? 1 : 0), 0),
        elementId: ctx.elementId,
      });
    }
  }

  const prov = adapter.provenance();
  return tallyRunSummary(
    prov.codeId, prov.codeVersion, outcomes,
    +(clock() - t0).toFixed(3), aborted, list.length - outcomes.length,
  );
}
