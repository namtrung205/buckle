/**
 * popover-position.ts — keeping a popover inside the window.
 *
 * The help bubbles were positioned `absolute` with a fixed width inside a
 * narrow side panel, so most of them ran off the right edge and were readable
 * only halfway. A panel is not a viewport, and anchoring to the trigger says
 * nothing about whether the result fits on screen.
 *
 * The arithmetic lives here rather than in the component because it is the part
 * that can be wrong, and it is pure: given where the trigger is and how big the
 * window is, there is one right answer.
 */

export interface Anchor {
  /** Trigger position in viewport coordinates. */
  left: number;
  top: number;
  bottom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  width: number;
  /** True when the popover was flipped above the trigger for lack of room. */
  above: boolean;
}

/** Preferred width, and the margin kept from every window edge. */
const IDEAL_WIDTH = 250;
const MARGIN = 8;
const GAP = 6;
/** Assumed height when deciding whether to flip; generous on purpose. */
const ASSUMED_HEIGHT = 150;

/**
 * Place a popover near `anchor` without letting it leave the window.
 *
 * Horizontally it prefers to start at the trigger and slides left only as much
 * as needed — sliding is far less disorienting than flipping, since the bubble
 * stays visually attached to the `?` that opened it. It narrows only when the
 * window itself is narrower than the ideal width, which is the phone case.
 *
 * Vertically it flips above the trigger when there is not enough room below,
 * because a bubble clipped by the bottom edge is exactly as unreadable as one
 * clipped by the right.
 */
export function placePopover(anchor: Anchor, viewport: Viewport): Placement {
  const width = Math.min(IDEAL_WIDTH, Math.max(120, viewport.width - 2 * MARGIN));

  // Start at the trigger, then pull back inside the right edge, then make sure
  // pulling back did not push it off the left. The order matters: on a window
  // narrower than the popover, the left edge has to win.
  let left = anchor.left;
  if (left + width + MARGIN > viewport.width) left = viewport.width - width - MARGIN;
  if (left < MARGIN) left = MARGIN;

  const roomBelow = viewport.height - anchor.bottom;
  const above = roomBelow < ASSUMED_HEIGHT && anchor.top > roomBelow;
  const top = above ? Math.max(MARGIN, anchor.top - ASSUMED_HEIGHT - GAP) : anchor.bottom + GAP;

  return { left, top, width, above };
}
