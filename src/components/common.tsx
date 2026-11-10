import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { applyUpdate } from '../pwa';
import { status } from '../lib/store';
import { sync } from '../lib/sync';
import { closeOverlay, openOverlay, ui } from '../ui';

const svg = (d: string, size = 24, sw = 2) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round">
    <path d={d} />
  </svg>
);

export const Icon = {
  back: () => svg('M15 5l-7 7 7 7'),
  minus: () => svg('M5 12h14', 22, 2.25),
  plus: () => svg('M5 12h14M12 5v14', 22, 2.25),
  up: () => svg('M12 19V5M6 11l6-6 6 6', 20),
  down: () => svg('M12 5v14M6 13l6 6 6-6', 20),
  chev: () => svg('M9 5l7 7-7 7', 18),
};

export function Head(p: { date: string; title: string; right?: string }) {
  return (
    <div class="head">
      <p class="date">
        <span>{p.date}</span>
        {p.right ? <span class="nowrap">{p.right}</span> : null}
      </p>
      <h1>{p.title}</h1>
    </div>
  );
}

/** Things the person needs to know no matter which tab they're on. */
export function Banner() {
  const syncBlocked = sync.status === 'error' && sync.kind !== 'rate' && sync.kind !== 'conflict';
  return (
    <>
      {!status.persistent ? (
        <p class="note" role="status">This browser isn’t keeping what you log. Private windows usually block storage, so open the app in a normal one.</p>
      ) : null}
      {status.saveError ? <p class="note" role="alert">{status.saveError}</p> : null}
      {syncBlocked ? (
        <p class="note act" role="alert">
          <span>Sync has stopped. Your log is still saved on this device.</span>
          <button class="link" onClick={() => openOverlay({ type: 'sync' })}>See why</button>
        </p>
      ) : null}
      {ui.updateReady ? (
        <p class="note act" role="status">
          <span>A new version is ready.</span>
          <button class="link" onClick={applyUpdate}>Reload</button>
        </p>
      ) : null}
    </>
  );
}

/** The full-screen frame every sheet shares: back arrow, title that takes focus, then content. */
export function Sheet(p: { title: string; pre?: string; sub?: string; backLabel?: string; children: ComponentChildren }) {
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    try { h.current?.focus({ preventScroll: true }); } catch { /* not focusable yet */ }
  }, []);
  return (
    <div class="in">
      <button class="back" onClick={closeOverlay} aria-label={p.backLabel ?? 'Back'}>{Icon.back()}</button>
      {p.pre ? <p class="date">{p.pre}</p> : null}
      <h1 class="s" ref={h} tabIndex={-1}>{p.title}</h1>
      {p.sub ? <p class="date">{p.sub}</p> : null}
      {p.children}
    </div>
  );
}

/** A destructive link that asks once more, in place, before it does anything. */
export function Confirm(p: { ask: string; yes: string; no: string; onYes: () => void; before?: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="bar">
      {p.before}
      {open ? (
        <>
          <button class="link" onClick={() => { setOpen(false); p.onYes(); }}>{p.yes}</button>
          <button class="link" onClick={() => setOpen(false)}>{p.no}</button>
        </>
      ) : (
        <button class="link" onClick={() => setOpen(true)}>{p.ask}</button>
      )}
    </div>
  );
}

export function Stepper(p: { value: string | number; onStep: (dir: -1 | 1) => void; less: string; more: string }) {
  return (
    <div class="step">
      <button type="button" class="sq" onClick={() => p.onStep(-1)} aria-label={p.less}>{Icon.minus()}</button>
      <b aria-live="polite">{p.value}</b>
      <button type="button" class="sq" onClick={() => p.onStep(1)} aria-label={p.more}>{Icon.plus()}</button>
    </div>
  );
}

/** A row of mutually exclusive choices, drawn as pressed-or-not buttons. */
export function Choice<T extends string | number>(p: { label: string; value: T; options: [T, string][]; onPick: (v: T) => void; cols?: 'two' | 'three' | 'four' | 'five' }) {
  const cols = p.cols ?? (p.options.length === 2 ? 'two' : p.options.length === 3 ? 'three' : p.options.length === 4 ? 'four' : 'five');
  return (
    <div class={cols} role="group" aria-label={p.label}>
      {p.options.map(([v, text]) => (
        <button type="button" class="tog" key={String(v)} aria-pressed={v === p.value ? 'true' : 'false'} onClick={() => p.onPick(v)}>{text}</button>
      ))}
    </div>
  );
}
