<script lang="ts">
  /**
   * Torsional shear — which theory applies, and what it gives.
   *
   * Until now a torque produced a number inside the total shear and nothing
   * else: no way to see how much of tau came from twisting, and no statement of
   * WHICH theory produced it. That last part is not a detail. Three different
   * theories apply depending on whether the wall is solid, closed or open, they
   * disagree by orders of magnitude, and the section's appearance does not tell
   * you which one you are in.
   *
   * So the theory is named on screen rather than applied silently, and where
   * the section is closed the panel also states what slitting it would cost —
   * the one comparison that makes the distinction concrete.
   */
  import type { ResolvedSection } from '../../lib/engine/section-stress';
  import { computeTorsionFlow, closedVersusOpen, compareTorsionTheories } from '../../lib/engine/torsion-flow';
  import { warpingProperties, withLambda, warpingResponse } from '../../lib/engine/warping';
  import { t } from '../../lib/i18n';
  import { fmt } from './fmt';

  interface Props {
    showTorsion: boolean;
    /** Torque at the station, kN·m. */
    torque: number;
    resolved: ResolvedSection | undefined;
    /** Member length, metres — warping depends on it, the section alone does not. */
    length: number;
    /**
     * Young's modulus, MPa. Omitted when the material does not carry one: the
     * warping rows then render as unavailable rather than computed from a
     * guessed steel value — the panel's policy is to omit, not to assume.
     */
    e?: number;
    nu: number;
  }

  let { showTorsion = $bindable(), torque, resolved, length, e, nu }: Props = $props();

  const flow = $derived(resolved ? computeTorsionFlow(torque, resolved) : null);
  const slitPenalty = $derived(resolved ? closedVersusOpen(resolved) : null);

  /**
   * All three theories, applicable or not.
   *
   * Shown together rather than one at a time because they are conceptually
   * different models of the same twist that give different numbers, and a
   * reader who only sees the winner has no way to know how much the choice
   * mattered — or that using Bredt on an open section, which looks perfectly
   * reasonable on paper, is wrong by two orders of magnitude.
   */
  const theories = $derived(resolved ? compareTorsionTheories(torque, resolved) : []);
  const governingTau = $derived(theories.find((th) => th.governs)?.tauMax ?? null);

  const FORMULA: Record<string, string> = {
    cauchy: 'stress.tt.formulaCauchy',
    bredt: 'stress.tt.formulaBredt',
    saintVenant: 'stress.tt.formulaSV',
  };

  /**
   * Warping — the other mechanism, and the one whose omission is not
   * conservative. Which end restraint applies is a property of the STRUCTURE,
   * not of the section, so it is a control rather than an assumption.
   */
  let restraint = $state<'cantilever' | 'simple'>('cantilever');
  const warp = $derived(resolved && e !== undefined ? withLambda(warpingProperties(resolved), e, nu) : null);
  const response = $derived(
    resolved && warp && e !== undefined ? warpingResponse(resolved, warp, torque, length, e, restraint, nu) : null,
  );
</script>

<button class="ssp-section-toggle" onclick={() => showTorsion = !showTorsion}>
  <span class="ssp-chevron">{showTorsion ? '▾' : '▸'}</span>
  {t('stress.torsion')}
  <span class="ssp-help ssp-help-inline" title={t('stress.torsionHelp')}>?</span>
</button>

{#if showTorsion}
  {#if !flow}
    <!-- No torque is a state worth naming: it is the common case, and an empty
         panel would read as a failure to compute rather than as nothing to
         report. -->
    <p class="ssp-tor-empty">{t('stress.torsionNone')}</p>
  {:else}
    <div class="ssp-tor">
      <div class="ssp-tor-theory">
        <span class="ssp-tor-badge">{t(flow.labelKey)}</span>
      </div>
      <div class="ssp-tor-row">
        <span class="ssp-tor-label">T</span>
        <span class="ssp-tor-val">{fmt(Math.abs(torque))}<span class="ssp-tor-unit">kN·m</span></span>
      </div>
      <div class="ssp-tor-row ssp-tor-peak">
        <span class="ssp-tor-label">&tau;<sub>max</sub></span>
        <span class="ssp-tor-val">{fmt(flow.tauMax)}<span class="ssp-tor-unit">MPa</span></span>
      </div>
      <div class="ssp-tor-row">
        <span class="ssp-tor-label">J</span>
        <!-- In cm⁴, the unit every profile table uses. -->
        <span class="ssp-tor-val">{fmt(flow.j * 1e8)}<span class="ssp-tor-unit">cm⁴</span></span>
      </div>

      <p class="ssp-tor-note">{t(`${flow.labelKey}Note`)}</p>

      <!-- ── The three theories, side by side ──────────────────
           Each row carries its own formula, the quantities that go into it and
           a note saying why it applies here or why it does not. The "does not"
           rows are the point of the table as much as the others. -->
      <div class="ssp-tt">
        <div class="ssp-tt-head">
          {t('stress.tt.title')}
          <span class="ssp-help ssp-help-inline" title={t('stress.tt.help')}>?</span>
        </div>
        {#each theories as th}
          <div class="ssp-tt-row" class:na={!th.applies} class:governs={th.governs}>
            <div class="ssp-tt-top">
              <span class="ssp-tt-name">{t(`stress.tt.${th.id}`)}</span>
              <span class="ssp-tt-formula">{t(FORMULA[th.id])}</span>
              {#if th.governs}<span class="ssp-tt-badge">{t('stress.tt.governs')}</span>{/if}
            </div>
            {#if th.applies && th.tauMax !== null}
              <div class="ssp-tt-value">
                <span class="ssp-tt-tau">&tau;<sub>max</sub> = {fmt(th.tauMax)}<span class="ssp-tor-unit">MPa</span></span>
                {#if !th.governs && governingTau && governingTau > 1e-9}
                  <!-- The gap is the teaching: two valid theories, one section,
                       different answers. -->
                  <span class="ssp-tt-delta">
                    {t('stress.tt.vsGoverning').replace('{pct}', (th.tauMax / governingTau * 100).toFixed(0))}
                  </span>
                {/if}
              </div>
              {#if th.terms.length}
                <div class="ssp-tt-terms">
                  {#each th.terms as term}
                    <span class="ssp-tt-term">{term.symbol} = {fmt(term.value)} {term.unit}</span>
                  {/each}
                </div>
              {/if}
            {:else}
              <div class="ssp-tt-value ssp-tt-na">{t('stress.tt.na')}</div>
            {/if}
            <p class="ssp-tt-why">{t(th.reasonKey)}</p>
          </div>
        {/each}
      </div>

      <!-- ── Warping ────────────────────────────────────────────
           Inside Torsion because it IS torsion: the same torque, carried by a
           second mechanism whose share depends on the member's length. -->
      {#if warp && warp.cw > 0}
        <div class="ssp-tor-warp">
          <div class="ssp-tor-warp-head">{t('warp.title')}</div>
          <div class="ssp-tor-row">
            <span class="ssp-tor-label">C<sub>w</sub></span>
            <span class="ssp-tor-val">
              {fmt(warp.cw * 1e12)}<span class="ssp-tor-unit">cm⁶</span>
              {#if warp.fidelity === 'thinWall'}
                <span class="ssp-tor-approx" title={t('warp.thinWallHelp')}>≈</span>
              {/if}
            </span>
          </div>
          {#if warp.lambda}
            <div class="ssp-tor-row">
              <span class="ssp-tor-label">&lambda; = &radic;(EC<sub>w</sub>/GJ)</span>
              <span class="ssp-tor-val">{fmt(warp.lambda)}<span class="ssp-tor-unit">m</span></span>
            </div>
            <div class="ssp-tor-row">
              <span class="ssp-tor-label">L / &lambda;</span>
              <span class="ssp-tor-val">{fmt(length / warp.lambda)}</span>
            </div>
          {/if}

          {#if response}
            <!-- End restraint: it changes the answer, so it is asked rather
                 than assumed. -->
            <div class="ssp-tor-restraint">
              <button
                class="ssp-tor-rtab" class:active={restraint === 'cantilever'}
                onclick={() => restraint = 'cantilever'}
              >{t('warp.case.cantilever')}</button>
              <button
                class="ssp-tor-rtab" class:active={restraint === 'simple'}
                onclick={() => restraint = 'simple'}
              >{t('warp.case.simple')}</button>
            </div>

            <!-- How the torque actually splits. This is the number that makes
                 the distinction concrete. -->
            {@const sv = Math.round(response.saintVenantShare * 100)}
            <div class="ssp-tor-split" title={t('warp.splitHelp')}>
              <div class="ssp-tor-bar">
                <div class="ssp-tor-sv" style="width:{sv}%"></div>
              </div>
              <div class="ssp-tor-legend">
                <span>{t('warp.bySaintVenant').replace('{pct}', String(sv))}</span>
                <span>{t('warp.byWarping').replace('{pct}', String(100 - sv))}</span>
              </div>
            </div>

            <div class="ssp-tor-row ssp-tor-peak">
              <span class="ssp-tor-label">&sigma;<sub>w</sub></span>
              <span class="ssp-tor-val">{fmt(response.sigmaW)}<span class="ssp-tor-unit">MPa</span></span>
            </div>
            <p class="ssp-tor-note ssp-tor-warn">{t('warp.addsToBending')}</p>
          {/if}
          <p class="ssp-tor-note">{t(warp.labelKey + 'Note')}</p>
        </div>
      {:else if resolved && e === undefined}
        <!-- Warping needs E and the material does not carry one. Stated as
             unavailable — the same "we decline" row the theory table uses —
             rather than silently computed from a guessed steel modulus. -->
        <div class="ssp-tor-warp">
          <div class="ssp-tor-warp-head">{t('warp.title')}</div>
          <div class="ssp-tt-value ssp-tt-na">{t('warp.noModulus')}</div>
        </div>
      {/if}

      {#if slitPenalty !== null}
        <!-- The single most instructive number here: same wall, same area, same
             bending inertia, and a factor of hundreds in torsion. -->
        <p class="ssp-tor-slit">
          {t('stress.torsionSlit').replace('{factor}', slitPenalty.toFixed(0))}
        </p>
      {/if}
    </div>
  {/if}
{/if}

<style>
  /* ── The three-theory table ─────────────────────────────────
     Rows that do not apply are dimmed rather than hidden: "Bredt does not
     apply here, and here is why" is information, and hiding it is how a reader
     ends up applying it anyway. */
  .ssp-tt {
    margin-top: 0.6rem;
    border-top: 1px solid var(--st-hair);
    padding-top: 0.5rem;
  }

  .ssp-tt-head {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--st-text-3);
    margin-bottom: 0.35rem;
  }

  .ssp-tt-row {
    padding: 0.4rem 0.5rem;
    margin-bottom: 0.3rem;
    border-left: 2px solid var(--st-hair);
    background: rgba(255, 255, 255, 0.02);
  }

  .ssp-tt-row.governs { border-left-color: var(--st-accent); }
  .ssp-tt-row.na { opacity: 0.55; }

  .ssp-tt-top {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .ssp-tt-name { font-size: 0.78rem; color: var(--st-text); }
  .ssp-tt-formula { font-size: 0.7rem; color: var(--st-text-3); font-family: ui-monospace, monospace; }

  .ssp-tt-badge {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--st-accent);
    border: 1px solid var(--st-accent);
    border-radius: 2px;
    padding: 0 0.25rem;
  }

  .ssp-tt-value {
    margin-top: 0.2rem;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .ssp-tt-tau { font-size: 0.85rem; color: var(--st-value); }
  .ssp-tt-delta { font-size: 0.66rem; color: var(--st-text-3); }
  .ssp-tt-na { font-size: 0.72rem; color: var(--st-text-3); font-style: italic; }

  .ssp-tt-terms {
    margin-top: 0.15rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .ssp-tt-term { font-size: 0.66rem; color: var(--st-text-2); font-family: ui-monospace, monospace; }

  .ssp-tt-why {
    margin: 0.25rem 0 0;
    font-size: 0.68rem;
    line-height: 1.35;
    color: var(--st-text-3);
  }

  .ssp-section-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 0;
    background: none;
    border: none;
    color: var(--st-text-3);
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    cursor: pointer;
    border-bottom: 1px solid rgba(26, 74, 122, 0.3);
  }
  .ssp-section-toggle:hover { color: var(--st-text-2); }
  .ssp-chevron { font-size: 0.6rem; width: 10px; }

  .ssp-tor { padding: 5px 0 8px; }
  .ssp-tor-empty {
    margin: 6px 0 8px;
    font-size: 0.65rem;
    color: var(--st-text-3);
    line-height: 1.45;
  }
  .ssp-tor-theory { margin-bottom: 5px; }
  .ssp-tor-badge {
    display: inline-block;
    padding: 2px 7px;
    border-radius: 3px;
    background: rgba(127, 212, 204, 0.14);
    border: 1px solid rgba(127, 212, 204, 0.35);
    color: var(--st-value);
    font-size: 0.62rem;
  }
  .ssp-tor-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 6px;
    font-size: 0.68rem;
    color: var(--st-text-2);
  }
  .ssp-tor-label { color: var(--st-text-3); flex: none; }
  .ssp-tor-val { font-family: 'Courier New', monospace; text-align: right; }
  .ssp-tor-unit { color: var(--st-text-3); opacity: 0.7; margin-left: 3px; font-size: 0.9em; }
  .ssp-tor-peak .ssp-tor-val { color: var(--st-value); font-weight: 600; }
  .ssp-tor-note {
    margin: 6px 0 0;
    font-size: 0.58rem;
    line-height: 1.45;
    color: var(--st-text-3);
  }
  .ssp-tor-warp {
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px solid rgba(26, 74, 122, 0.3);
  }
  .ssp-tor-warp-head {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--st-text-3);
    margin-bottom: 4px;
  }
  .ssp-tor-approx { color: var(--st-text-3); cursor: help; margin-left: 2px; }
  .ssp-tor-restraint { display: flex; gap: 3px; margin: 6px 0 5px; }
  .ssp-tor-rtab {
    flex: 1;
    padding: 2px 4px;
    border-radius: 3px;
    border: 1px solid rgba(127, 212, 204, 0.25);
    background: none;
    color: var(--st-text-3);
    font-size: 0.56rem;
    cursor: pointer;
  }
  .ssp-tor-rtab.active {
    background: rgba(127, 212, 204, 0.14);
    border-color: var(--st-value);
    color: var(--st-value);
  }
  .ssp-tor-split { margin: 5px 0; }
  /* Two mechanisms sharing one torque: a single bar says that better than two
     numbers, because the point is that they add to a whole. */
  .ssp-tor-bar {
    height: 6px;
    border-radius: 3px;
    overflow: hidden;
    background: var(--st-warn);
  }
  .ssp-tor-sv { height: 100%; background: var(--st-value); }
  .ssp-tor-legend {
    display: flex;
    justify-content: space-between;
    margin-top: 2px;
    font-size: 0.55rem;
    color: var(--st-text-3);
  }
  .ssp-tor-legend span:first-child { color: var(--st-value); }
  .ssp-tor-legend span:last-child { color: var(--st-warn); }
  .ssp-tor-warn { color: var(--st-warn); opacity: 0.95; }

  .ssp-tor-slit {
    margin: 6px 0 0;
    padding: 5px 7px;
    border-radius: 3px;
    background: rgba(255, 140, 0, 0.08);
    border-left: 2px solid var(--st-warn);
    font-size: 0.6rem;
    line-height: 1.45;
    color: var(--st-text-2);
  }

  .ssp-help {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: rgba(127, 212, 204, 0.12);
    color: var(--st-value);
    font-size: 0.5rem;
    font-weight: 700;
    cursor: help;
    flex-shrink: 0;
    border: 1px solid rgba(127, 212, 204, 0.25);
    opacity: 0.6;
    font-style: normal;
    line-height: 1;
  }
  .ssp-help:hover { opacity: 1; }
  .ssp-help-inline { margin-left: auto; }
</style>
