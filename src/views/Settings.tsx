import { useState } from 'preact/hooks';
import { Banner, Choice, Head, Icon } from '../components/common';
import { clock, sincePhrase } from '../lib/dates';
import { applyTheme, device, setDevice } from '../lib/device';
import type { Theme } from '../lib/device';
import { getConfig, getSessions, notify, saveConfig, status } from '../lib/store';
import { sync, syncOn } from '../lib/sync';
import type { DistUnit, WeightUnit } from '../lib/types';
import { applyUpdate, checkForUpdate, isStandalone } from '../pwa';
import { openOverlay, toast, ui } from '../ui';
import type { Overlay } from '../ui';

function syncLine(): string {
  if (!syncOn()) return 'Off';
  if (sync.status === 'syncing') return 'Syncing…';
  if (sync.status === 'offline') return 'Offline. Will sync later.';
  if (sync.status === 'error') return 'Needs attention';
  const d = device();
  return d.lastSyncAt ? 'Synced ' + sincePhrase(d.lastSyncAt) : 'On';
}

function NavRow(p: { label: string; sub?: string; value?: string; to: Overlay }) {
  return (
    <li>
      <button class="row" onClick={() => openOverlay(p.to)}>
        <span class="n">{p.label}{p.sub ? <span class="sub">{p.sub}</span> : null}</span>
        <span class="side-v" style="display:flex;align-items:center;gap:6px">{p.value}<span class="chev">{Icon.chev()}</span></span>
      </button>
    </li>
  );
}

export function Settings() {
  const d = device(), prefs = getConfig().prefs;
  const [checking, setChecking] = useState(false);
  const n = getSessions().length;
  const installed = isStandalone();

  const check = async () => {
    setChecking(true);
    const found = await checkForUpdate();
    setChecking(false);
    if (ui.updateReady) return; // the reload banner is already showing
    toast(found === 'found' ? 'A new version is downloading. You’ll be asked to reload when it’s ready.' : found === 'current' ? 'You have the latest version.' : 'Updates arrive by themselves when you’re online.');
  };

  return (
    <>
      <Banner />
      <Head date={n === 1 ? '1 session on this device' : n + ' sessions on this device'} title="Settings" />

      <section class="sect">
        <h2>Your log</h2>
        <ul class="rows">
          <NavRow label="Sync" sub={syncOn() ? d.repo : 'Keep your phone and computer on the same log'} value={syncLine()} to={{ type: 'sync' }} />
          <NavRow label="Backup and export" sub={d.lastBackupAt ? 'Last backup ' + sincePhrase(d.lastBackupAt) : 'Save a copy, or bring one in'} to={{ type: 'backup' }} />
          {!installed ? <NavRow label="Install on this device" sub="Opens from the home screen and works offline" to={{ type: 'install' }} /> : null}
        </ul>
      </section>

      <section class="sect">
        <h2>During a session</h2>
        <div class="field">
          <p class="lab">Rest timer</p>
          <Choice<number> label="Rest timer" value={prefs.restSec} cols="five"
            options={[[0, 'Off'], [60, clock(60)], [90, clock(90)], [120, clock(120)], [180, clock(180)]]}
            onPick={(v) => saveConfig((c) => { c.prefs.restSec = v; })} />
          <p class="tiny muted">Counts up after each set and marks when you’ve rested this long. A lift can have its own setting in Plan.</p>
        </div>
        <div class="field">
          <p class="lab">Screen</p>
          <button type="button" class="tog" aria-pressed={d.keepAwake ? 'true' : 'false'} onClick={() => { setDevice({ keepAwake: !d.keepAwake }); notify(); }}>
            {d.keepAwake ? 'Stays on during a session' : 'Keep the screen on during a session'}
          </button>
        </div>
      </section>

      <section class="sect">
        <h2>Units and look</h2>
        <div class="two" style="gap:10px">
          <div class="field">
            <p class="lab">Weight</p>
            <Choice<WeightUnit> label="Weight unit" value={prefs.unit} options={[['lb', 'lb'], ['kg', 'kg']]} onPick={(v) => saveConfig((c) => { c.prefs.unit = v; })} />
          </div>
          <div class="field">
            <p class="lab">Distance</p>
            <Choice<DistUnit> label="Distance unit" value={prefs.dist} options={[['mi', 'mi'], ['km', 'km']]} onPick={(v) => saveConfig((c) => { c.prefs.dist = v; })} />
          </div>
        </div>
        <p class="tiny muted" style="margin-top:6px">Changing units relabels your numbers. It doesn’t convert them.</p>
        <div class="field">
          <p class="lab">Theme</p>
          <Choice<Theme> label="Theme" value={d.theme} options={[['system', 'Match phone'], ['light', 'Light'], ['dark', 'Dark']]} onPick={(v) => { setDevice({ theme: v }); applyTheme(); notify(); }} />
        </div>
      </section>

      <section class="sect">
        <h2>Claude</h2>
        <ul class="rows">
          <NavRow label="Feedback on sessions" sub={d.apiKey ? 'Asks Claude directly with your API key' : 'By copy and paste. Can be made one tap.'} to={{ type: 'claude' }} />
        </ul>
      </section>

      <section class="sect">
        <h2>About</h2>
        <p class="small muted" style="margin-top:6px">
          Training Log {__APP_VERSION__}, built {__BUILD_DATE__}. {status.persistent ? 'Your log is stored on this device' + (syncOn() ? ' and in your private repository.' : '.') : 'Storage is blocked in this window.'}
        </p>
        <div class="bar" style="margin-top:4px">
          {ui.updateReady ? <button class="link" onClick={applyUpdate}>Reload to update</button> : <button class="link" disabled={checking} onClick={() => void check()}>{checking ? 'Checking…' : 'Check for an update'}</button>}
        </div>
      </section>
    </>
  );
}
