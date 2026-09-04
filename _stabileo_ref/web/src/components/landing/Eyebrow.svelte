<script lang="ts">
  /** The deck's section marker: a short rule, a two-digit number, a mono label. */
  type Props = { n: string; label: string };
  let { n, label }: Props = $props();
</script>

<p class="eyebrow">
  <span class="eyebrow-rule" aria-hidden="true"></span>
  <span class="eyebrow-n">{n}</span>
  <span class="eyebrow-label">{label}</span>
</p>
