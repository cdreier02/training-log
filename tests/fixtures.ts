// Made-up data for tests. Nothing here comes from anyone's real log.

import type { ConfigDoc, Kind, LiftDef, SessionDoc, SessionLift, SetRec } from '../src/lib/types';

export function lift(id: string, kind: Kind, over: Partial<LiftDef> = {}): LiftDef {
  return { id, name: id, kind, weights: [], addOn: 0, sets: 3, reps: 10, repUnit: 'reps', cue: '', ...over };
}

export const PRESS = lift('press', 'dumbbell', { name: 'Press', weights: [20, 25, 30, 35, 40] });
export const ROW = lift('row', 'stack', { name: 'Row', weights: [50, 70, 90, 110], addOn: 5, reps: 8 });
export const HANG = lift('hang', 'bodyweight', { name: 'Hang', repUnit: 'sec', reps: 30 });
export const SQUAT = lift('squat', 'barbell', { name: 'Squat' });

export function config(over: Partial<ConfigDoc> = {}): ConfigDoc {
  return {
    id: 'config', type: 'config', updatedAt: 1000,
    routines: [{ id: 'a', name: 'Day A', liftIds: ['press', 'row', 'hang'] }, { id: 'b', name: 'Day B', liftIds: ['squat'] }],
    lifts: { press: PRESS, row: ROW, hang: HANG, squat: SQUAT },
    prefs: { unit: 'lb', dist: 'mi', restSec: 90 },
    ...over,
  };
}

export const sets = (w: number, ...reps: (number | null)[]): SetRec[] => reps.map((r) => ({ w, r }));

export function did(def: LiftDef, s: SetRec[], note = ''): SessionLift {
  return { id: def.id, name: def.name, kind: def.kind, repUnit: def.repUnit, sets: s, note };
}

export function session(date: string, lifts: SessionLift[], over: Partial<SessionDoc> = {}): SessionDoc {
  const at = date + 'T18:00:00.000Z';
  return { id: 's_' + date.replace(/-/g, ''), type: 'session', updatedAt: Date.parse(at), date, startedAt: at, endedAt: at, routineId: 'a', routineName: 'Day A', lifts, ...over };
}
