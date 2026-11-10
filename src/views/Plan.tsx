import { Banner, Confirm, Head, Icon } from '../components/common';
import { liftSummary } from '../lib/logic';
import { getConfig, saveConfig } from '../lib/store';
import { KIND_LABEL } from '../lib/types';
import { openOverlay } from '../ui';

function move(rt: string, id: string, dir: -1 | 1): void {
  saveConfig((c) => {
    const r = c.routines.find((x) => x.id === rt);
    if (!r) return;
    const i = r.liftIds.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= r.liftIds.length) return;
    r.liftIds.splice(j, 0, r.liftIds.splice(i, 1)[0]);
  });
}

export function Plan() {
  const c = getConfig();
  return (
    <>
      <Banner />
      <Head date="Your lifts and the weights your gym has" title="Plan" />
      {!c.routines.length ? <p>A routine is a list of lifts you do together, like an upper body day. Start with one.</p> : null}
      {c.routines.map((r) => {
        const ids = r.liftIds.filter((id) => c.lifts[id]);
        return (
          <section class="rt" key={r.id}>
            <div class="rth">
              <h2>{r.name}</h2>
              <button class="link" onClick={() => openOverlay({ type: 'routine', id: r.id })}>Rename</button>
            </div>
            <ul class="rows">
              {ids.map((id, i) => {
                const d = c.lifts[id];
                return (
                  <li key={id}>
                    <div class="prow">
                      <button class="row" onClick={() => openOverlay({ type: 'lift', rt: r.id, id })}>
                        <span class="n">{d.name}<span class="sub">{liftSummary(d, KIND_LABEL[d.kind])}</span></span>
                      </button>
                      <button class="sq sm" disabled={i === 0} aria-label={'Move ' + d.name + ' up'} onClick={() => move(r.id, id, -1)}>{Icon.up()}</button>
                      <button class="sq sm" disabled={i === ids.length - 1} aria-label={'Move ' + d.name + ' down'} onClick={() => move(r.id, id, 1)}>{Icon.down()}</button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div style="margin-top:8px">
              <Confirm
                ask="Delete routine" yes={'Delete ' + r.name} no="Keep it"
                onYes={() => saveConfig((x) => { x.routines = x.routines.filter((y) => y.id !== r.id); })}
                before={<button class="link" onClick={() => openOverlay({ type: 'lift', rt: r.id, id: '' })}>Add a lift</button>}
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
