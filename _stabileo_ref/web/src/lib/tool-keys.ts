/**
 * Which letter arms which tool — the ONE place this is defined.
 *
 * This table existed in four places (the keyboard handler, the ribbon's
 * shortcut hints, the floating toolbar's tooltips and the mobile toolbar's
 * button labels) and had already drifted: two of them showed (H) for pan
 * while the handler armed it with A — and H has toggled the axes display
 * since long before the ribbon existed, so the displayed shortcut silently
 * did something else.
 *
 * The bindings themselves are the long-standing ones; do not change a letter
 * here without checking it does not collide with the other global shortcuts
 * in KeyboardShortcuts.svelte (H is the axes toggle).
 */
export const TOOL_KEYS = [
  { id: 'pan', key: 'A' },
  { id: 'select', key: 'V' },
  { id: 'node', key: 'N' },
  { id: 'element', key: 'E' },
  { id: 'support', key: 'S' },
  { id: 'load', key: 'L' },
] as const;

export type ToolKeyId = (typeof TOOL_KEYS)[number]['id'];

/** Tool id → its letter, for displays that only need the key. */
export const TOOL_KEY_MAP: Record<ToolKeyId, string> = Object.fromEntries(
  TOOL_KEYS.map((t) => [t.id, t.key]),
) as Record<ToolKeyId, string>;
