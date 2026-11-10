// The path from "the person tapped the button" to "the reply is on the session",
// with the call to Claude itself replaced by a stand-in.

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { did, PRESS, session, sets } from './fixtures';

type Store = typeof import('../src/lib/store');
type Feedback = typeof import('../src/lib/feedback');
type Device = typeof import('../src/lib/device');
type Kind = 'cancelled' | 'auth' | 'rate' | 'refused' | 'network' | 'other';

let store: Store, fb: Feedback, dev: Device;
let reply: () => Promise<{ text: string; truncated: boolean }>;
let asked: { key: string; prompt: string }[];
let fail: (kind: Kind, message: string) => Error;

const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const S = session('2026-03-02', [did(PRESS, sets(30, 10, 9, 8))]);

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllGlobals();
  globalThis.indexedDB = new IDBFactory();
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
  asked = [];
  reply = async () => ({ text: 'Stay at the 30s until all three sets hit 10.', truncated: false });
  vi.doMock('../src/lib/claude', () => {
    class AskError extends Error {
      kind: Kind;
      constructor(kind: Kind, message: string) { super(message); this.kind = kind; }
    }
    fail = (kind, message) => new AskError(kind, message);
    return {
      AskError,
      CLAUDE_MODEL: 'test-model',
      buildPrompt: (s: { id: string }) => ({ system: 'sys', user: 'about ' + s.id }),
      askClaude: (key: string, p: { user: string }, onText: (t: string) => void) => { asked.push({ key, prompt: p.user }); onText('Stay'); return reply(); },
    };
  });
  store = await import('../src/lib/store');
  fb = await import('../src/lib/feedback');
  dev = await import('../src/lib/device');
  await store.loadStore();
  store.putSession(S);
});

describe('asking Claude about a session', () => {
  it('sends nothing without a key', () => {
    fb.requestFeedback(S.id);
    expect(asked).toHaveLength(0);
    expect(fb.feedback.running).toBe(false);
  });

  it('never asks on its own: finishing or loading a session sends nothing', async () => {
    dev.setDevice({ apiKey: 'k' });
    fb.retryPending(); // what runs at startup and when the connection returns
    await settle();
    expect(asked).toHaveLength(0);
  });

  it('keeps the reply on the session when the button is tapped', async () => {
    dev.setDevice({ apiKey: 'k' });
    fb.requestFeedback(S.id);
    expect(fb.feedback).toMatchObject({ id: S.id, running: true, text: 'Stay' });
    await settle();
    expect(asked).toEqual([{ key: 'k', prompt: 'about ' + S.id }]);
    expect(fb.feedback.running).toBe(false);
    expect(store.sessionById(S.id)?.feedback?.text).toBe('Stay at the 30s until all three sets hit 10.');
    expect(store.sessionById(S.id)!.updatedAt).toBeGreaterThan(S.updatedAt); // so the reply syncs to other devices
  });

  it('ignores a second tap while the first is still running', async () => {
    dev.setDevice({ apiKey: 'k' });
    fb.requestFeedback(S.id);
    fb.requestFeedback(S.id);
    await settle();
    expect(asked).toHaveLength(1);
  });

  it('remembers a request that had no connection and sends it once there is one', async () => {
    dev.setDevice({ apiKey: 'k' });
    reply = async () => { throw fail('network', 'No connection.'); };
    fb.requestFeedback(S.id);
    await settle();
    expect(dev.device().pendingAsk).toBe(S.id);
    expect(fb.feedback.msg).toMatch(/as soon as you’re back online/);
    expect(store.sessionById(S.id)?.feedback).toBeUndefined();

    reply = async () => ({ text: 'Good session.', truncated: false });
    fb.retryPending();
    await settle();
    expect(asked).toHaveLength(2);
    expect(store.sessionById(S.id)?.feedback?.text).toBe('Good session.');
    expect(dev.device().pendingAsk).toBe('');
    fb.retryPending();
    await settle();
    expect(asked).toHaveLength(2); // and only once
  });

  it('does not keep retrying after a problem that waiting won’t fix', async () => {
    dev.setDevice({ apiKey: 'k' });
    reply = async () => { throw fail('auth', 'Anthropic didn’t accept the API key.'); };
    fb.requestFeedback(S.id);
    await settle();
    expect(dev.device().pendingAsk).toBe('');
    expect(fb.feedback.msg).toBe('Anthropic didn’t accept the API key.');
    fb.retryPending();
    await settle();
    expect(asked).toHaveLength(1);
  });

  it('drops a remembered request if the session was deleted or already has a reply', async () => {
    dev.setDevice({ apiKey: 'k', pendingAsk: S.id });
    store.deleteSession(S.id);
    fb.retryPending();
    await settle();
    expect(asked).toHaveLength(0);
    expect(dev.device().pendingAsk).toBe('');

    const other = session('2026-03-05', [did(PRESS, sets(30, 10))], { feedback: { text: 'Already answered on the phone.', at: '2026-03-05' } });
    store.putSession(other);
    dev.setDevice({ pendingAsk: other.id });
    fb.retryPending();
    await settle();
    expect(asked).toHaveLength(0);
    expect(dev.device().pendingAsk).toBe('');
  });

  it('says nothing when the person stops a request themselves', async () => {
    dev.setDevice({ apiKey: 'k' });
    reply = async () => { throw fail('cancelled', ''); };
    fb.requestFeedback(S.id);
    await settle();
    expect(fb.feedback).toMatchObject({ running: false, msg: '' });
    expect(dev.device().pendingAsk).toBe('');
  });
});
