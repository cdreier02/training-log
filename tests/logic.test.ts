import { describe, expect, it } from 'vitest';
import { weekStart } from '../src/lib/dates';
import {
  bestSet, buildSession, curIdx, deltaLine, entriesFor, lastEntry, liftStory, loadsFor, newActive, nextLoad, nudge,
  parseWeights, planFor, prFlags, sortSessions, splitLoad, upNext, weekCounts,
} from '../src/lib/logic';
import { config, did, HANG, PRESS, ROW, session, sets, SQUAT } from './fixtures';

describe('history lookups', () => {
  const a = session('2026-03-02', [did(PRESS, sets(25, 10, 10, 10))]);
  const b = session('2026-03-05', [did(PRESS, sets(30, 10, 9, 8)), did(ROW, sets(70, 8, 8, 8))]);
  const c = session('2026-03-09', [did(ROW, sets(90, 8, 7, 6))]);
  const sorted = sortSessions([c, a, b]);

  it('sorts oldest first', () => {
    expect(sorted.map((s) => s.date)).toEqual(['2026-03-02', '2026-03-05', '2026-03-09']);
  });
  it('finds every entry for a lift and the latest one', () => {
    expect(entriesFor(sorted, 'press').map((e) => e.s.date)).toEqual(['2026-03-02', '2026-03-05']);
    expect(lastEntry(sorted, 'press')?.s.date).toBe('2026-03-05');
    expect(lastEntry(sorted, 'press', b)?.s.date).toBe('2026-03-02');
    expect(lastEntry(sorted, 'press', a)).toBeNull();
  });
  it('orders two sessions on the same day by start time', () => {
    const late = session('2026-03-05', [], { id: 'late', startedAt: '2026-03-05T20:00:00.000Z' });
    expect(sortSessions([late, b]).map((s) => s.id)).toEqual([b.id, 'late']);
  });
});

describe('planFor', () => {
  it('starts a lift with no history at its starting weight, else the lightest', () => {
    expect(planFor(PRESS, [])).toEqual([{ w: 20, r: 10 }, { w: 20, r: 10 }, { w: 20, r: 10 }]);
    expect(planFor({ ...SQUAT, start: 95 }, [])[0]).toEqual({ w: 95, r: 10 });
    expect(planFor(HANG, [])[0]).toEqual({ w: 0, r: 30 });
  });
  it('repeats last time’s weights set by set at the target count', () => {
    const s = session('2026-03-02', [did(PRESS, [...sets(35, 9), ...sets(30, 10)])]);
    expect(planFor(PRESS, [s])).toEqual([{ w: 35, r: 10 }, { w: 30, r: 10 }, { w: 30, r: 10 }]);
  });
});

describe('an active session', () => {
  it('opens on the first unfinished lift and files only what was done', () => {
    const cfg = config();
    const A = newActive(cfg.routines[0], cfg, [], '2026-03-10', Date.parse('2026-03-10T17:00:00Z'));
    expect(A.lifts.map((l) => l.id)).toEqual(['press', 'row', 'hang']);
    expect(curIdx(A)).toBe(0);
    A.lifts[0].sets = sets(20, 10, 10, 10);
    expect(curIdx(A)).toBe(1);
    A.lifts[1].skipped = true;
    expect(curIdx(A)).toBe(2);
    A.cur = 0;
    expect(curIdx(A)).toBe(0);
    const s = buildSession(A, Date.parse('2026-03-10T17:45:00Z'));
    expect(s.lifts.map((l) => l.id)).toEqual(['press']);
    expect(s.date).toBe('2026-03-10');
    expect(s.id.startsWith('s_20260310_')).toBe(true);
  });
});

describe('deltaLine', () => {
  it('compares top weight first, then sets, then reps', () => {
    const prev = did(PRESS, sets(30, 10, 10, 8));
    expect(deltaLine(did(PRESS, sets(35, 8, 8, 8)), prev)).toBe('Up from the 30s.');
    expect(deltaLine(did(PRESS, sets(25, 10, 10, 10)), prev)).toBe('Down from the 30s.');
    expect(deltaLine(did(PRESS, sets(30, 10, 10)), prev)).toBe('Same top weight, 2 sets instead of 3.');
    expect(deltaLine(did(PRESS, sets(30, 10, 10, 10)), prev)).toBe('Same top weight, 2 more reps.');
    expect(deltaLine(did(PRESS, sets(30, 10, 10, 7)), prev)).toBe('Same top weight, 1 fewer rep.');
    expect(deltaLine(did(PRESS, sets(30, 10, 10, 8)), prev)).toBe('Same as last time.');
    expect(deltaLine(did(PRESS, sets(30, 10)), null)).toBe('First time logged.');
  });
  it('compares total time for timed bodyweight work', () => {
    expect(deltaLine(did(HANG, sets(0, 30, 30, 30)), did(HANG, sets(0, 30, 25, 25)))).toBe('10 more seconds than last time.');
  });
});

describe('available loads', () => {
  it('includes the add-on plate on a stack', () => {
    expect(loadsFor(ROW)).toEqual([50, 55, 70, 75, 90, 95, 110, 115]);
    expect(nextLoad(ROW, 70)).toBe(75);
    expect(nextLoad(ROW, 75)).toBe(90);
    expect(nextLoad(ROW, 115)).toBeNull();
  });
  it('steps by five when a lift has no list', () => {
    expect(nextLoad(SQUAT, 95)).toBe(100);
  });
  it('splits a logged weight back into pin and add-on', () => {
    expect(splitLoad(ROW, 75)).toEqual({ base: 70, addOn: true });
    expect(splitLoad(ROW, 70)).toEqual({ base: 70, addOn: false });
    expect(splitLoad(ROW, 80)).toEqual({ base: 80, addOn: false });
  });
  it('reads a typed list of weights', () => {
    expect(parseWeights('70, 85;100  120 85 abc -5')).toEqual([70, 85, 100, 120]);
  });
});

describe('nudge', () => {
  const entry = (s: ReturnType<typeof sets>) => ({ s: session('2026-03-02', []), l: did(PRESS, s) });
  it('suggests the next weight only after a clean session', () => {
    expect(nudge(PRESS, entry(sets(30, 10, 10, 10)))).toBe('You hit every set at the 30s. Next up is the 35s.');
  });
  it('stays quiet when a count was missed, unknown, or the session was short', () => {
    expect(nudge(PRESS, entry(sets(30, 10, 10, 9)))).toBe('');
    expect(nudge(PRESS, entry(sets(30, 10, 10, null)))).toBe('');
    expect(nudge(PRESS, entry(sets(30, 10, 10)))).toBe('');
  });
  it('defers to a note that says to hold', () => {
    const noted = (note: string) => ({ s: session('2026-03-02', []), l: did(PRESS, sets(30, 10, 10, 10), note) });
    expect(nudge(PRESS, noted('Very difficult. Holding here to build up.'))).toBe('');
    expect(nudge(PRESS, noted('Left shoulder a bit sore.'))).toBe('');
    expect(nudge(PRESS, noted('Felt good.'))).not.toBe('');
  });
  it('stays quiet when a set was very hard, the weights were mixed, or there is nowhere to go', () => {
    expect(nudge(PRESS, entry([{ w: 30, r: 10 }, { w: 30, r: 10 }, { w: 30, r: 10, feel: 'hard' }]))).toBe('');
    expect(nudge(PRESS, entry([...sets(35, 10), ...sets(30, 10, 10)]))).toBe('');
    expect(nudge(PRESS, entry(sets(40, 10, 10, 10)))).toBe('');
    expect(nudge(HANG, { s: session('2026-03-02', []), l: did(HANG, sets(0, 30, 30, 30)) })).toBe('');
  });
});

describe('records', () => {
  const s1 = session('2026-03-02', [did(PRESS, sets(30, 10, 9, 8)), did(HANG, sets(0, 30, 30))]);
  const s2 = session('2026-03-05', [did(PRESS, sets(30, 11, 9, 8)), did(HANG, sets(0, 40, 30))]);
  const s3 = session('2026-03-09', [did(PRESS, sets(35, 6, 6, 6))]);
  const s4 = session('2026-03-12', [did(PRESS, sets(30, 12, 12, 12))]);
  const all = sortSessions([s1, s2, s3, s4]);
  it('never flags a first entry', () => {
    expect(prFlags(all, s1, s1.lifts[0])).toEqual({ weight: false, reps: false });
  });
  it('flags more reps at the same weight', () => {
    expect(prFlags(all, s2, s2.lifts[0])).toEqual({ weight: false, reps: true });
    expect(prFlags(all, s2, s2.lifts[1])).toEqual({ weight: false, reps: true });
  });
  it('flags a heavier top weight', () => {
    expect(prFlags(all, s3, s3.lifts[0])).toEqual({ weight: true, reps: false });
  });
  it('compares reps against every earlier set at this weight or heavier', () => {
    const matched = session('2026-03-14', [did(PRESS, sets(25, 12, 12, 12))]); // 12 was already done with the 30s
    expect(prFlags(sortSessions([...all, matched]), matched, matched.lifts[0])).toEqual({ weight: false, reps: false });
    const beaten = session('2026-03-14', [did(PRESS, sets(25, 13, 13, 13))]);
    expect(prFlags(sortSessions([...all, beaten]), beaten, beaten.lifts[0])).toEqual({ weight: false, reps: true });
  });
  it('summarizes a lift’s history and its best set', () => {
    const es = entriesFor(all, 'press');
    expect(liftStory(es)).toBe('Back at the 30s after 4 sessions. The most so far is the 35s.');
    expect(liftStory(es.slice(0, 3))).toBe('From the 30s to the 35s in 3 sessions.');
    expect(liftStory(es.slice(0, 2))).toBe('Holding at the 30s across 2 sessions.');
    expect(bestSet(es)).toBe('35s × 6');
    expect(liftStory(entriesFor(all, 'hang'))).toBe('From 30 seconds to 40 seconds in 2 sessions.');
  });
});

describe('weeks', () => {
  it('counts sessions into Monday-start weeks ending with this one', () => {
    expect(weekStart('2026-03-15')).toBe('2026-03-09'); // a Sunday belongs to the week that began on Monday
    const list = [session('2026-03-09', []), session('2026-03-15', []), session('2026-03-16', []), session('2025-01-01', [])];
    const w = weekCounts(list, '2026-03-18', 4);
    expect(w.map((x) => x.start)).toEqual(['2026-02-23', '2026-03-02', '2026-03-09', '2026-03-16']);
    expect(w.map((x) => x.n)).toEqual([0, 0, 2, 1]);
  });
});

describe('upNext', () => {
  it('picks the routine that has waited longest once there is history', () => {
    const cfg = config();
    expect(upNext(cfg, [])).toBe('');
    const a = session('2026-03-02', [], { routineId: 'a' });
    expect(upNext(cfg, [a])).toBe('b');
    const b = session('2026-03-04', [], { routineId: 'b' });
    expect(upNext(cfg, sortSessions([a, b]))).toBe('a');
  });
});
