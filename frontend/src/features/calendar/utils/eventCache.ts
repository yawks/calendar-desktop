/**
 * IndexedDB-based event cache — no size limit unlike localStorage.
 * Falls back silently on error (e.g. private browsing restrictions).
 */

const DB_NAME = 'calendar-event-cache';
const DB_VERSION = 1;
const STORE = 'entries';

type CacheEntry<T> = { value: T; at: number };

let _db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      (e.target as IDBOpenDBRequest).result.createObjectStore(STORE);
    };
    req.onsuccess = (e) => {
      _db = (e.target as IDBOpenDBRequest).result;
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function cacheGet<T>(key: string, ttl: number): Promise<{ value: T; stale: boolean } | null> {
  try {
    const db = await openDB();
    const entry = await new Promise<CacheEntry<T> | undefined>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });
    if (!entry) return null;
    return { value: entry.value, stale: Date.now() - entry.at > ttl };
  } catch {
    return null;
  }
}

export async function cacheGetStale<T>(key: string): Promise<T | null> {
  try {
    const db = await openDB();
    const entry = await new Promise<CacheEntry<T> | undefined>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });
    return entry?.value ?? null;
  } catch {
    return null;
  }
}

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ value, at: Date.now() } satisfies CacheEntry<T>, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // fail silently
  }
}

/**
 * Patch a single event's RSVP-related fields in a cached CalendarEvent array.
 * Preserves the existing cache timestamp so the TTL is unchanged.
 */
export async function patchCachedEventRsvp(
  key: string,
  eventId: string,
  status: import('../../../shared/types').AttendeeStatus,
): Promise<void> {
  try {
    const db = await openDB();
    const entry = await new Promise<CacheEntry<import('../../../shared/types').CalendarEvent[]> | undefined>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as CacheEntry<import('../../../shared/types').CalendarEvent[]> | undefined);
      req.onerror = () => resolve(undefined);
    });
    if (!entry) return;

    const patched = entry.value.map((ev) => {
      if (ev.id !== eventId) return ev;
      return {
        ...ev,
        selfRsvpStatus: status,
        isDeclined: status === 'DECLINED',
        isUnaccepted: status !== 'ACCEPTED',
      };
    });

    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ value: patched, at: entry.at } satisfies CacheEntry<import('../../../shared/types').CalendarEvent[]>, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // fail silently
  }
}

export async function cacheIsFresh(key: string, ttl: number): Promise<boolean> {
  try {
    const db = await openDB();
    const entry = await new Promise<CacheEntry<unknown> | undefined>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });
    if (!entry) return false;
    return Date.now() - entry.at <= ttl;
  } catch {
    return false;
  }
}
