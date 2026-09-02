/**
 * solver-pool.ts — Worker pool for off-main-thread structural solving.
 *
 * Pre-initializes a pool of Web Workers, each with its own WASM instance.
 * Serves both single solves (2D and 3D) and parallel 3D case-solving.
 * Inputs/outputs travel as plain objects (structured clone), never JSON text.
 *
 * When Workers are unavailable (e.g. Node/vitest), `solve2DInWorker` /
 * `solve3DInWorker` throw `PoolUnavailableError` so callers can fall back to
 * the synchronous main-thread solver.
 */

import { getWasmBytes } from './wasm-solver';
import { findUncloneablePath } from '../utils/plain-deep-copy';

/** Thrown when the pool cannot be used (no Worker support, init failure). */
export class PoolUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PoolUnavailableError';
  }
}

/** Minimal structural type so tests can inject an in-process fake worker. */
export interface WorkerLike {
  postMessage(msg: any): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: any) => void) | null;
}

interface PendingSolve {
  resolve: (result: any) => void;
  reject: (err: Error) => void;
}

interface PoolWorker {
  worker: WorkerLike;
  ready: boolean;
  pending: Map<number, PendingSolve>;
}

let pool: PoolWorker[] = [];
let initPromise: Promise<void> | null = null;
let nextId = 0;

/** Test seam: inject a factory producing in-process fake workers (null = real Workers). */
let workerFactory: (() => WorkerLike) | null = null;
export function setWorkerFactoryForTests(factory: (() => WorkerLike) | null): void {
  workerFactory = factory;
  destroyPool();
}

/** Maximum number of workers to create */
const DEFAULT_WORKER_COUNT = 4;
const MAX_WORKERS = Math.min(
  typeof navigator !== 'undefined'
    ? (navigator.hardwareConcurrency ?? DEFAULT_WORKER_COUNT)
    : DEFAULT_WORKER_COUNT,
  8,
);

/** Create a single worker and wait for it to become ready. */
function createWorker(wasmModule: WebAssembly.Module | null): Promise<PoolWorker> {
  return new Promise((resolve, reject) => {
    const worker: WorkerLike = workerFactory
      ? workerFactory()
      : new Worker(
        new URL('./solver-worker.ts', import.meta.url),
        { type: 'module' },
      );

    const pw: PoolWorker = { worker, ready: false, pending: new Map() };

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'ready') {
        pw.ready = true;
        resolve(pw);
        return;
      }
      if (msg.type === 'error') {
        reject(new Error(msg.message));
        return;
      }
      if (msg.type === 'result') {
        const p = pw.pending.get(msg.id);
        if (p) {
          pw.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error));
          else p.resolve(msg.result);
        }
      }
    };

    worker.onerror = (err) => {
      reject(new Error(`Worker error: ${err.message}`));
    };

    // Compiled module is structured-cloneable: no byte copy, no per-worker compile.
    // (Fake test workers ignore it and share the test's in-process WASM instance.)
    worker.postMessage({ type: 'init', wasmModule });
  });
}

/** Initialize the worker pool. Idempotent — safe to call multiple times. */
export async function initPool(numWorkers?: number): Promise<void> {
  if (pool.length > 0) return;
  if (initPromise) return initPromise;

  const count = numWorkers ?? MAX_WORKERS;

  initPromise = (async () => {
    try {
      // Compile once on the main thread (bytes shared with wasm-solver's init,
      // so a single fetch); workers instantiate clones of the compiled module.
      // (Fake test workers skip the compile — they share the test's WASM instance.)
      const wasmModule = workerFactory ? null : await WebAssembly.compile(await getWasmBytes());
      const settled = await Promise.allSettled(
        Array.from({ length: count }, () => createWorker(wasmModule)),
      );
      const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
      if (failed) {
        // Terminate the workers that DID start (Promise.all would leak them),
        // then rethrow into the reset path below.
        for (const s of settled) {
          if (s.status === 'fulfilled') s.value.worker.terminate();
        }
        throw failed.reason;
      }
      pool = settled.map(s => (s as PromiseFulfilledResult<PoolWorker>).value);
    } catch (err) {
      // Don't poison the pool: a rejected initPromise would make every later
      // call re-await the same failure until reload. Reset so the next call
      // retries.
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}

/** Check if the pool is initialized and ready. */
export function isPoolReady(): boolean {
  return pool.length > 0 && pool.every(w => w.ready);
}

function workersAvailable(): boolean {
  return workerFactory !== null || (typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined');
}

/** Initialize the pool or throw PoolUnavailableError. */
async function ensurePool(): Promise<void> {
  if (!workersAvailable()) {
    throw new PoolUnavailableError('Web Workers are not available in this environment');
  }
  try {
    await initPool();
  } catch (err: any) {
    throw new PoolUnavailableError(err?.message ?? 'Worker pool initialization failed');
  }
}

/**
 * Route one solve job to the least-busy worker.
 *
 * A `DataCloneError` here is a defect in the payload, not a runtime condition, and the
 * browser's own message names only the offending VALUE ("[object Array] could not be
 * cloned") on a payload with hundreds of arrays in it. It is re-thrown naming the FIELD,
 * because that is the difference between a five-minute fix and a five-hour bisect — and
 * because the caller's fallback swallows the throw, so this string may be the only trace
 * the failure ever leaves.
 */
function runJob(type: 'solve' | 'solve3d', input: any): Promise<any> {
  const pw = pool.reduce((a, b) => (a.pending.size <= b.pending.size ? a : b));
  const msgId = nextId++;
  return new Promise((resolve, reject) => {
    pw.pending.set(msgId, { resolve, reject });
    try {
      pw.worker.postMessage({ type, id: msgId, input });
    } catch (err: any) {
      pw.pending.delete(msgId);
      if (err?.name === 'DataCloneError') {
        const path = findUncloneablePath(input) ?? 'input';
        reject(new Error(
          `Solver payload is not structured-cloneable at ${path} — ${err.message}`,
        ));
        return;
      }
      reject(err);
    }
  });
}

/**
 * Solve a single 2D case in a worker.
 * @param input Plain-object wire form of SolverInput (see input2DToWireObject)
 * @throws PoolUnavailableError when Workers are unavailable — caller should fall back to the sync solver
 */
export async function solve2DInWorker(input: any): Promise<any> {
  await ensurePool();
  return runJob('solve', input);
}

/**
 * Solve a single 3D case in a worker.
 * @param input Plain-object wire form of SolverInput3D (see input3DToWireObject)
 * @throws PoolUnavailableError when Workers are unavailable — caller should fall back to the sync solver
 */
export async function solve3DInWorker(input: any): Promise<any> {
  await ensurePool();
  return runJob('solve3d', input);
}

/**
 * Solve multiple 3D cases in parallel across the worker pool.
 *
 * @param cases Array of { id, input } where input is the plain-object wire form of SolverInput3D
 * @returns Map from id to the solved result object (structured-cloned from the worker)
 */
export async function solveParallel(
  cases: Array<{ id: number; input: any }>,
): Promise<Map<number, any>> {
  await ensurePool();

  const results = new Map<number, any>();
  await Promise.all(
    cases.map(({ id, input }) =>
      runJob('solve3d', input).then(result => { results.set(id, result); }),
    ),
  );
  return results;
}

/** Terminate all workers and clean up the pool. */
export function destroyPool(): void {
  for (const pw of pool) {
    pw.worker.terminate();
  }
  pool = [];
  initPromise = null;
}
