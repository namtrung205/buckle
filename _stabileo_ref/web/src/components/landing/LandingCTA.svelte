<script lang="ts">
  import { tPublic as t } from '../../lib/i18n/store.svelte';
  import { REPO_URL, enterApp } from './landing-utils';
</script>

<section class="sec sec--paper cta reveal" data-section="cta" aria-labelledby="cta-title">
  <div class="wrap cta-inner">
    <div>
      <h2 id="cta-title" class="display">{t('landing.ctaH')}</h2>
      <p class="lead">{t('landing.ctaP')}</p>
    </div>
    <div class="cta-actions">
      <button class="btn btn-primary btn-lg" onclick={() => enterApp()}>{t('landing.heroCtaPrimary')}</button>
      <a class="link-arrow" href={REPO_URL} target="_blank" rel="noreferrer">{t('landing.ctaSource')}</a>
    </div>
  </div>
</section>
