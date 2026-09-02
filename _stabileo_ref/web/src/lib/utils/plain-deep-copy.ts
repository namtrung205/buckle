/**
 * Deep copy into ORDINARY objects and arrays.
 *
 * ── What this is for ────────────────────────────────────────────────
 *
 * Two boundaries in this app refuse anything that is not a plain value: `worker.postMessage`
 * (the structured-clone algorithm rejects an exotic object — a Proxy has internal slots, so it
 * throws `DataCloneError` outright) and serde-wasm-bindgen on the other side of it.
 *
 * Reactive state is exactly such an exotic object. A project snapshot held in `$state` — which
 * is what the autosave banner and the tab manager both do — hands back a deep proxy, and any
 * consumer that copies it only one level deep adopts those proxies as its own. They then travel
 * to the solver, where the failure surfaces as `[object Array] could not be cloned`, naming the
 * value and not the field, thousands of lines away from the assignment that caused it.
 *
 * `$state.snapshot` is Svelte's answer to the same problem and is the right tool INSIDE a
 * component. It is not the right tool here: compiled for the server it is the identity
 * function, so a guarantee expressed with it holds in the browser and evaporates under Vitest —
 * which is to say it cannot be tested where the rest of these invariants are tested. This is
 * deterministic in every environment, which is the whole point.
 *
 * Faithful, not clever: it preserves own enumerable string keys and their values, including
 * keys whose value is `undefined` (dropping those would silently change what serde sees on the
 * far side — `Option<T>` and `#[serde(default)] Vec<T>` do not treat "absent" and "present but
 * unit" alike, and deciding that per field is the caller's business, not this function's).
 */
export function plainDeepCopy<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => plainDeepCopy(v)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>)) {
    out[k] = plainDeepCopy((value as Record<string, unknown>)[k]);
  }
  return out as T;
}

/**
 * Locate the first value in `value` that structured clone rejects, as a dotted path.
 *
 * `DataCloneError` reports the offending value and nothing else, which is useless on a solver
 * payload carrying hundreds of arrays. Callers use this to turn that message into one naming
 * the field, so a project holding an incompatible value says WHICH value.
 *
 * Returns `null` when the whole thing clones. Only ever called on a failure path, so the cost
 * of the walk never lands on a healthy solve.
 */
export function findUncloneablePath(value: unknown, path = 'input', depth = 0): string | null {
  try {
    structuredClone(value);
    return null;
  } catch {
    // Fall through and narrow.
  }
  if (value === null || typeof value !== 'object' || depth > 12) return path;
  for (const k of Object.keys(value as Record<string, unknown>)) {
    const child = findUncloneablePath((value as Record<string, unknown>)[k], `${path}.${k}`, depth + 1);
    if (child) return child;
  }
  // Every child clones but the container does not — the container itself is the exotic value.
  return path;
}
