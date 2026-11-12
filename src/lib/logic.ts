// What the log knows about training: what you did last time, what to load today,
// whether a set was a record. Pure functions over docs, no storage and no DOM.

import { addDays, weekStart } from './dates';
import { fmtW, freeStep, isBody, plural, sumR, topR, topW, wPhrase } from './format';
import type { ActiveCircuit, ActiveDoc, ActiveLift, Circuit, ConfigDoc, LiftDef, PlanSet, Routine, SessionDoc, SessionLift } from './types';

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

/**
 * Today's plan for a lift: last time's weights at the target count. `sets` overrides
 * the lift's own number of sets, which is how a circuit's rounds take over.
 */
export function planFor(L: LiftDef, sorted: SessionDoc[], sets?: number): PlanSet[] {
  const last = lastEntry(sorted, L.id);
  const n = Math.max(1, sets ?? (+L.sets || 3)), reps = +L.reps || 10;
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

export function activeLift(L: LiftDef, sorted: SessionDoc[], sets?: number): ActiveLift {
  return { id: L.id, name: L.name, kind: L.kind, repUnit: L.repUnit || 'reps', plan: planFor(L, sorted, sets), sets: [], note: '', skipped: false };
}

/* ---------- circuits in the plan ---------- */

/** A routine as the things done one after another: single lifts, and whole circuits. */
export type RoutineItem = { kind: 'lift'; id: string } | { kind: 'circuit'; c: Circuit };

/**
 * Splits a routine into its items, in order. A circuit sits where its first lift
 * is. Lifts that no longer exist are left out, and a circuit that is down to fewer
 * than two lifts stops being one: what's left of it is an ordinary lift.
 */
export function routineItems(r: Routine, lifts: Record<string, LiftDef>): RoutineItem[] {
  const inRoutine = new Set(r.liftIds.filter((id) => lifts[id]));
  const owner = new Map<string, Circuit>();
  for (const c of r.circuits ?? []) {
    const ids = [...new Set(c.liftIds)].filter((id) => inRoutine.has(id) && !owner.has(id));
    if (ids.length < 2) continue;
    const kept = { ...c, liftIds: ids };
    for (const id of ids) owner.set(id, kept);
  }
  const out: RoutineItem[] = [];
  const placed = new Set<string>();
  for (const id of r.liftIds) {
    if (!inRoutine.has(id) || placed.has(id)) continue;
    const c = owner.get(id);
    if (!c) { out.push({ kind: 'lift', id }); placed.add(id); continue; }
    out.push({ kind: 'circuit', c });
    for (const m of c.liftIds) placed.add(m);
  }
  return out;
}

/** Writes items back into a routine: one flat list of lifts with each circuit's lifts together. */
function setItems(r: Routine, items: RoutineItem[], lifts: Record<string, LiftDef>): void {
  const missing = r.liftIds.filter((id) => !lifts[id]); // kept as they were; they show up again if the lift comes back
  r.liftIds = [...items.flatMap((it) => (it.kind === 'lift' ? [it.id] : it.c.liftIds)), ...missing];
  const circuits = items.flatMap((it) => (it.kind === 'circuit' ? [it.c] : []));
  if (circuits.length) r.circuits = circuits;
  else delete r.circuits;
}

/** Puts a routine back in order after an edit: circuits contiguous, empty ones gone. */
export function tidyRoutine(r: Routine, lifts: Record<string, LiftDef>): void {
  setItems(r, routineItems(r, lifts), lifts);
}

/** Moves a lift or a whole circuit one place up (-1) or down (1) in the routine. */
export function moveItem(r: Routine, lifts: Record<string, LiftDef>, index: number, dir: -1 | 1): void {
  const items = routineItems(r, lifts), j = index + dir;
  if (index < 0 || j < 0 || index >= items.length || j >= items.length) return;
  items.splice(j, 0, items.splice(index, 1)[0]);
  setItems(r, items, lifts);
}

/** Moves a lift one place up or down within its circuit. */
export function moveInCircuit(r: Routine, lifts: Record<string, LiftDef>, circuitId: string, liftId: string, dir: -1 | 1): void {
  const items = routineItems(r, lifts);
  for (const it of items) {
    if (it.kind !== 'circuit' || it.c.id !== circuitId) continue;
    const i = it.c.liftIds.indexOf(liftId), j = i + dir;
    if (i < 0 || j < 0 || j >= it.c.liftIds.length) return;
    it.c.liftIds.splice(j, 0, it.c.liftIds.splice(i, 1)[0]);
  }
  setItems(r, items, lifts);
}

/* ---------- a session under way ---------- */

export function newActive(r: Routine, config: ConfigDoc, sorted: SessionDoc[], date: string, now = Date.now()): ActiveDoc {
  const lifts: ActiveLift[] = [];
  const circuits: ActiveCircuit[] = [];
  for (const item of routineItems(r, config.lifts)) {
    if (item.kind === 'lift') { lifts.push(activeLift(config.lifts[item.id], sorted)); continue; }
    const c = item.c, rounds = Math.max(1, c.rounds || 3);
    circuits.push({ id: c.id, name: c.name, rounds, ...(c.rest != null ? { rest: c.rest } : {}) });
    for (const id of c.liftIds) lifts.push({ ...activeLift(config.lifts[id], sorted, rounds), cid: c.id });
  }
  const A: ActiveDoc = { id: 'active', type: 'active', updatedAt: now, date, startedAt: new Date(now).toISOString(), routineId: r.id, routineName: r.name, cur: null, lifts, run: null };
  if (circuits.length) A.circuits = circuits;
  return A;
}

export function liftDone(l: ActiveLift): boolean {
  return l.skipped || l.sets.length >= l.plan.length;
}

/** The set to do next: which lift, and which of its sets. */
export interface Step {
  li: number;
  si: number;
}

/**
 * The next set in a circuit, or null when every round is done. Sets come up round by
 * round: each lift's first set in order, then each lift's second, and so on. A lift
 * that was skipped drops out of the rounds that are left.
 */
export function circuitStep(A: ActiveDoc, cid: string): Step | null {
  const members = A.lifts.map((l, i) => ({ l, i })).filter((x) => x.l.cid === cid && !x.l.skipped);
  const rounds = Math.max(0, ...members.map((x) => x.l.plan.length));
  for (let r = 0; r < rounds; r++) for (const { l, i } of members) if (l.sets.length <= r && l.plan.length > r) return { li: i, si: l.sets.length };
  return null;
}

/** How far a circuit has got: rounds finished by every lift still in it, out of how many. */
export function circuitProgress(A: ActiveDoc, cid: string): { done: number; rounds: number } {
  const all = A.lifts.filter((l) => l.cid === cid), live = all.filter((l) => !l.skipped);
  const rounds = Math.max(1, ...(live.length ? live : all).map((l) => l.plan.length));
  return { done: live.length ? Math.min(rounds, ...live.map((l) => l.sets.length)) : rounds, rounds };
}

/**
 * What the session screen should open on. If the person picked a lift, that one (or,
 * if it's in a circuit, wherever that circuit is up to). Otherwise the first thing
 * in the routine that isn't finished.
 */
export function nextStep(A: ActiveDoc): Step | null {
  const pinned = A.cur != null ? A.lifts[A.cur] : undefined;
  if (pinned) return (pinned.cid ? circuitStep(A, pinned.cid) : null) ?? { li: A.cur as number, si: pinned.sets.length };
  const seen = new Set<string>();
  for (let i = 0; i < A.lifts.length; i++) {
    const l = A.lifts[i];
    if (!l.cid) { if (!liftDone(l)) return { li: i, si: l.sets.length }; continue; }
    if (seen.has(l.cid)) continue;
    seen.add(l.cid);
    const s = circuitStep(A, l.cid);
    if (s) return s;
  }
  return null;
}

/** Which lift the session screen should open: -1 once everything is done. */
export function curIdx(A: ActiveDoc): number {
  return nextStep(A)?.li ?? -1;
}

/** Where the "current lift" pointer should rest after a change to this lift. */
export function pinAfter(A: ActiveDoc, li: number): number | null {
  const l = A.lifts[li];
  if (!l) return null;
  if (l.cid) return circuitStep(A, l.cid) ? li : null; // stay in the circuit until its rounds are done
  return liftDone(l) ? null : li;
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
    lifts: A.lifts.filter((l) => l.sets.length).map((l) => {
      const c = l.cid ? A.circuits?.find((x) => x.id === l.cid) : undefined;
      return { id: l.id, name: l.name, kind: l.kind, repUnit: l.repUnit, sets: l.sets, note: l.note || '', ...(c ? { circuit: c.name } : {}) };
    }),
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
