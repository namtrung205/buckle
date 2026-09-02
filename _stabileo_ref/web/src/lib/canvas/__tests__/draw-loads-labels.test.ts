/**
 * Where the load values actually land, measured through the renderer.
 *
 * `label-layout` is tested on its own, but that only proves the algorithm is
 * right — not that the drawing code hands it the right boxes. The defect the
 * user reported lived entirely in the handover: labels were drawn straight to
 * the canvas at a position nudged by a fixed offset, so no amount of layout
 * logic elsewhere could have moved them.
 *
 * These tests therefore drive the real functions with a recording context and
 * look at the coordinates that reach `fillText`.
 */

import { describe, it, expect } from 'vitest';
import { drawDistributedLoads, drawPointLoadsOnElements } from '../draw-loads';

interface Written { text: string; x: number; y: number }

/**
 * A canvas that records text instead of drawing it. Only the calls these
 * renderers make are implemented; anything else would be dead weight.
 */
function recordingCtx() {
  const written: Written[] = [];
  const ctx = {
    written,
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 0, textAlign: '',
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
    closePath() {}, arc() {}, save() {}, restore() {}, setLineDash() {},
    fillText(text: string, x: number, y: number) { written.push({ text, x, y }); },
    measureText(t: string) { return { width: t.length * 6 }; },
  };
  return ctx as unknown as CanvasRenderingContext2D & { written: Written[] };
}

/** A single horizontal beam, 6 m long, at y = 0. Screen y grows downward. */
function beamContext(ctx: CanvasRenderingContext2D, members: boolean) {
  const nodes: Record<number, { x: number; y: number }> = {
    1: { x: 0, y: 0 },
    2: { x: 6, y: 0 },
  };
  const toScreen = (wx: number, wy: number) => ({ x: 100 + wx * 50, y: 300 - wy * 50 });
  return {
    ctx,
    worldToScreen: toScreen,
    getNode: (id: number) => nodes[id],
    getElement: () => ({ nodeI: 1, nodeJ: 2 }),
    memberSegments: members
      ? () => [{ x1: 100, y1: 300, x2: 400, y2: 300 }]
      : undefined,
  };
}

const overlap = (a: Written, b: Written, w = 90, h = 14) =>
  Math.abs(a.x - b.x) < w && Math.abs(a.y - b.y) < h;

describe('two distributed loads on one beam', () => {
  /*
   * Negative q, which is the gravity case: the sign convention has positive q
   * acting UPWARD, so a dead and a live load are both negative and are drawn
   * above the beam with the arrows pointing down onto it.
   */
  const loads = [
    { elementId: 1, qI: -10, qJ: -10, caseName: 'D', caseColor: '#f00' },
    { elementId: 1, qI: -3, qJ: -3, caseName: 'L', caseColor: '#00f' },
  ];

  it('writes both values without one covering the other', () => {
    const ctx = recordingCtx();
    drawDistributedLoads(loads, beamContext(ctx, true));

    const big = ctx.written.find((w) => w.text.startsWith('D:'))!;
    const small = ctx.written.find((w) => w.text.startsWith('L:'))!;
    expect(big).toBeDefined();
    expect(small).toBeDefined();
    expect(overlap(big, small)).toBe(false);
  });

  it('lists them largest first, reading top to bottom', () => {
    const ctx = recordingCtx();
    drawDistributedLoads(loads, beamContext(ctx, true));

    const big = ctx.written.find((w) => w.text.startsWith('D:'))!;
    const small = ctx.written.find((w) => w.text.startsWith('L:'))!;
    // Two loads on one beam are that beam's load table, and a table is read
    // biggest first. Smaller screen y is higher up.
    expect(big.y).toBeLessThan(small.y);
  });

  it('breaks ties between equal loads by case: D, then L, then W', () => {
    const ctx = recordingCtx();
    drawDistributedLoads([
      { elementId: 1, qI: -8, qJ: -8, caseName: 'W', caseColor: '#0f0' },
      { elementId: 1, qI: -8, qJ: -8, caseName: 'L', caseColor: '#00f' },
      { elementId: 1, qI: -8, qJ: -8, caseName: 'D', caseColor: '#f00' },
    ], beamContext(ctx, true));

    const y = (p: string) => ctx.written.find((w) => w.text.startsWith(p))!.y;
    // Passed in reverse on purpose: order must come from the case, not from
    // however the loads happen to be stored.
    expect(y('D:')).toBeLessThan(y('L:'));
    expect(y('L:')).toBeLessThan(y('W:'));
  });

  it('does not depend on the order the loads are stored in', () => {
    const a = recordingCtx();
    const b = recordingCtx();
    drawDistributedLoads(loads, beamContext(a, true));
    drawDistributedLoads([loads[1], loads[0]], beamContext(b, true));

    const y = (c: typeof a, p: string) => c.written.find((w) => w.text.startsWith(p))!.y;
    expect(y(a, 'D:')).toBe(y(b, 'D:'));
    expect(y(a, 'L:')).toBe(y(b, 'L:'));
  });

  it('keeps three loads all readable', () => {
    const ctx = recordingCtx();
    drawDistributedLoads([
      ...loads,
      { elementId: 1, qI: -7, qJ: -7, caseName: 'S', caseColor: '#0f0' },
    ], beamContext(ctx, true));

    const found = ['D:', 'L:', 'S:'].map((p) => ctx.written.find((w) => w.text.startsWith(p))!);
    for (let i = 0; i < found.length; i++) {
      for (let j = i + 1; j < found.length; j++) {
        expect(overlap(found[i], found[j])).toBe(false);
      }
    }
    // Ordered by size, top down: 10, then 7, then 3.
    expect(found[0].y).toBeLessThan(found[2].y); // D above S
    expect(found[2].y).toBeLessThan(found[1].y); // S above L
  });
});

describe('a point load beside a column', () => {
  it('moves its value off the member instead of writing across it', () => {
    const ctx = recordingCtx();
    const load = { elementId: 1, a: 3, p: -25, caseName: 'P', caseColor: '#f00' };

    // A column rising from the load position, right where the value would go.
    const dcWithColumn = {
      ...beamContext(ctx, true),
      memberSegments: () => [
        { x1: 100, y1: 300, x2: 400, y2: 300 },
        { x1: 255, y1: 300, x2: 255, y2: 120 },
      ],
    };
    drawPointLoadsOnElements([load], dcWithColumn);

    const w = ctx.written.find((t) => t.text.startsWith('P:'))!;
    expect(w).toBeDefined();
    // The column occupies x ≈ 252..258. The label is left-aligned and about
    // 84 px wide, so it must start clear of that band on either side.
    const startsBefore = w.x + 84 < 252;
    const startsAfter = w.x > 258;
    expect(startsBefore || startsAfter).toBe(true);
  });

  it('leaves the value where it belongs when nothing is in the way', () => {
    const ctx = recordingCtx();
    drawPointLoadsOnElements(
      [{ elementId: 1, a: 3, p: -25, caseName: 'P', caseColor: '#f00' }],
      beamContext(ctx, false),
    );
    const w = ctx.written.find((t) => t.text.startsWith('P:'))!;
    // Just right of the arrow tail at x = 250.
    expect(w.x).toBe(255);
    // Above the beam, where the arrow is.
    expect(w.y).toBeLessThan(300);
  });

  it('separates the perpendicular, axial and moment values of one load', () => {
    const ctx = recordingCtx();
    drawPointLoadsOnElements(
      [{ elementId: 1, a: 3, p: -25, px: 10, my: 8, caseName: 'P', caseColor: '#f00' }],
      beamContext(ctx, true),
    );
    const three = ctx.written.filter((w) => w.text.startsWith('P:'));
    expect(three).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        expect(overlap(three[i], three[j])).toBe(false);
      }
    }
  });
});
