import { Chart } from '../components/Chart';
import { Banner, Choice, Head } from '../components/common';
import { sessionBits } from '../lib/backup';
import { shortDate, todayStr, yearOf } from '../lib/dates';
import { fmtSets, isBody, paceLine, plural, runLine, topR, topW, unitDLong, unitWLong } from '../lib/format';
import { bestSet, entriesFor, liftStory, weekCounts } from '../lib/logic';
import { getConfig, getSessions, notify } from '../lib/store';
import type { SessionDoc } from '../lib/types';
import { openOverlay, setTab, ui } from '../ui';

/** Sessions newest first, grouped under the year they belong to. */
function byYear(sessions: SessionDoc[]): [number, SessionDoc[]][] {
  const out: [number, SessionDoc[]][] = [];
  for (const s of sessions.slice().reverse()) {
    const y = yearOf(s.date), last = out[out.length - 1];
    if (last && last[0] === y) last[1].push(s);
    else out.push([y, [s]]);
  }
  return out;
}

function Weeks() {
  const sessions = getSessions();
  const weeks = weekCounts(sessions, todayStr(), 12);
  const recent = weeks.slice(-4).reduce((t, w) => t + w.n, 0);
  return (
    <div class="weeks">
      <p>{recent ? plural(recent, 'session') + ' in the last four weeks.' : 'No sessions in the last four weeks.'}</p>
      <div class="cells12" role="img" aria-label={'Sessions per week for the last twelve weeks: ' + weeks.map((w) => w.n).join(', ')}>
        {weeks.map((w, i) => <i key={w.start} class={(w.n >= 3 ? 'n3' : w.n === 2 ? 'n2' : w.n === 1 ? 'n1' : '') + (i === weeks.length - 1 ? ' now' : '')} />)}
      </div>
      <div class="ends"><span>Week of {shortDate(weeks[0].start)}</span><span>This week</span></div>
    </div>
  );
}

export function History() {
  const sessions = getSessions(), cfg = getConfig();
  if (!sessions.length) {
    return (
      <>
        <Banner />
        <Head date="Nothing logged yet" title="History" />
        <div class="empty">
          <p>Finish a session and it shows up here, with a chart for each lift.</p>
          <button class="btn" onClick={() => setTab('today')}>Go to today</button>
        </div>
      </>
    );
  }

  const top = (
    <>
      <Banner />
      <Head date={plural(sessions.length, 'session') + ' logged'} title="History" />
      <Weeks />
      <Choice label="Show" value={ui.histMode} options={[['lift', 'By lift'], ['session', 'By session']]} onPick={(v) => { ui.histMode = v; notify(); }} />
    </>
  );

  if (ui.histMode === 'session') {
    // Year headings appear only once the log spans more than the current year.
    const years = byYear(sessions);
    const showYears = years.length > 1 || years[0][0] !== yearOf(todayStr());
    return (
      <>
        {top}
        {years.map(([year, list]) => (
          <div key={year}>
            {showYears ? <h3 style="margin-top:18px">{year}</h3> : null}
            <ul class="rows" style={showYears ? '' : 'margin-top:10px'}>
              {list.map((s) => (
                <li key={s.id}>
                  <button class="row" onClick={() => openOverlay({ type: 'report', id: s.id })}>
                    <span class="n">{s.routineName || 'Session'}<span class="sub">{sessionBits(s)}</span></span>
                    <span class="small muted nowrap">{shortDate(s.date)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </>
    );
  }

  // By lift: everything in the plan first, then anything that only exists in old sessions.
  const names: Record<string, string> = {};
  const order: string[] = [];
  for (const r of cfg.routines) for (const id of r.liftIds) { const d = cfg.lifts[id]; if (d && !names[id]) { names[id] = d.name; order.push(id); } }
  for (const s of sessions) for (const l of s.lifts || []) if (!names[l.id]) { names[l.id] = l.name; order.push(l.id); }
  if (sessions.some((s) => s.run)) { names.__run = 'Runs'; order.push('__run'); }
  let sel = ui.histLift && names[ui.histLift] ? ui.histLift : '';
  if (!sel) sel = order.find((id) => id === '__run' || entriesFor(sessions, id).length > 0) ?? order[0];

  const picker = (
    <div class="field">
      <label for="hist-lift">Lift</label>
      <select id="hist-lift" value={sel} onChange={(e) => { ui.histLift = (e.target as HTMLSelectElement).value; notify(); }}>
        {order.map((id) => <option key={id} value={id}>{names[id]}</option>)}
      </select>
    </div>
  );

  if (sel === '__run') {
    const runs = sessions.filter((s) => s.run);
    const pts = runs.filter((s) => s.run!.mi).map((s) => ({ date: s.date, v: +s.run!.mi }));
    return (
      <>
        {top}
        {picker}
        <p style="margin-top:14px">{plural(runs.length, 'run')} logged.</p>
        {pts.length ? (
          <figure style="margin:0">
            <Chart pts={pts} label={'Distance per run in ' + unitDLong()} zero />
            <figcaption class="tiny muted">Distance per run, in {unitDLong()}.</figcaption>
          </figure>
        ) : null}
        <div class="gap">
          <h3>Recent runs</h3>
          <ul class="rows">
            {runs.slice().reverse().slice(0, 12).map((s) => {
              const sub = [paceLine(s.run!), s.run!.note].filter(Boolean).join('. ');
              return (
                <li key={s.id}>
                  <button class="row" onClick={() => openOverlay({ type: 'report', id: s.id })}>
                    <span class="small muted nowrap" style="flex:none;width:52px">{shortDate(s.date)}</span>
                    <span class="n" style="flex:1">
                      <span class="num" style="font-size:19px">{runLine(s.run!)}</span>
                      {sub ? <span class="sub">{sub}</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </>
    );
  }

  const es = entriesFor(sessions, sel), d = cfg.lifts[sel];
  if (!es.length) {
    return (
      <>
        {top}
        {picker}
        <p class="muted" style="margin-top:14px">No sets logged for this lift yet.</p>
      </>
    );
  }
  const kind = es[es.length - 1].l.kind;
  const body = es.every((e) => isBody(e.l.kind, e.l.sets));
  const ticks = !body && d && d.weights && d.weights.length ? d.weights : null;
  const best = bestSet(es);
  return (
    <>
      {top}
      {picker}
      <p style="margin-top:14px">{liftStory(es)}{best ? ' Best set: ' + best + '.' : ''}</p>
      <figure style="margin:0">
        <Chart pts={es.map((e) => ({ date: e.s.date, v: body ? topR(e.l.sets) : topW(e.l.sets) }))} ticks={ticks} label={'Top ' + (body ? 'count' : 'weight') + ' per session for ' + names[sel]} />
        <figcaption class="tiny muted">
          {body
            ? 'Best set per session.'
            : 'Top weight per session, in ' + unitWLong() + (kind === 'dumbbell' ? ' per hand' : '') + '.' + (ticks ? ' Each line is a weight your gym has, and a dashed line is the next one up.' : '')}
        </figcaption>
      </figure>
      <div class="gap">
        <h3>Recent sessions</h3>
        <ul class="rows">
          {es.slice().reverse().slice(0, 12).map((e) => (
            <li key={e.s.id}>
              <button class="row" onClick={() => openOverlay({ type: 'report', id: e.s.id })}>
                <span class="small muted nowrap" style="flex:none;width:52px">{shortDate(e.s.date)}</span>
                <span class="n" style="flex:1">
                  <span class="num" style="font-size:19px">{fmtSets(e.l)}</span>
                  {e.l.note ? <span class="sub">{e.l.note}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
