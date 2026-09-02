<script lang="ts">
  /**
   * "The analysis says there is torsion here, and nothing in this app checked it."
   *
   * ── Why a banner, and why a separate one ───────────────────────
   *
   * Separate from `ProvisionalBanner` because they are different facts about different
   * members. A proposal is steel whose SECONDARY BENDING was never checked; this is steel whose
   * TORSION was never checked. A member can be either, both, or neither, and one banner
   * covering both would tell the reader neither which members nor which action.
   *
   * ── Why it does not hide the geometry ──────────────────────────
   *
   * Because the geometry is the point. A member with unevaluated torsion keeps its concrete,
   * its cage and its proposal, and it stays selectable — turning it into a failure would take
   * away the very picture the engineer needs in order to make the judgement the application is
   * declining to make for them. What must be impossible is mistaking the picture for a
   * completed verification, and that is what this sentence is for.
   *
   * The same warning is on the sheets, in the schedule and in the report, each rendered by a
   * different module. This is the workspace's copy, kept small and separate so the four cannot
   * drift into saying four different things.
   */
  import { t, tp } from '../../../lib/i18n';

  interface Props {
    /** How many members carry unevaluated torsion. Zero renders nothing. */
    count: number;
  }
  const { count }: Props = $props();
</script>

{#if count > 0}
  <p class="torsion-banner" data-testid="rebar-torsion-banner" data-count={count}>
    <strong>{t('detailing.scene.torsionLabel')}</strong>
    {tp('detailing.scene.torsionBanner', { n: count })}
  </p>
{/if}

<style>
  .torsion-banner {
    margin: 0;
    padding: 0.4rem 0.75rem;
    /* Amber, which is neither the violet of a proposal nor the red of a conflict: this is an
       unverified action, not an unbuildable bar and not a clash. One colour, one meaning. */
    background: rgba(212, 118, 42, 0.16);
    border-bottom: 1px solid #d4762a;
    color: #f2ddc6;
    font-size: 0.76rem;
    line-height: 1.4;
  }
  .torsion-banner strong { color: #ffbe7a; letter-spacing: 0.02em; }
</style>
