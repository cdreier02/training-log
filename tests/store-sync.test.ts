// The store and the sync engine together, against an in-memory IndexedDB and a
// stand-in for the handful of GitHub endpoints sync uses.

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLog } from '../src/lib/backup';
import { b64decode, b64encode } from '../src/lib/github';
import { serializeDocs } from '../src/lib/merge';
import type { ConfigDoc, DocMap, SessionDoc } from '../src/lib/types';
import { config, did, lift, PRESS, session, sets } from './fixtures';

type Store = typeof import('../src/lib/store');
type Sync = typeof import('../src/lib/sync');
type Device = typeof import('../src/lib/device');

let store: Store, sync: Sync, dev: Device;

/** A fake repository holding at most one file, with GitHub's version check on writes. */
function fakeGitHub() {
  const gh = {
    file: null as { text: string; sha: string } | null,
    puts: 0,
    gets: 0,
    isPrivate: true,
    failNextPutWith: 0,
    onBeforePut: null as null | (() => void),
    /** Runs while a read is "in the air": after the request left, before the answer arrives. */
    duringGet: null as null | (() => void),
    docs(): DocMap { return gh.file ? parseLog(gh.file.text, true).docs : {}; },
    seed(docs: DocMap) { gh.file = { text: serializeDocs(docs), sha: 'seed' + Math.random() }; },
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const auth = (init?.headers as Record<string, string>).Authorization;
    if (auth !== 'Bearer good-token') return json(401, { message: 'Bad credentials' });
    if (url.endsWith('/user')) return json(200, { login: 'me' });
    if (url.endsWith('/repos/me/data')) return json(200, { private: gh.isPrivate, full_name: 'me/data' });
    if (url.endsWith('/repos/me/data/contents/training-log.json')) {
      if (method === 'GET') {
        gh.gets++;
        if (gh.duringGet) { const f = gh.duringGet; gh.duringGet = null; f(); }
        return gh.file ? json(200, { sha: gh.file.sha, encoding: 'base64', content: b64encode(gh.file.text) }) : json(404, { message: 'Not Found' });
      }
      if (method === 'PUT') {
        if (gh.onBeforePut) { const f = gh.onBeforePut; gh.onBeforePut = null; f(); }
        if (gh.failNextPutWith) { const s = gh.failNextPutWith; gh.failNextPutWith = 0; return json(s, { message: 'nope' }); }
        const body = JSON.parse(String(init?.body)) as { content: string; sha?: string };
        if (gh.file ? body.sha !== gh.file.sha : !!body.sha) return json(409, { message: 'is at a different sha' });
        gh.file = { text: b64decode(body.content), sha: 'v' + ++gh.puts };
        return json(200, { content: { sha: gh.file.sha } });
      }
    }
    return json(404, { message: 'Not Found' });
  });
  return gh;
}

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllGlobals();
  globalThis.indexedDB = new IDBFactory();
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
  store = await import('../src/lib/store');
  sync = await import('../src/lib/sync');
  dev = await import('../src/lib/device');
  await store.loadStore();
});

const reload = async () => {
  await store.flushed();
  vi.resetModules();
  store = await import('../src/lib/store');
  await store.loadStore();
};

describe('store', () => {
  it('starts empty and keeps what is saved across a reload', async () => {
    expect(store.isEmpty()).toBe(true);
    expect(store.getConfig().updatedAt).toBe(0);
    store.saveConfig((c) => { c.routines.push({ id: 'a', name: 'Day A', liftIds: [] }); });
    store.putSession(session('2026-03-02', [did(PRESS, sets(30, 10))]));
    await reload();
    expect(store.getConfig().routines.map((r) => r.name)).toEqual(['Day A']);
    expect(store.getSessions().map((s) => s.date)).toEqual(['2026-03-02']);
    expect(store.isEmpty()).toBe(false);
  });

  it('stamps every change later than the one before, even within the same millisecond', () => {
    store.saveConfig((c) => { c.prefs.restSec = 60; });
    const a = store.getConfig().updatedAt;
    store.saveConfig((c) => { c.prefs.restSec = 120; });
    expect(store.getConfig().updatedAt).toBeGreaterThan(a);
  });

  it('never hands out the stored object for editing in place', () => {
    store.putSession(session('2026-03-02', [did(PRESS, sets(30, 10))]));
    const before = store.getSessions()[0];
    store.updateSession(before.id, (s) => { s.lifts[0].sets[0].r = 12; });
    expect(before.lifts[0].sets[0].r).toBe(10);
    expect(store.getSessions()[0].lifts[0].sets[0].r).toBe(12);
  });

  it('finishing a session files it and clears the active one in one step', async () => {
    const s = session('2026-03-02', [did(PRESS, sets(30, 10))]);
    store.setActive({ id: 'active', type: 'active', updatedAt: 0, date: '2026-03-02', startedAt: s.startedAt, routineId: 'a', routineName: 'Day A', cur: null, lifts: [], run: null });
    expect(store.getActive()).not.toBeNull();
    store.finishActive(s);
    expect(store.getActive()).toBeNull();
    expect(store.allDocs().active.type).toBe('tombstone');
    await reload();
    expect(store.getActive()).toBeNull();
    expect(store.getSessions()).toHaveLength(1);
  });

  it('deleting leaves a marker behind rather than nothing', () => {
    const s = session('2026-03-02', []);
    store.putSession(s);
    store.deleteSession(s.id);
    expect(store.getSessions()).toHaveLength(0);
    expect(store.allDocs()[s.id]).toMatchObject({ type: 'tombstone', deleted: true });
  });

  describe('importDocs', () => {
    const a = session('2026-03-02', [did(PRESS, sets(30, 10))]);
    const b = session('2026-03-05', [did(PRESS, sets(30, 11))]);

    it('merge adds what is missing, keeps what is here, and takes the plan when there is none', () => {
      store.putSession(b);
      const r = store.importDocs({ config: config(), [a.id]: a, [b.id]: { ...b, updatedAt: 1, note: 'older copy' } }, 'merge');
      expect(r).toEqual({ added: 2, updated: 0, removed: 0 });
      expect(store.getSessions().map((s) => s.id)).toEqual([a.id, b.id]);
      expect(store.sessionById(b.id)?.note).toBeUndefined();
      expect(store.getConfig().routines).toHaveLength(2);
    });
    it('merge joins two plans instead of letting either replace the other', () => {
      store.saveConfig((c) => { c.routines.push({ id: 'new', name: 'New', liftIds: ['press'] }); c.lifts.press = { ...PRESS, name: 'My press' }; });
      // An older backup: its routines and lifts are added, but what was edited here since is kept.
      store.importDocs({ config: config({ updatedAt: 5 }) }, 'merge');
      expect(store.getConfig().routines.map((r) => r.id)).toEqual(['new', 'a', 'b']);
      expect(store.getConfig().lifts.press.name).toBe('My press');
      expect(Object.keys(store.getConfig().lifts).sort()).toEqual(['hang', 'press', 'row', 'squat']);
    });
    it('merge with a newer backup still keeps a routine that only exists here', () => {
      store.saveConfig((c) => { c.routines.push({ id: 'new', name: 'New', liftIds: ['press'] }); c.lifts.press = { ...PRESS, name: 'My press' }; });
      store.importDocs({ config: config({ updatedAt: Date.now() + 60_000 }) }, 'merge');
      expect(store.getConfig().routines.map((r) => r.id)).toEqual(['a', 'b', 'new']);
      expect(store.getConfig().lifts.press.name).toBe('Press'); // the newer plan's version of a shared lift
      expect(store.getConfig().updatedAt).toBeGreaterThan(Date.now() + 59_000); // and it will win everywhere it syncs to
    });
    it('merge ignores a backup whose plan is empty', () => {
      store.saveConfig((c) => { c.routines.push({ id: 'new', name: 'New', liftIds: [] }); });
      store.importDocs({ config: config({ routines: [], lifts: {}, updatedAt: Date.now() + 60_000 }) }, 'merge');
      expect(store.getConfig().routines.map((r) => r.id)).toEqual(['new']);
    });
    it('merge brings back a session that was deleted here', () => {
      store.putSession(a);
      store.deleteSession(a.id);
      expect(store.importDocs({ [a.id]: a }, 'merge').added).toBe(1);
      expect(store.sessionById(a.id)).not.toBeNull();
      expect(store.sessionById(a.id)!.updatedAt).toBeGreaterThan(a.updatedAt);
    });
    it('replace makes this device match the file, deleting what the file lacks', () => {
      store.putSession(a);
      store.putSession(b);
      const r = store.importDocs({ config: config(), [a.id]: { ...a, note: 'from file' } }, 'replace');
      expect(r).toEqual({ added: 1, updated: 1, removed: 1 });
      expect(store.getSessions().map((s) => s.id)).toEqual([a.id]);
      expect(store.sessionById(a.id)?.note).toBe('from file');
      expect(store.allDocs()[b.id].type).toBe('tombstone');
    });
  });
});

describe('sync', () => {
  const connect = () => sync.connect('good-token', 'me/data');

  it('refuses a public repository and a bad token, and stays disconnected', async () => {
    const gh = fakeGitHub();
    gh.isPrivate = false;
    await expect(connect()).rejects.toThrow(/public repository/);
    await expect(sync.connect('bad-token', 'me/data')).rejects.toThrow(/didn’t accept the token/);
    await expect(sync.connect('good-token', 'not a repo')).rejects.toThrow(/owner\/name/);
    expect(sync.syncOn()).toBe(false);
    expect(gh.puts).toBe(0);
  });

  it('pushes this device’s log to an empty repository', async () => {
    const gh = fakeGitHub();
    store.importDocs({ config: config() }, 'merge');
    store.putSession(session('2026-03-02', [did(PRESS, sets(30, 10))]));
    await connect();
    expect(sync.syncOn()).toBe(true);
    expect(sync.sync.status).toBe('idle');
    expect(Object.keys(gh.docs()).sort()).toEqual(['config', 's_20260302']);
    expect(dev.device().dirty).toBe(false);
    expect(dev.device().lastSyncAt).toBeGreaterThan(0);
  });

  it('pulls an existing log onto a fresh device without writing anything back', async () => {
    const gh = fakeGitHub();
    gh.seed({ config: config(), s_20260302: session('2026-03-02', [did(PRESS, sets(30, 10))]) });
    await connect();
    expect(store.getConfig().routines).toHaveLength(2);
    expect(store.getSessions()).toHaveLength(1);
    expect(gh.puts).toBe(0);
    await reload();
    expect(store.getSessions()).toHaveLength(1); // what was pulled is on disk
  });

  it('merges both directions and does nothing when already in step', async () => {
    const gh = fakeGitHub();
    const theirs = session('2026-03-05', [did(PRESS, sets(30, 11))]);
    gh.seed({ config: config(), [theirs.id]: theirs });
    await connect();
    const mine = session('2026-03-09', [did(PRESS, sets(35, 8))]);
    store.putSession(mine);
    expect(await sync.syncNow()).toBe(true);
    expect(Object.keys(gh.docs()).sort()).toEqual(['config', mine.id, theirs.id].sort());
    const puts = gh.puts;
    expect(await sync.syncNow()).toBe(true);
    expect(gh.puts).toBe(puts);
  });

  it('carries a deletion from one device to another', async () => {
    const gh = fakeGitHub();
    const s = session('2026-03-05', []);
    store.putSession(s);
    await connect();
    // Another device deletes it and syncs.
    const remote = gh.docs();
    remote[s.id] = { id: s.id, type: 'tombstone', deleted: true, updatedAt: Date.now() + 1000 };
    gh.seed(remote);
    await sync.syncNow();
    expect(store.getSessions()).toHaveLength(0);
  });

  it('reads again and merges when another device writes in between', async () => {
    const gh = fakeGitHub();
    await connect();
    const mine = session('2026-03-09', []), theirs = session('2026-03-10', []);
    store.putSession(mine);
    gh.onBeforePut = () => gh.seed({ ...gh.docs(), [theirs.id]: theirs }); // the other device lands first
    expect(await sync.syncNow()).toBe(true);
    expect(Object.keys(gh.docs()).sort()).toEqual([mine.id, theirs.id].sort());
    expect(store.getSessions().map((x) => x.id).sort()).toEqual([mine.id, theirs.id].sort());
  });

  it('keeps both setups the first time a device with its own plan meets a synced one', async () => {
    const gh = fakeGitHub();
    gh.seed({ config: config({ updatedAt: 50 }) });
    store.saveConfig((c) => { c.routines.push({ id: 'mine', name: 'Mine', liftIds: ['curl'] }); c.lifts.curl = lift('curl', 'dumbbell'); });
    await connect();
    const ids = (c: ConfigDoc) => c.routines.map((r) => r.id);
    expect(ids(store.getConfig())).toEqual(['a', 'b', 'mine']);
    expect(ids(gh.docs().config as ConfigDoc)).toEqual(['a', 'b', 'mine']);
    expect(Object.keys(store.getConfig().lifts)).toContain('curl');
    expect(Object.keys(store.getConfig().lifts)).toContain('press');
  });

  it('after the first sync, the newest plan simply wins', async () => {
    const gh = fakeGitHub();
    gh.seed({ config: config({ updatedAt: 50 }) });
    await connect();
    store.saveConfig((c) => { c.routines = c.routines.filter((r) => r.id !== 'b'); });
    await sync.syncNow();
    expect((gh.docs().config as ConfigDoc).routines.map((r) => r.id)).toEqual(['a']);
  });

  it('will not overwrite a synced file it cannot read', async () => {
    const gh = fakeGitHub();
    await connect();
    const puts = gh.puts;
    gh.file = { text: '{ this is not json', sha: 'broken' };
    store.putSession(session('2026-03-09', []));
    expect(await sync.syncNow()).toBe(false);
    expect(sync.sync.status).toBe('error');
    expect(sync.sync.error).toMatch(/can’t be read/);
    expect(gh.file.text).toBe('{ this is not json');
    expect(gh.puts).toBe(puts);
  });

  it('syncs by itself a few seconds after a change, as one write for a burst of changes', async () => {
    const gh = fakeGitHub();
    await connect();
    const puts = gh.puts;
    vi.useFakeTimers();
    try {
      sync.watchLocalChanges();
      store.putSession(session('2026-03-09', []));
      store.putSession(session('2026-03-10', []));
      expect(dev.device().dirty).toBe(true);
      expect(gh.puts).toBe(puts);
      await vi.advanceTimersByTimeAsync(5000);
      expect(gh.puts).toBe(puts + 1);
      expect(Object.keys(gh.docs()).sort()).toEqual(['s_20260309', 's_20260310']);
      expect(dev.device().dirty).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a token that stopped working and keeps the changes for later', async () => {
    const gh = fakeGitHub();
    await connect();
    dev.setDevice({ token: 'expired' });
    store.putSession(session('2026-03-09', []));
    expect(await sync.syncNow()).toBe(false);
    expect(sync.sync).toMatchObject({ status: 'error', kind: 'auth' });
    dev.setDevice({ token: 'good-token' });
    expect(await sync.syncNow()).toBe(true);
    expect(Object.keys(gh.docs())).toContain('s_20260309');
  });

  it('notices changes made while a sync was in flight and stays marked as unsynced', async () => {
    const gh = fakeGitHub();
    await connect();
    store.putSession(session('2026-03-09', []));
    const late = session('2026-03-10', []);
    gh.onBeforePut = () => store.putSession(late); // logged while the write was on its way
    expect(await sync.syncNow()).toBe(true);
    expect(Object.keys(gh.docs())).not.toContain(late.id);
    expect(dev.device().dirty).toBe(true);
    expect(await sync.syncNow()).toBe(true);
    expect(Object.keys(gh.docs())).toContain(late.id);
    expect(dev.device().dirty).toBe(false);
  });

  it('disconnecting forgets the token but leaves the log alone', async () => {
    fakeGitHub();
    store.putSession(session('2026-03-09', []));
    await connect();
    sync.disconnect();
    expect(dev.device().token).toBe('');
    expect(sync.syncOn()).toBe(false);
    expect(store.getSessions()).toHaveLength(1);
  });

  describe('an empty plan never replaces a real one', () => {
    const pickUnits = () => store.saveConfig((c) => { c.prefs.unit = 'kg'; }); // all a new device has done

    it('when a new device that only changed a setting connects to a log with a plan', async () => {
      const gh = fakeGitHub();
      gh.seed({ config: config({ updatedAt: 50 }) });
      pickUnits();
      await connect();
      expect(store.getConfig().routines.map((r) => r.id)).toEqual(['a', 'b']);
      expect((gh.docs().config as ConfigDoc).routines.map((r) => r.id)).toEqual(['a', 'b']);
      expect(Object.keys((gh.docs().config as ConfigDoc).lifts)).toHaveLength(4);
    });

    it('when the device holding the only plan connects after an empty one was synced', async () => {
      const gh = fakeGitHub();
      gh.seed({ config: config({ routines: [], lifts: {}, updatedAt: Date.now() + 3_600_000 }) }); // from a device whose clock runs ahead
      store.importDocs({ config: config({ updatedAt: 50 }) }, 'merge');
      await connect();
      expect(store.getConfig().routines.map((r) => r.id)).toEqual(['a', 'b']);
      const pushed = gh.docs().config as ConfigDoc;
      expect(pushed.routines.map((r) => r.id)).toEqual(['a', 'b']);
      expect(pushed.updatedAt).toBeGreaterThan(Date.now() + 3_599_000);
    });

    it('on later syncs too, not only the first', async () => {
      const gh = fakeGitHub();
      gh.seed({ config: config({ updatedAt: 50 }) });
      await connect();
      gh.seed({ ...gh.docs(), config: config({ routines: [], lifts: {}, updatedAt: Date.now() + 5000 }) });
      await sync.syncNow();
      expect(store.getConfig().routines).toHaveLength(2);
      expect((gh.docs().config as ConfigDoc).routines).toHaveLength(2);
    });
  });

  it('a sync already under way cannot bring the log back after the device is erased', async () => {
    const gh = fakeGitHub();
    gh.seed({ config: config(), s_20260302: session('2026-03-02', [did(PRESS, sets(30, 10))]) });
    await connect();
    expect(store.getSessions()).toHaveLength(1);
    const puts = gh.puts;
    gh.duringGet = () => { sync.disconnect(); store.eraseDevice(); };
    expect(await sync.syncNow()).toBe(false);
    expect(store.isEmpty()).toBe(true);
    expect(sync.sync.status).toBe('off');
    expect(dev.device().token).toBe('');
    expect(gh.puts).toBe(puts);
    await reload();
    expect(store.isEmpty()).toBe(true);
  });

  it('writes back entries it does not understand instead of dropping them', async () => {
    const gh = fakeGitHub();
    const fromTheFuture = { id: 'goal_1', type: 'goal', updatedAt: 9, target: '60s' };
    gh.file = { text: serializeDocs({ config: config() }, {}, [fromTheFuture]), sha: 'seed' };
    await connect();
    store.putSession(session('2026-03-09', []));
    expect(await sync.syncNow()).toBe(true);
    const written = JSON.parse(gh.file.text) as { docs: { id: string }[] };
    expect(written.docs.map((d) => d.id).sort()).toEqual(['config', 'goal_1', 's_20260309']);
    expect(written.docs.find((d) => d.id === 'goal_1')).toEqual(fromTheFuture);
  });

  it('writes text that survives the trip, accents and all', () => {
    const s = 'Split squats — “harder” on the right ✓ ñ';
    expect(b64decode(b64encode(s))).toBe(s);
    const big = 'x'.repeat(200_000) + 'é';
    expect(b64decode(b64encode(big))).toBe(big);
  });
});

export type { SessionDoc };
