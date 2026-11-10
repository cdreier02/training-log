// The on-device copy of the log. IndexedDB rather than localStorage because it
// survives larger logs and is what browsers protect when storage is marked persistent.

import type { Doc } from './types';

const DB_NAME = 'training-log';
const STORE = 'docs';
let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('Storage is unavailable'));
    req.onblocked = () => reject(new Error('Storage is blocked by another tab'));
  });
  opening.catch(() => { opening = null; });
  return opening;
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then((db) => new Promise<T | undefined>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    let out: T | undefined;
    const req = run(t.objectStore(STORE));
    if (req) req.onsuccess = () => { out = req.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error ?? new Error('Storage write failed'));
    t.onabort = () => reject(t.error ?? new Error('Storage write was cancelled'));
  }));
}

export async function idbAll(): Promise<Doc[]> {
  return ((await tx<Doc[]>('readonly', (s) => s.getAll())) ?? []) as Doc[];
}

/** Writes and removals in one transaction, so a half-applied change can't be left behind. */
export async function idbApply(puts: Doc[], deletes: string[] = []): Promise<void> {
  if (!puts.length && !deletes.length) return;
  await tx('readwrite', (s) => {
    for (const d of puts) s.put(d);
    for (const id of deletes) s.delete(id);
  });
}

export async function idbReplaceAll(docs: Doc[]): Promise<void> {
  await tx('readwrite', (s) => {
    s.clear();
    for (const d of docs) s.put(d);
  });
}
