import { useEffect, useRef, useState } from 'preact/hooks';
import { Confirm, Sheet } from '../components/common';
import { isDateStr, longDate, todayStr } from '../lib/dates';
import { isBody, num, runLine } from '../lib/format';
import { sessionById, updateSession } from '../lib/store';
import { openOverlay, toast } from '../ui';

/**
 * A text field that is saved when the person leaves it, not on every keystroke.
 * The typing is held here rather than read back from the log, because the screen
 * redraws whenever anything changes (a sync finishing, a toast clearing) and that
 * would otherwise put the saved text back mid-word. `commit` returns what ended up
 * stored, which may differ from what was typed (trimmed, or refused).
 */
function useDraft(stored: string, commit: (typed: string) => string) {
  const [text, setText] = useState(stored);
  const editing = useRef(false);
  const latest = useRef({ text, stored, commit });
  latest.current = { text, stored, commit };

  // A change from elsewhere (another device) shows up unless the field is being typed in.
  useEffect(() => { if (!editing.current) setText(stored); }, [stored]);
  // Leaving the sheet with the back gesture never fires a blur, so save on the way out too.
  useEffect(() => () => { const l = latest.current; if (l.text !== l.stored) l.commit(l.text); }, []);

  return {
    value: text,
    onFocus: () => { editing.current = true; },
    onInput: (e: Event) => setText((e.target as HTMLInputElement | HTMLTextAreaElement).value),
    onBlur: () => { editing.current = false; setText(text !== stored ? commit(text) : stored); },
  };
}

/** Correcting a finished session. There is no save button: each change is kept as it's made. */
export function SessionEdit({ id }: { id: string }) {
  const s = sessionById(id);

  const name = useDraft(s?.routineName ?? '', (typed) => {
    const v = typed.trim().slice(0, 60);
    if (v && v !== s?.routineName) updateSession(id, (x) => { x.routineName = v; });
    return v || (s?.routineName ?? '');
  });
  const note = useDraft(s?.note ?? '', (typed) => {
    const v = typed.trim().slice(0, 500);
    if (v !== (s?.note ?? '')) updateSession(id, (x) => { if (v) x.note = v; else delete x.note; });
    return v;
  });
  // The day is held the same way so a half-typed date isn't replaced by the saved one.
  const [day, setDay] = useState(s?.date ?? '');
  useEffect(() => { setDay(s?.date ?? ''); }, [s?.date]);

  if (!s) return <Sheet title="Edit session"><p class="muted" style="margin-top:14px">This session has been deleted.</p></Sheet>;
  const target = { kind: 'session' as const, id };

  return (
    <Sheet title="Edit session" sub="Changes are kept as you make them." backLabel="Back to report">
      <div class="two" style="gap:10px">
        <div class="field">
          <label for="e-date">Day</label>
          <input
            id="e-date" type="date" value={day} max={todayStr()}
            onInput={(e) => setDay((e.target as HTMLInputElement).value)}
            onChange={(e) => {
              const v = (e.target as HTMLInputElement).value;
              if (isDateStr(v) && v !== s.date && v <= todayStr()) { updateSession(id, (x) => { x.date = v; }); toast('Moved to ' + longDate(v) + '.'); }
            }}
            onBlur={() => setDay(s.date)}
          />
        </div>
        <div class="field">
          <label for="e-name">Name</label>
          <input id="e-name" type="text" autocomplete="off" {...name} />
        </div>
      </div>

      {s.lifts.map((l, li) => (
        <section class="cur" key={l.id + li} style="margin-top:14px;margin-bottom:0" aria-label={l.name}>
          <div class="curh">
            <h2>{l.name}</h2>
            <p class="small muted nowrap">{l.sets.length === 1 ? '1 set' : l.sets.length + ' sets'}</p>
          </div>
          <ol class="cells">
            {l.sets.map((x, si) => {
              const body = isBody(l.kind, [x]);
              const r = x.r == null ? '?' : x.r;
              return (
                <li key={si}>
                  <button class="cell done" aria-label={'Edit set ' + (si + 1)} onClick={() => openOverlay({ type: 'log', target, li, si })}>
                    <span class="t">
                      {body ? (
                        <>
                          <span class="w">{r}</span>
                          {l.repUnit === 'sec' ? <span class="x">sec</span> : null}
                        </>
                      ) : (
                        <>
                          <span class="w">{num(x.w)}</span>
                          <span class="x">× {r}</span>
                        </>
                      )}
                    </span>
                    <span class="s">{x.feel ? (x.feel === 'hard' ? 'Very hard' : x.feel === 'good' ? 'Good' : 'Easy') : 'Set ' + (si + 1)}</span>
                  </button>
                </li>
              );
            })}
            <li>
              <button class="cell add" onClick={() => openOverlay({ type: 'log', target, li, si: l.sets.length })}>Add a set</button>
            </li>
          </ol>
          {l.note ? <p class="small muted">“{l.note}”</p> : null}
          <Confirm ask="Remove this lift" yes={'Remove ' + l.name} no="Keep it" onYes={() => updateSession(id, (x) => { x.lifts.splice(li, 1); })} />
        </section>
      ))}

      <ul class="rows top" style="margin-top:14px">
        <li>
          <button class={'row ' + (s.run ? 'done' : 'todo')} onClick={() => openOverlay({ type: 'run', target })}>
            <span class="n">Run</span>
            <span class="num v">{s.run ? runLine(s.run) : 'Add'}</span>
          </button>
        </li>
      </ul>
      <div class="bar">
        <button class="link" onClick={() => openOverlay({ type: 'addlift', target })}>Add a lift</button>
      </div>

      <div class="field">
        <label for="e-note">Session note</label>
        <textarea id="e-note" placeholder="Optional" style="min-height:84px" {...note} />
      </div>
    </Sheet>
  );
}
