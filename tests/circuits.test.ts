import { describe, expect, it } from 'vitest';
import { normalizeDoc, parseLog } from '../src/lib/backup';
import { reportText } from '../src/lib/format';
import { buildSession, circuitProgress, circuitStep, liftDone, moveInCircuit, moveItem, newActive, nextStep, pinAfter, routineItems, tidyRoutine } from '../src/lib/logic';
import { canon, serializeDocs } from '../src/lib/merge';
import type { ActiveDoc, Circuit, ConfigDoc, Routine } from '../src/lib/types';
import { config, HANG, lift, PRESS, ROW, SQUAT } from './fixtures';

const CURL = lift('curl', 'dumbbell', { name: 'Curl', weights: [10, 15, 20] });
const LIFTS = { press: PRESS, row: ROW, hang: HANG, squat: SQUAT, curl: CURL };
const CORE: Circuit = { id: 'c1', name: 'Core', rounds: 2, liftIds: ['hang', 'row'] };

const routine = (over: Partial<Routine> = {}): Routine => ({ id: 'a', name: 'Day A', liftIds: ['press', 'row', 'hang', 'curl', 'squat'], circuits: [{ ...CORE, liftIds: CORE.liftIds.slice() }], ...over });
const cfg = (r = routine()): ConfigDoc => config({ routines: [r], lifts: LIFTS });
const shape = (r: Routine) => routineItems(r, LIFTS).map((it) => (it.kind === 'lift' ? it.id : it.c.name + '[' + it.c.liftIds.join(',') + ']'));

describe('a routine with a circuit', () => {
  it('reads as single lifts and whole circuits, with the circuit where its first lift is', () => {
    expect(shape(routine())).toEqual(['press', 'Core[hang,row]', 'curl', 'squat']);
  });
  it('is stored with the circuit’s lifts together, in the circuit’s own order', () => {
    const r = routine();
    tidyRoutine(r, LIFTS);
    expect(r.liftIds).toEqual(['press', 'hang', 'row', 'curl', 'squat']);
    expect(r.circuits).toEqual([CORE]);
  });
  it('lets a circuit dissolve when it is down to one lift', () => {
    const r = routine({ circuits: [{ ...CORE, liftIds: ['hang', 'deleted-lift'] }] });
    expect(shape(r)).toEqual(['press', 'row', 'hang', 'curl', 'squat']);
    tidyRoutine(r, LIFTS);
    expect(r.circuits).toBeUndefined();
    expect(r.liftIds).toEqual(['press', 'row', 'hang', 'curl', 'squat']);
  });
  it('keeps a lift in only one circuit', () => {
    const r = routine({ circuits: [CORE, { id: 'c2', name: 'Arms', rounds: 3, liftIds: ['row', 'curl', 'press'] }] });
    expect(shape(r)).toEqual(['Arms[curl,press]', 'Core[hang,row]', 'squat']);
  });
  it('moves a circuit as one block, and a lift within its circuit', () => {
    const r = routine();
    moveItem(r, LIFTS, 1, 1);
    expect(r.liftIds).toEqual(['press', 'curl', 'hang', 'row', 'squat']);
    moveItem(r, LIFTS, 0, -1); // already first: nothing happens
    expect(r.liftIds).toEqual(['press', 'curl', 'hang', 'row', 'squat']);
    moveInCircuit(r, LIFTS, 'c1', 'row', -1);
    expect(shape(r)).toEqual(['press', 'curl', 'Core[row,hang]', 'squat']);
  });
  it('leaves a routine without circuits exactly as it was', () => {
    const r: Routine = { id: 'a', name: 'Day A', liftIds: ['press', 'row'] };
    tidyRoutine(r, LIFTS);
    expect(r).toEqual({ id: 'a', name: 'Day A', liftIds: ['press', 'row'] });
  });
});

describe('a session with a circuit', () => {
  const start = () => newActive(cfg().routines[0], cfg(), [], '2026-03-10', Date.parse('2026-03-10T17:00:00Z'));
  /** Logs whatever is up next, the way the log sheet does, and says what it was. */
  const logNext = (A: ActiveDoc): string => {
    const s = nextStep(A);
    if (!s) return 'finished';
    const l = A.lifts[s.li];
    l.sets.push({ w: l.plan[s.si].w, r: l.plan[s.si].r });
    A.cur = pinAfter(A, s.li);
    return l.id + (s.si + 1);
  };

  it('gives circuit lifts one set per round and leaves the others alone', () => {
    const A = start();
    expect(A.lifts.map((l) => l.id + ':' + l.plan.length + (l.cid ? ':' + l.cid : ''))).toEqual(['press:3', 'hang:2:c1', 'row:2:c1', 'curl:3', 'squat:3']);
    expect(A.circuits).toEqual([{ id: 'c1', name: 'Core', rounds: 2 }]);
  });

  it('goes round by round through a circuit, and set by set through everything else', () => {
    const A = start();
    const order: string[] = [];
    for (let i = 0; i < 20; i++) { const x = logNext(A); if (x === 'finished') break; order.push(x); }
    expect(order).toEqual(['press1', 'press2', 'press3', 'hang1', 'row1', 'hang2', 'row2', 'curl1', 'curl2', 'curl3', 'squat1', 'squat2', 'squat3']);
    expect(A.lifts.every(liftDone)).toBe(true);
    expect(nextStep(A)).toBeNull();
  });

  it('stays in a circuit once it is started, even with earlier lifts unfinished', () => {
    const A = start();
    A.cur = 2; // tapped Row, which is in the circuit
    expect(nextStep(A)).toEqual({ li: 1, si: 0 }); // the circuit starts with its first lift
    expect([logNext(A), logNext(A), logNext(A), logNext(A)]).toEqual(['hang1', 'row1', 'hang2', 'row2']);
    expect(A.cur).toBeNull();
    expect(logNext(A)).toBe('press1'); // then back to what was skipped over
  });

  it('reports how many rounds are done', () => {
    const A = start();
    A.cur = 1;
    expect(circuitProgress(A, 'c1')).toEqual({ done: 0, rounds: 2 });
    logNext(A);
    expect(circuitProgress(A, 'c1')).toEqual({ done: 0, rounds: 2 }); // half a round isn't a round
    logNext(A);
    expect(circuitProgress(A, 'c1')).toEqual({ done: 1, rounds: 2 });
  });

  it('drops a skipped lift from the rounds that are left', () => {
    const A = start();
    A.cur = 1;
    logNext(A); logNext(A); // round one
    A.lifts[1].skipped = true; // Hang is skipped from here on
    A.cur = pinAfter(A, 1);
    expect(circuitStep(A, 'c1')).toEqual({ li: 2, si: 1 });
    expect(logNext(A)).toBe('row2');
    expect(circuitStep(A, 'c1')).toBeNull();
    expect(circuitProgress(A, 'c1')).toEqual({ done: 2, rounds: 2 });
  });

  it('files each lift with the circuit it was done in', () => {
    const A = start();
    for (let i = 0; i < 20 && logNext(A) !== 'finished'; i++) { /* log everything */ }
    const s = buildSession(A, Date.parse('2026-03-10T17:40:00Z'));
    expect(s.lifts.map((l) => l.id + (l.circuit ? ' in ' + l.circuit : ''))).toEqual(['press', 'hang in Core', 'row in Core', 'curl', 'squat']);
    expect(reportText(s).split('\n')[2]).toBe('Hang (circuit: Core): 30, 30 sec.');
  });
});

describe('circuits in saved files', () => {
  it('come back unchanged from the synced file', () => {
    const c = cfg();
    tidyRoutine(c.routines[0], LIFTS);
    const A = newActive(c.routines[0], c, [], '2026-03-10', 1000);
    A.lifts[1].sets.push({ w: 0, r: 30 });
    const back = parseLog(serializeDocs({ config: c, active: A })).docs;
    expect(canon(back.config)).toBe(canon(c));
    expect(canon(back.active)).toBe(canon(A));
  });

  it('are repaired when the file is wrong about them', () => {
    const raw = {
      type: 'config', lifts: LIFTS,
      routines: [{ id: 'a', name: 'Day A', liftIds: ['press', 'row', 'hang'], circuits: [
        { id: 'c1', name: 'Core', rounds: 99, liftIds: ['hang', 'row', 'hang', 'not-in-routine'], rest: '45' },
        { id: 'c2', name: 'Lonely', rounds: 3, liftIds: ['press'] },
        { id: 'c1', name: 'Same id again', rounds: 3, liftIds: ['press', 'row'] },
        'junk',
      ] }],
    };
    const c = normalizeDoc(raw, 'config') as ConfigDoc;
    expect(c.routines[0].circuits).toEqual([{ id: 'c1', name: 'Core', rounds: 12, liftIds: ['hang', 'row'], rest: 45 }]);
  });

  it('drop a session lift’s link to a circuit the session doesn’t have', () => {
    const A = normalizeDoc({
      type: 'active', date: '2026-03-10', startedAt: '2026-03-10T17:00:00.000Z', routineId: 'a', routineName: 'Day A', cur: null, run: null,
      circuits: [{ id: 'c1', name: 'Core', rounds: 2 }, { id: 'unused', name: 'Nobody', rounds: 2 }],
      lifts: [
        { id: 'hang', name: 'Hang', kind: 'bodyweight', repUnit: 'sec', note: '', skipped: false, sets: [], plan: [{ w: 0, r: 30 }], cid: 'c1' },
        { id: 'row', name: 'Row', kind: 'stack', repUnit: 'reps', note: '', skipped: false, sets: [], plan: [{ w: 50, r: 8 }], cid: 'gone' },
      ],
    }, 'active') as ActiveDoc;
    expect(A.circuits).toEqual([{ id: 'c1', name: 'Core', rounds: 2 }]);
    expect(A.lifts.map((l) => l.cid)).toEqual(['c1', undefined]);
  });
});
