import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * Svelte configuration.
 *
 * The Vite build already preprocesses `<script lang="ts">` blocks through
 * `@sveltejs/vite-plugin-svelte`'s defaults, so this file exists mainly so
 * `svelte-check` can resolve the same preprocessing outside Vite. Without it
 * the checker reports "No Svelte configuration found in vite config" and
 * mis-parses every TypeScript block.
 */
export default {
  preprocess: vitePreprocess(),
};
