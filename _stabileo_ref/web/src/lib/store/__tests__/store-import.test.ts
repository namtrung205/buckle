import { describe, expect, it } from 'vitest';

describe('store import', () => {
  it('can import the normal store bundle without browser globals', async () => {
    const mod = await import('../index');
    expect(mod.modelStore).toBeTruthy();
    expect(mod.resultsStore).toBeTruthy();
    expect(mod.uiStore).toBeTruthy();
    expect(mod.historyStore).toBeTruthy();
    // The assertion is that the import RESOLVES without browser globals, not how
    // fast. The merged store graph (autosave/IndexedDB modules, 700+ profile
    // materials data) evaluates in ~5.4s on a quiet machine — past the 5s
    // default — so the budget is stated explicitly.
  }, 30_000);
});
