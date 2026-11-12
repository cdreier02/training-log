import { useEffect, useRef, useState } from 'preact/hooks';
import { Choice, Sheet, Stepper } from '../components/common';
import { freeStep, num, unitW, unitWLong } from '../lib/format';
import { lastEntry, pinAfter, splitLoad } from '../lib/logic';
import { getActive, getConfig, getSessions, sessionById, updateActive, updateSession } from '../lib/store';
import type { ActiveLift, Feel, LiftDef, SessionLift, SetRec } from '../lib/types';
import { closeOverlay } from '../ui';
import type { Target } from '../ui';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The lift this sheet is editing, wherever it lives. */
function liftAt(target: Target, li: number): { l: SessionLift; plan: { w: number; r: number }[] } | null {
  if (target.kind === 'active') {
    const l = getActive()?.lifts[li];
    return l ? { l, plan: l.plan } : null;
  }
  const l = sessionById(target.id)?.lifts[li];
  return l ? { l, plan: [] } : null;
}

export function LogSet({ target, li, si }: { target: Target; li: number; si: number }) {
  const found = liftAt(target, li);
  const def = (found ? getConfig().lifts[found.l.id] : undefined) as LiftDef | undefined;

  // Starting values: the set as logged, else the plan, else whatever the last set was.
  const [st, setSt] = useState(() => {
    if (!found) return { base: 0, addOn: false, r: 10, feel: '' as Feel | '', note: '' };
    const { l, plan } = found;
    const ex = l.sets[si], prev = l.sets[l.sets.length - 1];
    const p = plan[si] || plan[plan.length - 1] || { w: prev?.w ?? def?.start ?? def?.weights?.[0] ?? 0, r: prev?.r ?? def?.reps ?? 10 };
    const w = ex ? ex.w : si >= plan.length && prev ? prev.w : p.w;
    const split = splitLoad(def ?? null, w);
    return { base: split.base, addOn: split.addOn, r: ex && ex.r != null ? ex.r : p.r, feel: (ex?.feel ?? '') as Feel | '', note: l.note || '' };
  });

  // Updates are applied to the latest state, never to a copy captured by an earlier render.
  type St = typeof st;
  const up = (patch: Partial<St> | ((s: St) => Partial<St>)) => setSt((s) => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }));

  // Keep the chosen plate in view when the sheet opens on a long rack.
  const plates = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = plates.current, sel = box?.querySelector<HTMLElement>('.sel');
    if (box && sel) box.scrollTop = sel.offsetTop - box.offsetTop - box.clientHeight / 2 + 22;
  }, []);

  if (!found) return <Sheet title="Set" backLabel="Back"><p class="muted" style="margin-top:14px">This set isn’t here anymore.</p></Sheet>;
  const { l, plan } = found;
  const edit = si < l.sets.length;
  const body = l.kind === 'bodyweight';
  const stack = l.kind === 'stack';
  const weights = (def?.weights || []).slice();
  if (weights.length && weights.indexOf(st.base) < 0) weights.push(st.base);
  weights.sort((a, b) => a - b);
  const addOn = def?.addOn || 0;
  const total = round2(st.base + (st.addOn ? addOn : 0));

  const sessions = getSessions();
  const last = target.kind === 'active' ? lastEntry(sessions, l.id) : lastEntry(sessions, l.id, sessionById(target.id) ?? undefined);
  const lastSet = last ? last.l.sets[Math.min(si, last.l.sets.length - 1)] : null;
  const inCircuit = target.kind === 'active' && !!(l as ActiveLift).cid;
  let sub = (inCircuit ? 'Round ' : 'Set ') + (si + 1) + ' of ' + Math.max(plan.length, l.sets.length + (edit ? 0 : 1)) + '.';
  if (lastSet && lastSet.r != null) sub += ' Last time you got ' + lastSet.r + (body ? (l.repUnit === 'sec' ? ' seconds' : '') : ' at ' + num(lastSet.w)) + '.';

  const stepR = l.repUnit === 'sec' ? 5 : 1;
  const aim = (plan[si] || plan[plan.length - 1])?.r;

  const save = () => {
    const set: SetRec = { w: body ? 0 : total, r: st.r };
    if (st.feel) set.feel = st.feel;
    const note = st.note.trim().slice(0, 300);
    if (target.kind === 'active') {
      updateActive((a) => {
        const x = a.lifts[li];
        if (!x) return;
        if (si < x.sets.length) x.sets[si] = set;
        else {
          x.sets.push(set);
          a.lastSetAt = Date.now();
          // Going heavier or lighter than planned usually holds for the rest of the lift,
          // so the sets still to come follow this one.
          const planned = x.plan[si]?.w;
          if (!body && planned != null && set.w !== planned) for (let k = si + 1; k < x.plan.length; k++) if (x.plan[k].w === planned) x.plan[k].w = set.w;
        }
        x.note = note;
        x.skipped = false;
        a.cur = pinAfter(a, li); // in a circuit this moves on to the next lift in the round
      });
    } else {
      updateSession(target.id, (s) => {
        const x = s.lifts[li];
        if (!x) return;
        if (si < x.sets.length) x.sets[si] = set;
        else x.sets.push(set);
        x.note = note;
      });
    }
    closeOverlay();
  };

  const remove = () => {
    if (target.kind === 'active') updateActive((a) => { a.lifts[li]?.sets.splice(si, 1); a.cur = li; });
    else updateSession(target.id, (s) => {
      const x = s.lifts[li];
      if (!x) return;
      x.sets.splice(si, 1);
      if (!x.sets.length) s.lifts.splice(li, 1); // a lift with no sets left isn't part of the session
    });
    closeOverlay();
  };

  return (
    <Sheet title={l.name} sub={sub} backLabel="Back to session">
      <div class="pick">
        {!body && weights.length ? (
          <div class="stackcol">
            {stack ? <span class="cable" aria-hidden="true" /> : null}
            <div class={'plates ' + (stack ? 'stack' : 'rack')} role="group" aria-label="Weight" ref={plates}>
              {weights.map((w) => {
                const sel = w === st.base, on = stack ? w <= st.base : true;
                return (
                  <button type="button" key={w} class={'plate' + (sel ? ' sel' : on ? ' on' : '')} aria-pressed={sel ? 'true' : 'false'} aria-label={num(w) + ' ' + unitWLong()} onClick={() => up({ base: w })}>
                    {num(w)}
                  </button>
                );
              })}
            </div>
            <p class="tiny muted">{stack ? 'Tap a plate to move the pin.' : l.kind === 'dumbbell' ? 'Tap the pair you’re using.' : 'Tap the weight you’re using.'}</p>
          </div>
        ) : null}
        <div class={'side' + (!body && weights.length ? '' : ' wide')}>
          {!body ? (
            <div class="grp">
              {weights.length ? (
                <p class="read" aria-live="polite">
                  <b class={num(total).length > 4 ? 'long' : ''}>{num(total)}</b>
                  <span class="muted">{l.kind === 'dumbbell' ? unitW() + ' each' : unitW()}</span>
                </p>
              ) : (
                <>
                  <p class="lab">Weight, {unitW()}</p>
                  <Stepper value={num(total)} onStep={(d) => up((s) => ({ base: Math.max(0, round2(s.base + d * freeStep())) }))} less={freeStep() + ' ' + unitWLong() + ' less'} more={freeStep() + ' ' + unitWLong() + ' more'} />
                </>
              )}
              {addOn ? (
                <button type="button" class="tog" aria-pressed={st.addOn ? 'true' : 'false'} onClick={() => up((s) => ({ addOn: !s.addOn }))}>
                  {st.addOn ? num(addOn) + ' ' + unitW() + ' plate added' : 'Add ' + num(addOn) + ' ' + unitW() + ' plate'}
                </button>
              ) : null}
            </div>
          ) : null}
          <div class="grp">
            <p class="lab">{l.repUnit === 'sec' ? 'Seconds' : 'Reps'}</p>
            <Stepper
              value={st.r}
              onStep={(d) => up((s) => ({ r: Math.max(0, Math.min(999, s.r + d * stepR)) }))}
              less={l.repUnit === 'sec' ? '5 seconds less' : 'One fewer rep'}
              more={l.repUnit === 'sec' ? '5 seconds more' : 'One more rep'}
            />
            {aim ? <p class="tiny muted">Aim for {aim}.</p> : null}
          </div>
        </div>
      </div>

      <div class="field">
        <p class="lab" id="feel-l">How did it feel?</p>
        <Choice<Feel> label="How did it feel?" value={st.feel as Feel} options={[['easy', 'Easy'], ['good', 'Good'], ['hard', 'Very hard']]} onPick={(v) => up((s) => ({ feel: s.feel === v ? '' : v }))} />
      </div>
      <div class="field">
        <label for="f-note">Note for next time</label>
        <input id="f-note" type="text" value={st.note} placeholder="Optional" autocomplete="off" enterkeyhint="done" onInput={(e) => up({ note: (e.target as HTMLInputElement).value })} />
      </div>
      <div class="foot">
        <button class="btn" onClick={save}>{(edit ? 'Save set ' : 'Log set ') + (si + 1)}</button>
        {edit ? (
          <div class="bar">
            <button class="link" onClick={remove}>Remove this set</button>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
