import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Closing an advanced analysis must clear the slot for the mode it ran in.
 *
 * The Advanced panel shows one analysis at a time and offers a ✕ to end it.
 * Whether it is running is read from the store — `pdeltaResult` in 2D,
 * `pdeltaResult3D` in 3D — and that check was mode-aware from the start. The
 * matching `close` was not: it always called the 2D clear. So in 3D the ✕ left
 * the 3D slot set, `isActive` immediately returned true again, the header came
 * straight back, and the analysis could not be exited at all — the panel was
 * stuck on it with no route back to the menu.
 *
 * Three analyses have per-mode slots. The test reads the source rather than
 * driving the component because the defect is in the pairing of two functions,
 * which is visible statically and cheap to hold.
 */
const SRC = readFileSync(
  join(__dirname, '..', '..', '..', 'components', 'toolbar', 'ToolbarAdvanced.svelte'),
  'utf8',
);

/** The registry entry for `key`, from `isActive` to the end of `close`. */
function entry(key: string): string {
  const start = SRC.indexOf(`{ key: '${key}'`);
  expect(start, `no registry entry for '${key}'`).toBeGreaterThan(-1);
  const end = SRC.indexOf("{ key: '", start + 8);
  return SRC.slice(start, end === -1 ? start + 600 : end);
}

describe('advanced analyses close the mode they are running in', () => {
  for (const [key, clear2D, clear3D] of [
    ['pdelta', 'clearPDelta', 'clearPDelta3D'],
    ['buckling', 'clearBuckling', 'clearBuckling3D'],
    ['modal', 'clearModal', 'clearModal3D'],
  ] as const) {
    it(`${key}: reads and clears the same slot`, () => {
      const e = entry(key);
      // Mode-aware on both halves, not just the one that decides visibility.
      expect(e, `${key} should test the 3D slot`).toMatch(/is3D \?/);
      expect(e, `${key} should clear the 3D slot in 3D`).toContain(`${clear3D}()`);
      expect(e, `${key} should clear the 2D slot in 2D`).toContain(`${clear2D}()`);
    });
  }

  it('every registry entry has a close that names a store call or an assignment', () => {
    const keys = [...SRC.matchAll(/\{ key: '(\w+)'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(12);
    for (const k of keys) {
      const e = entry(k);
      expect(e, `${k} has no close`).toMatch(/close: \(\) =>/);
      // A close that does nothing would leave the panel stuck the same way.
      expect(e.match(/close: \(\) => \{?\s*\}?\s*\}/), `${k}'s close is empty`).toBeNull();
    }
  });
});
