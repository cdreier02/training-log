// Feedback from Claude on one session. The prompt is the same whether it's sent
// from here with the person's own API key or copied into a Claude chat by hand.

import { feelLine, fmtSets, num, reportText, runLine, unitWLong } from './format';
import { entriesFor, sortSessions } from './logic';
import type { ConfigDoc, SessionDoc } from './types';

export const CLAUDE_MODEL = 'claude-opus-5-5';

export interface FeedbackPrompt {
  system: string;
  user: string;
}

export function buildPrompt(s: SessionDoc, sessions: SessionDoc[], config: ConfigDoc): FeedbackPrompt {
  const sorted = sortSessions(sessions);
  const system = [
    'You are giving feedback on one entry in a personal training log, written to the person who logged it. They train at a commercial gym and can only load the weights listed for each lift. Dumbbell weights are per hand. All weights are in ' + unitWLong() + '.',
    '',
    'Write plain text with no Markdown and no headings, under 220 words. First say what the numbers show went well. Then say what to do next session for the lifts where it matters, naming exact weights from the available list and a rep target. Then name one thing to watch. Use their own notes. Be direct and specific and skip generic advice. Do not diagnose injuries: if a note mentions pain, say to ease off and to get it checked if it persists.',
  ].join('\n');

  const L: string[] = [];
  L.push('THIS SESSION');
  L.push(reportText(s));
  L.push('');
  L.push('EARLIER ENTRIES FOR THE SAME LIFTS, NEWEST FIRST');
  for (const l of s.lifts || []) {
    const d = config.lifts[l.id];
    const list = entriesFor(sorted, l.id).filter((e) => e.s.id !== s.id).reverse().slice(0, 6);
    L.push(
      l.name +
        (d && d.weights && d.weights.length ? ' (available: ' + d.weights.map(num).join(', ') + (d.addOn ? '; plus an optional ' + num(d.addOn) + ' add-on' : '') + ')' : '') +
        (d && d.cue ? ' (their standing cue: ' + d.cue + ')' : ''),
    );
    if (!list.length) L.push('  no earlier entries');
    for (const e of list) {
      const f = feelLine(e.l.sets);
      L.push('  ' + e.s.date + ': ' + fmtSets(e.l) + '.' + (f ? ' ' + f : '') + (e.l.note ? ' Note: ' + e.l.note : ''));
    }
  }
  L.push('');
  L.push('RECENT SESSION DATES');
  for (const x of sorted.slice().reverse().slice(0, 10)) L.push('  ' + x.date + ' ' + (x.routineName || '') + (x.run ? ' (run: ' + runLine(x.run) + ')' : ''));
  return { system, user: L.join('\n').slice(0, 60000) };
}

/** The whole prompt as one message, for pasting into a chat. */
export function promptText(p: FeedbackPrompt): string {
  return p.system + '\n\n' + p.user;
}

export type AskKind = 'cancelled' | 'auth' | 'rate' | 'refused' | 'network' | 'other';

export class AskError extends Error {
  kind: AskKind;
  constructor(kind: AskKind, message: string) {
    super(message);
    this.name = 'AskError';
    this.kind = kind;
  }
}

export interface AskResult {
  text: string;
  truncated: boolean;
}

/**
 * Sends the prompt straight from this device to the Anthropic API with the person's
 * own key. The SDK is loaded only when this is first used, so it costs nothing at startup.
 */
export async function askClaude(apiKey: string, p: FeedbackPrompt, onText: (soFar: string) => void, signal: AbortSignal): Promise<AskResult> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // The key is the person's own, typed into their own device and stored only there,
  // which is the case the SDK's browser switch exists for.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  let live = '';
  try {
    const stream = client.beta.messages.stream(
      {
        model: CLAUDE_MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        system: p.system,
        messages: [{ role: 'user', content: p.user }],
      },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === 'content_block_start' && event.content_block.type === 'fallback') {
        live = ''; // another model is taking over: what came before is discarded
        onText(live);
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        live += event.delta.text;
        onText(live);
      }
    }
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new AskError('refused', 'Claude declined this one. Try again after editing your notes.');
    let text = '';
    for (const block of msg.content) {
      if (block.type === 'fallback') text = '';
      else if (block.type === 'text') text += block.text;
    }
    text = (text || live).trim();
    if (!text) throw new AskError('other', 'Claude sent back an empty reply. Ask again when you’re ready.');
    return { text, truncated: msg.stop_reason === 'max_tokens' };
  } catch (e) {
    if (e instanceof AskError) throw e;
    if (e instanceof Anthropic.APIUserAbortError || signal.aborted) throw new AskError('cancelled', '');
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AskError('auth', 'Anthropic didn’t accept the API key. Check it in Settings.');
    if (e instanceof Anthropic.RateLimitError) throw new AskError('rate', 'Claude is busy or the key has reached a usage limit. Try again later.');
    if (e instanceof Anthropic.APIConnectionError) throw new AskError('network', 'No connection. Ask again when you’re online.');
    if (e instanceof Anthropic.APIError) throw new AskError('other', e.status === 400 ? 'Anthropic rejected the request. The key’s account may not have access to this model.' : 'The reply was interrupted. Ask again when you’re ready.');
    throw new AskError('other', 'The reply was interrupted. Ask again when you’re ready.');
  }
}
