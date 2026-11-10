import { useState } from 'preact/hooks';
import { Confirm, Sheet } from '../components/common';
import { AskError, askClaude, buildPrompt, promptText } from '../lib/claude';
import { longDate, shortDate, todayStr, yearOf } from '../lib/dates';
import { device } from '../lib/device';
import { feelLine, fmtSets, paceLine, reportText, runLine, sessionMinutes } from '../lib/format';
import { deltaLine, lastEntry, prFlags, prLine } from '../lib/logic';
import { deleteSession, getConfig, getSessions, notify, sessionById, updateSession } from '../lib/store';
import { copyText, shareText } from '../pwa';
import { closeOverlay, openOverlay, toast } from '../ui';

// The in-flight request lives outside the component so it survives re-renders and
// keeps streaming if the sheet is covered by another one.
const fb: { id: string; running: boolean; text: string; msg: string; ctl: AbortController | null } = { id: '', running: false, text: '', msg: '', ctl: null };

function ask(id: string): void {
  const s = sessionById(id), key = device().apiKey;
  if (!s || !key || fb.running) return;
  fb.id = id; fb.running = true; fb.text = ''; fb.msg = '';
  fb.ctl = new AbortController();
  notify();
  askClaude(key, buildPrompt(s, getSessions(), getConfig()), (t) => { fb.text = t; notify(); }, fb.ctl.signal).then(
    (res) => {
      updateSession(id, (x) => { x.feedback = { text: res.text, at: todayStr(), ...(res.truncated ? { truncated: true } : {}) }; });
      fb.running = false; fb.text = '';
      notify();
    },
    (e: unknown) => {
      fb.running = false; fb.text = '';
      fb.msg = e instanceof AskError ? e.message : 'The reply was interrupted. Ask again when you’re ready.';
      notify();
    },
  );
}

export function Report({ id }: { id: string }) {
  const s = sessionById(id);
  const [paste, setPaste] = useState<string | null>(null);
  const [fallback, setFallback] = useState('');
  if (!s) return <Sheet title="Session"><p class="muted" style="margin-top:14px">This session has been deleted.</p></Sheet>;

  const sessions = getSessions();
  const mins = sessionMinutes(s);
  const hasKey = !!device().apiKey;
  const running = fb.running && fb.id === id;

  const copyOut = async (text: string, done: string) => {
    if (await copyText(text)) { setFallback(''); toast(done); }
    else setFallback(text); // clipboard blocked: show the text to copy by hand
  };
  const askByHand = async () => {
    const text = promptText(buildPrompt(s, sessions, getConfig()));
    const shared = await shareText(text, 'Training log report');
    if (shared === 'none') await copyOut(text, 'Copied. Paste it into a Claude chat.');
  };
  const savePasted = () => {
    const text = (paste ?? '').trim().slice(0, 20000);
    if (text) updateSession(id, (x) => { x.feedback = { text, at: todayStr() }; });
    setPaste(null);
  };

  return (
    <Sheet title={s.routineName || 'Session'} pre={longDate(s.date) + ', ' + yearOf(s.date) + (mins ? ' · ' + mins + ' min' : '')}>
      <ul class="rows rep" style="margin-top:10px">
        {(s.lifts || []).map((l, i) => {
          const prev = lastEntry(sessions, l.id, s);
          const bits = [deltaLine(l, prev ? prev.l : null)];
          const f = feelLine(l.sets);
          if (f) bits.push(f);
          const pr = prLine(l.kind, l, prFlags(sessions, s, l));
          return (
            <li key={l.id + i}>
              <div class="rlh">
                <span class="n">{l.name}{pr ? <span class="tag">{pr.replace(/\.$/, '')}</span> : null}</span>
                <span class="num v">{fmtSets(l)}</span>
              </div>
              <p class="small muted">{bits.join(' ')}{l.note ? ' “' + l.note + '”' : ''}</p>
            </li>
          );
        })}
        {s.run ? (
          <li>
            <div class="rlh"><span class="n">Run</span><span class="num v">{runLine(s.run)}</span></div>
            {paceLine(s.run) || s.run.note ? <p class="small muted">{[paceLine(s.run) ? paceLine(s.run) + '.' : '', s.run.note ? '“' + s.run.note + '”' : ''].filter(Boolean).join(' ')}</p> : null}
          </li>
        ) : null}
      </ul>
      {s.note ? <p class="small" style="margin-top:6px">{s.note}</p> : null}

      <section class="fbs" aria-label="Feedback from Claude">
        <h3>Feedback from Claude</h3>
        {running ? (
          <>
            <p class="fb" aria-busy="true">{fb.text || 'Thinking…'}</p>
            <button class="btn ghost" onClick={() => fb.ctl?.abort()}>Stop</button>
          </>
        ) : (
          <>
            {s.feedback?.text ? (
              <>
                <p class="fb">{s.feedback.text}</p>
                <p class="tiny muted">Saved {shortDate(s.feedback.at)}.{s.feedback.truncated ? ' The reply was cut short.' : ''}</p>
              </>
            ) : null}
            {fb.id === id && fb.msg ? <p class="small" role="alert">{fb.msg}</p> : null}
            {hasKey ? (
              <>
                {!s.feedback ? <p class="small muted">Sends this report and your recent entries for the same lifts to Claude, then keeps the reply here.</p> : null}
                <button class={'btn' + (s.feedback ? ' ghost' : '')} onClick={() => ask(id)}>{s.feedback ? 'Ask again' : 'Send report to Claude'}</button>
              </>
            ) : paste != null ? (
              <>
                <div class="field">
                  <label for="f-paste">Claude’s reply</label>
                  <textarea id="f-paste" value={paste} placeholder="Paste it here" onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)} />
                </div>
                <button class="btn" onClick={savePasted}>Keep this reply</button>
                <div class="bar"><button class="link" onClick={() => setPaste(null)}>Cancel</button></div>
              </>
            ) : (
              <>
                {!s.feedback ? <p class="small muted">Hands Claude this report with your recent entries for the same lifts. Paste what it says back here to keep it with the session.</p> : null}
                <button class={'btn' + (s.feedback ? ' ghost' : '')} onClick={() => void askByHand()}>{s.feedback ? 'Ask again' : 'Ask Claude'}</button>
                <div class="bar">
                  <button class="link" onClick={() => setPaste('')}>Paste Claude’s reply</button>
                  <button class="link" onClick={() => openOverlay({ type: 'claude' })}>Skip the copying</button>
                </div>
              </>
            )}
          </>
        )}
      </section>

      <div class="gap stack-v">
        <button class="btn ghost" onClick={() => void copyOut(reportText(s), 'Report copied.')}>Copy report</button>
        {fallback ? (
          <div class="field" style="margin-top:0">
            <label for="f-copy">Copying is blocked here, so select the text and copy it yourself.</label>
            <textarea id="f-copy" readOnly value={fallback} onFocus={(e) => (e.target as HTMLTextAreaElement).select()} />
          </div>
        ) : null}
        <Confirm
          ask="Delete session" yes="Delete this session" no="Keep it"
          onYes={() => { if (fb.id === id) fb.ctl?.abort(); deleteSession(id); closeOverlay(); toast('Session deleted.'); }}
          before={<button class="link" onClick={() => openOverlay({ type: 'edit', id })}>Edit session</button>}
        />
      </div>
    </Sheet>
  );
}
