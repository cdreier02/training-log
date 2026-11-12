import { useState } from 'preact/hooks';
import { Confirm, Sheet, Stepper } from '../components/common';
import { clock } from '../lib/dates';
import { tidyRoutine, uid } from '../lib/logic';
import { getConfig, saveConfig } from '../lib/store';
import type { Circuit } from '../lib/types';
import { closeOverlay } from '../ui';

const REST_CHOICES = [30, 45, 60, 90, 120, 150, 180, 240, 300];

/** Making or changing a circuit: which of the routine's lifts are in it, in what order, for how many rounds. */
export function CircuitSheet({ rt, id }: { rt: string; id: string }) {
  const cfg = getConfig();
  const routine = cfg.routines.find((r) => r.id === rt);
  const existing = id ? routine?.circuits?.find((x) => x.id === id) : undefined;
  const [f, setF] = useState({
    name: existing?.name ?? '',
    rounds: existing?.rounds ?? 3,
    rest: existing?.rest == null ? 'default' : String(existing.rest),
    picked: existing?.liftIds.slice() ?? ([] as string[]),
    err: '',
  });
  const up = (patch: Partial<typeof f> | ((s: typeof f) => Partial<typeof f>)) => setF((s) => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }));

  if (!routine) return <Sheet title="Circuit" backLabel="Back to plan"><p class="muted" style="margin-top:14px">This routine isn’t here anymore.</p></Sheet>;
  const lifts = routine.liftIds.filter((l) => cfg.lifts[l]).map((l) => cfg.lifts[l]);
  const elsewhere = (liftId: string) => routine.circuits?.find((x) => x.id !== existing?.id && x.liftIds.includes(liftId));

  const save = () => {
    if (f.picked.length < 2) { up({ err: 'Pick at least two lifts. A circuit is two or more done back to back.' }); return; }
    const cid = existing?.id ?? uid('c');
    const mine: Circuit = { id: cid, name: f.name.trim().slice(0, 60) || 'Circuit', rounds: Math.max(1, Math.min(12, f.rounds)), liftIds: f.picked.slice() };
    if (f.rest !== 'default') mine.rest = Math.max(0, parseInt(f.rest, 10) || 0);
    saveConfig((c) => {
      const r = c.routines.find((x) => x.id === rt);
      if (!r) return;
      // A lift is in one circuit at a time: picking it here takes it out of any other.
      const others = (r.circuits ?? []).filter((x) => x.id !== cid).map((x) => ({ ...x, liftIds: x.liftIds.filter((l) => !mine.liftIds.includes(l)) }));
      r.circuits = [...others, mine];
      tidyRoutine(r, c.lifts);
    });
    closeOverlay();
  };
  const remove = () => {
    saveConfig((c) => {
      const r = c.routines.find((x) => x.id === rt);
      if (!r) return;
      r.circuits = (r.circuits ?? []).filter((x) => x.id !== existing?.id);
      tidyRoutine(r, c.lifts);
    });
    closeOverlay();
  };

  return (
    <Sheet title={existing ? 'Edit circuit' : 'New circuit'} sub={'In ' + routine.name} backLabel="Back to plan">
      <p style="margin-top:14px">A circuit is a group of lifts done back to back: one set of each, then round again. You rest between rounds, not between lifts.</p>
      {lifts.length < 2 ? (
        <p class="note" role="status" style="margin-top:14px">This routine needs at least two lifts before it can have a circuit. Add them on the Plan tab first.</p>
      ) : (
        <>
          {f.err ? <p class="note" role="alert" style="margin-top:14px;margin-bottom:0">{f.err}</p> : null}
          <div class="field">
            <label for="c-name">Name</label>
            <input id="c-name" type="text" value={f.name} placeholder="Core circuit" autocomplete="off" onInput={(e) => up({ name: (e.target as HTMLInputElement).value })} />
          </div>

          <div class="field">
            <p class="lab" id="c-lifts">Lifts, in the order you do them</p>
            <div class="stack-v" role="group" aria-labelledby="c-lifts">
              {lifts.map((d) => {
                const at = f.picked.indexOf(d.id), other = at < 0 ? elsewhere(d.id) : undefined;
                return (
                  <button
                    type="button" class="tog pickrow" key={d.id} aria-pressed={at >= 0 ? 'true' : 'false'}
                    onClick={() => up((s) => ({ err: '', picked: s.picked.includes(d.id) ? s.picked.filter((x) => x !== d.id) : [...s.picked, d.id] }))}
                  >
                    <span>{d.name}{other ? <span class="sub"> Now in {other.name}</span> : null}</span>
                    <span class="num ord" aria-hidden={at < 0 ? 'true' : undefined}>{at >= 0 ? at + 1 : ''}</span>
                  </button>
                );
              })}
            </div>
            <p class="tiny muted">Tap them in order. The number is each lift’s place in a round.</p>
          </div>

          <div class="two" style="gap:10px">
            <div class="field">
              <p class="lab">Rounds</p>
              <Stepper value={f.rounds} onStep={(d) => up((s) => ({ rounds: Math.max(1, Math.min(12, s.rounds + d)) }))} less="One fewer round" more="One more round" />
            </div>
            <div class="field">
              <label for="c-rest">Rest between rounds</label>
              <select id="c-rest" value={f.rest} onChange={(e) => up({ rest: (e.target as HTMLSelectElement).value })}>
                <option value="default">Usual ({cfg.prefs.restSec ? clock(cfg.prefs.restSec) : 'off'})</option>
                <option value="0">No timer</option>
                {REST_CHOICES.map((s) => <option key={s} value={String(s)}>{clock(s)}</option>)}
              </select>
            </div>
          </div>
          <p class="tiny muted" style="margin-top:6px">In a circuit, each lift does one set per round, so the rounds here replace each lift’s own number of sets. Its weights and target stay as they are.</p>

          <div class="foot">
            <button class="btn" onClick={save}>{existing ? 'Save circuit' : 'Add circuit'}</button>
            {existing ? <Confirm ask="Remove this circuit" yes="Remove the circuit, keep its lifts" no="Keep it" onYes={remove} /> : null}
          </div>
        </>
      )}
    </Sheet>
  );
}
