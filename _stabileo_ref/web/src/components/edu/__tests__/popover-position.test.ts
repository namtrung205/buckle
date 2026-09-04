/**
 * Keeping a help bubble inside the window.
 *
 * The bug: bubbles were positioned `absolute` with a fixed 250 px width inside
 * a narrow side panel, so most of them ran off the right edge and were readable
 * only halfway. A panel is not a viewport, and anchoring to a trigger says
 * nothing about whether the result fits on screen.
 *
 * These are the cases that broke it, plus the ones that would break a naive fix.
 */

import { describe, it, expect } from 'vitest';
import { placePopover } from '../popover-position';

const screen = { width: 1440, height: 900 };
/** A `?` roughly where one sits in the authoring panel. */
const at = (left: number, top = 300) => ({ left, top, bottom: top + 14 });

describe('the bubble never leaves the window', () => {
  it('stays put when there is room', () => {
    const p = placePopover(at(200), screen);
    expect(p.left).toBe(200);
    expect(p.width).toBe(250);
  });

  it('slides left instead of overflowing the right edge — the reported bug', () => {
    const p = placePopover(at(1380), screen);
    expect(p.left + p.width).toBeLessThanOrEqual(screen.width);
    expect(p.left).toBeGreaterThan(0);
  });

  it('is fully visible for a trigger anywhere across the window', () => {
    // The property that matters, checked exhaustively rather than at a few
    // hand-picked points.
    for (let x = 0; x <= screen.width; x += 20) {
      const p = placePopover(at(x), screen);
      expect(p.left, `x=${x}`).toBeGreaterThanOrEqual(0);
      expect(p.left + p.width, `x=${x}`).toBeLessThanOrEqual(screen.width);
    }
  });

  it('a phone still gets the full width, because it fits', () => {
    // 250 px inside 320 leaves room for both margins, so nothing has to give.
    const phone = { width: 320, height: 640 };
    const p = placePopover(at(300), phone);
    expect(p.width).toBe(250);
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.left + p.width).toBeLessThanOrEqual(phone.width);
  });

  it('a window narrower than the bubble narrows the bubble, not the margin', () => {
    // Sliding cannot help when nothing fits, so the width has to give — and
    // the left edge must still win over the right.
    const narrow = { width: 200, height: 640 };
    const p = placePopover(at(180), narrow);
    expect(p.width).toBeLessThan(250);
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.left + p.width).toBeLessThanOrEqual(narrow.width);
  });

  it('never collapses to something unreadable', () => {
    const tiny = { width: 140, height: 500 };
    expect(placePopover(at(100), tiny).width).toBeGreaterThanOrEqual(120);
  });
});

describe('vertical placement', () => {
  it('opens below the trigger when there is room', () => {
    const p = placePopover(at(200, 100), screen);
    expect(p.above).toBe(false);
    expect(p.top).toBeGreaterThan(100);
  });

  it('flips above when the trigger is near the bottom', () => {
    // A bubble clipped by the bottom edge is exactly as unreadable as one
    // clipped by the right, which is what this module exists for.
    const p = placePopover(at(200, 860), screen);
    expect(p.above).toBe(true);
    expect(p.top).toBeLessThan(860);
    expect(p.top).toBeGreaterThanOrEqual(0);
  });

  it('stays on screen even in a very short window', () => {
    const short = { width: 1440, height: 200 };
    for (const y of [10, 90, 180]) {
      const p = placePopover(at(200, y), short);
      expect(p.top, `y=${y}`).toBeGreaterThanOrEqual(0);
    }
  });
});
