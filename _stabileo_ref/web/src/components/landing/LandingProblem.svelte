<script lang="ts">
  import { tPublic as t } from '../../lib/i18n/store.svelte';
  import Eyebrow from './Eyebrow.svelte';

  const rows = [
    { term: 'landing.probCostTerm', body: 'landing.probCostBody', accent: true },
    { term: 'landing.probOsTerm', body: 'landing.probOsBody', accent: false },
    { term: 'landing.probBoxTerm', body: 'landing.probBoxBody', accent: false },
  ];
</script>

<section class="sec sec--paper problem reveal" data-section="problem" id="problem" aria-labelledby="problem-title">
  <div class="wrap">
    <Eyebrow n="02" label={t('landing.ebProblem')} />
    <h2 id="problem-title" class="display">
      {t('landing.probH1')}<br /><em>{t('landing.probH2')}</em>
    </h2>

    <dl class="prob-rows">
      {#each rows as r}
        <div class="prob-row">
          <dt class="prob-term" class:accent={r.accent}>{t(r.term)}</dt>
          <dd class="prob-body">{t(r.body)}</dd>
        </div>
      {/each}
    </dl>
  </div>
</section>
