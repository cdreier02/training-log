import { MONTHS, shortDate, toDate } from '../lib/dates';
import { num } from '../lib/format';

export interface Pt {
  date: string;
  v: number;
}

function niceStep(range: number): number {
  const raw = range / 5 || 1;
  const p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/**
 * A step chart of one value per session. When the lift has a list of available
 * weights, the horizontal lines are those weights, and the next one up is dashed.
 */
export function Chart({ pts, ticks, label, zero }: { pts: Pt[]; ticks?: number[] | null; label: string; zero?: boolean }) {
  const W = 350, H = 256, x0 = 36, x1 = 340, yT = 20, yB = 226;
  const vs = pts.map((p) => p.v);
  let mn = Math.min(...vs);
  const mx = Math.max(...vs);
  let lines: number[] | null = null, next: number | null = null;
  if (ticks && ticks.length) {
    const t = ticks.slice().sort((a, b) => a - b);
    let lo = mn, hi = mx;
    for (const x of t) if (x <= mn) lo = x;
    for (const x of t) if (x > mx) { hi = x; next = x; break; }
    lines = t.filter((x) => x >= lo && x <= hi);
    for (const x of [mn, mx]) if (lines.indexOf(x) < 0) lines.push(x);
    lines.sort((a, b) => a - b);
    if (lines.length > 11 || lines.length < 2) { lines = null; next = null; }
  }
  if (!lines) {
    if (zero) mn = 0;
    const st = niceStep(mx - mn), a = Math.floor(mn / st) * st;
    let b = Math.ceil(mx / st) * st;
    if (b === a) b = a + st;
    lines = [];
    for (let v = a; v <= b + 1e-9; v += st) lines.push(Math.round(v * 100) / 100);
  }
  const lo2 = lines[0], hi2 = lines[lines.length - 1];
  const t0 = toDate(pts[0].date).getTime(), t1 = toDate(pts[pts.length - 1].date).getTime(), span = t1 - t0;
  const X = (d: string) => (span ? x0 + ((toDate(d).getTime() - t0) / span) * (x1 - x0) : (x0 + x1) / 2);
  const Y = (v: number) => yB - ((v - lo2) / (hi2 - lo2)) * (yB - yT);
  const f = (n: number) => Math.round(n * 10) / 10;

  let labs: { x: number; t: string }[] = [];
  const months = span > 40 * 864e5;
  if (months) {
    let d = new Date(t0);
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    while (d.getTime() <= t1) {
      labs.push({ x: x0 + ((d.getTime() - t0) / span) * (x1 - x0), t: MONTHS[d.getMonth()].slice(0, 3) });
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
    const every = Math.ceil(labs.length / 6);
    labs = labs.filter((_, i) => i % every === 0);
    if (!labs.length || labs[0].x - x0 > 34) labs.unshift({ x: x0, t: MONTHS[new Date(t0).getMonth()].slice(0, 3) });
  }

  let path = '';
  if (pts.length > 1) {
    path = 'M' + f(X(pts[0].date)) + ' ' + f(Y(pts[0].v));
    for (let k = 1; k < pts.length; k++) path += 'H' + f(X(pts[k].date)) + 'V' + f(Y(pts[k].v));
  }
  const first = pts[0], last = pts[pts.length - 1];
  const aria = label + ', from ' + num(first.v) + ' on ' + shortDate(first.date) + ' to ' + num(last.v) + ' on ' + shortDate(last.date);

  return (
    <svg class="chart" role="img" aria-label={aria} viewBox={'0 0 ' + W + ' ' + H}>
      {lines.map((v) => (
        <g key={v}>
          <path class={v === next ? 'nx' : 'g'} d={'M' + (x0 - 4) + ' ' + f(Y(v)) + 'H' + W} />
          <text x={x0 - 10} y={f(Y(v) + 4)} text-anchor="end">{num(v)}</text>
        </g>
      ))}
      {months ? (
        labs.map((l, i) => (
          <g key={i}>
            <path class="tk" d={'M' + f(l.x) + ' ' + yB + 'v6'} />
            <text x={f(Math.min(l.x, W - 24))} y={yB + 22}>{l.t}</text>
          </g>
        ))
      ) : (
        <>
          <text x={x0} y={yB + 22}>{shortDate(first.date)}</text>
          {span ? <text x={x1} y={yB + 22} text-anchor="end">{shortDate(last.date)}</text> : null}
        </>
      )}
      {path ? <path class="ln" d={path} /> : null}
      {pts.map((p, i) => {
        const end = i === pts.length - 1;
        return <circle key={i} class={end ? 'last' : 'pt'} cx={f(X(p.date))} cy={f(Y(p.v))} r={end ? 5.5 : 2.5} />;
      })}
    </svg>
  );
}
