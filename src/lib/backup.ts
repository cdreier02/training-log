// Reading a log from outside (a backup file, the synced copy, an export from the
// original Claude artifact) and writing one out. Everything that comes in is
// rebuilt field by field, so a damaged or hand-edited file can't break the app.

import { isDateStr, toDate } from './dates';
import { runLine, unitD, unitW } from './format';
import { serializeDocs } from './merge';
import { DEFAULT_PREFS } from './types';
import type { ActiveCircuit, ActiveDoc, ActiveLift, Circuit, ConfigDoc, Doc, DocMap, Feedback, Kind, LiftDef, PlanSet, Prefs, Routine, Run, SessionDoc, SessionLift, SetRec } from './types';

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number, dflt = ''): string => (typeof v === 'string' ? v.slice(0, max) : dflt);
const fin = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return isFinite(n) ? n : null;
};
const nonNeg = (v: unknown, max = 1e6): number => {
  const n = fin(v);
  return n == null || n < 0 ? 0 : Math.min(max, Math.round(n * 100) / 100);
};
const int = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = fin(v);
  return n == null ? dflt : Math.max(lo, Math.min(hi, Math.round(n)));
};
const ID_OK = /^[A-Za-z0-9_\-.~:@+]{1,80}$/;
const KINDS: Kind[] = ['dumbbell', 'stack', 'barbell', 'bodyweight'];
const kindOf = (v: unknown): Kind => (KINDS.includes(v as Kind) ? (v as Kind) : 'dumbbell');

function normSet(v: unknown): SetRec | null {
  if (!isObj(v)) return null;
  const r = fin(v.r);
  const s: SetRec = { w: nonNeg(v.w), r: r == null ? null : Math.max(0, Math.min(999, Math.round(r))) };
  if (v.feel === 'easy' || v.feel === 'good' || v.feel === 'hard') s.feel = v.feel;
  return s;
}

function normLift(v: unknown): SessionLift | null {
  if (!isObj(v)) return null;
  const id = str(v.id, 80);
  if (!id) return null;
  const sets = (Array.isArray(v.sets) ? v.sets : []).map(normSet).filter((x): x is SetRec => !!x).slice(0, 40);
  const lift: SessionLift = { id, name: str(v.name, 60, 'Lift') || 'Lift', kind: kindOf(v.kind), repUnit: v.repUnit === 'sec' ? 'sec' : 'reps', sets, note: str(v.note, 300) };
  const circuit = str(v.circuit, 60);
  if (circuit) lift.circuit = circuit;
  return lift;
}

/** Circuits as stored on a routine: each needs a name, rounds, and at least two of the routine's lifts. */
function normCircuits(v: unknown, liftIds: string[]): Circuit[] {
  const out: Circuit[] = [];
  const taken = new Set<string>(), ids = new Set<string>();
  for (const c of Array.isArray(v) ? v : []) {
    if (!isObj(c)) continue;
    const id = str(c.id, 80);
    if (!id || ids.has(id)) continue;
    const members = [...new Set((Array.isArray(c.liftIds) ? c.liftIds : []).filter((x): x is string => typeof x === 'string'))].filter((x) => liftIds.includes(x) && !taken.has(x));
    if (members.length < 2) continue;
    ids.add(id);
    for (const m of members) taken.add(m);
    const circuit: Circuit = { id, name: str(c.name, 60, 'Circuit') || 'Circuit', rounds: int(c.rounds, 1, 12, 3), liftIds: members };
    if (c.rest != null && fin(c.rest) != null) circuit.rest = int(c.rest, 0, 900, 90);
    out.push(circuit);
  }
  return out;
}

function normActiveLift(v: unknown): ActiveLift | null {
  const l = normLift(v);
  if (!l || !isObj(v)) return null;
  const plan: PlanSet[] = (Array.isArray(v.plan) ? v.plan : [])
    .filter(isObj)
    .map((p) => ({ w: nonNeg(p.w), r: int(p.r, 0, 999, 10) }))
    .slice(0, 12);
  if (!plan.length) plan.push({ w: l.sets[0]?.w ?? 0, r: 10 });
  const cid = str(v.cid, 80);
  return { ...l, plan, skipped: v.skipped === true, ...(cid ? { cid } : {}) };
}

function normRun(v: unknown): Run | null {
  if (!isObj(v)) return null;
  const run = { mi: nonNeg(v.mi, 1000), min: nonNeg(v.min, 10000), note: str(v.note, 300) };
  return run.mi || run.min || run.note ? run : null;
}

export function normLiftDef(v: unknown, idHint: string): LiftDef | null {
  if (!isObj(v)) return null;
  const id = str(v.id, 80) || idHint;
  if (!id) return null;
  const kind = kindOf(v.kind);
  const seen = new Set<number>();
  if (kind !== 'bodyweight' && Array.isArray(v.weights)) for (const w of v.weights) { const n = nonNeg(w); if (n > 0) seen.add(n); }
  const d: LiftDef = {
    id,
    name: str(v.name, 60, 'Lift') || 'Lift',
    kind,
    weights: [...seen].sort((a, b) => a - b).slice(0, 80),
    addOn: kind === 'stack' ? nonNeg(v.addOn, 100) : 0,
    sets: int(v.sets, 1, 12, 3),
    reps: int(v.reps, 1, 999, 10),
    repUnit: v.repUnit === 'sec' ? 'sec' : 'reps',
    cue: str(v.cue, 200),
  };
  if (v.start != null && fin(v.start) != null) d.start = nonNeg(v.start);
  if (v.rest != null && fin(v.rest) != null) d.rest = int(v.rest, 0, 900, 90);
  return d;
}

function normPrefs(v: unknown): Prefs {
  if (!isObj(v)) return { ...DEFAULT_PREFS };
  return { unit: v.unit === 'kg' ? 'kg' : 'lb', dist: v.dist === 'km' ? 'km' : 'mi', restSec: int(v.restSec, 0, 900, DEFAULT_PREFS.restSec) };
}

function stamp(v: unknown, fallback: number): number {
  const n = fin(v);
  return n != null && n >= 0 ? Math.round(n) : fallback;
}

/**
 * Turns anything doc-shaped into a valid doc, or null if it can't be one.
 * `idHint` is the id the container gave it (a map key or file name), used for
 * exports from the original artifact, where the id wasn't stored inside the doc.
 */
export function normalizeDoc(raw: unknown, idHint = ''): Doc | null {
  if (!isObj(raw)) return null;
  const hinted = str(raw.id, 80) || str(raw._id, 80) || idHint;

  if (raw.type === 'tombstone' || raw.deleted === true) {
    if (!ID_OK.test(hinted)) return null;
    return { id: hinted, type: 'tombstone', deleted: true, updatedAt: stamp(raw.updatedAt, 1) };
  }

  const type = raw.type === 'config' || raw.type === 'active' || raw.type === 'session'
    ? raw.type
    : hinted === 'config' || (isObj(raw.lifts) && Array.isArray(raw.routines)) ? 'config'
    : hinted === 'active' ? 'active'
    : Array.isArray(raw.lifts) && typeof raw.date === 'string' ? 'session'
    : '';

  if (type === 'config') {
    const lifts: Record<string, LiftDef> = {};
    if (isObj(raw.lifts)) for (const k of Object.keys(raw.lifts)) { const d = normLiftDef(raw.lifts[k], k); if (d) lifts[d.id] = d; }
    const routines: Routine[] = [];
    const seen = new Set<string>();
    if (Array.isArray(raw.routines)) for (const r of raw.routines) {
      if (!isObj(r)) continue;
      const id = str(r.id, 80);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const ids = [...new Set((Array.isArray(r.liftIds) ? r.liftIds : []).filter((x): x is string => typeof x === 'string'))];
      const routine: Routine = { id, name: str(r.name, 60, 'Routine') || 'Routine', liftIds: ids };
      const circuits = normCircuits(r.circuits, ids);
      if (circuits.length) routine.circuits = circuits;
      routines.push(routine);
    }
    const c: ConfigDoc = { id: 'config', type: 'config', updatedAt: stamp(raw.updatedAt, 1), routines, lifts, prefs: normPrefs(raw.prefs) };
    return c;
  }

  if (type === 'active') {
    if (!isDateStr(raw.date)) return null;
    const lifts = (Array.isArray(raw.lifts) ? raw.lifts : []).map(normActiveLift).filter((x): x is ActiveLift => !!x);
    const startedAt = str(raw.startedAt, 40) || raw.date + 'T12:00:00.000Z';
    const cur = fin(raw.cur);
    const a: ActiveDoc = {
      id: 'active', type: 'active', updatedAt: stamp(raw.updatedAt, Date.parse(startedAt) || 1),
      date: raw.date, startedAt, routineId: str(raw.routineId, 80), routineName: str(raw.routineName, 60, 'Session') || 'Session',
      cur: cur != null && cur >= 0 && cur < lifts.length ? Math.round(cur) : null, lifts, run: normRun(raw.run),
    };
    const ls = fin(raw.lastSetAt);
    if (ls != null && ls > 0) a.lastSetAt = Math.round(ls);
    // Circuits in the session, and only the ones some lift actually points at.
    const circuits: ActiveCircuit[] = [];
    for (const c of Array.isArray(raw.circuits) ? raw.circuits : []) {
      if (!isObj(c)) continue;
      const cid = str(c.id, 80);
      if (!cid || circuits.some((x) => x.id === cid) || !lifts.some((l) => l.cid === cid)) continue;
      const circuit: ActiveCircuit = { id: cid, name: str(c.name, 60, 'Circuit') || 'Circuit', rounds: int(c.rounds, 1, 40, 3) };
      if (c.rest != null && fin(c.rest) != null) circuit.rest = int(c.rest, 0, 900, 90);
      circuits.push(circuit);
    }
    for (const l of lifts) if (l.cid && !circuits.some((x) => x.id === l.cid)) delete l.cid;
    if (circuits.length) a.circuits = circuits;
    return a;
  }

  if (type === 'session') {
    if (!ID_OK.test(hinted) || hinted === 'config' || hinted === 'active') return null;
    if (!isDateStr(raw.date)) return null;
    const startedAt = str(raw.startedAt, 40) || raw.date + 'T12:00:00.000Z';
    const endedAt = str(raw.endedAt, 40) || startedAt;
    const lifts = (Array.isArray(raw.lifts) ? raw.lifts : []).map(normLift).filter((x): x is SessionLift => !!x && x.sets.length > 0);
    const s: SessionDoc = {
      id: hinted, type: 'session',
      updatedAt: stamp(raw.updatedAt, Date.parse(endedAt) || Date.parse(startedAt) || toDate(raw.date).getTime()),
      date: raw.date, startedAt, endedAt, routineId: str(raw.routineId, 80), routineName: str(raw.routineName, 60, 'Session') || 'Session', lifts,
    };
    const run = normRun(raw.run);
    if (run) s.run = run;
    const note = str(raw.note, 500);
    if (note) s.note = note;
    if (isObj(raw.feedback) && typeof raw.feedback.text === 'string' && raw.feedback.text) {
      const fb: Feedback = { text: raw.feedback.text.slice(0, 20000), at: isDateStr(raw.feedback.at) ? raw.feedback.at : raw.date };
      if (raw.feedback.truncated === true) fb.truncated = true;
      s.feedback = fb;
    }
    return s;
  }
  return null;
}

export interface Parsed {
  docs: DocMap;
  /** Entries that were present but couldn't be read as a doc. */
  skipped: number;
  /** Those entries as found, so a sync can write them back instead of losing them. */
  unread: unknown[];
  sessions: number;
  hasConfig: boolean;
}

/** Reads a log file in any shape this app or the original artifact has produced. Throws if it isn't one. */
export function parseLog(text: string, allowEmpty = false): Parsed {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file isn’t a Training Log backup. It should be a .json file exported from this app.');
  }
  const pairs: [string, unknown][] = [];
  const fromList = (list: unknown[]) => list.forEach((d) => pairs.push(['', d]));
  const fromMap = (m: Raw) => Object.keys(m).forEach((k) => pairs.push([k, m[k]]));

  if (Array.isArray(data)) fromList(data);
  else if (isObj(data)) {
    if (Array.isArray(data.docs)) fromList(data.docs);
    else if (isObj(data.docs)) fromMap(data.docs);
    else if (Array.isArray(data.sessions)) {
      if (isObj(data.config)) pairs.push(['config', data.config]);
      if (isObj(data.active)) pairs.push(['active', data.active]);
      fromList(data.sessions);
    } else fromMap(data); // a plain map of documents by name, config and active among them
  }

  const docs: DocMap = {};
  const unread: unknown[] = [];
  let skipped = 0;
  for (const [k, v] of pairs) {
    const d = normalizeDoc(v, k);
    if (!d) { skipped++; unread.push(v); continue; }
    const prev = docs[d.id];
    if (!prev || d.updatedAt >= prev.updatedAt) docs[d.id] = d;
  }
  const list = Object.values(docs);
  if (!list.length && !allowEmpty) throw new Error('That file doesn’t have any training log entries in it.');
  return { docs, skipped, unread, sessions: list.filter((d) => d.type === 'session').length, hasConfig: list.some((d) => d.type === 'config') };
}

export function exportJson(docs: DocMap, now = new Date()): string {
  return serializeDocs(docs, { exportedAt: now.toISOString() });
}

function cell(v: string | number | null | undefined): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = "'" + s; // keep spreadsheets from reading a note as a formula
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** One row per set (and per run), for anyone who wants the log in a spreadsheet. */
export function exportCsv(sorted: SessionDoc[]): string {
  const rows: (string | number | null)[][] = [['date', 'routine', 'lift', 'equipment', 'set', 'weight_' + unitW(), 'count', 'count_unit', 'feel', 'note', 'distance_' + unitD(), 'minutes']];
  for (const s of sorted) {
    for (const l of s.lifts) l.sets.forEach((x, i) => {
      rows.push([s.date, s.routineName, l.name, l.kind, i + 1, l.kind === 'bodyweight' ? null : x.w, x.r, l.repUnit, x.feel ?? '', i === 0 ? l.note : '', null, null]);
    });
    if (s.run) rows.push([s.date, s.routineName, 'Run', '', null, null, null, '', '', s.run.note, s.run.mi || null, s.run.min || null]);
  }
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** A one-line description of a session for lists. */
export function sessionBits(s: SessionDoc): string {
  const sets = (s.lifts || []).reduce((t, l) => t + l.sets.length, 0);
  const bits: string[] = [];
  if (s.lifts && s.lifts.length) bits.push(s.lifts.length + (s.lifts.length === 1 ? ' lift' : ' lifts') + ', ' + sets + (sets === 1 ? ' set' : ' sets'));
  if (s.run) bits.push(s.run.mi || s.run.min ? 'run ' + runLine(s.run) : 'run');
  return bits.join(', ');
}
