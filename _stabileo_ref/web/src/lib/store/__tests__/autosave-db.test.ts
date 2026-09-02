/**
 * The autosave store itself: revisions, retention, and every way a read can refuse.
 *
 * ── What is being pinned ───────────────────────────────────────────
 *
 * The defect this replaces was not "the write failed". It was "the write failed and the read
 * handed back an older project as if it were the current one". So the assertions here are
 * mostly about the READ path, and specifically about the difference between these three
 * answers, which the old single localStorage slot could not tell apart:
 *
 *   - here is your newest save
 *   - here is an OLDER save, because the newest one is unreadable
 *   - there is nothing readable at all
 *
 * `fake-indexeddb` is a real IndexedDB implementation, not a stub of this module's calls, so
 * transaction atomicity, key ranges and structured clone all behave as they do in a browser.
 * That matters: the retention rule and the three-transaction write are both statements about
 * transaction behaviour, and a hand-rolled double would let them pass by construction.
 *
 * The policy used here is synthetic on purpose. This module is format-agnostic — the project
 * format's own migrations and validation are `file.ts`'s and are exercised against a real
 * building in `autosave-project.test.ts`.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AUTOSAVE_REVISIONS_KEPT, LEGACY_AUTOSAVE_KEY,
  autosaveClear, autosaveRead, autosaveRevisions, autosaveStatus, autosaveWrite,
  resetAutosaveDbForTests,
  type AutosavePolicy,
} from '../autosave-db';

const DB_NAME = 'stabileo-autosave';

interface Doc { version: '2.0'; name: string; items: number[] }

/** Accepts a v2 document with an items array, and counts the items. */
const policy: AutosavePolicy<Doc> = {
  accept(raw) {
    const d = raw as Partial<Doc> | null;
    if (!d || typeof d !== 'object') return null;
    if (d.version !== '2.0') return null;
    if (!Array.isArray(d.items)) return null;
    if (typeof d.name !== 'string') return null;
    return d as Doc;
  },
  fingerprint(raw) {
    const d = raw as Partial<Doc> | null;
    return { items: Array.isArray(d?.items) ? d.items.length : 0 };
  },
};

const doc = (name: string, n: number): Doc => ({
  version: '2.0', name, items: Array.from({ length: n }, (_, i) => i),
});

function deleteDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const rq = indexedDB.deleteDatabase(DB_NAME);
    rq.onsuccess = () => resolve();
    rq.onerror = () => resolve();
    rq.onblocked = () => resolve();
  });
}

/**
 * Plant a record the module would never write, into the database it owns.
 *
 * Creates the schema if the database does not exist yet — a test may damage storage before
 * the module has ever opened it — and ALWAYS closes, because a leaked connection blocks the
 * `deleteDatabase` in the next `beforeEach` and turns one failure into a hung file.
 */
function plant(store: 'snapshots' | 'meta', value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB_NAME, 1);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'revision' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    rq.onerror = () => reject(rq.error);
    rq.onsuccess = () => {
      const db = rq.result;
      try {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value as never);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      } catch (err) {
        db.close();
        reject(err);
      }
    };
  });
}

/** A localStorage that accepts reads and writes, or refuses writes the way a full one does. */
function stubStorage(opts: { throwOn?: 'quota' | 'none' } = {}) {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    removeItem: (k: string) => { map.delete(k); },
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    clear: () => map.clear(),
    setItem: (k: string, v: string) => {
      if (opts.throwOn === 'quota') {
        const e = new Error("Setting the value of 'stabileo-autosave' exceeded the quota.");
        e.name = 'QuotaExceededError';
        throw e;
      }
      map.set(k, v);
    },
  });
  return map;
}

describe('autosave storage — IndexedDB', () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetAutosaveDbForTests();
    await deleteDatabase();
    stubStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips a payload and reports which backend answered', async () => {
    const status = await autosaveStatus();
    expect(status.backend).toBe('indexeddb');
    expect(status.degraded).toBe(false);

    const write = await autosaveWrite(doc('Torre', 3), policy);
    expect(write.ok).toBe(true);
    expect(write.backend).toBe('indexeddb');
    expect(write.revision).toBe(1);

    const read = await autosaveRead(policy);
    expect(read.backend).toBe('indexeddb');
    expect(read.value).toEqual(doc('Torre', 3));
    expect(read.revision).toBe(1);
    expect(read.timestamp).toBeTruthy();
    expect(read.rejected).toEqual([]);
    expect(read.unfinishedRevision).toBeNull();
  });

  it('numbers revisions monotonically and hands back the newest', async () => {
    for (const n of [1, 2, 3]) await autosaveWrite(doc(`v${n}`, n), policy);
    const read = await autosaveRead(policy);
    expect(read.revision).toBe(3);
    expect((read.value as Doc).name).toBe('v3');
    // Timestamps are recorded per revision, not only on the newest.
    const revs = await autosaveRevisions();
    expect(revs.map((r) => r.revision)).toEqual([3, 2, 1]);
    expect(revs.every((r) => typeof r.timestamp === 'string' && r.timestamp.length > 0)).toBe(true);
  });

  it('retires revisions beyond the retention window instead of growing without bound', async () => {
    for (let i = 1; i <= AUTOSAVE_REVISIONS_KEPT + 3; i++) await autosaveWrite(doc(`v${i}`, i), policy);
    const revs = await autosaveRevisions();
    expect(revs.length).toBe(AUTOSAVE_REVISIONS_KEPT);
    // The window is the NEWEST ones — retiring the newest to keep the oldest would be the
    // original bug with extra steps.
    expect(revs[0].revision).toBe(AUTOSAVE_REVISIONS_KEPT + 3);
  });

  it('falls back to an older revision when the newest is corrupt, and says so', async () => {
    await autosaveWrite(doc('good', 2), policy);      // revision 1
    await autosaveWrite(doc('newest', 5), policy);    // revision 2

    // Damage revision 2 the way storage damage looks: the record is there, its census is not
    // what the payload actually holds any more.
    await plant('snapshots', {
      revision: 2, timestamp: '2026-08-10T00:00:00.000Z', status: 'complete',
      fingerprint: { items: 5 }, payload: doc('newest', 1),
    });

    const read = await autosaveRead(policy);
    expect((read.value as Doc).name, 'the older, readable save is returned').toBe('good');
    expect(read.revision).toBe(1);
    expect(read.rejected).toHaveLength(1);
    expect(read.rejected[0]).toMatchObject({ revision: 2, why: 'fingerprint' });
  });

  it('refuses a payload the policy rejects rather than restoring it partially', async () => {
    await autosaveWrite(doc('good', 2), policy);
    await plant('snapshots', {
      revision: 2, timestamp: '2026-08-10T00:00:00.000Z', status: 'complete',
      fingerprint: { items: 0 }, payload: { version: '9.9', name: 'from the future', items: [] },
    });

    const read = await autosaveRead(policy);
    expect((read.value as Doc).name).toBe('good');
    expect(read.rejected[0]).toMatchObject({ revision: 2, why: 'invalid' });
  });

  it('reports nothing at all rather than pretending, when every revision is unreadable', async () => {
    await plant('snapshots', {
      revision: 1, timestamp: '2026-08-10T00:00:00.000Z', status: 'complete',
      fingerprint: { items: 0 }, payload: { nope: true },
    });

    const read = await autosaveRead(policy);
    expect(read.value).toBeNull();
    expect(read.revision).toBeNull();
    expect(read.rejected).toHaveLength(1);
    expect(read.rejected[0].why).toBe('invalid');
  });

  it('reports a write that started and never committed', async () => {
    await autosaveWrite(doc('committed', 2), policy);
    // The tab died between "I am about to save revision 2" and the record landing.
    await plant('meta', {
      key: 'state', lastRevision: 1, unfinishedRevision: 2, legacyImported: true,
    });

    const read = await autosaveRead(policy);
    expect((read.value as Doc).name).toBe('committed');
    expect(read.unfinishedRevision, 'the lost save is named, not glossed over').toBe(2);
  });

  it('does not call a superseded marker a lost save', async () => {
    await autosaveWrite(doc('a', 1), policy);
    await autosaveWrite(doc('b', 2), policy);
    await plant('meta', {
      key: 'state', lastRevision: 2, unfinishedRevision: 1, legacyImported: true,
    });

    const read = await autosaveRead(policy);
    expect(read.revision).toBe(2);
    expect(read.unfinishedRevision, 'revision 1 was superseded by 2, not lost').toBeNull();
  });

  it('refuses a record that never reached complete status', async () => {
    await plant('snapshots', {
      revision: 1, timestamp: '2026-08-10T00:00:00.000Z', status: 'writing',
      fingerprint: { items: 2 }, payload: doc('half', 2),
    });

    const read = await autosaveRead(policy);
    expect(read.value).toBeNull();
    expect(read.rejected[0]).toMatchObject({ revision: 1, why: 'incomplete' });
  });

  it('imports a pre-IndexedDB autosave once, and leaves only one copy behind', async () => {
    const map = stubStorage();
    map.set(LEGACY_AUTOSAVE_KEY, JSON.stringify(doc('legacy', 4)));

    const first = await autosaveRead(policy);
    expect((first.value as Doc).name, 'the old slot is not abandoned').toBe('legacy');
    expect(map.has(LEGACY_AUTOSAVE_KEY),
      'two stores holding two vintages of one project is the bug being removed').toBe(false);

    // A second read must not re-import (there is nothing to import) nor lose what it moved.
    const second = await autosaveRead(policy);
    expect((second.value as Doc).name).toBe('legacy');
    expect((await autosaveRevisions()).length).toBe(1);
  });

  it('prefers what IndexedDB already holds over a stale legacy slot', async () => {
    const map = stubStorage();
    map.set(LEGACY_AUTOSAVE_KEY, JSON.stringify(doc('stale', 1)));
    await autosaveWrite(doc('current', 9), policy);

    const read = await autosaveRead(policy);
    expect((read.value as Doc).name).toBe('current');
    expect(map.has(LEGACY_AUTOSAVE_KEY)).toBe(false);
  });

  it('clears every revision, and the legacy slot with them', async () => {
    const map = stubStorage();
    map.set(LEGACY_AUTOSAVE_KEY, JSON.stringify(doc('legacy', 1)));
    await autosaveWrite(doc('a', 1), policy);
    await autosaveWrite(doc('b', 2), policy);

    await autosaveClear();

    expect(await autosaveRevisions()).toEqual([]);
    expect(map.has(LEGACY_AUTOSAVE_KEY)).toBe(false);
    const read = await autosaveRead(policy);
    expect(read.value).toBeNull();
  });

  it('starts revisions again from 1 after a clear, without resurrecting old records', async () => {
    await autosaveWrite(doc('a', 1), policy);
    await autosaveWrite(doc('b', 2), policy);
    await autosaveClear();
    const write = await autosaveWrite(doc('c', 3), policy);
    expect(write.revision).toBe(1);
    const read = await autosaveRead(policy);
    expect((read.value as Doc).name).toBe('c');
  });
});

describe('autosave storage — when IndexedDB is not available', () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetAutosaveDbForTests();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await resetAutosaveDbForTests();
  });

  it('falls back to browser storage and reports the degradation', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const map = stubStorage();

    const status = await autosaveStatus();
    expect(status.backend).toBe('localstorage');
    expect(status.degraded, 'a fallback is not a success').toBe(true);
    expect(status.reason).toBeTruthy();

    const write = await autosaveWrite(doc('small', 1), policy);
    expect(write.ok).toBe(true);
    expect(write.backend).toBe('localstorage');
    expect(map.get(LEGACY_AUTOSAVE_KEY)).toBeTruthy();

    const read = await autosaveRead(policy);
    expect(read.backend).toBe('localstorage');
    expect((read.value as Doc).name).toBe('small');
  });

  it('survives a private window where opening the database throws', async () => {
    vi.stubGlobal('indexedDB', {
      open() { const e = new Error('The operation is insecure.'); e.name = 'SecurityError'; throw e; },
      deleteDatabase() { return {}; },
    });
    stubStorage();
    const status = await autosaveStatus();
    expect(status.backend).toBe('localstorage');
    expect(status.reason).toMatch(/SecurityError/);
  });

  it('reports quota failure on the fallback instead of claiming a save', async () => {
    vi.stubGlobal('indexedDB', undefined);
    stubStorage({ throwOn: 'quota' });
    const write = await autosaveWrite(doc('big', 5), policy);
    expect(write.ok).toBe(false);
    expect(write.failure?.kind).toBe('quota');
  });

  it('says there is no autosave at all when the browser offers no storage', async () => {
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('localStorage', undefined);
    const status = await autosaveStatus();
    expect(status.backend).toBe('none');
    const write = await autosaveWrite(doc('nowhere', 1), policy);
    expect(write.ok).toBe(false);
    expect(write.backend).toBe('none');
    expect(write.failure?.kind).toBe('unavailable');
    const read = await autosaveRead(policy);
    expect(read.backend).toBe('none');
    expect(read.value).toBeNull();
  });
});
