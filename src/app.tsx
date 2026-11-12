import { useLayoutEffect, useReducer, useRef } from 'preact/hooks';
import { longDate, todayStr } from './lib/dates';
import { status, subscribe } from './lib/store';
import { sync } from './lib/sync';
import { CircuitSheet } from './sheets/Circuit';
import { LogSet } from './sheets/LogSet';
import { Report } from './sheets/Report';
import { SessionEdit } from './sheets/SessionEdit';
import { BackupSheet, ClaudeSheet, InstallSheet, SyncSheet } from './sheets/SettingsSheets';
import { AddLift, LiftSheet, RoutineSheet, RunSheet } from './sheets/Small';
import { setTab, TABS, ui } from './ui';
import type { Overlay } from './ui';
import { History } from './views/History';
import { Plan } from './views/Plan';
import { Settings } from './views/Settings';
import { Today } from './views/Today';

function overlayKey(o: Overlay, depth: number): string {
  const bits: (string | number)[] = [depth, o.type];
  if ('id' in o) bits.push(o.id);
  if ('rt' in o) bits.push(o.rt);
  if ('li' in o) bits.push(o.li, o.si);
  if ('target' in o) bits.push(o.target.kind, 'id' in o.target ? o.target.id : '');
  return bits.join('|');
}

function OverlayView({ o }: { o: Overlay }) {
  switch (o.type) {
    case 'log': return <LogSet target={o.target} li={o.li} si={o.si} />;
    case 'run': return <RunSheet target={o.target} />;
    case 'addlift': return <AddLift target={o.target} />;
    case 'lift': return <LiftSheet rt={o.rt} id={o.id} />;
    case 'circuit': return <CircuitSheet rt={o.rt} id={o.id} />;
    case 'routine': return <RoutineSheet id={o.id} />;
    case 'report': return <Report id={o.id} />;
    case 'edit': return <SessionEdit id={o.id} />;
    case 'sync': return <SyncSheet />;
    case 'backup': return <BackupSheet />;
    case 'install': return <InstallSheet />;
    case 'claude': return <ClaudeSheet />;
  }
}

export function App() {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  // Subscribed before the browser paints, not after: a hidden tab delays ordinary effects,
  // and the log can finish loading in that gap. The extra render catches anything missed.
  useLayoutEffect(() => {
    const stop = subscribe(() => rerender(0));
    rerender(0);
    return stop;
  }, []);

  const depth = ui.stack.length;
  const top = depth ? ui.stack[depth - 1] : null;
  const key = top ? overlayKey(top, depth) : '';

  // A new sheet starts at its top. Coming back to the sheet underneath returns to where
  // it was left, so fixing one set in a long session doesn't lose your place.
  const over = useRef<HTMLDivElement>(null);
  const scrolls = useRef<number[]>([]);
  const lastDepth = useRef(0);
  useLayoutEffect(() => {
    if (over.current) over.current.scrollTop = depth < lastDepth.current ? scrolls.current[depth] ?? 0 : 0;
    scrolls.current.length = depth + 1;
    lastDepth.current = depth;
    document.body.style.overflow = key ? 'hidden' : '';
  }, [key]);

  if (!status.ready) {
    return (
      <main id="app">
        <div class="head">
          <p class="date">{longDate(todayStr())}</p>
          <h1>Training log</h1>
        </div>
        <p class="muted" role="status">Loading your log…</p>
      </main>
    );
  }

  const syncDot = sync.status === 'error' && sync.kind !== 'rate' && sync.kind !== 'conflict';
  return (
    <>
      <main id="app" inert={!!top}>
        {ui.tab === 'history' ? <History /> : ui.tab === 'plan' ? <Plan /> : ui.tab === 'settings' ? <Settings /> : <Today />}
      </main>
      <nav id="tabs" aria-label="Sections" inert={!!top}>
        <div class="in">
          {TABS.map(([t, label]) => (
            <a key={t} href={'#' + t} aria-current={ui.tab === t ? 'page' : undefined} onClick={(e) => { e.preventDefault(); setTab(t); }}>
              {label}
              {t === 'settings' && (syncDot || ui.updateReady) ? <span class="dot" aria-label="needs attention" /> : null}
            </a>
          ))}
        </div>
      </nav>
      {top ? (
        <div id="over" ref={over} role="dialog" aria-modal="true" inert={ui.closing} onScroll={(e) => { scrolls.current[depth] = (e.currentTarget as HTMLDivElement).scrollTop; }}>
          <OverlayView key={key} o={top} />
        </div>
      ) : null}
      <div id="toast" class={top ? 'over' : ''} role="status" aria-live="polite">{ui.toast ? <p>{ui.toast}</p> : null}</div>
    </>
  );
}
