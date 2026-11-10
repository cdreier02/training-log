// Dates are stored as local calendar days ("2026-11-09"), never as instants, so a
// session logged at 11pm doesn't slide into tomorrow when viewed in another zone.

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n: number) => (n < 10 ? '0' + n : '' + n);

export function dateStr(d: Date): string {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function todayStr(): string {
  return dateStr(new Date());
}

export function toDate(s: string): Date {
  const p = String(s || '').split('-');
  return new Date(+p[0] || 2000, (+p[1] || 1) - 1, +p[2] || 1);
}

export function isDateStr(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return dateStr(toDate(s)) === s;
}

export function longDate(s: string): string {
  const d = toDate(s);
  return DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
}

export function shortDate(s: string): string {
  const d = toDate(s);
  return MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate();
}

export function yearOf(s: string): number {
  return toDate(s).getFullYear();
}

/** The Monday that starts the week containing this day. */
export function weekStart(s: string): string {
  const d = toDate(s);
  const back = (d.getDay() + 6) % 7;
  return dateStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back));
}

export function addDays(s: string, n: number): string {
  const d = toDate(s);
  return dateStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** Whole days from a to b. Uses noon so daylight-saving shifts can't round the wrong way. */
export function daysBetween(a: string, b: string): number {
  const da = toDate(a), db = toDate(b);
  da.setHours(12); db.setHours(12);
  return Math.round((db.getTime() - da.getTime()) / 864e5);
}

/** "today", "yesterday", "3 days ago", or a short date once it's more than a week back. */
export function agoPhrase(s: string, today = todayStr()): string {
  const n = daysBetween(s, today);
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 7) return n + ' days ago';
  return shortDate(s);
}

/** 95 seconds -> "1:35". */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return Math.floor(s / 60) + ':' + pad(s % 60);
}

/** "just now", "4 min ago", "2 hr ago", then a date. For sync status. */
export function sincePhrase(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' hr ago';
  return shortDate(dateStr(new Date(ms)));
}
