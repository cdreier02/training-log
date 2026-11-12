// Which tab is showing and which full-screen sheets are stacked on top of it.
// Each open sheet is a browser history entry, so the phone's back button or
// back swipe closes the sheet instead of leaving the app.

import { notify } from './lib/store';

export type Tab = 'today' | 'history' | 'plan' | 'settings';
export const TABS: [Tab, string][] = [['today', 'Today'], ['history', 'History'], ['plan', 'Plan'], ['settings', 'Settings']];

/** Where a set or run being edited lives: the session in progress, or a finished one. */
export type Target = { kind: 'active' } | { kind: 'session'; id: string };

export type Overlay =
  | { type: 'log'; target: Target; li: number; si: number }
  | { type: 'run'; target: Target | { kind: 'solo' } }
  | { type: 'addlift'; target: Target }
  | { type: 'lift'; rt: string; id: string }
  | { type: 'circuit'; rt: string; id: string }
  | { type: 'routine'; id: string }
  | { type: 'report'; id: string }
  | { type: 'edit'; id: string }
  | { type: 'sync' }
  | { type: 'backup' }
  | { type: 'install' }
  | { type: 'claude' };

export const ui: {
  tab: Tab;
  stack: Overlay[];
  toast: string;
  histMode: 'lift' | 'session';
  histLift: string;
  /** A new version has been downloaded and is waiting for a reload. */
  updateReady: boolean;
  /** The top sheet is on its way out and should ignore input. */
  closing: boolean;
} = { tab: 'today', stack: [], toast: '', histMode: 'lift', histLift: '', updateReady: false, closing: false };

const openers: (HTMLElement | null)[] = [];

const depthOf = (state: unknown): number => {
  const n = (state as { ov?: unknown } | null)?.ov;
  return typeof n === 'number' && n > 0 ? n : 0;
};

function tabFromHash(): Tab {
  const h = location.hash.replace('#', '');
  return h === 'history' || h === 'plan' || h === 'settings' ? h : 'today';
}

export function setTab(t: Tab): void {
  if (ui.tab === t && !ui.stack.length) { window.scrollTo(0, 0); return; }
  ui.tab = t;
  try { history.replaceState(history.state, '', '#' + t); } catch { /* file: URLs can refuse */ }
  window.scrollTo(0, 0);
  notify();
}

export function openOverlay(o: Overlay): void {
  openers[ui.stack.length] = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  ui.stack = [...ui.stack, o];
  try { history.pushState({ ov: ui.stack.length }, ''); } catch { /* still works, just without back-button support */ }
  notify();
}

/** Swaps the top sheet for another without adding a history entry. */
export function replaceOverlay(o: Overlay): void {
  if (!ui.stack.length) { openOverlay(o); return; }
  ui.stack = [...ui.stack.slice(0, -1), o];
  notify();
}

let closeTimer: ReturnType<typeof setTimeout> | undefined;

function truncate(depth: number): void {
  clearTimeout(closeTimer);
  const wasClosing = ui.closing;
  ui.closing = false;
  if (depth >= ui.stack.length) { if (wasClosing) notify(); return; }
  const opener = openers[depth];
  ui.stack = ui.stack.slice(0, depth);
  openers.length = depth;
  notify();
  if (opener && opener.isConnected) {
    // After the sheet is gone, put focus back where it came from.
    requestAnimationFrame(() => { try { opener.focus({ preventScroll: true }); } catch { /* element may be gone */ } });
  }
}

// Going back in history is asynchronous. Until the browser confirms it, the sheet is
// marked as closing and ignores taps, so a quick second tap can't save twice or step
// back one page too many.
function leave(steps: number, toDepth: number): void {
  if (ui.closing) return;
  if (depthOf(history.state) !== ui.stack.length) { truncate(toDepth); return; }
  ui.closing = true;
  notify();
  closeTimer = setTimeout(() => truncate(toDepth), 700); // in case the browser never reports back
  history.go(-steps);
}

export function closeOverlay(): void {
  if (ui.stack.length) leave(1, ui.stack.length - 1);
}

/** Closes every sheet, back to the tab underneath. */
export function closeAll(): void {
  if (ui.stack.length) leave(ui.stack.length, 0);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string): void {
  ui.toast = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast = ''; notify(); }, 3400);
  notify();
}

export function initUi(): void {
  ui.tab = tabFromHash();
  // A reload while a sheet was open leaves its history entries behind; step back over them.
  const stale = depthOf(history.state);
  if (stale) history.go(-stale);

  window.addEventListener('popstate', (e) => {
    const depth = depthOf(e.state);
    if (depth < ui.stack.length) truncate(depth);
    else {
      truncate(ui.stack.length); // nothing to close, but clears a pending "closing" state
      if (depth > ui.stack.length) history.go(ui.stack.length - depth); // "forward" to a sheet that no longer exists
    }
    const t = tabFromHash();
    if (t !== ui.tab && !ui.stack.length) { ui.tab = t; notify(); }
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.stack.length) { e.preventDefault(); closeOverlay(); }
  });
  // While a sheet is on its way out, swallow clicks inside it before any button sees them.
  document.addEventListener('click', (e) => {
    if (ui.closing && e.target instanceof Element && e.target.closest('#over')) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}
