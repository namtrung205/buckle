/**
 * Bridge between the CSS design tokens and the 2D canvas.
 *
 * Canvas drawing takes colour strings, so it cannot read `var(--st-hair)` the
 * way a stylesheet can. Without a bridge the viewport is the one surface that
 * a palette change cannot reach — which is exactly what happened before: the
 * shell moved to the landing's ink while the canvas kept a violet grid
 * (#2a2a4e) and slate axes (#3a3a6e) from the old palette, on the largest
 * area of the screen.
 *
 * Tokens are read once and cached, because `getComputedStyle` forces style
 * resolution and the draw loop runs on every pan, zoom and edit. Call
 * `refreshCanvasTheme()` if the tokens ever become themeable at runtime.
 */

const FALLBACK = {
  grid: 'rgba(143, 163, 179, 0.13)',
  axis: 'rgba(143, 163, 179, 0.32)',
  surface: '#0c1620',
  text: '#f4f7fa',
  textDim: '#8fa3b3',
  accent: '#e5482a',
  tension: '#e5482a',
  compression: '#2c6cb4',
  /* Axle loads, mode shapes, the influence-line unit load: the amber family
   * (--st-amber-text), kept out of the vermillion used for selections and
   * the deformed shape so demand and response never share a hue. */
  amber: '#d9a441',
  /*
   * Model geometry is deliberately quiet. Before this the frame was bright
   * blue, the nodes pink and the supports orange: three saturated hues
   * competing, none of them meaning anything. The landing's truss figure does
   * the opposite — grey geometry, colour only where it carries a result — and
   * that is what makes it readable. So geometry is near-white, and the accent
   * is reserved for the one thing the user is acting on.
   */
  member: '#c7d3dd',
  memberTruss: '#9fb2c2',
  node: '#8fa3b3',
  /* A member carrying ~nothing, in the axial colour map. */
  neutralMember: '#8fa3b3',
  support: '#8fa3b3',
  selected: '#e5482a',
  /*
   * The deformed shape IS the answer to the question the user asked, so it
   * takes the accent. It was amber, which put it in the same family as the
   * load arrows and left the eye with no way to tell demand from response.
   */
  deformed: 'rgba(229, 72, 42, 0.85)',
  deformedFill: 'rgba(229, 72, 42, 0.55)',
} as const;

export type CanvasTheme = { -readonly [K in keyof typeof FALLBACK]: string };

let cache: CanvasTheme | null = null;

function read(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function canvasTheme(): CanvasTheme {
  if (cache) return cache;
  cache = {
    /*
     * The grid is deliberately weaker than a panel hairline. It covers the
     * whole viewport, so at hairline strength it competes with the model
     * instead of sitting behind it.
     */
    grid: read('--st-canvas-grid', FALLBACK.grid),
    axis: read('--st-canvas-axis', FALLBACK.axis),
    surface: read('--st-bg', FALLBACK.surface),
    text: read('--st-text', FALLBACK.text),
    textDim: read('--st-text-2', FALLBACK.textDim),
    accent: read('--st-accent', FALLBACK.accent),
    tension: read('--st-tension', FALLBACK.tension),
    compression: read('--st-compression', FALLBACK.compression),
    amber: read('--st-amber-text', FALLBACK.amber),
    member: read('--st-model-member', FALLBACK.member),
    memberTruss: read('--st-model-truss', FALLBACK.memberTruss),
    node: read('--st-model-node', FALLBACK.node),
    neutralMember: read('--st-neutral', FALLBACK.neutralMember),
    support: read('--st-model-support', FALLBACK.support),
    selected: read('--st-selected', FALLBACK.selected),
    deformed: read('--st-model-deformed', FALLBACK.deformed),
    deformedFill: read('--st-model-deformed-fill', FALLBACK.deformedFill),
  };
  return cache;
}

export function refreshCanvasTheme(): void {
  cache = null;
}
