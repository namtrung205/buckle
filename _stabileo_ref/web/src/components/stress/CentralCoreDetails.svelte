<script lang="ts">
  import type { CentralCore, ResolvedSection } from '../../lib/engine/section-stress';
  import { t } from '../../lib/i18n';
  import { fmt } from './fmt';

  interface Props {
    showCentralCoreInfo: boolean;
    centralCore: CentralCore | null;
    resolved: ResolvedSection | undefined;
    /**
     * Kern half-widths from the section's OWN moduli, metres, as
     * `{ z: [min,max], y: [min,max] }`.
     *
     * The drawing shows the core as a polygon; these are the numbers behind it.
     * Computed from the canonical properties rather than from the drawn shape,
     * so they are a check on it as much as a readout — and for a rectangle they
     * land on the familiar middle third.
     */
    kern: { z: [number, number]; y: [number, number] } | null;
  }

  let { showCentralCoreInfo = $bindable(), centralCore, resolved, kern }: Props = $props();

  const shapeLabel = $derived.by((): string => {
    if (!resolved) return '';
    switch (resolved.shape) {
      case 'rect': return t('stress.shapeRect');
      case 'I': case 'H': return t('stress.shapeIH');
      case 'CHS': return t('stress.shapeCHS');
      case 'RHS': return t('stress.shapeRHS');
      case 'T': return t('stress.shapeT');
      case 'L': return t('stress.shapeL');
      case 'C': return t('stress.shapeC');
      default: return resolved.shape;
    }
  });

  const coreShape = $derived.by((): string => {
    if (!resolved) return '';
    switch (resolved.shape) {
      case 'CHS': return t('stress.coreCircular');
      case 'I': case 'H': return t('stress.coreHexagonal');
      default: return t('stress.coreDiamond');
    }
  });
</script>

<button class="ssp-section-toggle" onclick={() => showCentralCoreInfo = !showCentralCoreInfo}>
  <span class="ssp-chevron">{showCentralCoreInfo ? '▾' : '▸'}</span>
  {t('stress.centralCore')}
  <span class="ssp-help ssp-help-inline" title={t('stress.centralCoreHelp')}>?</span>
</button>
{#if showCentralCoreInfo && centralCore && resolved}
  <div class="nc-detail">
    <p class="nc-desc">{@html t('stress.ccDesc1')}</p>
    <p class="nc-desc">{t('stress.ccDesc2')}</p>

    {#if kern}
      <!-- The limits themselves, in millimetres: how far the load can move
           along each axis before some fibre goes into tension. -->
      <div class="nc-limits">
        <div class="nc-limit">
          <span class="nc-limit-label">{t('stress.ccLimitZ')}</span>
          <span class="nc-limit-val">
            {(kern.z[0] * 1000).toFixed(1)} … {(kern.z[1] * 1000).toFixed(1)} mm
          </span>
        </div>
        <div class="nc-limit">
          <span class="nc-limit-label">{t('stress.ccLimitY')}</span>
          <span class="nc-limit-val">
            {(kern.y[0] * 1000).toFixed(1)} … {(kern.y[1] * 1000).toFixed(1)} mm
          </span>
        </div>
      </div>
    {/if}

    <div class="nc-divider"></div>

    <div class="nc-eq-title">{t('stress.ccEquations')}</div>
    <p class="nc-eq">{@html t('stress.ccEqDesc')}</p>
    <div class="nc-formula">e = W / A = I / (A · d)</div>
    <p class="nc-eq">{t('stress.ccEqWhere')}</p>

    <div class="nc-divider"></div>

    <div class="nc-row">
      <span class="nc-label">{t('stress.sectionLabel')}</span>
      <span class="nc-val">{shapeLabel}</span>
    </div>
    <div class="nc-row">
      <span class="nc-label">{t('stress.ccShapeLabel')}</span>
      <span class="nc-val">{coreShape}</span>
    </div>

    {#if resolved.shape === 'rect'}
      <p class="nc-eq nc-shape-note">{@html t('stress.ccRectNote')}</p>
    {:else if resolved.shape === 'I' || resolved.shape === 'H'}
      <p class="nc-eq nc-shape-note">{@html t('stress.ccIHNote')}</p>
    {:else if resolved.shape === 'CHS'}
      <p class="nc-eq nc-shape-note">{@html t('stress.ccCHSNote')}</p>
    {:else}
      <p class="nc-eq nc-shape-note">{@html t('stress.ccDefaultNote')}</p>
    {/if}

    <div class="nc-divider"></div>

    <div class="nc-row">
      <span class="nc-label">e<sub>y,max</sub> =</span>
      <span class="nc-val mono">{fmt(centralCore.eyMax * 1000, 1)} mm</span>
    </div>
    <div class="nc-row">
      <span class="nc-label">e<sub>z,max</sub> =</span>
      <span class="nc-val mono">{fmt(centralCore.ezMax * 1000, 1)} mm</span>
    </div>
  </div>
{/if}

<style>
  .nc-limits {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 6px 0 2px;
  }
  .nc-limit {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    font-size: 0.65rem;
    color: var(--st-text-2);
  }
  .nc-limit-label { color: var(--st-text-3); }
  .nc-limit-val { font-family: 'Courier New', monospace; }

  .ssp-section-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 3px 0;
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
    transition: opacity 0.15s;
    font-style: normal;
    line-height: 1;
    vertical-align: middle;
  }
  .ssp-help:hover { opacity: 1; background: rgba(127, 212, 204, 0.25); }
  .ssp-help-inline { margin-left: auto; }

  .nc-detail {
    padding: 4px 0 6px;
  }

  .nc-desc {
    font-size: 0.68rem;
    color: var(--st-text-2);
    margin: 0 0 4px;
    line-height: 1.45;
  }

  .nc-divider {
    height: 1px;
    background: rgba(26, 74, 122, 0.3);
    margin: 5px 0;
  }

  .nc-eq-title {
    font-size: 0.65rem;
    color: var(--st-warn);
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin-bottom: 3px;
    font-weight: 600;
  }

  .nc-eq {
    font-size: 0.65rem;
    color: var(--st-text-3);
    margin: 0 0 3px;
    line-height: 1.4;
  }

  .nc-formula {
    font-family: 'Courier New', monospace;
    font-size: 0.7rem;
    color: var(--st-warn);
    background: rgba(255, 140, 0, 0.08);
    border: 1px solid rgba(255, 140, 0, 0.15);
    border-radius: 4px;
    padding: 3px 6px;
    margin: 3px 0;
    text-align: center;
  }

  .nc-shape-note {
    color: var(--st-text-2);
    font-style: italic;
  }

  .nc-row {
    display: flex;
    align-items: baseline;
    gap: 4px;
    margin-bottom: 2px;
    font-size: 0.68rem;
    color: var(--st-text-2);
  }

  .nc-label {
    color: var(--st-text-3);
    min-width: 60px;
  }

  .nc-val {
    color: var(--st-text-2);
  }

  .nc-val.mono {
    font-family: 'Courier New', monospace;
    color: var(--st-warn);
  }
</style>
