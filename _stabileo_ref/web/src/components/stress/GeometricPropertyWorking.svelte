<script lang="ts">
  /**
   * The centroid and the shear centre, worked out rather than asserted.
   *
   * Both already appear as numbers elsewhere in this panel. What was missing is
   * the derivation — and for these two properties the derivation IS the
   * content: they are what a student is asked to find by hand, and an answer
   * with no working teaches nothing except that the software knows.
   *
   * The centroid gets the table it gets on paper — parts, areas, lever arms,
   * products — because that layout is the method. The shear centre gets an
   * argument instead, because there is no single formula: which rule applies
   * depends on the section's symmetry, and knowing WHICH rule is the lesson.
   *
   * The hand result is compared against the engine's own and the discrepancy
   * shown rather than hidden. A decomposition into rectangles ignores root
   * fillets, so on a rolled profile the two differ slightly — and a student who
   * is told the hand method is exact has been taught something false.
   */
  import type { ResolvedSection } from '../../lib/engine/section-stress';
  import { centroidWorking, shearCentreWorking } from '../../lib/engine/section-teaching';
  import { t } from '../../lib/i18n';
  import { fmt } from './fmt';

  interface Props {
    showCentroidWork: boolean;
    showShearCentreWork: boolean;
    resolved: ResolvedSection | undefined;
    /** The engine's shear centre, centroid-relative [z, y] in metres. */
    engineShearCentre: [number, number] | null;
  }

  let {
    showCentroidWork = $bindable(),
    showShearCentreWork = $bindable(),
    resolved,
    engineShearCentre,
  }: Props = $props();

  const work = $derived(resolved ? centroidWorking(resolved) : null);
  const sc = $derived(resolved ? shearCentreWorking(resolved) : null);

  /** mm, for a table where every length is small. */
  const mm = (v: number) => fmt(v * 1000, 1);
  /** cm², the unit a profile table uses for area. */
  const cm2 = (v: number) => fmt(v * 1e4, 2);
  /** cm³, for first moments. */
  const cm3 = (v: number) => fmt(v * 1e6, 1);
</script>

<!-- ── Centroid ─────────────────────────────────────────────── -->
<button class="ssp-section-toggle" onclick={() => showCentroidWork = !showCentroidWork}>
  <span class="ssp-chevron">{showCentroidWork ? '▾' : '▸'}</span>
  {t('teach.centroidTitle')}
  <span class="ssp-help ssp-help-inline" title={t('teach.centroidHelp')}>?</span>
</button>

{#if showCentroidWork && work}
  <div class="tw">
    <p class="tw-lead">{t('teach.centroidLead')}</p>

    {#if work.bySymmetry.horizontal || work.bySymmetry.vertical}
      <!-- Symmetry settles an axis without any arithmetic, and saying so is
           part of the method: the calculation below only has to find what
           symmetry does not already give. -->
      <p class="tw-sym">
        {work.bySymmetry.horizontal && work.bySymmetry.vertical
          ? t('teach.symBoth')
          : work.bySymmetry.vertical ? t('teach.symVertical') : t('teach.symHorizontal')}
      </p>
    {/if}

    <div class="tw-table" role="table">
      <div class="tw-row tw-head" role="row">
        <span role="columnheader">{t('teach.colPart')}</span>
        <span role="columnheader">A<sub>i</sub></span>
        <span role="columnheader">y<sub>i</sub></span>
        <span role="columnheader">A<sub>i</sub>·y<sub>i</sub></span>
      </div>
      {#each work.parts as p}
        <div class="tw-row" role="row" class:tw-void={p.area < 0}>
          <span role="cell" class="tw-name">{t(p.labelKey)}</span>
          <span role="cell">{cm2(p.area)}</span>
          <span role="cell">{mm(p.yi)}</span>
          <span role="cell">{cm3(p.area * p.yi)}</span>
        </div>
      {/each}
      <div class="tw-row tw-total" role="row">
        <span role="cell">Σ</span>
        <span role="cell">{cm2(work.totalArea)}</span>
        <span role="cell"></span>
        <span role="cell">{cm3(work.sumAy)}</span>
      </div>
    </div>
    <p class="tw-units">{t('teach.unitsNote')}</p>

    <div class="tw-result">
      <span class="tw-formula">ȳ = ΣA<sub>i</sub>y<sub>i</sub> / ΣA<sub>i</sub></span>
      <span class="tw-value">{mm(work.yBar)} mm</span>
    </div>
    {#if !work.bySymmetry.vertical}
      <div class="tw-result">
        <span class="tw-formula">z̄ = ΣA<sub>i</sub>z<sub>i</sub> / ΣA<sub>i</sub></span>
        <span class="tw-value">{mm(work.zBar)} mm</span>
      </div>
    {/if}
    <p class="tw-note">{t(work.originKey)}</p>
    <p class="tw-note">{t('teach.filletNote')}</p>
  </div>
{/if}

<!-- ── Shear centre ─────────────────────────────────────────── -->
<button class="ssp-section-toggle" onclick={() => showShearCentreWork = !showShearCentreWork}>
  <span class="ssp-chevron">{showShearCentreWork ? '▾' : '▸'}</span>
  {t('teach.shearCentreTitle')}
  <span class="ssp-help ssp-help-inline" title={t('teach.shearCentreHelp')}>?</span>
</button>

{#if showShearCentreWork && sc}
  <div class="tw">
    <p class="tw-lead">{t('teach.shearCentreLead')}</p>

    <div class="tw-rule">
      <span class="tw-rule-badge">{t(sc.labelKey)}</span>
    </div>
    <p class="tw-note">{t(`${sc.labelKey}Note`)}</p>

    {#if sc.terms.length > 0}
      <div class="tw-terms">
        {#each sc.terms as term}
          <div class="tw-term">
            <span class="tw-term-sym">{t(term.symbolKey)}</span>
            <span class="tw-term-val">{fmt(term.value)}<span class="tw-term-unit">{term.unit}</span></span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="tw-result">
      <span class="tw-formula">{t('teach.scOffset')}</span>
      <span class="tw-value">{mm(sc.ez)} · {mm(sc.ey)} mm</span>
    </div>

    {#if sc.outsideSection}
      <!-- The finding that makes the property worth teaching. -->
      <p class="tw-outside">{t('teach.scOutside')}</p>
    {/if}

    {#if engineShearCentre}
      <!-- Against the numerical solve. Where the two agree, the hand rule is
           confirmed; where they differ, the reason is worth knowing. -->
      <div class="tw-result tw-check">
        <span class="tw-formula">{t('teach.scEngine')}</span>
        <span class="tw-value">{mm(engineShearCentre[0])} · {mm(engineShearCentre[1])} mm</span>
      </div>
    {/if}
  </div>
{/if}

<style>
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

  .tw { padding: 5px 0 9px; }
  .tw-lead {
    margin: 0 0 6px;
    font-size: 0.62rem;
    line-height: 1.45;
    color: var(--st-text-3);
  }
  .tw-sym {
    margin: 0 0 6px;
    padding: 4px 6px;
    border-radius: 3px;
    background: rgba(42, 168, 105, 0.1);
    border-left: 2px solid var(--st-ok);
    font-size: 0.6rem;
    line-height: 1.4;
    color: var(--st-text-2);
  }

  .tw-table { display: flex; flex-direction: column; }
  .tw-row {
    display: grid;
    grid-template-columns: 1.5fr 1fr 1fr 1fr;
    gap: 4px;
    padding: 2px 0;
    font-size: 0.62rem;
    font-family: 'Courier New', monospace;
    color: var(--st-text-2);
  }
  .tw-row > :global(*:not(.tw-name)) { text-align: right; }
  .tw-head {
    color: var(--st-text-3);
    border-bottom: 1px solid rgba(26, 74, 122, 0.35);
    font-family: inherit;
  }
  .tw-name { font-family: inherit; overflow: hidden; text-overflow: ellipsis; }
  /* A subtracted bore reads as a negative area, which is the arithmetic — the
     styling only stops it looking like a typo. */
  .tw-void { color: var(--st-text-3); font-style: italic; }
  .tw-total {
    border-top: 1px solid rgba(26, 74, 122, 0.35);
    margin-top: 2px;
    padding-top: 3px;
    font-weight: 600;
  }
  .tw-units {
    margin: 3px 0 0;
    font-size: 0.55rem;
    color: var(--st-text-3);
    opacity: 0.75;
  }

  .tw-result {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-top: 7px;
    padding-top: 5px;
    border-top: 1px solid rgba(26, 74, 122, 0.3);
    font-size: 0.68rem;
  }
  .tw-formula { color: var(--st-text-3); }
  .tw-value {
    font-family: 'Courier New', monospace;
    color: var(--st-value);
    font-weight: 600;
  }
  .tw-check .tw-value { color: var(--st-text-2); font-weight: 400; }

  .tw-note {
    margin: 5px 0 0;
    font-size: 0.57rem;
    line-height: 1.45;
    color: var(--st-text-3);
  }

  .tw-rule { margin: 2px 0 5px; }
  .tw-rule-badge {
    display: inline-block;
    padding: 2px 7px;
    border-radius: 3px;
    background: rgba(127, 212, 204, 0.14);
    border: 1px solid rgba(127, 212, 204, 0.35);
    color: var(--st-value);
    font-size: 0.62rem;
  }
  .tw-terms {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 6px;
  }
  .tw-term {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    font-size: 0.63rem;
    color: var(--st-text-2);
  }
  .tw-term-sym { color: var(--st-text-3); }
  .tw-term-val { font-family: 'Courier New', monospace; }
  .tw-term-unit { color: var(--st-text-3); opacity: 0.7; margin-left: 3px; }

  .tw-outside {
    margin: 6px 0 0;
    padding: 5px 7px;
    border-radius: 3px;
    background: rgba(255, 140, 0, 0.09);
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
