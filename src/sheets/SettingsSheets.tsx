// The sheets behind the Settings tab: sync, backup, install, and Claude.

import { useState } from 'preact/hooks';
import { Confirm, Sheet } from '../components/common';
import { exportCsv, exportJson, parseLog } from '../lib/backup';
import type { Parsed } from '../lib/backup';
import { CLAUDE_MODEL } from '../lib/claude';
import { sincePhrase, todayStr } from '../lib/dates';
import { device, setDevice } from '../lib/device';
import { plural } from '../lib/format';
import { ghUser } from '../lib/github';
import { allDocs, eraseDevice, getSessions, importDocs, isEmpty, notify } from '../lib/store';
import { connect, disconnect, sync, syncNow, syncOn } from '../lib/sync';
import type { ConfigDoc } from '../lib/types';
import { canPromptInstall, isStandalone, platform, promptInstall, saveFile } from '../pwa';
import { closeOverlay, toast } from '../ui';

const val = (e: Event) => (e.target as HTMLInputElement | HTMLTextAreaElement).value;

const NEW_REPO_URL = 'https://github.com/new?name=training-log-data&visibility=private&description=' + encodeURIComponent('Private data for my Training Log app');
const NEW_TOKEN_URL =
  'https://github.com/settings/personal-access-tokens/new?name=' + encodeURIComponent('Training Log sync') +
  '&description=' + encodeURIComponent('Lets the Training Log app read and write one private repository') + '&contents=write&expires_in=none';

/* ---------- sync ---------- */

export function SyncSheet() {
  const d = device();
  const [token, setToken] = useState('');
  const [repo, setRepo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (syncOn()) {
    const line =
      sync.status === 'syncing' ? 'Syncing now…'
      : sync.status === 'offline' ? 'Offline. Changes are saved on this device and will sync when you’re back online.'
      : sync.status === 'error' ? sync.error
      : d.lastSyncAt ? 'Up to date. Last synced ' + sincePhrase(d.lastSyncAt) + '.' : 'Connected.';
    return (
      <Sheet title="Sync" sub={'With ' + d.repo} backLabel="Back to settings">
        <p style="margin-top:14px" role="status">{line}</p>
        <p class="small muted" style="margin-top:8px">
          Every change is saved on this device first, then copied to your private GitHub repository. Other devices connected to the same repository pick it up the next time they open.
        </p>
        <div class="gap stack-v">
          <button class="btn" disabled={sync.status === 'syncing'} onClick={() => void syncNow().then((ok) => { if (ok) toast('Synced.'); })}>Sync now</button>
          <a class="btn ghost" href={'https://github.com/' + d.repo + '/commits'} target="_blank" rel="noopener noreferrer">See the change history on GitHub</a>
        </div>
        <h3 class="gap">Another device</h3>
        <p class="small muted" style="margin-top:4px">Open this app there, go to Settings, then Sync, and connect it to {d.repo} with a token of its own.</p>
        <div class="gap">
          <Confirm ask="Disconnect this device" yes="Disconnect" no="Stay connected" onYes={() => { disconnect(); toast('Disconnected. Your log is still on this device.'); }} />
          <p class="tiny muted">Disconnecting removes the token from this device. It doesn’t delete anything here or in the repository.</p>
        </div>
      </Sheet>
    );
  }

  const go = async () => {
    setErr('');
    setBusy(true);
    try {
      let r = repo.trim();
      if (!r) {
        const u = await ghUser(token.trim());
        if (!u.login) throw new Error('GitHub didn’t accept the token.');
        r = u.login + '/training-log-data';
        setRepo(r);
      }
      const hadData = !isEmpty();
      await connect(token, r);
      setToken('');
      toast(hadData ? 'Connected. This device and the repository now match.' : 'Connected. Your log is here.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Couldn’t connect.');
    }
    setBusy(false);
  };

  return (
    <Sheet title="Sync" sub="Keep every device on the same log" backLabel="Back to settings">
      <p style="margin-top:14px">
        Your log lives on this device. Sync also keeps a copy in a private GitHub repository that only you can open, so your phone and computer stay in step and nothing is lost if a phone is.
      </p>
      <ol class="steps">
        <li>
          <p><b>A private repository for the log.</b></p>
          <p class="small muted">If you don’t have one yet, create it. The name training-log-data is what the app looks for.</p>
          <a class="link" href={NEW_REPO_URL} target="_blank" rel="noopener noreferrer">Create it on GitHub</a>
        </li>
        <li>
          <p><b>A token that can only touch that repository.</b></p>
          <p class="small muted">
            On the page this opens: under Repository access choose “Only select repositories” and pick training-log-data. Under Permissions, Repositories, set Contents to “Read and write”. Then generate the token and copy it.
          </p>
          <a class="link" href={NEW_TOKEN_URL} target="_blank" rel="noopener noreferrer">Create the token on GitHub</a>
        </li>
        <li>
          <p><b>Paste the token here.</b></p>
          <p class="small muted">It stays on this device and is only ever sent to GitHub.</p>
        </li>
      </ol>
      {err ? <p class="note" role="alert" style="margin-top:14px;margin-bottom:0">{err}</p> : null}
      <div class="field">
        <label for="s-token">Token</label>
        <input id="s-token" type="password" value={token} autocomplete="off" autocapitalize="off" spellcheck={false} placeholder="github_pat_…" onInput={(e) => { setToken(val(e)); setErr(''); }} />
      </div>
      <div class="field">
        <label for="s-repo">Repository</label>
        <input id="s-repo" type="text" value={repo} autocomplete="off" autocapitalize="off" spellcheck={false} placeholder="yourname/training-log-data" onInput={(e) => { setRepo(val(e)); setErr(''); }} />
        <p class="tiny muted">Leave this empty to use training-log-data under your own account.</p>
      </div>
      <div class="foot">
        <button class="btn" disabled={busy || !token.trim()} onClick={() => void go()}>{busy ? 'Connecting…' : 'Connect'}</button>
      </div>
    </Sheet>
  );
}

/* ---------- backup ---------- */

function describe(p: Parsed): string {
  const cfg = p.docs.config as ConfigDoc | undefined;
  const bits = [plural(p.sessions, 'session')];
  if (cfg && cfg.type === 'config') bits.push('a plan with ' + plural(cfg.routines.length, 'routine') + ' and ' + plural(Object.keys(cfg.lifts).length, 'lift'));
  return 'This backup has ' + bits.join(' and ') + '.' + (p.skipped ? ' ' + plural(p.skipped, 'entry') + ' couldn’t be read and will be left out.' : '');
}

export function BackupSheet() {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [err, setErr] = useState('');
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState('');
  const d = device();
  const n = getSessions().length;

  const read = (t: string) => {
    try {
      setParsed(parseLog(t));
      setErr('');
    } catch (e) {
      setParsed(null);
      setErr(e instanceof Error ? e.message : 'That file couldn’t be read.');
    }
  };
  const onFile = (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 30_000_000) { setErr('That file is too large to be a Training Log backup.'); return; }
    file.text().then(read, () => setErr('That file couldn’t be opened.'));
  };
  const bring = (mode: 'merge' | 'replace') => {
    if (!parsed) return;
    const r = importDocs(parsed.docs, mode);
    const bits = [];
    if (r.added) bits.push(r.added + ' added');
    if (r.updated) bits.push(r.updated + ' updated');
    if (r.removed) bits.push(r.removed + ' removed');
    toast(bits.length ? 'Backup brought in: ' + bits.join(', ') + '.' : 'Nothing new in that backup.');
    closeOverlay();
  };
  const save = async (kind: 'json' | 'csv') => {
    const name = 'training-log-' + todayStr() + (kind === 'json' ? '.json' : '.csv');
    const ok = kind === 'json' ? await saveFile(name, exportJson(allDocs()), 'application/json') : await saveFile(name, exportCsv(getSessions()), 'text/csv');
    if (ok && kind === 'json') { setDevice({ lastBackupAt: Date.now() }); notify(); }
  };

  return (
    <Sheet title="Backup and export" sub={plural(n, 'session') + ' on this device'} backLabel="Back to settings">
      <h3 class="gap">Save a copy</h3>
      <p class="small muted" style="margin-top:4px">
        A backup is one file with everything: sessions, routines, lifts and settings.{d.lastBackupAt ? ' Last saved ' + sincePhrase(d.lastBackupAt) + '.' : ''}
      </p>
      <div class="gap-s stack-v">
        <button class="btn" onClick={() => void save('json')}>Save a backup</button>
        <button class="btn ghost" disabled={!n} onClick={() => void save('csv')}>Export sets as a spreadsheet</button>
      </div>

      <h3 class="gap">Bring a backup in</h3>
      {err ? <p class="note" role="alert" style="margin-top:10px;margin-bottom:0">{err}</p> : null}
      {!parsed ? (
        <>
          <div class="field" style="margin-top:8px">
            <label for="b-file">Backup file</label>
            <input id="b-file" type="file" accept=".json,application/json,text/plain" onChange={onFile} />
          </div>
          {pasting ? (
            <>
              <div class="field">
                <label for="b-text">Or paste the backup’s text</label>
                <textarea id="b-text" value={text} onInput={(e) => setText(val(e))} spellcheck={false} />
              </div>
              <div class="gap-s"><button class="btn ghost" disabled={!text.trim()} onClick={() => read(text)}>Read it</button></div>
            </>
          ) : (
            <div class="bar"><button class="link" onClick={() => setPasting(true)}>Paste it instead</button></div>
          )}
        </>
      ) : (
        <>
          <p style="margin-top:8px">{describe(parsed)}</p>
          <div class="gap-s stack-v">
            <button class="btn" onClick={() => bring('merge')}>{isEmpty() ? 'Bring it in' : 'Add it to what’s here'}</button>
            {!isEmpty() ? (
              <>
                <p class="tiny muted">Adding keeps everything on this device and brings in what the backup has. Where both have the same session, the newer copy is kept.</p>
                <Confirm ask="Replace what’s here instead" yes="Replace everything with this backup" no="Don’t replace" onYes={() => bring('replace')} />
              </>
            ) : null}
            <div class="bar"><button class="link" onClick={() => { setParsed(null); setText(''); }}>Choose a different backup</button></div>
          </div>
        </>
      )}

      <h3 class="gap">Erase</h3>
      <p class="small muted" style="margin-top:4px">
        Removes the log from this device only.{syncOn() ? ' The copy in your repository is left alone, and this device is disconnected from it first.' : ' Save a backup first if you want to keep it.'}
      </p>
      <Confirm ask="Erase this device’s copy" yes="Erase it" no="Keep it" onYes={() => { disconnect(); eraseDevice(); closeOverlay(); toast('This device’s copy is erased.'); }} />
    </Sheet>
  );
}

/* ---------- install ---------- */

export function InstallSheet() {
  const p = platform();
  if (isStandalone()) {
    return (
      <Sheet title="Installed" backLabel="Back to settings">
        <p style="margin-top:14px">You’re using the installed app. It opens from your home screen and works without a connection.</p>
      </Sheet>
    );
  }
  return (
    <Sheet title="Install" sub="Put Training Log on your home screen" backLabel="Back to settings">
      <p style="margin-top:14px">Installed, it opens full screen like any other app and works in a gym with no signal. Your log stays on the device either way.</p>
      {canPromptInstall() ? (
        <div class="gap"><button class="btn" onClick={() => void promptInstall().then((ok) => { if (ok) { toast('Installed.'); closeOverlay(); } })}>Install Training Log</button></div>
      ) : p === 'ios' ? (
        <ol class="steps">
          <li><p>Open this page in <b>Safari</b>.</p><p class="small muted">Other iPhone browsers can’t install apps.</p></li>
          <li><p>Tap the <b>Share</b> button.</p><p class="small muted">The square with an arrow pointing up, at the bottom of the screen.</p></li>
          <li><p>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</p></li>
        </ol>
      ) : p === 'android' ? (
        <ol class="steps">
          <li><p>Open this page in <b>Chrome</b>.</p></li>
          <li><p>Tap the <b>three dots</b> at the top right.</p></li>
          <li><p>Tap <b>Add to Home screen</b>, then <b>Install</b>.</p></li>
        </ol>
      ) : (
        <ol class="steps">
          <li><p>Open this page in <b>Chrome</b> or <b>Edge</b>.</p></li>
          <li><p>Click the <b>install icon</b> at the right end of the address bar.</p><p class="small muted">It looks like a screen with a down arrow. It’s also under the browser menu as “Install Training Log”.</p></li>
        </ol>
      )}
      <p class="small muted gap">Do this once on each device. To put your log on a second device, set up Sync or bring in a backup there.</p>
    </Sheet>
  );
}

/* ---------- Claude ---------- */

export function ClaudeSheet() {
  const d = device();
  const [key, setKey] = useState('');
  const save = () => {
    const k = key.trim();
    if (!k) return;
    setDevice({ apiKey: k });
    setKey('');
    notify();
    toast('Key saved on this device.');
  };
  return (
    <Sheet title="Claude feedback" sub="A second opinion on any session" backLabel="Back">
      <p style="margin-top:14px">Every session report has an Ask Claude button. There are two ways it can work.</p>
      <h3 class="gap">Copy and paste</h3>
      <p class="small muted" style="margin-top:4px">
        The default, and it needs nothing set up. The button hands the report to the Claude app on a phone, or copies it on a computer. Paste Claude’s reply back into the report to keep it with the session.
      </p>
      <h3 class="gap">One tap, with an API key</h3>
      <p class="small muted" style="margin-top:4px">
        With an Anthropic API key, the report goes straight to Claude ({CLAUDE_MODEL}) and the reply appears in place. API use is billed to the key’s account, separately from a Claude subscription. Expect a few cents per reply.
      </p>
      {d.apiKey ? (
        <>
          <p style="margin-top:12px" role="status">A key is saved on this device, ending in {d.apiKey.slice(-4)}.</p>
          <Confirm ask="Remove the key" yes="Remove it" no="Keep it" onYes={() => { setDevice({ apiKey: '' }); notify(); toast('Key removed.'); }} />
        </>
      ) : (
        <>
          <div class="field">
            <label for="c-key">API key</label>
            <input id="c-key" type="password" value={key} autocomplete="off" autocapitalize="off" spellcheck={false} placeholder="sk-ant-…" onInput={(e) => setKey(val(e))} />
            <p class="tiny muted">Kept on this device only and sent only to Anthropic. It is never synced or put in a backup.</p>
          </div>
          <div class="gap-s stack-v">
            <button class="btn" disabled={!key.trim()} onClick={save}>Save key</button>
            <a class="link" href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener noreferrer">Get a key from Anthropic</a>
          </div>
        </>
      )}
    </Sheet>
  );
}
