/**
 * AI model snapshot: compact outgoing element serialization + apply-path
 * validation/normalization for typed end releases.
 *
 * The general ModelSnapshot type (model.svelte.ts / history.svelte.ts) always
 * carries releaseI/releaseJ (defaulting to NO_RELEASE) — that's needed for the
 * internal undo/redo and file-save round-trip, where every element must have
 * a fully-typed Release on both ends. Sending that verbatim to the AI backend
 * means every single element repeats `{my:false,mz:false,t:false}` twice for
 * zero information, which bloats the prompt. This module keeps the AI-facing
 * payload compact (releases included only when non-default) and guards the
 * reverse path (AI response -> store, the Build tab's Apply flow) against
 * malformed shapes.
 */
import type { Release } from '../store/model.svelte';
import { NO_RELEASE } from '../store/model.svelte';

/** True when a release has at least one flag set (i.e. differs from NO_RELEASE). */
function hasReleaseFlag(r: Release | undefined | null): boolean {
  return !!r && (r.my === true || r.mz === true || r.t === true);
}

/** Compact serialization of one element for the outgoing AI snapshot: drop
 *  releaseI/releaseJ entirely unless some flag is true. All other fields pass
 *  through unchanged. */
export function serializeElementForAi(
  el: Record<string, unknown> & { releaseI?: Release; releaseJ?: Release },
): Record<string, unknown> {
  const { releaseI, releaseJ, ...rest } = el;
  return {
    ...rest,
    ...(hasReleaseFlag(releaseI) ? { releaseI } : {}),
    ...(hasReleaseFlag(releaseJ) ? { releaseJ } : {}),
  };
}

/** Compact an `[id, element][]` array (the shape `ModelSnapshot.elements` uses)
 *  for the outgoing AI request payload. */
export function compactElementsForAi(
  elements: ReadonlyArray<[number, Record<string, unknown> & { releaseI?: Release; releaseJ?: Release }]>,
): Array<[number, Record<string, unknown>]> {
  return elements.map(([id, el]) => [id, serializeElementForAi(el)]);
}

/** Compact a full outgoing AI snapshot payload: only `elements` is touched
 *  (default-release padding stripped); every other field passes through
 *  unchanged. Safe no-op if `elements` is missing/not an array. */
export function compactSnapshotForAi<T extends Record<string, unknown>>(snapshot: T): T {
  if (!snapshot || !Array.isArray(snapshot.elements)) return snapshot;
  return { ...snapshot, elements: compactElementsForAi(snapshot.elements as any) };
}

/** Shape guard for a value claiming to be a Release on an AI-returned element.
 *  `undefined` is valid (absent -> defaults to NO_RELEASE on apply). When
 *  present, it must be a plain object whose my/mz/t — if present — are
 *  booleans, and whose slide/slideAxis — if present — are one of the known
 *  enum values. Used by the Build tab's Apply validator to reject malformed
 *  releases the same way it rejects other bad fields (as a validation error,
 *  not a thrown exception). */
export function isValidReleaseShape(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  for (const key of ['my', 'mz', 't'] as const) {
    if (key in r && typeof r[key] !== 'boolean') return false;
  }
  if ('slide' in r && r.slide !== undefined && r.slide !== 'x' && r.slide !== 'z') return false;
  if ('slideAxis' in r && r.slideAxis !== undefined && r.slideAxis !== 'global' && r.slideAxis !== 'local') return false;
  return true;
}

/** Normalize an AI-returned release value to a full Release, defaulting
 *  absent flags (or the whole object) to NO_RELEASE — the same normalization
 *  `modelStore.restore()` applies on every apply path (undo/redo, file load,
 *  and the Build tab's `fastRebuild()`). Called via `normalizeSnapshotReleases`
 *  from the Build tab's Apply flow, after `isValidReleaseShape` has confirmed
 *  the shape; this function itself does not throw on malformed input, so
 *  callers must still validate first. */
export function normalizeAiRelease(value: unknown): Release {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ...NO_RELEASE };
  }
  const r = value as Partial<Release>;
  return {
    my: r.my === true,
    mz: r.mz === true,
    t: r.t === true,
    ...(r.slide === 'x' || r.slide === 'z' ? { slide: r.slide } : {}),
    ...(r.slideAxis === 'global' || r.slideAxis === 'local' ? { slideAxis: r.slideAxis } : {}),
  };
}

/** Normalize releaseI/releaseJ on every element of an AI-returned snapshot
 *  before it reaches `fastRebuild()`/`modelStore.restore()`. `isValidReleaseShape`
 *  only guards the shape — it does not strip unknown extra keys, so e.g.
 *  `{ mz: true, junk: 1 }` passes the guard unchanged and `junk` would
 *  otherwise land in the store. This maps each present release through
 *  `normalizeAiRelease` so only the known `Release` fields survive; an
 *  element whose releaseI/releaseJ is absent is left absent (`modelStore.restore()`
 *  defaults it to NO_RELEASE). Safe no-op if `elements` is missing/not an array. */
export function normalizeSnapshotReleases<T extends Record<string, unknown>>(snapshot: T): T {
  if (!snapshot || !Array.isArray(snapshot.elements)) return snapshot;
  const elements = (snapshot.elements as Array<[number, Record<string, unknown>]>).map(([id, el]) => {
    if (el.releaseI === undefined && el.releaseJ === undefined) {
      return [id, el] as [number, Record<string, unknown>];
    }
    const normalized = { ...el };
    if (el.releaseI !== undefined) normalized.releaseI = normalizeAiRelease(el.releaseI);
    if (el.releaseJ !== undefined) normalized.releaseJ = normalizeAiRelease(el.releaseJ);
    return [id, normalized] as [number, Record<string, unknown>];
  });
  return { ...snapshot, elements };
}
