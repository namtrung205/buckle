import { describe, expect, it } from 'vitest';
import { elementReleaseKey } from '../scene-sync';

describe('elementReleaseKey', () => {
  const none = { my: false, mz: false, t: false };
  it('changes when any axis is toggled at either end', () => {
    const base = elementReleaseKey(none, none);
    for (const axis of ['my', 'mz', 't'] as const) {
      expect(elementReleaseKey({ ...none, [axis]: true }, none)).not.toBe(base);
      expect(elementReleaseKey(none, { ...none, [axis]: true })).not.toBe(base);
    }
  });
  it('is stable for equal inputs', () => {
    expect(elementReleaseKey({ ...none, t: true }, none))
      .toBe(elementReleaseKey({ ...none, t: true }, none));
  });
});
