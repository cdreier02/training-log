// The short sheets: logging a run, adding a lift to a session, and editing the plan.

import { useState } from 'preact/hooks';
import { Sheet } from '../components/common';
import { clock, isDateStr, longDate, todayStr } from '../lib/dates';
import { paceLine, unitDLong, unitW } from '../lib/format';
import { activeLift, liftSummary, parseWeights, planFor, sessionId, uid } from '../lib/logic';
import { getActive, getConfig, getSessions, putSession, saveConfig, sessionById, updateActive, updateSession } from '../lib/store';
import { KIND_LABEL } from '../lib/types';
import type { Kind, LiftDef, RepUnit, Run, SessionDoc } from '../lib/types';
import { closeOverlay, replaceOverlay } from '../ui';
import type { Target } from '../ui';

const val = (e: Event) => (e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;

/* ---------- run ---------- */

export function RunSheet({ target }: { target: Target | { kind: 'solo' } }) {
  const existing: Run | null | undefined = target.kind === 'active' ? getActive()?.run : target.kind === 'session' ? sessionById(target.id)?.run : null;
  const [f, setF] = useState({
    date: target.kind === 'active' ? getActive()?.date ?? todayStr() : target.kind === 'session' ? sessionById(target.id)?.date ?? todayStr() : todayStr(),
    mi: existing?.mi ? String(existing.mi) : '',
    min: existing?.min ? String(existing.min) : '',
    note: existing?.note ?? '',
  });
  const up = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }));
  const run: Run = { mi: Math.max(0, parseFloat(f.mi) || 0), min: Math.max(0, parseFloat(f.min) || 0), note: f.note.trim().slice(0, 300) };
  const pace = paceLine(run);

  const save = () => {
    const empty = !run.mi && !run.min && !run.note;
    if (target.kind === 'solo') {
      if (empty) { closeOverlay(); return; }
      const now = Date.now(), date = isDateStr(f.date) ? f.date : todayStr();
      const stamp = date === todayStr() ? new Date(now).toISOString() : date + 'T12:00:00.000Z';
      const s: SessionDoc = { id: sessionId(date, now), type: 'session', updatedAt: now, date, startedAt: stamp, endedAt: stamp, routineId: '', routineName: 'Run', lifts: [], run };
      putSession(s);
      replaceOverlay({ type: 'report', id: s.id });
      return;
    }
    if (target.kind === 'active') updateActive((a) => { a.run = empty ? null : run; });
    else updateSession(target.id, (s) => { if (empty) delete s.run; else s.run = run; });
    closeOverlay();
  };
  const remove = () => {
    if (target.kind === 'active') updateActive((a) => { a.run = null; });
    else if (target.kind === 'session') updateSession(target.id, (s) => { delete s.run; });
    closeOverlay();
  };

  return (
    <Sheet title="Run" sub={target.kind === 'solo' ? undefined : longDate(f.date)}>
      {target.kind === 'solo' ? (
        <div class="field">
          <label for="f-date">Day</label>
          <input id="f-date" type="date" value={f.date} max={todayStr()} onInput={(e) => up({ date: val(e) })} />
        </div>
      ) : null}
      <div class="field">
        <label for="f-mi">Distance, {unitDLong()}</label>
        <input id="f-mi" type="number" inputmode="decimal" min="0" step="0.1" value={f.mi} onInput={(e) => up({ mi: val(e) })} />
      </div>
      <div class="field">
        <label for="f-min">Time, minutes</label>
        <input id="f-min" type="number" inputmode="decimal" min="0" step="1" value={f.min} placeholder="Optional" onInput={(e) => up({ min: val(e) })} />
        {pace ? <p class="tiny muted">That’s {pace}.</p> : null}
      </div>
      <div class="field">
        <label for="f-note">Note</label>
        <input id="f-note" type="text" value={f.note} placeholder="Optional" autocomplete="off" onInput={(e) => up({ note: val(e) })} />
      </div>
      <div class="foot">
        <button class="btn" onClick={save}>Save run</button>
        {existing ? <div class="bar"><button class="link" onClick={remove}>Remove this run</button></div> : null}
      </div>
    </Sheet>
  );
}

/* ---------- add a lift to a session ---------- */

export function AddLift({ target }: { target: Target }) {
  const c = getConfig(), sessions = getSessions();
  const have = new Set((target.kind === 'active' ? getActive()?.lifts : sessionById(target.id)?.lifts)?.map((l) => l.id) ?? []);
  const seen = new Set<string>();
  const options: LiftDef[] = [];
  for (const r of c.routines) for (const id of r.liftIds) { const d = c.lifts[id]; if (d && !seen.has(id)) { seen.add(id); if (!have.has(id)) options.push(d); } }
  for (const d of Object.values(c.lifts)) if (!seen.has(d.id) && !have.has(d.id)) options.push(d);

  const add = (d: LiftDef) => {
    if (target.kind === 'active') {
      updateActive((a) => { a.lifts.push(activeLift(d, sessions)); a.cur = a.lifts.length - 1; });
    } else {
      // A finished session gets the lift with last time's sets filled in, ready to correct.
      updateSession(target.id, (s) => {
        s.lifts.push({ id: d.id, name: d.name, kind: d.kind, repUnit: d.repUnit, sets: planFor(d, sessions.filter((x) => x.id !== s.id)).map((p) => ({ w: p.w, r: p.r })), note: '' });
      });
    }
    closeOverlay();
  };

  return (
    <Sheet title="Add a lift" sub={target.kind === 'active' ? 'For this session only. Your routine stays as it is.' : 'Added with your usual sets. Tap any set to correct it.'}>
      {options.length ? (
        <ul class="rows" style="margin-top:10px">
          {options.map((d) => (
            <li key={d.id}>
              <button class="row" onClick={() => add(d)}>
                <span class="n">{d.name}<span class="sub">{liftSummary(d, KIND_LABEL[d.kind])}</span></span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p class="muted" style="margin-top:14px">Every lift you’ve set up is already in this session. New lifts are added on the Plan tab.</p>
      )}
    </Sheet>
  );
}

/* ---------- plan: a lift ---------- */

const REST_CHOICES = [30, 45, 60, 90, 120, 150, 180, 240, 300];

export function LiftSheet({ rt, id }: { rt: string; id: string }) {
  const c = getConfig();
  const L = id ? c.lifts[id] : undefined;
  const routine = c.routines.find((r) => r.id === rt);
  const isNew = !L;
  const others = isNew ? Object.values(c.lifts).filter((d) => !routine?.liftIds.includes(d.id)) : [];
  const [f, setF] = useState({
    name: L?.name ?? '', kind: (L?.kind ?? 'dumbbell') as Kind, weights: (L?.weights ?? []).join(', '), addOn: L?.addOn ? String(L.addOn) : '',
    sets: String(L?.sets ?? 3), reps: String(L?.reps ?? 10), repUnit: (L?.repUnit ?? 'reps') as RepUnit, cue: L?.cue ?? '',
    rest: L?.rest == null ? 'default' : String(L.rest), err: '',
  });
  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }));

  const save = () => {
    const name = f.name.trim().slice(0, 60);
    if (!name) { set({ err: 'Give the lift a name.' }); return; }
    const lid = L?.id ?? uid('l');
    const kind: Kind = KIND_LABEL[f.kind] ? f.kind : 'dumbbell';
    const next: LiftDef = {
      ...(L ?? {}),
      id: lid, name, kind,
      weights: kind === 'bodyweight' ? [] : parseWeights(f.weights),
      addOn: kind === 'stack' ? Math.max(0, parseFloat(f.addOn) || 0) : 0,
      sets: Math.max(1, Math.min(12, parseInt(f.sets, 10) || 3)),
      reps: Math.max(1, Math.min(999, parseInt(f.reps, 10) || 10)),
      repUnit: f.repUnit === 'sec' ? 'sec' : 'reps',
      cue: f.cue.trim().slice(0, 200),
    };
    if (f.rest === 'default') delete next.rest;
    else next.rest = Math.max(0, parseInt(f.rest, 10) || 0);
    saveConfig((x) => {
      x.lifts[lid] = next;
      const r = x.routines.find((y) => y.id === rt);
      if (r && r.liftIds.indexOf(lid) < 0) r.liftIds.push(lid);
    });
    closeOverlay();
  };
  const reuse = (lid: string) => {
    if (!lid) return;
    saveConfig((x) => { const r = x.routines.find((y) => y.id === rt); if (r && r.liftIds.indexOf(lid) < 0) r.liftIds.push(lid); });
    closeOverlay();
  };
  const removeFromRoutine = () => {
    saveConfig((x) => { const r = x.routines.find((y) => y.id === rt); if (r) r.liftIds = r.liftIds.filter((y) => y !== id); });
    closeOverlay();
  };
  const defaultRest = c.prefs.restSec;

  return (
    <Sheet title={isNew ? 'New lift' : 'Edit lift'} sub={routine ? 'In ' + routine.name : undefined} backLabel="Back to plan">
      {f.err ? <p class="note" role="alert" style="margin-top:10px">{f.err}</p> : null}
      {others.length ? (
        <div class="field">
          <label for="f-reuse">Use a lift you already have</label>
          <select id="f-reuse" value="" onChange={(e) => reuse(val(e))}>
            <option value="">No, set up a new one</option>
            {others.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      ) : null}
      <div class="field">
        <label for="f-name">Name</label>
        <input id="f-name" type="text" value={f.name} autocomplete="off" onInput={(e) => set({ name: val(e), err: '' })} />
      </div>
      <div class="field">
        <label for="f-kind">Equipment</label>
        <select id="f-kind" value={f.kind} onChange={(e) => set({ kind: val(e) as Kind })}>
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </div>
      {f.kind !== 'bodyweight' ? (
        <>
          <div class="field">
            <label for="f-weights">Weights your gym has, in {unitW()}</label>
            <input id="f-weights" type="text" value={f.weights} placeholder="70, 85, 100, 120" autocomplete="off" autocapitalize="off" spellcheck={false} onInput={(e) => set({ weights: val(e) })} />
            <p class="tiny muted">Separate them with commas. Leave it empty to step by {unitW() === 'kg' ? '2.5' : '5'} instead.</p>
          </div>
          {f.kind === 'stack' ? (
            <div class="field">
              <label for="f-addon">Add-on plate, {unitW()}</label>
              <input id="f-addon" type="number" inputmode="decimal" min="0" step="0.5" value={f.addOn} placeholder="None" onInput={(e) => set({ addOn: val(e) })} />
            </div>
          ) : null}
        </>
      ) : null}
      <div class="two" style="gap:10px">
        <div class="field">
          <label for="f-sets">Sets</label>
          <input id="f-sets" type="number" inputmode="numeric" min="1" max="12" value={f.sets} onInput={(e) => set({ sets: val(e) })} />
        </div>
        <div class="field">
          <label for="f-reps">Target per set</label>
          <input id="f-reps" type="number" inputmode="numeric" min="1" value={f.reps} onInput={(e) => set({ reps: val(e) })} />
        </div>
      </div>
      <div class="two" style="gap:10px">
        <div class="field">
          <label for="f-unit">Count in</label>
          <select id="f-unit" value={f.repUnit} onChange={(e) => set({ repUnit: val(e) as RepUnit })}>
            <option value="reps">Reps</option>
            <option value="sec">Seconds</option>
          </select>
        </div>
        <div class="field">
          <label for="f-rest">Rest between sets</label>
          <select id="f-rest" value={f.rest} onChange={(e) => set({ rest: val(e) })}>
            <option value="default">Usual ({defaultRest ? clock(defaultRest) : 'off'})</option>
            <option value="0">No timer</option>
            {REST_CHOICES.map((s) => <option key={s} value={String(s)}>{clock(s)}</option>)}
          </select>
        </div>
      </div>
      <div class="field">
        <label for="f-cue">Cue to show at the lift</label>
        <input id="f-cue" type="text" value={f.cue} placeholder="Optional" autocomplete="off" onInput={(e) => set({ cue: val(e) })} />
      </div>
      <div class="foot">
        <button class="btn" onClick={save}>{isNew ? 'Add lift' : 'Save lift'}</button>
        {!isNew ? <div class="bar"><button class="link" onClick={removeFromRoutine}>Remove from this routine</button></div> : null}
      </div>
    </Sheet>
  );
}

/* ---------- plan: a routine ---------- */

export function RoutineSheet({ id }: { id: string }) {
  const r = id ? getConfig().routines.find((x) => x.id === id) : undefined;
  const [name, setName] = useState(r?.name ?? '');
  const [err, setErr] = useState('');
  const save = () => {
    const n = name.trim().slice(0, 60);
    if (!n) { setErr('Give the routine a name.'); return; }
    saveConfig((c) => {
      const cur = id ? c.routines.find((x) => x.id === id) : undefined;
      if (cur) cur.name = n;
      else c.routines.push({ id: uid('r'), name: n, liftIds: [] });
    });
    closeOverlay();
  };
  return (
    <Sheet title={r ? 'Rename routine' : 'New routine'} backLabel="Back to plan">
      {err ? <p class="note" role="alert" style="margin-top:10px">{err}</p> : null}
      <div class="field">
        <label for="f-name">Name</label>
        <input id="f-name" type="text" value={name} placeholder="Upper body" autocomplete="off" enterkeyhint="done"
          onInput={(e) => { setName(val(e)); setErr(''); }} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
      </div>
      <div class="foot">
        <button class="btn" onClick={save}>{r ? 'Save name' : 'Add routine'}</button>
      </div>
    </Sheet>
  );
}
