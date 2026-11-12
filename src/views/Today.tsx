import { useEffect, useRef, useState } from 'preact/hooks';
import { Banner, Confirm, Head } from '../components/common';
import { clock, longDate, shortDate, todayStr, weekStart } from '../lib/dates';
import { fmtPlan, fmtSets, isBody, num, plural, runLine } from '../lib/format';
import { buildSession, circuitProgress, circuitStep, lastEntry, liftDone, newActive, nextStep, nudge, pinAfter, upNext } from '../lib/logic';
import { finishActive, getActive, getConfig, getSessions, isEmpty, setActive, updateActive } from '../lib/store';
import type { ActiveDoc, ActiveLift, LiftDef } from '../lib/types';
import { openOverlay, setTab } from '../ui';

export function Today() {
  const A = getActive();
  if (A) return <Active A={A} />;

  const c = getConfig(), sessions = getSessions(), today = todayStr();
  if (!c.routines.length) {
    return (
      <>
        <Banner />
        <Head date={longDate(today)} title="Today" />
        <div class="empty">
          <p>No routines yet. Add the lifts you do and the weights your gym has, and this screen will have your next session ready.</p>
          <button class="btn" onClick={() => setTab('plan')}>Set up a routine</button>
          {isEmpty() ? (
            <>
              <p class="muted small" style="margin-top:8px">Already keeping a log somewhere else?</p>
              <button class="btn ghost" onClick={() => openOverlay({ type: 'sync' })}>Sync with another device</button>
              <button class="btn ghost" onClick={() => openOverlay({ type: 'backup' })}>Restore from a backup</button>
            </>
          ) : (
            <button class="btn ghost" onClick={() => openOverlay({ type: 'run', target: { kind: 'solo' } })}>Log a run</button>
          )}
        </div>
      </>
    );
  }

  const next = upNext(c, sessions);
  const thisWeek = sessions.filter((s) => weekStart(s.date) === weekStart(today)).length;
  const last = sessions[sessions.length - 1];
  return (
    <>
      <Banner />
      <Head date={longDate(today)} title="Today" right={sessions.length ? plural(thisWeek, 'session') + ' this week' : ''} />
      <ul class="rows">
        {c.routines.map((r) => {
          let done = '';
          for (const s of sessions) if (s.routineId === r.id) done = s.date;
          const n = r.liftIds.filter((id) => c.lifts[id]).length;
          return (
            <li key={r.id}>
              <div class="prow">
                <div class="row">
                  <span class="n">
                    <span class="big">{r.name}</span>
                    {next === r.id ? <span class="tag">Up next</span> : null}
                    <span class="sub">{plural(n, 'lift')}{done ? '. Last done ' + shortDate(done) + '.' : '. Not done yet.'}</span>
                  </span>
                </div>
                <button class="btn auto" disabled={!n} aria-label={'Start ' + r.name} onClick={() => { setActive(newActive(r, c, sessions, todayStr())); window.scrollTo(0, 0); }}>Start</button>
              </div>
            </li>
          );
        })}
      </ul>
      <div class="gap stack-v">
        <button class="btn ghost" onClick={() => openOverlay({ type: 'run', target: { kind: 'solo' } })}>Log a run</button>
      </div>
      {last ? (
        <div class="gap">
          <h3>Last session</h3>
          <ul class="rows">
            <li>
              <button class="row" onClick={() => openOverlay({ type: 'report', id: last.id })}>
                <span class="n">{last.routineName || 'Session'}<span class="sub">{longDate(last.date)}</span></span>
                <span class="small muted nowrap">{last.feedback ? 'Report and feedback' : 'Report'}</span>
              </button>
            </li>
          </ul>
        </div>
      ) : null}
    </>
  );
}

function Active({ A }: { A: ActiveDoc }) {
  const step = nextStep(A), ci = step ? step.li : -1, doneN = A.lifts.filter(liftDone).length;
  const any = !!A.run || A.lifts.some((l) => l.sets.length);
  const stale = A.date !== todayStr();
  // When the open lift is part of a circuit, the card shows the whole circuit.
  const cid = ci !== -1 ? A.lifts[ci].cid : undefined;
  const inCard = (i: number) => (cid ? A.lifts[i].cid === cid : i === ci);
  const cardFrom = A.lifts.findIndex((_, i) => inCard(i));

  const finish = () => {
    const s = buildSession(A);
    finishActive(s);
    window.scrollTo(0, 0);
    openOverlay({ type: 'report', id: s.id });
  };

  // The lifts before and after the open card are two separate lists, so the card sits between
  // them. Lifts that belong to a circuit get its name above the first of them.
  const rows = (keep: (i: number) => boolean) => {
    const out = [];
    let label = '';
    for (let i = 0; i < A.lifts.length; i++) {
      if (!keep(i) || inCard(i)) continue;
      const l = A.lifts[i], c = l.cid ? A.circuits?.find((x) => x.id === l.cid) : undefined;
      if (c && c.id !== label) out.push(<li key={'c' + c.id} class="clab">{c.name} · {plural(c.rounds, 'round')}</li>);
      label = c ? c.id : '';
      out.push(<li key={l.id + i}><LiftRow l={l} i={i} /></li>);
    }
    return out.length ? <ul class="rows">{out}</ul> : null;
  };

  return (
    <>
      <Banner />
      <Head date={longDate(A.date)} title={A.routineName} right={doneN + ' of ' + A.lifts.length + ' lifts done'} />
      <div class="segs" aria-hidden="true">
        {A.lifts.map((l, i) => <i key={i} class={i === ci ? 'c' : liftDone(l) ? 'd' : ''} />)}
      </div>
      {stale ? <p class="note" role="status">This session was started on {longDate(A.date)}. Finishing it files it under that day.</p> : null}

      {rows((i) => ci === -1 || i < cardFrom)}
      {ci === -1 ? null : cid ? <CircuitCard A={A} cid={cid} now={circuitStep(A, cid)?.li ?? -1} /> : <CurLift A={A} l={A.lifts[ci]} i={ci} />}
      {ci !== -1 ? rows((i) => i > cardFrom) : null}

      <ul class="rows top">
        <li>
          <button class={'row ' + (A.run ? 'done' : 'todo')} onClick={() => openOverlay({ type: 'run', target: { kind: 'active' } })}>
            <span class="n">Run</span>
            <span class="num v">{A.run ? runLine(A.run) : 'Add'}</span>
          </button>
        </li>
      </ul>

      <div class="gap stack-v">
        <button class={'btn' + (ci === -1 ? '' : ' ghost')} disabled={!any} onClick={finish}>Finish session</button>
        <Confirm
          ask="Discard session" yes="Discard this session" no="Keep going"
          onYes={() => { setActive(null); window.scrollTo(0, 0); }}
          before={<button class="link" onClick={() => openOverlay({ type: 'addlift', target: { kind: 'active' } })}>Add a lift</button>}
        />
      </div>
    </>
  );
}

function LiftRow({ l, i }: { l: ActiveLift; i: number }) {
  const done = liftDone(l);
  const v = l.skipped && !l.sets.length ? 'Skipped' : !l.sets.length ? fmtPlan(l) : fmtSets(l) + (done ? '' : ', ' + (l.plan.length - l.sets.length) + ' to go');
  return (
    <button class={'row ' + (done ? 'done' : 'todo')} onClick={() => updateActive((a) => { a.cur = i; })}>
      <span class="n">{l.name}</span>
      <span class="num v">{v}</span>
    </button>
  );
}

function restTarget(d: LiftDef | undefined): number {
  return d && d.rest != null ? d.rest : getConfig().prefs.restSec;
}

function CurLift({ A, l, i }: { A: ActiveDoc; l: ActiveLift; i: number }) {
  const d = getConfig().lifts[l.id] as LiftDef | undefined;
  const sessions = getSessions();
  const last = lastEntry(sessions, l.id);
  const n = Math.max(l.plan.length, l.sets.length), si = l.sets.length, done = liftDone(l);
  const hint = !l.sets.length ? nudge(d ?? null, last) : '';
  const rest = restTarget(d);
  const log = (s: number) => openOverlay({ type: 'log', target: { kind: 'active' }, li: i, si: s });

  const cells = [];
  for (let k = 0; k < n; k++) {
    const s = l.sets[k], p = l.plan[k] || l.plan[l.plan.length - 1];
    const shown = s || p;
    const body = isBody(l.kind, [shown]);
    const r = s ? (s.r == null ? '?' : s.r) : p.r;
    const inner = (
      <span class="t">
        {body ? (
          <>
            <span class="w">{r}</span>
            {l.repUnit === 'sec' ? <span class="x">sec</span> : null}
          </>
        ) : (
          <>
            <span class="w">{num(shown.w)}</span>
            <span class="x">× {r}</span>
          </>
        )}
      </span>
    );
    if (s) cells.push(<li key={k}><button class="cell done" onClick={() => log(k)} aria-label={'Edit set ' + (k + 1)}>{inner}<span class="s">Done</span></button></li>);
    else if (k === si && !l.skipped) cells.push(<li key={k}><button class="cell now" onClick={() => log(k)} aria-label={'Log set ' + (k + 1)}>{inner}<span class="s">Now</span></button></li>);
    else cells.push(<li key={k}><div class="cell">{inner}<span class="s">{l.skipped ? 'Skipped' : 'Next'}</span></div></li>);
  }

  return (
    <section class="cur" aria-label="Current lift">
      <div class="curh">
        <h2>{l.name}</h2>
        <p class="small muted nowrap">{done ? 'Done' : 'Set ' + (si + 1) + ' of ' + l.plan.length}</p>
      </div>
      {d && d.cue ? (
        <div class="cue">
          <p>{d.cue}</p>
          <p class="tiny muted">Your cue</p>
        </div>
      ) : null}
      <ol class="cells">{cells}</ol>
      {A.lastSetAt && rest > 0 && !l.skipped ? <RestTimer key={A.lastSetAt} since={A.lastSetAt} target={rest} /> : null}
      {last ? (
        <p class="small muted">{shortDate(last.s.date)}: {fmtSets(last.l)}.{last.l.note ? ' ' + last.l.note : ''}</p>
      ) : (
        <p class="small muted">First time logging this lift.</p>
      )}
      {hint ? <p class="small">{hint}</p> : null}
      {l.skipped ? (
        <button class="btn" onClick={() => updateActive((a) => { a.lifts[i].skipped = false; })}>Do it after all</button>
      ) : (
        <button class="btn" onClick={() => log(si)}>{done ? 'Add a set' : 'Log set ' + (si + 1)}</button>
      )}
      {!done ? (
        <div class="bar">
          <button class="link" onClick={() => updateActive((a) => { a.lifts[i].skipped = true; a.cur = null; })}>Skip this lift</button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The card for a circuit: every lift in it, for the round being done, with the one
 * that's up next marked. Rest is between rounds, so the timer only shows once a round
 * has just ended.
 */
function CircuitCard({ A, cid, now }: { A: ActiveDoc; cid: string; now: number }) {
  const cfg = getConfig(), sessions = getSessions();
  const c = A.circuits?.find((x) => x.id === cid);
  const members = A.lifts.map((l, i) => ({ l, i })).filter((x) => x.l.cid === cid);
  const live = members.filter((x) => !x.l.skipped);
  const { done: roundsDone, rounds } = circuitProgress(A, cid);
  const finished = now === -1;
  const round = finished ? rounds - 1 : roundsDone; // the round on show, counting from 0
  const cur = finished ? null : A.lifts[now];
  const d = cur ? (cfg.lifts[cur.id] as LiftDef | undefined) : undefined;
  const last = cur ? lastEntry(sessions, cur.id) : null;
  const rest = c?.rest != null ? c.rest : cfg.prefs.restSec;
  const roundJustEnded = !finished && roundsDone > 0 && live.length > 0 && live[0].i === now && live.every((x) => x.l.sets.length === roundsDone);
  const log = (li: number, si: number) => openOverlay({ type: 'log', target: { kind: 'active' }, li, si });

  const addRound = () => updateActive((a) => {
    for (const l of a.lifts) if (l.cid === cid && !l.skipped) l.plan.push({ ...l.plan[l.plan.length - 1] });
    const k = a.circuits?.find((x) => x.id === cid);
    if (k) k.rounds += 1;
    a.cur = a.lifts.findIndex((l) => l.cid === cid);
  });

  return (
    <section class="cur" aria-label={'Circuit: ' + (c?.name ?? 'Circuit')}>
      <div class="curh">
        <h2>{c?.name ?? 'Circuit'}</h2>
        <p class="small muted nowrap">{finished ? 'Done' : 'Round ' + (round + 1) + ' of ' + rounds}</p>
      </div>
      <div class="segs" aria-hidden="true" style="margin-bottom:0">
        {Array.from({ length: rounds }, (_, k) => <i key={k} class={k < roundsDone ? 'd' : k === roundsDone && !finished ? 'c' : ''} />)}
      </div>
      <ol class="crows">
        {members.map(({ l, i }) => {
          const s = l.sets[round], p = l.plan[round] || l.plan[l.plan.length - 1];
          const shown = s || p;
          const body = isBody(l.kind, [shown]);
          const r = s ? (s.r == null ? '?' : s.r) : p.r;
          const state = l.skipped ? 'skip' : s ? 'done' : i === now ? 'now' : '';
          const label = l.skipped ? 'Skipped. Tap to do it' : s ? 'Done' : i === now ? 'Now' : 'Next';
          return (
            <li key={l.id + i}>
              <button
                class={'crow ' + state}
                aria-label={l.skipped ? 'Do ' + l.name + ' after all' : (s ? 'Edit ' : 'Log ') + l.name + ', round ' + (round + 1)}
                onClick={() => (l.skipped ? updateActive((a) => { a.lifts[i].skipped = false; a.cur = i; }) : log(i, s ? round : l.sets.length))}
              >
                <span class="n">{l.name}</span>
                <span class="v">
                  <span class="w">{body ? r + (l.repUnit === 'sec' ? ' sec' : '') : num(shown.w) + ' × ' + r}</span>
                  <span class="s">{label}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {roundJustEnded && A.lastSetAt && rest > 0 ? <RestTimer key={A.lastSetAt} since={A.lastSetAt} target={rest} /> : null}
      {cur && d && d.cue ? (
        <div class="cue">
          <p>{d.cue}</p>
          <p class="tiny muted">Your cue for {cur.name}</p>
        </div>
      ) : null}
      {cur ? (
        <p class="small muted">
          {last ? cur.name + ', ' + shortDate(last.s.date) + ': ' + fmtSets(last.l) + '.' + (last.l.note ? ' ' + last.l.note : '') : 'First time logging ' + cur.name + '.'}
        </p>
      ) : null}
      {cur ? (
        <>
          <button class="btn" onClick={() => log(now, cur.sets.length)}>Log {cur.name}</button>
          <div class="bar">
            <button class="link" onClick={() => updateActive((a) => { a.lifts[now].skipped = true; a.cur = pinAfter(a, now); })}>Skip {cur.name}</button>
          </div>
        </>
      ) : (
        <button class="btn ghost" onClick={addRound}>Add a round</button>
      )}
    </section>
  );
}

/** Counts up from the last logged set and fills toward the rest target. */
function RestTimer({ since, target }: { since: number; target: number }) {
  const [, tick] = useState(0);
  const buzzed = useRef((Date.now() - since) / 1000 >= target);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  const el = Math.max(0, (Date.now() - since) / 1000);
  const ready = el >= target;
  useEffect(() => {
    if (ready && !buzzed.current) {
      buzzed.current = true;
      if (document.visibilityState === 'visible') { try { navigator.vibrate?.([120, 80, 120]); } catch { /* not supported */ } }
    }
  });
  if (el > 20 * 60) return null; // long past any rest: the session was probably set aside
  return (
    <div class={'rest' + (ready ? ' ready' : '')} role="timer" aria-label="Rest since last set">
      <div class="line">
        <span class="clock">{clock(el)}</span>
        <span class="lab">{ready ? 'Rested. Go when ready.' : 'Rest to ' + clock(target)}</span>
      </div>
      <div class="track"><i style={{ transform: 'scaleX(' + Math.min(1, el / target).toFixed(3) + ')' }} /></div>
    </div>
  );
}
