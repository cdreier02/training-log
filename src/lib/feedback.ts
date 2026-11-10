// Getting Claude's feedback into a session. Nothing is ever sent unless the person
// taps the button on a report. Once they have, the reply is kept with the session,
// and if the gym had no signal at the time, the request goes out when there is one.

import { AskError, askClaude, buildPrompt } from './claude';
import { todayStr } from './dates';
import { device, setDevice } from './device';
import { getConfig, getSessions, notify, sessionById, updateSession } from './store';

/** The request in flight, if any. Lives outside the screens so it keeps going when they change. */
export const feedback: { id: string; running: boolean; text: string; msg: string } = { id: '', running: false, text: '', msg: '' };
let ctl: AbortController | null = null;

const clearPending = (id: string) => { if (device().pendingAsk === id) setDevice({ pendingAsk: '' }); };

/** Sends one session to Claude and stores the reply on it. Does nothing without a key. */
export function requestFeedback(id: string): void {
  const s = sessionById(id), key = device().apiKey;
  if (!s || !key || feedback.running) return;
  feedback.id = id;
  feedback.running = true;
  feedback.text = '';
  feedback.msg = '';
  ctl = new AbortController();
  notify();
  askClaude(key, buildPrompt(s, getSessions(), getConfig()), (t) => { feedback.text = t; notify(); }, ctl.signal).then(
    (res) => {
      updateSession(id, (x) => { x.feedback = { text: res.text, at: todayStr(), ...(res.truncated ? { truncated: true } : {}) }; });
      clearPending(id);
      feedback.running = false;
      feedback.text = '';
      notify();
    },
    (e: unknown) => {
      const err = e instanceof AskError ? e : new AskError('other', 'The reply was interrupted. Ask again when you’re ready.');
      feedback.running = false;
      feedback.text = '';
      if (err.kind === 'network') {
        // Remembered on the device, so it survives the app being closed on the way out of the gym.
        setDevice({ pendingAsk: id });
        feedback.msg = 'No connection. Claude will be asked as soon as you’re back online.';
      } else {
        clearPending(id);
        feedback.msg = err.message;
      }
      notify();
    },
  );
}

export function stopFeedback(id?: string): void {
  if (id && feedback.id !== id) return;
  ctl?.abort();
}

/** Sends the request that couldn't get through earlier, if there is one and it still makes sense. */
export function retryPending(): void {
  const id = device().pendingAsk;
  if (!id || feedback.running) return;
  const s = sessionById(id);
  if (!s || s.feedback) { setDevice({ pendingAsk: '' }); return; } // deleted, or answered from another device
  if (!device().apiKey) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  requestFeedback(id);
}

export function initFeedback(): void {
  window.addEventListener('online', retryPending);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') retryPending(); });
  retryPending();
}
