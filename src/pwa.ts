// The parts that make this an app rather than a page: the offline service worker
// and its updates, the install prompt, keeping the screen awake mid-session, and
// handing files and text to the rest of the phone.

import { registerSW } from 'virtual:pwa-register';
import { device } from './lib/device';
import { getActive, notify, subscribe } from './lib/store';
import { ui } from './ui';

let update: ((reload?: boolean) => Promise<void>) | null = null;

export function applyUpdate(): void {
  if (update) void update(true);
  else location.reload();
}

/**
 * Asks the browser to look for a new version right now. 'found' means one is being
 * downloaded or is waiting; the reload banner appears once it is ready.
 */
export async function checkForUpdate(): Promise<'unavailable' | 'current' | 'found'> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return 'unavailable';
    await reg.update();
    return reg.installing || reg.waiting ? 'found' : 'current';
  } catch {
    return 'unavailable';
  }
}

/* ---------- install ---------- */

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let installEvent: InstallEvent | null = null;

export const canPromptInstall = (): boolean => !!installEvent;

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

export type Platform = 'ios' | 'android' | 'desktop';
export function platform(): Platform {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

export async function promptInstall(): Promise<boolean> {
  if (!installEvent) return false;
  const e = installEvent;
  installEvent = null;
  await e.prompt();
  const choice = await e.userChoice;
  notify();
  return choice.outcome === 'accepted';
}

/* ---------- screen wake lock ---------- */

let lock: WakeLockSentinel | null = null;
let asking = false;

async function syncWakeLock(): Promise<void> {
  const want = device().keepAwake && !!getActive() && document.visibilityState === 'visible';
  if (want && !lock && !asking && 'wakeLock' in navigator) {
    asking = true;
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } catch {
      lock = null; // low battery or not allowed: the screen just follows the phone's own timeout
    }
    asking = false;
  } else if (!want && lock) {
    const l = lock;
    lock = null;
    try { await l.release(); } catch { /* already released */ }
  }
}

/* ---------- handing things to the phone ---------- */

const coarse = () => window.matchMedia('(pointer: coarse)').matches;

/** Saves a file: the share sheet on a phone (so it can go to Files or Drive), a download elsewhere. */
export async function saveFile(name: string, text: string, mime: string): Promise<boolean> {
  const file = new File([text], name, { type: mime });
  if (coarse() && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return false;
      // fall through to a plain download
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Opens the phone's share sheet with some text. Resolves 'none' where there isn't one. */
export async function shareText(text: string, title: string): Promise<'shared' | 'cancelled' | 'none'> {
  if (!coarse() || !navigator.share) return 'none';
  try {
    await navigator.share({ text, title });
    return 'shared';
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' : 'none';
  }
}

export function initPwa(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e as InstallEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => { installEvent = null; notify(); });

  subscribe(() => void syncWakeLock());
  document.addEventListener('visibilitychange', () => void syncWakeLock());

  if (import.meta.env.PROD) {
    update = registerSW({
      immediate: true,
      onNeedRefresh() { ui.updateReady = true; notify(); },
      onRegisteredSW(_url, reg) {
        if (!reg) return;
        // A phone app can stay open for weeks; look for a new version when it comes back to the front.
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reg.update().catch(() => {}); });
      },
    });
  }
  try { void navigator.storage?.persist?.(); } catch { /* optional */ }
}
