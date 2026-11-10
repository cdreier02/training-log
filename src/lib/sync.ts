// Keeps this device and a private GitHub repository in step. There is no server
// of our own: the whole log is one file in the repository, and every device reads
// it, merges it with what it has, and writes the result back. GitHub refuses a
// write based on a stale read, so two devices can't silently overwrite each other.

import { parseLog } from './backup';
import { device, deviceLabel, onDeviceChange, setDevice } from './device';
import { GhError, ghGetFile, ghPutFile, ghRepo } from './github';
import type { GhKind } from './github';
import { canon, combineConfigs, hasSetup, mergeDocs, serializeDocs } from './merge';
import { allDocs, applyRemote, commitDoc, getLocalSeq, notify, onLocalChange } from './store';
import type { DocMap } from './types';

export const SYNC_FILE = 'training-log.json';

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'offline' | 'error';

export const sync: { status: SyncStatus; error: string; kind: GhKind | '' } = { status: 'off', error: '', kind: '' };

let running = false;
let queued = false;
let debounce: ReturnType<typeof setTimeout> | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let retryMs = 0;

export function syncOn(): boolean {
  const d = device();
  return !!(d.token && d.repo);
}

function setStatus(status: SyncStatus, error = '', kind: GhKind | '' = ''): void {
  if (sync.status === status && sync.error === error) return;
  sync.status = status;
  sync.error = error;
  sync.kind = kind;
  notify();
}

const MESSAGES: Record<GhKind, string> = {
  auth: 'GitHub didn’t accept the token. It may have expired or been removed. Connect again with a new one.',
  notfound: 'GitHub can’t find the repository with this token. It may have been renamed, or the token can’t see it.',
  forbidden: 'The token can’t write to the repository. It needs the Contents permission set to Read and write.',
  rate: 'GitHub is limiting requests for now. Sync will try again by itself.',
  conflict: 'Another device was syncing at the same moment. Sync will try again by itself.',
  network: 'No connection.',
  other: 'Sync ran into a problem.',
};

/** Syncs soon, after a pause, so a burst of changes becomes one write. */
export function requestSync(delayMs = 4000): void {
  if (!syncOn()) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => void syncNow(), delayMs);
}

function parseRemote(text: string): { docs: DocMap; unread: unknown[] } {
  if (!text.trim()) return { docs: {}, unread: [] };
  try {
    const p = parseLog(text, true);
    return { docs: p.docs, unread: p.unread };
  } catch {
    // Never write over a file we couldn't read: it may be the only good copy.
    throw new GhError('other', 0, 'The synced file can’t be read, so sync has stopped rather than overwrite it. An earlier version can be restored from the repository’s history on GitHub.');
  }
}

/**
 * The plan (routines, lifts, weights) is one doc, so "newest wins" alone could let an
 * empty plan replace a real one: a brand-new device stamps its plan the moment someone
 * picks a unit in Settings. Two rules prevent that, applied before the ordinary merge.
 * A plan with something in it always beats an empty one. And the first time a device
 * with its own plan meets a synced plan, the two are joined rather than one replacing
 * the other. In both cases the result is stamped above both copies so it sticks.
 */
function settlePlans(remote: DocMap): void {
  const lc = allDocs().config, rc = remote.config;
  if (lc?.type !== 'config' || rc?.type !== 'config') return;
  if (canon({ ...lc, updatedAt: 0 }) === canon({ ...rc, updatedAt: 0 })) return;
  const mine = hasSetup(lc), theirs = hasSetup(rc), floor = Math.max(lc.updatedAt, rc.updatedAt);
  if (mine && theirs) {
    if (!device().lastSyncAt) commitDoc(combineConfigs(lc, rc, 0), floor);
  } else if (mine && rc.updatedAt >= lc.updatedAt) commitDoc(lc, floor);
  else if (theirs && lc.updatedAt >= rc.updatedAt) commitDoc(rc, floor);
}

/** Thrown inside a sync that should stop quietly: the device was disconnected or erased meanwhile. */
class Cancelled extends Error {}
let epoch = 0;

async function runSync(): Promise<void> {
  const started = epoch;
  const stillWanted = () => { if (epoch !== started || !syncOn()) throw new Cancelled(); };
  const { token, repo } = device();
  for (let attempt = 0; ; attempt++) {
    const file = await ghGetFile(token, repo, SYNC_FILE);
    stillWanted(); // nothing read from the repository may land on a device that has since left it
    const remote = file ? parseRemote(file.text) : { docs: {}, unread: [] };
    settlePlans(remote.docs);

    const seq = getLocalSeq();
    const m = mergeDocs(allDocs(), remote.docs);
    if (m.takeRemote.length) applyRemote(m.takeRemote.map((id) => m.merged[id]));
    if (m.remoteStale || !file) {
      try {
        await ghPutFile(token, repo, SYNC_FILE, serializeDocs(m.merged, {}, remote.unread), file?.sha ?? null, 'Sync from ' + deviceLabel());
      } catch (e) {
        if (e instanceof GhError && e.kind === 'conflict' && attempt < 3) { stillWanted(); continue; } // someone else wrote first: read again
        throw e;
      }
      stillWanted();
    }
    const changedMeanwhile = getLocalSeq() !== seq;
    setDevice({ lastSyncAt: Date.now(), dirty: changedMeanwhile });
    if (changedMeanwhile) queued = true;
    return;
  }
}

/** Syncs now. Resolves true if this device and the repository ended up matching. */
export async function syncNow(): Promise<boolean> {
  if (!syncOn()) { setStatus('off'); return false; }
  if (running) { queued = true; return false; }
  clearTimeout(debounce);
  clearTimeout(retry);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { setStatus('offline'); return false; }

  running = true;
  setStatus('syncing');
  let ok = false;
  try {
    await runSync();
    ok = true;
    retryMs = 0;
    setStatus('idle');
  } catch (e) {
    if (e instanceof Cancelled) {
      running = false;
      queued = false;
      setStatus(syncOn() ? 'idle' : 'off');
      return false;
    }
    const g = e instanceof GhError ? e : new GhError('other', 0, MESSAGES.other);
    if (g.kind === 'network') setStatus('offline');
    else setStatus('error', g.kind === 'other' ? g.message : MESSAGES[g.kind], g.kind);
    if (g.kind === 'network' || g.kind === 'rate' || g.kind === 'conflict' || (g.kind === 'other' && g.status >= 500)) {
      retryMs = Math.min(retryMs ? retryMs * 2 : 30_000, 600_000);
      retry = setTimeout(() => void syncNow(), retryMs);
    }
  } finally {
    running = false;
  }
  if (queued) { queued = false; requestSync(1500); }
  return ok;
}

/** Normalizes "https://github.com/me/repo.git" and friends to "me/repo". */
export function cleanRepo(input: string): string {
  return input.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
}

/** Checks the token and repository, then does the first sync. Throws with a sentence to show. */
export async function connect(tokenIn: string, repoIn: string): Promise<void> {
  const token = tokenIn.trim(), repo = cleanRepo(repoIn);
  if (!token) throw new Error('Paste the token first.');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Write the repository as owner/name, like yourname/training-log-data.');
  let info;
  try {
    info = await ghRepo(token, repo);
  } catch (e) {
    throw new Error(e instanceof GhError ? (e.kind === 'other' ? e.message : MESSAGES[e.kind]) : MESSAGES.other);
  }
  if (!info) throw new Error('GitHub can’t find ' + repo + ' with this token. Check the name, and that the token was given access to that repository.');
  if (!info.private) throw new Error(repo + ' is a public repository, so anyone could read your log there. Use a private one.');

  const before = { token: device().token, repo: device().repo, lastSyncAt: device().lastSyncAt, dirty: device().dirty };
  // A sync from an earlier connection may still be winding down; let it finish first.
  for (let i = 0; running && i < 100; i++) await new Promise((r) => setTimeout(r, 100));
  setDevice({ token, repo: info.fullName, lastSyncAt: 0, dirty: true });
  retryMs = 0;
  const ok = await syncNow();
  if (!ok) {
    const msg = sync.status === 'offline' ? 'No connection. Try again when you’re online.' : sync.error || MESSAGES.other;
    clearTimeout(retry);
    setDevice(before);
    setStatus(syncOn() ? 'idle' : 'off');
    throw new Error(msg);
  }
}

export function disconnect(): void {
  epoch++; // a sync already on its way must not finish after this
  clearTimeout(debounce);
  clearTimeout(retry);
  queued = false;
  setDevice({ token: '', repo: '', lastSyncAt: 0, dirty: false });
  setStatus('off');
}

/** Marks the device as having unsynced changes whenever the log is edited here, and syncs shortly after. */
export function watchLocalChanges(): void {
  onLocalChange(() => {
    if (!syncOn()) return;
    if (!device().dirty) setDevice({ dirty: true });
    requestSync();
  });
}

/** Wires sync to the things that should trigger it. Call once at startup. */
export function initSync(): void {
  watchLocalChanges();
  // Connected or disconnected in another tab of this app: follow along.
  onDeviceChange(() => {
    if (!syncOn()) { epoch++; clearTimeout(debounce); clearTimeout(retry); setStatus('off'); }
    else if (sync.status === 'off') { setStatus('idle'); void syncNow(); }
    notify();
  });
  window.addEventListener('online', () => void syncNow());
  window.addEventListener('offline', () => { if (syncOn() && !running) setStatus('offline'); });
  document.addEventListener('visibilitychange', () => {
    if (!syncOn()) return;
    if (document.visibilityState === 'hidden') {
      if (device().dirty) void syncNow(); // best effort before the phone suspends the page
    } else if (device().dirty || Date.now() - device().lastSyncAt > 30_000) void syncNow();
  });
  setInterval(() => {
    if (syncOn() && document.visibilityState === 'visible' && Date.now() - device().lastSyncAt > 240_000) void syncNow();
  }, 60_000);
  if (syncOn()) { setStatus('idle'); void syncNow(); }
}
