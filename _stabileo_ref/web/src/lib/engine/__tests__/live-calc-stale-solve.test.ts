// PR15 review fix (C) — discard late-arriving solves.
//
// `runGlobalSolve` → `globalSolve3D` → `runComboSolve` awaits
// `modelStore.solveCombinations3DParallel(...)` and then unconditionally publishes
// via `resultsStore.setResults3D` / `setCombinationResults3D`. If the model is
// mutated WHILE that await is in flight (which clears resultsStore via the wired
// `_onMutation` hook — see store/index.ts), the stale solve's `.then` continuation
// still fires and repopulates the stores with forces computed from the
// already-superseded model, silently resurrecting pre-edit results as current.
//
// Fix: a version guard. Capture `modelStore.modelVersion` right before dispatching
// the async solve; if it changed by the time the solve resolves, discard the
// publish instead of committing it.
//
// We mock `modelStore.solveCombinations3DParallel` with a promise we control by
// hand, so the test can deterministically mutate the model DURING the async gap
// before releasing the (now-stale) solve.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runGlobalSolve } from '../live-calc';
import { modelStore, resultsStore, uiStore } from '../../store';
import * as wasm from '../wasm-solver';

const fakeCaseResult = () => ({
  elementForces: [], reactions: [], displacements: [], solverDiagnostics: [],
}) as any;
const fakeComboResult = () => ({
  perCase: new Map([[1, fakeCaseResult()]]),
  perCombo: new Map([[1, fakeCaseResult()]]),
  envelope: {} as any,
});

describe('Fix C: discard solve results that arrive after a model mutation', () => {
  beforeEach(() => {
    modelStore.clear();
    resultsStore.clear();
    const n1 = modelStore.addNode(0, 0, 0);
    const n2 = modelStore.addNode(5, 0, 0);
    modelStore.addElement(n1, n2, 'frame');
    modelStore.addSupport(n1, 'fixed');
    // modelStore.clear() restores the default combinations (non-empty), so
    // globalSolve3D takes the combo (async) path — same setup as
    // pro-double-solve.test.ts.
    uiStore.analysisMode = 'pro';
    vi.spyOn(wasm, 'isWasmReady').mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    uiStore.analysisMode = '2d';
  });

  it('a combo solve that resolves after a mid-flight mutation is discarded, not published', async () => {
    let releaseSolve: (v: unknown) => void = () => {};
    const pending = new Promise((resolve) => { releaseSolve = resolve; });
    vi.spyOn(modelStore, 'solveCombinations3DParallel').mockReturnValue(pending as any);

    const solvePromise = runGlobalSolve(); // dispatches; awaits our controlled promise

    // Let the microtask queue advance up to the point where solveCombinations3DParallel
    // has been called and its promise is pending.
    await Promise.resolve();
    await Promise.resolve();

    // Mutate the model mid-flight — a real edit, which clears resultsStore via the
    // wired _onMutation hook (store/index.ts).
    modelStore.addNode(9, 9, 9);
    expect(resultsStore.results3D).toBeNull();
    expect(resultsStore.perCombo3D.size).toBe(0);

    // Now the stale solve resolves.
    releaseSolve(fakeComboResult());
    await solvePromise;

    // The stale result must be discarded: results stay empty, not resurrected.
    expect(resultsStore.results3D).toBeNull();
    expect(resultsStore.perCombo3D.size).toBe(0);
  });

  it('a combo solve that resolves WITHOUT any mid-flight mutation still publishes normally', async () => {
    const combo = vi.spyOn(modelStore, 'solveCombinations3DParallel').mockResolvedValue(fakeComboResult());
    await runGlobalSolve();
    expect(combo).toHaveBeenCalledTimes(1);
    expect(resultsStore.results3D).not.toBeNull();
    expect(resultsStore.perCombo3D.size).toBeGreaterThan(0);
  });
});
