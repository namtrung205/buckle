import { describe, it, expect, beforeEach } from 'vitest';
import { modelStore } from '../model.svelte';
import { historyStore } from '../history.svelte';

/**
 * The `foundation` history channel.
 *
 * Foundation edits sit between the two channels that already existed. They must be UNDOABLE
 * like a structural edit, and ANALYSIS-NEUTRAL like a reinforcement edit — a footing carries
 * a reaction, it does not contribute stiffness, so clearing the solve on every footing edit
 * left every footing reporting "no reaction" at design time.
 *
 * They used to be pushed onto the reinforcement channel, which satisfied neither half: the
 * snapshot was taken, but undo restored it through `restoreReinforcementOnly`, which touches
 * only element reinforcement and never `footings` or `geotechnical`. So Ctrl+Z on a footing
 * silently did nothing at all — recorded, and unrecoverable.
 *
 * These assert the channel's guarantees directly, because each of them is a way the previous
 * behaviour could come back one at a time.
 */
describe('the foundation history channel', () => {
  beforeEach(() => { modelStore.clear(); });

  const withFooting = () => {
    const nodeId = modelStore.addNode(0, 0, 0);
    const profileId = modelStore.addSoilProfile('Arena densa');
    const footingId = modelStore.addFooting(nodeId, 'Z1');
    return { nodeId, profileId, footingId };
  };

  it('undo restores a footing GEOMETRY edit, and redo reapplies it', () => {
    const { footingId } = withFooting();
    modelStore.updateFooting(footingId, { B: 2.5, L: 3.0 });
    expect(modelStore.model.footings.get(footingId)!.B).toBe(2.5);

    historyStore.undo();
    expect(modelStore.model.footings.get(footingId)!.B).toBe(0);
    expect(modelStore.model.footings.get(footingId)!.L).toBe(0);

    historyStore.redo();
    expect(modelStore.model.footings.get(footingId)!.B).toBe(2.5);
    expect(modelStore.model.footings.get(footingId)!.L).toBe(3.0);
  });

  it('undo RECOVERS a deleted footing', () => {
    const { footingId } = withFooting();
    modelStore.updateFooting(footingId, { B: 1.8 });
    expect(modelStore.model.footings.has(footingId)).toBe(true);

    modelStore.removeFooting(footingId);
    expect(modelStore.model.footings.has(footingId)).toBe(false);

    historyStore.undo();
    // Not merely present again — present with what it had.
    expect(modelStore.model.footings.has(footingId)).toBe(true);
    expect(modelStore.model.footings.get(footingId)!.B).toBe(1.8);
  });

  it('undo restores the GROUND, not only the footings', () => {
    const { profileId } = withFooting();
    modelStore.updateSoilProfile(profileId, {
      bearing: { kind: 'allowablePressure', allowableBearingKPa: 250 },
    });
    const after = modelStore.model.geotechnical?.profiles
      .find((p) => p.id === profileId)?.bearing as { allowableBearingKPa?: number } | undefined;
    expect(after?.allowableBearingKPa).toBe(250);

    historyStore.undo();
    const restored = modelStore.model.geotechnical?.profiles
      .find((p) => p.id === profileId)?.bearing as { allowableBearingKPa?: number } | undefined;
    expect(restored?.allowableBearingKPa).not.toBe(250);
  });

  it('undoing a foundation edit PRESERVES the analysis state', () => {
    const { footingId } = withFooting();
    const before = modelStore.modelVersion;
    modelStore.updateFooting(footingId, { B: 2.5 });
    historyStore.undo();
    // The whole point of the channel: a footing round-trip must not look like a structural
    // change, or the solve is discarded and every footing reports "no reaction".
    expect(modelStore.modelVersion).toBe(before);
  });

  it('a STRUCTURAL edit still restores fully, so the channel is not swallowing them', () => {
    const nodeId = modelStore.addNode(0, 0, 0);
    modelStore.addNode(5, 0, 0);
    expect(modelStore.model.nodes.size).toBe(2);
    historyStore.undo();
    expect(modelStore.model.nodes.size).toBe(1);
    expect(modelStore.model.nodes.has(nodeId)).toBe(true);
  });
});
