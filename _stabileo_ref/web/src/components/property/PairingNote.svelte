<script lang="ts">
  /**
   * "This section is not normally rolled in that steel."
   *
   * A section and a material look like independent choices, and physically they
   * are — an IPN in F-36 is a perfectly good member. But a mill rolls each
   * family in a particular grade, so the pairing on a real drawing is usually
   * not a free choice: it is what the supplier ships. Ordering anything else
   * means a special run, which is a question of cost and lead time rather than
   * of correctness.
   *
   * So this NEVER blocks and never corrects. It states what is stocked and lets
   * the user proceed, because the departure may well be deliberate — a
   * verification of an existing structure, a study, an import.
   *
   * It appears only when the pairing departs from EVERY practice on record. A
   * W in A992 is standard in the United States even though Argentina rolls it
   * in F-36, and warning about that would make the warning worthless. Where no
   * practice is recorded at all — most families — it says nothing: silence is
   * not a claim that something is unusual. It also says nothing when the
   * grade's own region offers the family but no practice is recorded there —
   * a European tube in S235, whose product standards are not in the data —
   * while it DOES speak when the region does not roll the family at all: an
   * IPN in A992 departs from every practice on record and no mill ships it.
   */
  import {
    commercialGradesFor, isUnusualPairing, gradeById,
  } from '../../lib/data/structural-grades';
  import { t } from '../../lib/i18n';

  interface Props {
    /** Catalogue family of the section, when it came from the catalogue. */
    family: string | undefined;
    /** Catalogue grade of the material, when it came from the catalogue. */
    gradeId: string | undefined;
  }

  let { family, gradeId }: Props = $props();

  const unusual = $derived(family ? isUnusualPairing(family, gradeId) : null);
  const expected = $derived(family ? commercialGradesFor(family) : []);
  const chosen = $derived(gradeId ? gradeById(gradeId) : undefined);
</script>

{#if unusual === true && expected.length > 0}
  <div class="pn" role="note">
    <span class="pn-icon" aria-hidden="true">ⓘ</span>
    <div class="pn-body">
      <p class="pn-text">
        {t('pairing.unusual')
          .replace('{family}', family ?? '')
          .replace('{grade}', chosen?.designation ?? '')}
      </p>
      <ul class="pn-list">
        {#each expected as e}
          {@const g = gradeById(e.gradeId)}
          {#if g}
            <li>
              <strong>{g.designation}</strong>
              <span class="pn-src">{t(e.sourceKey)}</span>
            </li>
          {/if}
        {/each}
      </ul>
      <p class="pn-ok">{t('pairing.stillValid')}</p>
    </div>
  </div>
{/if}

<style>
  .pn {
    display: flex;
    gap: 7px;
    margin: 4px 0 2px;
    padding: 7px 9px;
    border-radius: 4px;
    /* Informational, not an error: this is a note about supply, and the model
       is perfectly valid either way. */
    background: rgba(127, 212, 204, 0.07);
    border-left: 2px solid var(--st-value);
  }
  .pn-icon { color: var(--st-value); font-size: 0.8rem; line-height: 1.3; flex: none; }
  .pn-body { min-width: 0; }
  .pn-text {
    margin: 0;
    font-size: 0.66rem;
    line-height: 1.45;
    color: var(--st-text-2);
  }
  .pn-list {
    margin: 4px 0 0;
    padding-left: 14px;
    font-size: 0.64rem;
    line-height: 1.5;
    color: var(--st-text-2);
  }
  .pn-src { color: var(--st-text-3); margin-left: 5px; font-size: 0.92em; }
  .pn-ok {
    margin: 4px 0 0;
    font-size: 0.6rem;
    line-height: 1.4;
    color: var(--st-text-3);
  }
</style>
