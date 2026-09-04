<script lang="ts">
  /**
   * "Now click the model" — the missing half of arming section analysis.
   *
   * Pressing Section Analysis puts the viewport into a mode where a click
   * means "inspect this station", and until that click nothing appears. From
   * the user's side the button did nothing: no panel, no cursor change, no
   * instruction. The mode was invisible and so was the way out of it.
   *
   * Shown exactly while the mode is armed AND unanswered, which makes every
   * dismissal automatic and none of them a special case:
   *
   *   * clicking the model sets a query, so it goes;
   *   * turning the analysis off restores `selectMode`, so it goes;
   *   * switching to another advanced tool changes `selectMode`, so it goes.
   *
   * No timer and no dismiss button: a hint that describes a live state should
   * disappear when the state does, not when a clock says so. Leaving it
   * dismissable would let a user hide the only explanation of why their clicks
   * are doing something unexpected.
   */
  import { uiStore, resultsStore } from '../../lib/store';
  import { t } from '../../lib/i18n';

  const armed = $derived(uiStore.selectMode === 'stress' && resultsStore.stressQuery === null);
</script>

{#if armed}
  <div class="sph" role="status">
    <span class="sph-icon" aria-hidden="true">◎</span>
    <span class="sph-text">{t('stress.pickHint')}</span>
  </div>
{/if}

<style>
  .sph {
    position: absolute;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 40;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 14px;
    border-radius: 20px;
    background: rgba(12, 22, 32, 0.94);
    border: 1px solid var(--st-value);
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
    color: var(--st-text-2);
    font-size: 0.76rem;
    white-space: nowrap;
    /* It sits over the canvas the user is about to click, so it must not be
       the thing they hit. */
    pointer-events: none;
    animation: sph-in 0.18s ease-out;
  }
  .sph-icon {
    color: var(--st-value);
    font-size: 0.9rem;
    line-height: 1;
    animation: sph-pulse 1.6s ease-in-out infinite;
  }
  @keyframes sph-in {
    from { opacity: 0; transform: translate(-50%, -6px); }
    to   { opacity: 1; transform: translate(-50%, 0); }
  }
  @keyframes sph-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.35; }
  }
  /* A pulsing dot is decoration; for anyone who has asked not to see motion it
     is just motion. The hint still reads without it. */
  @media (prefers-reduced-motion: reduce) {
    .sph { animation: none; }
    .sph-icon { animation: none; }
  }
</style>
