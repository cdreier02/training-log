// Things that belong to this phone or this browser and must never travel with the
// log: the sync token, the theme, whether the screen stays on. Kept apart from the
// docs so a backup or a sync can't carry a credential with it.

export type Theme = 'system' | 'light' | 'dark';

export interface Device {
  theme: Theme;
  keepAwake: boolean;
  /** GitHub token with read and write access to the data repository. Device-only. */
  token: string;
  /** "owner/name" of the private repository that holds the synced log. */
  repo: string;
  lastSyncAt: number;
  /** Local changes are waiting to be pushed. */
  dirty: boolean;
  /** Anthropic API key for in-app feedback. Optional and device-only. */
  apiKey: string;
  /** A session the person asked Claude about with no connection; sent once back online. */
  pendingAsk: string;
  installDismissed: boolean;
  lastBackupAt: number;
}

const KEY = 'tl:device';
const DEFAULTS: Device = { theme: 'system', keepAwake: false, token: '', repo: '', lastSyncAt: 0, dirty: false, apiKey: '', pendingAsk: '', installDismissed: false, lastBackupAt: 0 };

let cache: Device | null = null;

function read(): Device {
  if (cache) return cache;
  let saved: Partial<Device> = {};
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) saved = JSON.parse(raw) as Partial<Device>;
  } catch {
    saved = {};
  }
  cache = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS) as (keyof Device)[]) {
    if (typeof saved[k] === typeof DEFAULTS[k]) (cache as unknown as Record<string, unknown>)[k] = saved[k];
  }
  if (cache.theme !== 'light' && cache.theme !== 'dark') cache.theme = 'system';
  return cache;
}

export function device(): Readonly<Device> {
  return read();
}

export function setDevice(patch: Partial<Device>): void {
  cache = null; // re-read first: another tab or the installed app may have changed something since
  cache = { ...read(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Private windows can refuse storage. The setting still holds until the page closes.
  }
}

/** Calls back when another tab or window of the app changes these settings. */
export function onDeviceChange(fn: () => void): void {
  window.addEventListener('storage', (e) => {
    if (e.key !== null && e.key !== KEY) return;
    cache = null;
    fn();
  });
}

export function applyTheme(): void {
  const t = read().theme;
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#11181E' : '#E9ECEE');
}

/** A short name for this device, used in the synced file's change history. */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Linux/.test(ua)) return 'Linux';
  return 'browser';
}
