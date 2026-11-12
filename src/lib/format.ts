// How numbers become the short phrases the app shows: "50s × 10, 10, 9",
// "120 lb × 3 sets", "1 mi in 9 min". Kept free of DOM and state so it can be tested.

import { longDate, yearOf } from './dates';
import type { DistUnit, Feel, Kind, PlanSet, RepUnit, Run, SessionDoc, SetRec, WeightUnit } from './types';

let W: WeightUnit = 'lb';
let D: DistUnit = 'mi';

/** Called once when preferences load or change. Formatting reads these everywhere. */
export function setUnits(w: WeightUnit, d: DistUnit): void {
  W = w === 'kg' ? 'kg' : 'lb';
  D = d === 'km' ? 'km' : 'mi';
}
export const unitW = (): WeightUnit => W;
export const unitD = (): DistUnit => D;
export const unitWLong = (): string => (W === 'kg' ? 'kilograms' : 'pounds');
export const unitDLong = (): string => (D === 'km' ? 'kilometers' : 'miles');
/** The step offered when a lift has no list of available weights. */
export const freeStep = (): number => (W === 'kg' ? 2.5 : 5);

export function num(w: number | string | null | undefined): string {
  return String(Math.round((+(w ?? 0) || 0) * 100) / 100);
}

export function plural(n: number, word: string): string {
  return n + ' ' + word + (n === 1 ? '' : 's');
}

/** Dumbbells are named by the pair ("the 50s"); everything else by its load. */
export function fmtW(kind: Kind, w: number): string {
  return kind === 'dumbbell' ? num(w) + 's' : num(w) + ' ' + W;
}

export function wPhrase(kind: Kind, w: number): string {
  return kind === 'dumbbell' ? 'the ' + num(w) + 's' : num(w) + ' ' + W;
}

/** True when there is no load to talk about, so only the count is shown. */
export function isBody(kind: Kind, sets: ReadonlyArray<{ w: number }>): boolean {
  return kind === 'bodyweight' || !sets.some((s) => s.w);
}

const unitWord = (u: RepUnit): string => (u === 'sec' ? ' sec' : '');

interface SetsLike {
  kind: Kind;
  repUnit: RepUnit;
  sets: SetRec[];
}

export function fmtSets(l: SetsLike): string {
  const sets = l.sets || [];
  if (!sets.length) return '';
  if (isBody(l.kind, sets)) return sets.map((s) => (s.r == null ? '?' : s.r)).join(', ') + unitWord(l.repUnit);
  if (sets.every((s) => s.r == null)) {
    if (sets.every((s) => s.w === sets[0].w)) return fmtW(l.kind, sets[0].w) + ' × ' + plural(sets.length, 'set');
    return l.kind === 'dumbbell' ? sets.map((s) => num(s.w) + 's').join(', ') : sets.map((s) => num(s.w)).join(', ') + ' ' + W;
  }
  const groups: { w: number; r: (number | null)[] }[] = [];
  for (const s of sets) {
    const g = groups[groups.length - 1];
    if (g && g.w === s.w) g.r.push(s.r);
    else groups.push({ w: s.w, r: [s.r] });
  }
  return groups
    .map((g) => {
      const known = g.r.every((r) => r != null);
      return fmtW(l.kind, g.w) + ' × ' + (known ? g.r.join(', ') + unitWord(l.repUnit) : plural(g.r.length, 'set'));
    })
    .join(', then ');
}

export function fmtPlan(l: { kind: Kind; repUnit: RepUnit; plan: PlanSet[] }): string {
  const p = l.plan || [];
  if (!p.length) return '';
  const shape = p.length + ' × ' + p[0].r + unitWord(l.repUnit);
  if (isBody(l.kind, p)) return shape;
  const ws: number[] = [];
  for (const s of p) if (ws[ws.length - 1] !== s.w) ws.push(s.w);
  return ws.map((w) => fmtW(l.kind, w)).join(' then ') + ', ' + shape;
}

export function topW(sets: ReadonlyArray<{ w: number }>): number {
  return (sets || []).reduce((m, s) => Math.max(m, +s.w || 0), 0);
}
export function topR(sets: ReadonlyArray<{ r: number | null }>): number {
  return (sets || []).reduce((m, s) => Math.max(m, +(s.r ?? 0) || 0), 0);
}
/** Total count across sets, or null if any set's count is unknown. */
export function sumR(sets: ReadonlyArray<{ r: number | null }>): number | null {
  let t = 0;
  for (const s of sets) {
    if (s.r == null) return null;
    t += +s.r;
  }
  return t;
}

export const FEEL_WORD: Record<Feel, string> = { easy: 'easy', good: 'good', hard: 'very hard' };
export const FEEL_LABEL: Record<Feel, string> = { easy: 'Easy', good: 'Good', hard: 'Very hard' };

export function feelLine(sets: SetRec[]): string {
  const f = sets.map((s) => (s.feel ? FEEL_WORD[s.feel] : null));
  if (!f.some(Boolean)) return '';
  if (f.every((x) => x === f[0])) return 'Felt ' + f[0] + '.';
  if (f.every(Boolean)) return 'Felt ' + f.join(', ') + '.';
  const bits: string[] = [];
  f.forEach((x, i) => {
    if (x) bits.push(x + ' on set ' + (i + 1));
  });
  return 'Felt ' + bits.join(', ') + '.';
}

export function runLine(r: Run): string {
  const p: string[] = [];
  if (r.mi) p.push(num(r.mi) + ' ' + D);
  if (r.min) p.push(num(r.min) + ' min');
  return p.join(' in ') || 'No distance logged';
}

/** "9:30 per mi", or '' when there isn't both a distance and a time. */
export function paceLine(r: Run): string {
  if (!r.mi || !r.min) return '';
  const per = r.min / r.mi;
  let m = Math.floor(per), s = Math.round((per - m) * 60);
  if (s === 60) { m += 1; s = 0; }
  return m + ':' + (s < 10 ? '0' : '') + s + ' per ' + D;
}

/** Minutes between start and end, when both are real and plausible for one gym visit. */
export function sessionMinutes(s: Pick<SessionDoc, 'startedAt' | 'endedAt'>): number | null {
  const a = Date.parse(s.startedAt), b = Date.parse(s.endedAt);
  if (!isFinite(a) || !isFinite(b)) return null;
  const m = Math.round((b - a) / 60000);
  return m >= 3 && m <= 300 ? m : null;
}

/** The plain-text report: what gets copied, shared, and sent to Claude. */
export function reportText(s: SessionDoc): string {
  const lines = [(s.routineName || 'Session') + ', ' + longDate(s.date) + ', ' + yearOf(s.date)];
  for (const l of s.lifts || []) {
    let t = l.name + (l.circuit ? ' (circuit: ' + l.circuit + ')' : '') + ': ' + fmtSets(l) + (l.kind === 'dumbbell' ? ' (per hand)' : '') + '.';
    const f = feelLine(l.sets);
    if (f) t += ' ' + f;
    if (l.note) t += ' Note: ' + l.note;
    lines.push(t);
  }
  if (s.run) lines.push('Run: ' + runLine(s.run) + '.' + (s.run.note ? ' Note: ' + s.run.note : ''));
  if (s.note) lines.push('Session note: ' + s.note);
  return lines.join('\n');
}
