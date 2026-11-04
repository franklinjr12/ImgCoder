/**
 * Minimal IndexedDB wrapper (offline-first persistence for designs, the asset library and
 * uploaded fonts). Falls back to an in-memory store when IndexedDB is unavailable.
 */
const DB_NAME = 'game-artisan-studio';
const DB_VERSION = 1;
export type StoreName = 'documents' | 'assets' | 'fonts' | 'kv';
const STORES: StoreName[] = ['documents', 'assets', 'fonts', 'kv'];

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = new Map<StoreName, Map<string, unknown>>(STORES.map((s) => [s, new Map()]));

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        if (!db) return reject(new Error('no-idb'));
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  try {
    return await tx<T>(store, 'readonly', (s) => s.get(key) as IDBRequest<T>);
  } catch {
    return memory.get(store)!.get(key) as T | undefined;
  }
}

export async function idbPut<T>(store: StoreName, key: string, value: T): Promise<void> {
  try {
    await tx(store, 'readwrite', (s) => s.put(value, key));
  } catch {
    memory.get(store)!.set(key, value);
  }
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  try {
    await tx(store, 'readwrite', (s) => s.delete(key));
  } catch {
    memory.get(store)!.delete(key);
  }
}

export async function idbAll<T>(store: StoreName): Promise<T[]> {
  try {
    return await tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
  } catch {
    return [...memory.get(store)!.values()] as T[];
  }
}

/** localStorage with try/catch (private mode, blocked storage…). */
export const local = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(`artisan:${key}`);
      return v == null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(`artisan:${key}`, JSON.stringify(value));
    } catch {
      /* ignore quota / privacy errors */
    }
  },
};
