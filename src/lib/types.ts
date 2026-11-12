// The shapes everything else agrees on. Every stored thing is a "doc" with an id
// and an updatedAt stamp, which is what lets two devices merge without a server.

export type Kind = 'dumbbell' | 'stack' | 'barbell' | 'bodyweight';
export type RepUnit = 'reps' | 'sec';
export type Feel = 'easy' | 'good' | 'hard';
export type WeightUnit = 'lb' | 'kg';
export type DistUnit = 'mi' | 'km';

/** One logged set. `r` is null when the weight was recorded but the count wasn't. */
export interface SetRec {
  w: number;
  r: number | null;
  feel?: Feel;
}

export interface PlanSet {
  w: number;
  r: number;
}

export interface LiftDef {
  id: string;
  name: string;
  kind: Kind;
  /** The loads the gym actually has for this lift. Empty means "step by a fixed amount". */
  weights: number[];
  /** A small extra plate that can be hung on a machine stack. 0 for none. */
  addOn: number;
  sets: number;
  reps: number;
  repUnit: RepUnit;
  cue: string;
  /** Starting weight to offer before there is any history. */
  start?: number;
  /** Rest target in seconds. Undefined follows the app-wide default; 0 turns it off. */
  rest?: number;
}

/** Lifts done back to back, one set of each, then round again. */
export interface Circuit {
  id: string;
  name: string;
  rounds: number;
  /** In the order they're done. Every one is also in the routine's liftIds. */
  liftIds: string[];
  /** Rest between rounds in seconds. Undefined follows the app-wide default; 0 turns it off. */
  rest?: number;
}

export interface Routine {
  id: string;
  name: string;
  /** Every lift in the routine, in order. Lifts in a circuit appear here too. */
  liftIds: string[];
  circuits?: Circuit[];
}

export interface Prefs {
  unit: WeightUnit;
  dist: DistUnit;
  /** Default rest target in seconds. 0 turns the timer off. */
  restSec: number;
}

export interface SessionLift {
  id: string;
  name: string;
  kind: Kind;
  repUnit: RepUnit;
  sets: SetRec[];
  note: string;
  /** The name of the circuit this lift was done in, if it was. */
  circuit?: string;
}

export interface ActiveLift extends SessionLift {
  plan: PlanSet[];
  skipped: boolean;
  /** The id of the circuit (in the session's `circuits`) this lift belongs to. */
  cid?: string;
}

/** A circuit as it stands in the session under way. Rounds can grow if one is added. */
export interface ActiveCircuit {
  id: string;
  name: string;
  rounds: number;
  rest?: number;
}

/** `mi` holds the distance in whichever distance unit the person uses. */
export interface Run {
  mi: number;
  min: number;
  note: string;
}

export interface Feedback {
  text: string;
  at: string;
  truncated?: boolean;
}

interface DocBase {
  id: string;
  /** Milliseconds since the epoch, set on every local change. Newest wins on merge. */
  updatedAt: number;
}

export interface ConfigDoc extends DocBase {
  id: 'config';
  type: 'config';
  routines: Routine[];
  lifts: Record<string, LiftDef>;
  prefs: Prefs;
}

export interface ActiveDoc extends DocBase {
  id: 'active';
  type: 'active';
  date: string;
  startedAt: string;
  routineId: string;
  routineName: string;
  cur: number | null;
  lifts: ActiveLift[];
  circuits?: ActiveCircuit[];
  run: Run | null;
  /** When the most recent set was logged. Drives the rest timer. */
  lastSetAt?: number;
}

export interface SessionDoc extends DocBase {
  type: 'session';
  date: string;
  startedAt: string;
  endedAt: string;
  routineId: string;
  routineName: string;
  lifts: SessionLift[];
  run?: Run | null;
  note?: string;
  feedback?: Feedback;
}

/** What is left behind when something is deleted, so the deletion reaches other devices. */
export interface Tombstone extends DocBase {
  type: 'tombstone';
  deleted: true;
}

export type Doc = ConfigDoc | ActiveDoc | SessionDoc | Tombstone;
export type DocMap = Record<string, Doc>;

export const KIND_LABEL: Record<Kind, string> = {
  dumbbell: 'Dumbbells',
  stack: 'Machine stack',
  barbell: 'Barbell or plates',
  bodyweight: 'Bodyweight',
};

export const DEFAULT_PREFS: Prefs = { unit: 'lb', dist: 'mi', restSec: 90 };

export function emptyConfig(): ConfigDoc {
  // updatedAt 0 marks "never touched here", so any real config wins a merge against it.
  return { id: 'config', type: 'config', updatedAt: 0, routines: [], lifts: {}, prefs: { ...DEFAULT_PREFS } };
}
