import { afterEach, describe, expect, it } from 'vitest';
import { feelLine, fmtPlan, fmtSets, paceLine, reportText, runLine, sessionMinutes, setUnits } from '../src/lib/format';
import { did, HANG, PRESS, ROW, session, sets } from './fixtures';

afterEach(() => setUnits('lb', 'mi'));

describe('fmtSets', () => {
  it('names dumbbells by the pair and lists the counts', () => {
    expect(fmtSets(did(PRESS, sets(30, 10, 10, 9)))).toBe('30s × 10, 10, 9');
  });
  it('gives machine loads a unit', () => {
    expect(fmtSets(did(ROW, sets(90, 8, 8, 8)))).toBe('90 lb × 8, 8, 8');
  });
  it('splits into groups when the weight changes mid-lift', () => {
    expect(fmtSets(did(PRESS, [...sets(35, 9), ...sets(30, 10, 10)]))).toBe('35s × 9, then 30s × 10, 10');
  });
  it('falls back to a set count when the counts were never written down', () => {
    expect(fmtSets(did(ROW, sets(90, null, null, null)))).toBe('90 lb × 3 sets');
    expect(fmtSets(did(PRESS, [{ w: 20, r: null }, { w: 25, r: null }]))).toBe('20s, 25s');
  });
  it('shows only the count for bodyweight work, with seconds marked', () => {
    expect(fmtSets(did(HANG, sets(0, 30, 30, 25)))).toBe('30, 30, 25 sec');
  });
  it('follows the weight unit setting', () => {
    setUnits('kg', 'km');
    expect(fmtSets(did(ROW, sets(40, 8)))).toBe('40 kg × 8');
  });
});

describe('fmtPlan', () => {
  it('describes what is planned', () => {
    expect(fmtPlan({ kind: 'dumbbell', repUnit: 'reps', plan: [{ w: 30, r: 10 }, { w: 30, r: 10 }, { w: 30, r: 10 }] })).toBe('30s, 3 × 10');
    expect(fmtPlan({ kind: 'bodyweight', repUnit: 'sec', plan: [{ w: 0, r: 30 }, { w: 0, r: 30 }] })).toBe('2 × 30 sec');
  });
});

describe('feelLine', () => {
  it('collapses when every set felt the same', () => {
    expect(feelLine([{ w: 1, r: 1, feel: 'good' }, { w: 1, r: 1, feel: 'good' }])).toBe('Felt good.');
  });
  it('names the set when only some were rated', () => {
    expect(feelLine([{ w: 1, r: 1 }, { w: 1, r: 1, feel: 'hard' }])).toBe('Felt very hard on set 2.');
  });
  it('says nothing when nothing was rated', () => {
    expect(feelLine(sets(1, 1, 1))).toBe('');
  });
});

describe('runs', () => {
  it('formats distance, time and pace', () => {
    expect(runLine({ mi: 2, min: 19, note: '' })).toBe('2 mi in 19 min');
    expect(paceLine({ mi: 2, min: 19, note: '' })).toBe('9:30 per mi');
    expect(paceLine({ mi: 2, min: 0, note: '' })).toBe('');
  });
  it('never shows sixty seconds in a pace', () => {
    expect(paceLine({ mi: 3, min: 29.99, note: '' })).toBe('10:00 per mi');
  });
});

describe('sessionMinutes', () => {
  it('ignores sessions whose start and end are the same placeholder time', () => {
    expect(sessionMinutes({ startedAt: '2026-01-01T18:00:00.000Z', endedAt: '2026-01-01T18:00:00.000Z' })).toBeNull();
    expect(sessionMinutes({ startedAt: '2026-01-01T18:00:00.000Z', endedAt: '2026-01-01T18:47:10.000Z' })).toBe(47);
  });
});

describe('reportText', () => {
  it('writes the whole session as plain lines', () => {
    const s = session('2026-03-02', [did(PRESS, [{ w: 30, r: 10, feel: 'good' }, { w: 30, r: 9, feel: 'good' }], 'Slow on the way down.')], { run: { mi: 1, min: 0, note: '' }, note: 'Short on time.' });
    expect(reportText(s)).toBe(
      ['Day A, Monday, March 2, 2026', 'Press: 30s × 10, 9 (per hand). Felt good. Note: Slow on the way down.', 'Run: 1 mi.', 'Session note: Short on time.'].join('\n'),
    );
  });
});
