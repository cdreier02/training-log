// What the log knows about training: what you did last time, what to load today,
// whether a set was a record. Pure functions over docs, no storage and no DOM.

import { addDays, weekStart } from './dates';
import { fmtW, freeStep, isBody, plural, sumR, topR, topW, wPhrase } from './format';
import type { ActiveDoc, ActiveLift, ConfigDoc, LiftDef, PlanSet, Routine, SessionDoc, SessionLift } from './types';

export function uid(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
}

export function sessionId(date: string, now = Date.now()): string {
  return 's_' + date.replace(/-/g, '') + '_' + now.toString(36);
}

const key = (s: Pick<SessionDoc, 'date' | 'startedAt'>) => s.date + '|' + (s.startedAt || '');

/** Oldest first, by calendar day and then by start time. */
export function sortSessions(list: SessionDoc[]): SessionDoc[] {
  return list.slice().sort((a, b) => {
    const ka = key(a), kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export interface Entry {
  s: SessionDoc;
  l: SessionLift;
}

/** Every time a lift was logged, oldest first. `sorted` must come from sortSessions. */
export function entriesFor(sorted: SessionDoc[], liftId: string): Entry[] {
  const out: Entry[] = [];
  for (const s of sorted) for (const l of s.lifts || []) if (l.id === liftId && l.sets && l.sets.length) out.push({ s, l });
  return out;
}

/** The most recent entry for a lift, optionally the most recent one before a given session. */
export function lastEntry(sorted: SessionDoc[], liftId: string, before?: SessionDoc): Entry | null {
  const list = entriesFor(sorted, liftId);
  for (let i = list.length - 1; i >= 0; i--) {
    if (!before) return list[i];
    if (list[i].s.id !== before.id && key(list[i].s) < key(before)) return list[i];
  }
  return null;
}

/** Today's plan for a lift: last time's weights at the target count. */
export function planFor(L: LiftDef, sorted: SessionDoc[]): PlanSet[] {
  const last = lastEntry(sorted, L.id);
  const n = Math.max(1, +L.sets || 3), reps = +L.reps || 10;
  const out: PlanSet[] = [];
  for (let i = 0; i < n; i++) {
    let w = 0;
    if (L.kind !== 'bodyweight') {
      if (last) w = last.l.sets[Math.min(i, last.l.sets.length - 1)].w || 0;
      else w = L.start != null ? +L.start : L.weights && L.weights.length ? L.weights[0] : 0;
    }
    out.push({ w, r: reps });
  }
  return out;
}

export function activeLift(L: LiftDef, sorted: SessionDoc[]): ActiveLift {
  return { id: L.id, name: L.name, kind: L.kind, repUnit: L.repUnit || 'reps', plan: planFor(L, sorted), sets: [], note: '', skipped: false };
}

export function newActive(r: Routine, config: ConfigDoc, sorted: SessionDoc[], date: string, now = Date.now()): ActiveDoc {
  const lifts: ActiveLift[] = [];
  for (const id of r.liftIds) {
    const L = config.lifts[id];
    if (L) lifts.push(activeLift(L, sorted));
  }
  return { id: 'active', type: 'active', updatedAt: now, date, startedAt: new Date(now).toISOString(), routineId: r.id, routineName: r.name, cur: null, lifts, run: null };
}

export function liftDone(l: ActiveLift): boolean {
  return l.skipped || l.sets.length >= l.plan.length;
}

/** Which lift the session screen should open: the pinned one, else the first unfinished. */
export function curIdx(A: ActiveDoc): number {
  if (A.cur != null && A.lifts[A.cur]) return A.cur;
  for (let i = 0; i < A.lifts.length; i++) if (!liftDone(A.lifts[i])) return i;
  return -1;
}

export function buildSession(A: ActiveDoc, now = Date.now()): SessionDoc {
  const s: SessionDoc = {
    id: sessionId(A.date, now),
    type: 'session',
    updatedAt: now,
    date: A.date,
    startedAt: A.startedAt,
    endedAt: new Date(now).toISOString(),
    routineId: A.routineId,
    routineName: A.routineName,
    lifts: A.lifts.filter((l) => l.sets.length).map((l) => ({ id: l.id, name: l.name, kind: l.kind, repUnit: l.repUnit, sets: l.sets, note: l.note || '' })),
  };
  if (A.run) s.run = A.run;
  return s;
}

/** One short sentence comparing a lift with the time before. */
export function deltaLine(l: SessionLift, prev: SessionLift | null): string {
  if (!prev) return 'First time logged.';
  if (isBody(l.kind, l.sets)) {
    const a = sumR(l.sets), b = sumR(prev.sets);
    if (a == null || b == null || a === b) return 'Same as last time.';
    return (a > b ? a - b + ' more' : b - a + ' fewer') + (l.repUnit === 'sec' ? ' seconds' : ' reps') + ' than last time.';
  }
  const ta = topW(l.sets), tb = topW(prev.sets);
  if (ta > tb) return 'Up from ' + wPhrase(prev.kind, tb) + '.';
  if (ta < tb) return 'Down from ' + wPhrase(prev.kind, tb) + '.';
  if (l.sets.length !== prev.sets.length) return 'Same top weight, ' + plural(l.sets.length, 'set') + ' instead of ' + prev.sets.length + '.';
  const ra = sumR(l.sets), rb = sumR(prev.sets);
  if (ra == null || rb == null) return 'Same top weight as last time.';
  if (ra > rb) return 'Same top weight, ' + plural(ra - rb, 'more rep') + '.';
  if (ra < rb) return 'Same top weight, ' + (rb - ra) + ' fewer ' + (rb - ra === 1 ? 'rep' : 'reps') + '.';
  return 'Same as last time.';
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Every load this lift can actually be set to, smallest first. */
export function loadsFor(def: Pick<LiftDef, 'weights' | 'addOn' | 'kind'>): number[] {
  const seen = new Set<number>();
  for (const w of def.weights || []) {
    seen.add(round2(w));
    if (def.kind === 'stack' && def.addOn > 0) seen.add(round2(w + def.addOn));
  }
  return [...seen].sort((a, b) => a - b);
}

/** The next load up from `w`, or null at the top of what the gym has. */
export function nextLoad(def: Pick<LiftDef, 'weights' | 'addOn' | 'kind'>, w: number): number | null {
  if (def.kind === 'bodyweight') return null;
  const loads = loadsFor(def);
  if (!loads.length) return round2(w + freeStep());
  for (const x of loads) if (x > w + 1e-9) return x;
  return null;
}

// Words in a note that mean "don't add weight yet", however the numbers look.
const HOLD_WORDS = /\b(hard|harder|difficult|tough|heavy|struggl\w*|grind\w*|hold|holding|stay|staying|keep|keeping|pain\w*|hurt\w*|sore|tweak\w*|ache\w*|form)\b/i;

/**
 * A suggestion to go up, only when last time leaves no doubt: every planned set
 * done at one weight, every count at or above target, none marked very hard,
 * and nothing in the note saying to hold.
 */
export function nudge(def: LiftDef | null, last: Entry | null): string {
  if (!def || !last || def.kind === 'bodyweight') return '';
  const sets = last.l.sets;
  if (sets.length < Math.max(1, def.sets || 3)) return '';
  const w = sets[0].w;
  if (!w || !sets.every((s) => s.w === w)) return '';
  if (!sets.every((s) => s.r != null && s.r >= (def.reps || 10))) return '';
  if (sets.some((s) => s.feel === 'hard')) return '';
  if (HOLD_WORDS.test(last.l.note || '')) return ''; // their own note for next time outranks a suggestion
  const next = nextLoad(def, w);
  if (next == null) return '';
  return 'You hit every set at ' + wPhrase(def.kind, w) + '. Next up is ' + wPhrase(def.kind, next) + '.';
}

export interface PrFlags {
  /** A heavier top weight than ever before. */
  weight: boolean;
  /** More in one set than ever before at this weight or heavier (or, for bodyweight, at all). */
  reps: boolean;
}

export function prFlags(sorted: SessionDoc[], s: SessionDoc, l: SessionLift): PrFlags {
  const none = { weight: false, reps: false };
  const prior = entriesFor(sorted, l.id).filter((e) => e.s.id !== s.id && key(e.s) < key(s));
  if (!prior.length || !l.sets.length) return none;
  if (isBody(l.kind, l.sets)) {
    const best = topR(l.sets);
    const known = prior.some((e) => e.l.sets.some((x) => x.r != null));
    return { weight: false, reps: known && best > Math.max(...prior.map((e) => topR(e.l.sets))) };
  }
  const tw = topW(l.sets);
  const priorTop = Math.max(...prior.map((e) => topW(e.l.sets)));
  if (tw > priorTop) return { weight: true, reps: false };
  const mine = Math.max(0, ...l.sets.filter((x) => x.w === tw && x.r != null).map((x) => x.r as number));
  let seen = false, theirs = 0;
  for (const e of prior) for (const x of e.l.sets) if (x.w >= tw && x.r != null) { seen = true; theirs = Math.max(theirs, x.r); }
  return { weight: false, reps: seen && mine > theirs };
}

export function prLine(kind: SessionLift['kind'], l: SessionLift, f: PrFlags): string {
  if (f.weight) return 'Heaviest yet.';
  if (f.reps) return isBody(kind, l.sets) ? 'Best set yet.' : 'Most reps yet at ' + wPhrase(kind, topW(l.sets)) + '.';
  return '';
}

/** The sentence at the top of a lift's history. */
export function liftStory(es: Entry[]): string {
  if (!es.length) return '';
  const kind = es[es.length - 1].l.kind;
  const body = es.every((e) => isBody(e.l.kind, e.l.sets));
  const val = (e: Entry) => (body ? topR(e.l.sets) : topW(e.l.sets));
  const first = val(es[0]), last = val(es[es.length - 1]);
  let streak = 0;
  for (let j = es.length - 1; j >= 0 && val(es[j]) === last; j--) streak++;
  const say = (v: number) => (body ? v + (es[0].l.repUnit === 'sec' ? ' seconds' : ' reps') : wPhrase(kind, v));
  if (es.length === 1) return 'One session so far, at ' + say(last) + '.';
  if (first === last && streak === es.length) return 'Holding at ' + say(last) + ' across ' + es.length + ' sessions.';
  if (first === last) {
    const most = Math.max(...es.map(val));
    return 'Back at ' + say(last) + ' after ' + es.length + ' sessions.' + (most > last ? ' The most so far is ' + say(most) + '.' : '');
  }
  return 'From ' + say(first) + ' to ' + say(last) + ' in ' + es.length + ' sessions.' + (streak >= 3 ? ' The last ' + streak + ' were at ' + say(last) + '.' : '');
}

/** The best single set on record, as a short phrase. '' when counts were never logged. */
export function bestSet(es: Entry[]): string {
  let bw = -1, br = -1, kind = es.length ? es[0].l.kind : 'dumbbell', unit = es.length ? es[0].l.repUnit : 'reps';
  for (const e of es) for (const x of e.l.sets) {
    if (x.r == null) continue;
    if (x.w > bw || (x.w === bw && x.r > br)) { bw = x.w; br = x.r; kind = e.l.kind; unit = e.l.repUnit; }
  }
  if (br < 0) return '';
  return bw > 0 ? fmtW(kind, bw) + ' × ' + br : br + (unit === 'sec' ? ' sec' : ' reps');
}

export interface WeekCount {
  /** The Monday of the week. */
  start: string;
  n: number;
}

/** Sessions per week for the last `weeks` weeks, oldest first, ending with this week. */
export function weekCounts(sessions: SessionDoc[], today: string, weeks = 12): WeekCount[] {
  const thisWeek = weekStart(today);
  const out: WeekCount[] = [];
  for (let i = weeks - 1; i >= 0; i--) out.push({ start: addDays(thisWeek, -7 * i), n: 0 });
  const idx = new Map(out.map((w, i) => [w.start, i]));
  for (const s of sessions) {
    const i = idx.get(weekStart(s.date));
    if (i != null) out[i].n++;
  }
  return out;
}

/** Which routine has waited longest, when there is more than one to choose from. */
export function upNext(config: ConfigDoc, sorted: SessionDoc[]): string {
  const usable = config.routines.filter((r) => r.liftIds.some((id) => config.lifts[id]));
  if (usable.length < 2) return '';
  let pick = '', oldest = '￿';
  for (const r of usable) {
    let last = '';
    for (const s of sorted) if (s.routineId === r.id) last = key(s);
    if (last < oldest) { oldest = last; pick = r.id; }
  }
  return sorted.some((s) => s.routineId) ? pick : '';
}

export function liftSummary(d: LiftDef, kindLabel: string): string {
  return kindLabel + ', ' + (d.sets || 3) + ' × ' + (d.reps || 10) + (d.repUnit === 'sec' ? ' sec' : '');
}

export function parseWeights(t: string): number[] {
  const seen = new Set<number>();
  for (const x of String(t || '').split(/[,;\s]+/)) {
    const n = round2(parseFloat(x));
    if (n > 0 && isFinite(n)) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

/** Splits a logged weight into the pin position and whether the add-on plate is on. */
export function splitLoad(def: Pick<LiftDef, 'weights' | 'addOn'> | null, w: number): { base: number; addOn: boolean } {
  const ws = def?.weights || [];
  if (def && ws.length && ws.indexOf(w) < 0 && def.addOn) {
    const b = round2(w - def.addOn);
    if (ws.indexOf(b) >= 0) return { base: b, addOn: true };
  }
  return { base: +w || 0, addOn: false };
}
