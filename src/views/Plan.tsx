import { Banner, Confirm, Head, Icon } from '../components/common';
import { plural } from '../lib/format';
import { liftSummary, moveInCircuit, moveItem, routineItems } from '../lib/logic';
import { getConfig, saveConfig } from '../lib/store';
import { KIND_LABEL } from '../lib/types';
import type { LiftDef, Routine } from '../lib/types';
import { openOverlay } from '../ui';

const inRoutine = (rt: string, fn: (r: Routine, lifts: Record<string, LiftDef>) => void) =>
  saveConfig((c) => {
    const r = c.routines.find((x) => x.id === rt);
    if (r) fn(r, c.lifts);
  });

/** One lift's row, with arrows that move it within whatever list it's in. */
function LiftLine(p: { rt: string; d: LiftDef; sub: string; first: boolean; last: boolean; onMove: (dir: -1 | 1) => void }) {
  return (
    <div class="prow">
      <button class="row" onClick={() => openOverlay({ type: 'lift', rt: p.rt, id: p.d.id })}>
        <span class="n">{p.d.name}<span class="sub">{p.sub}</span></span>
      </button>
      <button class="sq sm" disabled={p.first} aria-label={'Move ' + p.d.name + ' up'} onClick={() => p.onMove(-1)}>{Icon.up()}</button>
      <button class="sq sm" disabled={p.last} aria-label={'Move ' + p.d.name + ' down'} onClick={() => p.onMove(1)}>{Icon.down()}</button>
    </div>
  );
}

export function Plan() {
  const c = getConfig();
  return (
    <>
      <Banner />
      <Head date="Your lifts and the weights your gym has" title="Plan" />
      {!c.routines.length ? <p>A routine is a list of lifts you do together, like an upper body day. Start with one.</p> : null}
      {c.routines.map((r) => {
        const items = routineItems(r, c.lifts);
        return (
          <section class="rt" key={r.id}>
            <div class="rth">
              <h2>{r.name}</h2>
              <button class="link" onClick={() => openOverlay({ type: 'routine', id: r.id })}>Rename</button>
            </div>
            <ul class="rows">
              {items.map((it, i) => {
                const first = i === 0, last = i === items.length - 1;
                if (it.kind === 'lift') {
                  const d = c.lifts[it.id];
                  return (
                    <li key={it.id}>
                      <LiftLine rt={r.id} d={d} sub={liftSummary(d, KIND_LABEL[d.kind])} first={first} last={last} onMove={(dir) => inRoutine(r.id, (x, lifts) => moveItem(x, lifts, i, dir))} />
                    </li>
                  );
                }
                const k = it.c;
                return (
                  <li key={k.id} class="circ">
                    <div class="prow">
                      <button class="row" onClick={() => openOverlay({ type: 'circuit', rt: r.id, id: k.id })}>
                        <span class="n"><span class="big">{k.name}</span><span class="sub">Circuit. {plural(k.rounds, 'round')} of {plural(k.liftIds.length, 'lift')}.</span></span>
                      </button>
                      <button class="sq sm" disabled={first} aria-label={'Move ' + k.name + ' up'} onClick={() => inRoutine(r.id, (x, lifts) => moveItem(x, lifts, i, -1))}>{Icon.up()}</button>
                      <button class="sq sm" disabled={last} aria-label={'Move ' + k.name + ' down'} onClick={() => inRoutine(r.id, (x, lifts) => moveItem(x, lifts, i, 1))}>{Icon.down()}</button>
                    </div>
                    <ul class="rows">
                      {k.liftIds.map((id, j) => {
                        const d = c.lifts[id];
                        return (
                          <li key={id}>
                            <LiftLine
                              rt={r.id} d={d} first={j === 0} last={j === k.liftIds.length - 1}
                              sub={KIND_LABEL[d.kind] + ', ' + (d.reps || 10) + (d.repUnit === 'sec' ? ' sec' : '') + ' each round'}
                              onMove={(dir) => inRoutine(r.id, (x, lifts) => moveInCircuit(x, lifts, k.id, id, dir))}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
            <div style="margin-top:8px">
              <Confirm
                ask="Delete routine" yes={'Delete ' + r.name} no="Keep it"
                onYes={() => saveConfig((x) => { x.routines = x.routines.filter((y) => y.id !== r.id); })}
                before={
                  <>
                    <button class="link" onClick={() => openOverlay({ type: 'lift', rt: r.id, id: '' })}>Add a lift</button>
                    <button class="link" onClick={() => openOverlay({ type: 'circuit', rt: r.id, id: '' })}>Add a circuit</button>
                  </>
                }
              />
            </div>
          </section>
        );
      })}
      <div class="gap">
        <button class="btn ghost" onClick={() => openOverlay({ type: 'routine', id: '' })}>Add a routine</button>
      </div>
      {c.routines.length ? <p class="tiny muted" style="margin-top:14px">Deleting a routine keeps the sessions you’ve already logged.</p> : null}
    </>
  );
}
