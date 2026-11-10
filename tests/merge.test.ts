import { describe, expect, it } from 'vitest';
import { exportCsv, exportJson, normalizeDoc, parseLog } from '../src/lib/backup';
import { canon, combineConfigs, mergeDocs, serializeDocs } from '../src/lib/merge';
import type { ConfigDoc, DocMap, SessionDoc, Tombstone } from '../src/lib/types';
import { config, did, lift, PRESS, ROW, session, sets } from './fixtures';

const tomb = (id: string, updatedAt: number): Tombstone => ({ id, type: 'tombstone', deleted: true, updatedAt });
const map = (...docs: DocMap[string][]): DocMap => Object.fromEntries(docs.map((d) => [d.id, d]));

describe('mergeDocs', () => {
  const a = session('2026-03-02', [did(PRESS, sets(30, 10))]);
  const b = session('2026-03-05', [did(PRESS, sets(30, 11))]);

  it('unions docs that only one side has', () => {
    const m = mergeDocs(map(a), map(b));
    expect(Object.keys(m.merged).sort()).toEqual([a.id, b.id].sort());
    expect(m.takeRemote).toEqual([b.id]);
    expect(m.remoteStale).toBe(true);
  });
  it('is a no-op when both sides already match', () => {
    const m = mergeDocs(map(a, b), map(b, a));
    expect(m.takeRemote).toEqual([]);
    expect(m.remoteStale).toBe(false);
  });
  it('keeps the newer copy of the same doc, whichever side it is on', () => {
    const newer = { ...a, updatedAt: a.updatedAt + 5, note: 'edited' };
    expect(mergeDocs(map(newer), map(a))).toMatchObject({ takeRemote: [], remoteStale: true });
    const m = mergeDocs(map(a), map(newer));
    expect(m.takeRemote).toEqual([a.id]);
    expect(m.remoteStale).toBe(false);
    expect((m.merged[a.id] as SessionDoc).note).toBe('edited');
  });
  it('lets a newer deletion win, and a newer edit undo an older deletion', () => {
    expect(mergeDocs(map(a), map(tomb(a.id, a.updatedAt + 1))).merged[a.id].type).toBe('tombstone');
    expect(mergeDocs(map(a), map(tomb(a.id, a.updatedAt - 1))).merged[a.id].type).toBe('session');
  });
  it('gives the same answer from both sides', () => {
    const l = map(a, tomb(b.id, b.updatedAt + 9)), r = map({ ...a, updatedAt: a.updatedAt + 1, note: 'x' }, b);
    expect(canon(mergeDocs(l, r).merged)).toBe(canon(mergeDocs(r, l).merged));
  });
  it('settles equal stamps with different content in favor of the synced copy', () => {
    const x = { ...a, note: 'one' }, y = { ...a, note: 'two' };
    expect((mergeDocs(map(x), map(y)).merged[a.id] as SessionDoc).note).toBe('two');
    expect(mergeDocs(map(x), map(y)).takeRemote).toEqual([a.id]);
  });
});

describe('combineConfigs', () => {
  it('keeps the lifts and routines from both setups', () => {
    const local = config({ routines: [{ id: 'mine', name: 'Mine', liftIds: ['curl'] }], lifts: { curl: lift('curl', 'dumbbell'), press: { ...PRESS, name: 'Local press' } } });
    const remote = config();
    const c = combineConfigs(local, remote, 5000);
    expect(c.routines.map((r) => r.id)).toEqual(['a', 'b', 'mine']);
    expect(Object.keys(c.lifts).sort()).toEqual(['curl', 'hang', 'press', 'row', 'squat']);
    expect(c.lifts.press.name).toBe('Press'); // where both define a lift, the synced one is kept
    expect(c.updatedAt).toBe(5000);
  });
});

describe('the file format', () => {
  const docs = map(config(), session('2026-03-02', [did(PRESS, sets(30, 10, 9, 8), 'Left elbow, “fine”')], { run: { mi: 1.5, min: 14, note: '' } }), tomb('s_gone', 77));

  it('round-trips through serialize and parse without changing anything', () => {
    const back = parseLog(serializeDocs(docs));
    expect(canon(back.docs)).toBe(canon(docs));
    expect(back.sessions).toBe(1);
    expect(back.hasConfig).toBe(true);
    expect(back.skipped).toBe(0);
  });
  it('puts one doc on each line, config first', () => {
    const lines = serializeDocs(docs).split('\n').filter((l) => l.startsWith('  {'));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('"id":"config"');
  });
  it('carries extra header fields in a backup', () => {
    expect(JSON.parse(exportJson(docs, new Date('2026-03-03T00:00:00Z'))).exportedAt).toBe('2026-03-03T00:00:00.000Z');
  });
  it('rejects files that are not a log', () => {
    expect(() => parseLog('not json')).toThrow(/isn’t a Training Log backup/);
    expect(() => parseLog('{"hello": 1}')).toThrow(/doesn’t have any/);
    expect(parseLog('{"format":"training-log","version":2,"docs":[]}', true).docs).toEqual({});
  });
});

describe('reading an export from the original artifact', () => {
  // The artifact stored docs without ids or stamps inside them: the id was the document's name.
  const artifact = {
    config: { type: 'config', routines: [{ id: 'a', name: 'Day A', liftIds: ['press'] }], lifts: { press: { id: 'press', name: 'Press', kind: 'dumbbell', weights: [25, 20, 20], addOn: 0, sets: 3, reps: 10, repUnit: 'reps', cue: '', start: 20 } } },
    active: { type: 'active', date: '2026-03-09', startedAt: '2026-03-09T17:00:00.000Z', routineId: 'a', routineName: 'Day A', cur: 0, run: null, lifts: [{ id: 'press', name: 'Press', kind: 'dumbbell', repUnit: 'reps', note: '', skipped: false, sets: [], plan: [{ w: 20, r: 10 }] }] },
    s_20260302_seed: { type: 'session', date: '2026-03-02', startedAt: '2026-03-02T18:00:00.000Z', endedAt: '2026-03-02T18:40:00.000Z', routineId: 'a', routineName: 'Day A', lifts: [{ id: 'press', name: 'Press', kind: 'dumbbell', repUnit: 'reps', note: 'ok', sets: [{ w: 20, r: null }, { w: 20, r: 10, feel: 'good' }] }] },
    s_20260305_seed: { type: 'session', date: '2026-03-05', startedAt: '2026-03-05T18:00:00.000Z', endedAt: '2026-03-05T18:00:00.000Z', routineId: '', routineName: 'Run', lifts: [], run: { mi: 1, min: 0, note: '' } },
  };

  it('accepts a map of documents keyed by name', () => {
    const p = parseLog(JSON.stringify({ format: 'training-log', version: 1, docs: artifact }));
    expect(p.sessions).toBe(2);
    expect(p.skipped).toBe(0);
    const cfg = p.docs.config as ConfigDoc;
    expect(cfg.lifts.press.weights).toEqual([20, 25]);
    expect(cfg.lifts.press.start).toBe(20);
    expect(cfg.prefs).toEqual({ unit: 'lb', dist: 'mi', restSec: 90 });
    const s = p.docs.s_20260302_seed as SessionDoc;
    expect(s.id).toBe('s_20260302_seed');
    expect(s.updatedAt).toBe(Date.parse('2026-03-02T18:40:00.000Z'));
    expect(s.lifts[0].sets).toEqual([{ w: 20, r: null }, { w: 20, r: 10, feel: 'good' }]);
    expect((p.docs.s_20260305_seed as SessionDoc).run).toEqual({ mi: 1, min: 0, note: '' });
    expect(p.docs.active.type).toBe('active');
  });
  it('gives the same stamps every time, so two devices importing the same file agree', () => {
    const one = parseLog(JSON.stringify({ docs: artifact })).docs, two = parseLog(JSON.stringify(artifact)).docs;
    expect(canon(one)).toBe(canon(two));
    expect(mergeDocs(one, two)).toMatchObject({ takeRemote: [], remoteStale: false });
  });
  it('accepts the bundled shape too', () => {
    const p = parseLog(JSON.stringify({ config: artifact.config, sessions: [{ ...artifact.s_20260302_seed, _id: 's_x' }] }));
    expect(Object.keys(p.docs).sort()).toEqual(['config', 's_x']);
  });
});

describe('normalizeDoc', () => {
  it('drops what it cannot make sense of instead of passing it through', () => {
    expect(normalizeDoc(null)).toBeNull();
    expect(normalizeDoc({ type: 'session', date: 'tomorrow', lifts: [] }, 's_1')).toBeNull();
    expect(normalizeDoc({ type: 'session', date: '2026-02-30', lifts: [] }, 's_1')).toBeNull();
    expect(normalizeDoc({ type: 'session', date: '2026-03-02', lifts: [] }, 'bad id!')).toBeNull();
    expect(normalizeDoc({ type: 'session', date: '2026-03-02', lifts: [] }, 'config')).toBeNull();
  });
  it('repairs fields that are the wrong shape', () => {
    const s = normalizeDoc({ type: 'session', date: '2026-03-02', routineName: 7, lifts: [{ id: 'press', kind: 'laser', sets: [{ w: '30', r: '10.4', feel: 'meh' }, 'junk', { w: -5, r: null }] }, { name: 'no id' }], run: { mi: 'far' }, note: 'x'.repeat(900) }, 's_1') as SessionDoc;
    expect(s.routineName).toBe('Session');
    expect(s.lifts).toHaveLength(1);
    expect(s.lifts[0]).toMatchObject({ kind: 'dumbbell', name: 'Lift', sets: [{ w: 30, r: 10 }, { w: 0, r: null }] });
    expect(s.run).toBeUndefined();
    expect(s.note).toHaveLength(500);
  });
  it('keeps a deletion marker as a deletion', () => {
    expect(normalizeDoc({ id: 's_1', deleted: true, updatedAt: 9 })).toEqual({ id: 's_1', type: 'tombstone', deleted: true, updatedAt: 9 });
  });
});

describe('exportCsv', () => {
  it('writes one row per set and quotes what needs it', () => {
    const csv = exportCsv([session('2026-03-02', [did(PRESS, [{ w: 30, r: 10, feel: 'good' }, { w: 30, r: null }], 'Said "easy", then =SUM(1)'), did(ROW, sets(70, 8), '-careful')], { run: { mi: 1, min: 9, note: '' } })]);
    const rows = csv.trim().split('\r\n');
    expect(rows[0]).toBe('date,routine,lift,equipment,set,weight_lb,count,count_unit,feel,note,distance_mi,minutes');
    expect(rows[1]).toBe('2026-03-02,Day A,Press,dumbbell,1,30,10,reps,good,"Said ""easy"", then =SUM(1)",,');
    expect(rows[2]).toBe('2026-03-02,Day A,Press,dumbbell,2,30,,reps,,,,');
    expect(rows[3]).toBe("2026-03-02,Day A,Row,stack,1,70,8,reps,,'-careful,,");
    expect(rows[4]).toBe('2026-03-02,Day A,Run,,,,,,,,1,9');
  });
});
