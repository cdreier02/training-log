// The log in memory, written through to the device on every change. Screens read
// from here and re-render when it says something changed; sync reads and writes
// whole docs through the same door.

import { normalizeDoc } from './backup';
import { setUnits } from './format';
import { idbAll, idbApply, idbReplaceAll } from './idb';
import { sortSessions } from './logic';
import { canon, combineConfigs, hasSetup } from './merge';
import { emptyConfig } from './types';
import type { ActiveDoc, ConfigDoc, Doc, DocMap, SessionDoc, Tombstone } from './types';

type Listener = () => void;
const listeners = new Set<Listener>();

let docs: DocMap = {};
let localSeq = 0;
let changeHook: (() => void) | null = null;

let cfg: ConfigDoc = emptyConfig();
let act: ActiveDoc | null = null;
let sess: SessionDoc[] = [];

export const status = {
  ready: false,
  /** False when the browser refused storage (some private windows): nothing will be kept. */
  persistent: true,
  saveError: '',
};

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function derive(): void {
  const c = docs.config;
  cfg = c && c.type === 'config' ? c : emptyConfig();
  const a = docs.active;
  act = a && a.type === 'active' ? a : null;
  sess = sortSessions(Object.values(docs).filter((d): d is SessionDoc => d.type === 'session'));
  setUnits(cfg.prefs.unit, cfg.prefs.dist);
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Tells every screen to re-read. Also used for state that lives outside the docs. */
export function notify(): void {
  listeners.forEach((fn) => fn());
}

// The same log can be open twice on one device (the installed app and a browser tab).
// Each tells the other when it has written something, so neither keeps working from an
// old copy and saves that over the newer one.
const channel: BroadcastChannel | null = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('training-log') : null;

let writes: Promise<void> = Promise.resolve();
function persist(job: () => Promise<void>, announce: 'docs' | 'erased' = 'docs'): void {
  if (!status.persistent) return;
  writes = writes.then(job).then(
    () => {
      channel?.postMessage(announce);
      if (status.saveError) { status.saveError = ''; notify(); }
    },
    () => { status.saveError = 'Saving to this device didn’t go through. Your last change may be missing after a reload.'; notify(); },
  );
}

/** Picks up what another tab wrote. Only ever moves a doc forward to a newer copy. */
async function absorbDisk(): Promise<void> {
  try {
    await writes;
    const disk = await idbAll();
    const next = { ...docs };
    let changed = false;
    for (const raw of disk) {
      const d = normalizeDoc(raw);
      const cur = d ? next[d.id] : undefined;
      if (d && (!cur || d.updatedAt > cur.updatedAt)) { next[d.id] = d; changed = true; }
    }
    if (changed) { docs = next; derive(); notify(); }
  } catch {
    // The next change or reload will catch up.
  }
}

channel?.addEventListener('message', (e) => {
  if (e.data === 'erased') { docs = {}; derive(); notify(); }
  else void absorbDisk();
});

/** Resolves once everything queued so far is on disk. */
export function flushed(): Promise<void> {
  return writes;
}

export async function loadStore(): Promise<void> {
  try {
    const next: DocMap = {};
    for (const raw of await idbAll()) {
      const d = normalizeDoc(raw);
      if (d) next[d.id] = d;
    }
    docs = next;
  } catch {
    status.persistent = false;
  }
  derive();
  status.ready = true;
  notify();
}

/** Called after any change made on this device (not for changes arriving from sync). */
export function onLocalChange(fn: () => void): void {
  changeHook = fn;
}

// A stamp that always moves forward, even if the clock was set back since the last edit.
function stampFor(id: string): number {
  return Math.max(Date.now(), (docs[id]?.updatedAt ?? 0) + 1);
}

function commit(list: Doc[]): void {
  const next = { ...docs };
  for (const d of list) next[d.id] = d;
  docs = next;
  localSeq++;
  derive();
  persist(() => idbApply(list));
  changeHook?.();
  notify();
}

function tomb(id: string): Tombstone {
  return { id, type: 'tombstone', deleted: true, updatedAt: stampFor(id) };
}

/* ---------- reading ---------- */

export const getConfig = (): ConfigDoc => cfg;
export const getActive = (): ActiveDoc | null => act;
/** Finished sessions, oldest first. */
export const getSessions = (): SessionDoc[] => sess;
export const allDocs = (): DocMap => docs;
/** Goes up by one on every local change. Lets sync notice edits made while it was running. */
export const getLocalSeq = (): number => localSeq;

export function sessionById(id: string): SessionDoc | null {
  const d = docs[id];
  return d && d.type === 'session' ? d : null;
}

export function isEmpty(): boolean {
  return !sess.length && !act && !hasSetup(cfg);
}

/* ---------- changing ---------- */

export function saveConfig(mut: (c: ConfigDoc) => void): void {
  const next = clone(cfg);
  mut(next);
  next.updatedAt = stampFor('config');
  commit([next]);
}

export function setActive(a: ActiveDoc | null): void {
  if (a) commit([{ ...a, updatedAt: stampFor('active') }]);
  else if (docs.active && docs.active.type !== 'tombstone') commit([tomb('active')]);
}

export function updateActive(mut: (a: ActiveDoc) => void): void {
  if (!act) return;
  const next = clone(act);
  mut(next);
  setActive(next);
}

export function putSession(s: SessionDoc): void {
  commit([{ ...s, updatedAt: stampFor(s.id) }]);
}

export function updateSession(id: string, mut: (s: SessionDoc) => void): void {
  const cur = sessionById(id);
  if (!cur) return;
  const next = clone(cur);
  mut(next);
  putSession(next);
}

export function deleteSession(id: string): void {
  if (sessionById(id)) commit([tomb(id)]);
}

/** Ends the active session and files it, as one write. */
export function finishActive(s: SessionDoc): void {
  commit([{ ...s, updatedAt: stampFor(s.id) }, tomb('active')]);
}

/* ---------- arriving from elsewhere ---------- */

/** Takes docs from the synced copy where they are newer than what's here. */
export function applyRemote(list: Doc[]): number {
  const next = { ...docs };
  const puts: Doc[] = [];
  for (const d of list) {
    const cur = next[d.id];
    if (!cur || d.updatedAt > cur.updatedAt || (d.updatedAt === cur.updatedAt && canon(cur) !== canon(d))) {
      next[d.id] = d;
      puts.push(d);
    }
  }
  if (puts.length) {
    docs = next;
    derive();
    persist(() => idbApply(puts));
    notify();
  }
  return puts.length;
}

/**
 * Replaces one doc as a local change (used when sync has to settle two setups).
 * `floor` is a stamp the result must beat, for when the other copy came from a
 * device whose clock runs ahead of this one.
 */
export function commitDoc(d: Doc, floor = 0): void {
  commit([{ ...d, updatedAt: Math.max(stampFor(d.id), floor + 1) } as Doc]);
}

export interface ImportResult {
  added: number;
  updated: number;
  removed: number;
}

/**
 * Brings a backup in. 'merge' adds what the file has and keeps what's here, newest
 * copy winning, and brings back sessions that were deleted here. 'replace' makes
 * this device match the file exactly.
 */
export function importDocs(incoming: DocMap, mode: 'merge' | 'replace'): ImportResult {
  const out: ImportResult = { added: 0, updated: 0, removed: 0 };
  const changes: Doc[] = [];
  const now = Date.now();
  const bump = (id: string) => Math.max(now, (docs[id]?.updatedAt ?? 0) + 1);

  for (const d of Object.values(incoming)) {
    if (d.type === 'tombstone') continue;
    const cur = docs[d.id];
    const live = cur && cur.type !== 'tombstone';
    if (mode === 'replace') {
      if (live && canon({ ...cur, updatedAt: 0 }) === canon({ ...d, updatedAt: 0 })) continue;
      changes.push({ ...d, updatedAt: bump(d.id) } as Doc);
      if (live) out.updated++; else out.added++;
    } else if (!cur) {
      changes.push(d);
      out.added++;
    } else if (!live) {
      if (d.id === 'active') continue; // a finished or discarded session shouldn't come back as in-progress
      changes.push({ ...d, updatedAt: bump(d.id) } as Doc);
      out.added++;
    } else if (d.type === 'config' && cur.type === 'config') {
      // "Add" must never take a routine or lift away. Both plans are kept; where they
      // define the same thing, the more recently edited plan's version is used.
      if (!hasSetup(d) || canon({ ...d, updatedAt: 0 }) === canon({ ...cur, updatedAt: 0 })) continue;
      const next = !hasSetup(cur) ? d : d.updatedAt > cur.updatedAt ? combineConfigs(cur, d, 0) : combineConfigs(d, cur, 0);
      if (canon({ ...next, updatedAt: 0 }) === canon({ ...cur, updatedAt: 0 })) continue;
      changes.push({ ...next, updatedAt: Math.max(bump('config'), d.updatedAt + 1) }); // above both, so the joined plan is the one that spreads
      out.updated++;
    } else if (d.updatedAt > cur.updatedAt) {
      changes.push(d);
      out.updated++;
    }
  }
  if (mode === 'replace') {
    for (const cur of Object.values(docs)) {
      if (cur.type === 'tombstone' || cur.id === 'config') continue;
      const inc = incoming[cur.id];
      if (!inc || inc.type === 'tombstone') { changes.push(tomb(cur.id)); out.removed++; }
    }
  }
  if (changes.length) commit(changes);
  return out;
}

/** Wipes this device's copy. Does not touch the synced copy; callers disconnect sync first. */
export function eraseDevice(): void {
  docs = {};
  localSeq++;
  derive();
  persist(() => idbReplaceAll([]), 'erased');
  notify();
}
