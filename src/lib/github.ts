// The four GitHub calls sync needs: who am I, does the repository exist, read one
// file, write one file. The token is sent only to api.github.com.

const API = 'https://api.github.com';

export type GhKind = 'auth' | 'notfound' | 'conflict' | 'rate' | 'network' | 'forbidden' | 'other';

export class GhError extends Error {
  kind: GhKind;
  status: number;
  constructor(kind: GhKind, status: number, message: string) {
    super(message);
    this.name = 'GhError';
    this.kind = kind;
    this.status = status;
  }
}

// A request that never answers would otherwise leave sync "running" forever.
const TIMEOUT_MS = 45_000;
const deadline = (): AbortSignal | undefined => (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(TIMEOUT_MS) : undefined);

async function call(token: string, method: string, path: string, body?: unknown, accept = 'application/vnd.github+json'): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(API + path, {
      method,
      signal: deadline(),
      // GitHub marks API responses cacheable for a minute. A stale read here would hand
      // back an old version id and make the next write collide, so always go to the network.
      cache: 'no-store',
      headers: {
        Accept: accept,
        Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new GhError('network', 0, 'No connection to GitHub.');
  }
  if (res.ok) return res;
  if (res.status === 401) throw new GhError('auth', 401, 'GitHub didn’t accept the token.');
  if (res.status === 404) throw new GhError('notfound', 404, 'Not found.');
  if (res.status === 409) throw new GhError('conflict', 409, 'The synced copy changed.');
  let msg = '';
  try { msg = ((await res.json()) as { message?: string }).message ?? ''; } catch { /* no body */ }
  // GitHub signals both its hourly limit and its short-term "slow down" limit with a 403.
  const limited = res.status === 429 || (res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.get('retry-after') !== null || /rate limit/i.test(msg)));
  if (limited) throw new GhError('rate', res.status, 'GitHub is limiting requests for now.');
  if (res.status === 403) throw new GhError('forbidden', 403, 'The token isn’t allowed to do that.');
  if (res.status === 422 && /sha/i.test(msg)) throw new GhError('conflict', 422, 'The synced copy changed.');
  throw new GhError('other', res.status, msg || 'GitHub returned an error (' + res.status + ').');
}

export function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function b64decode(b64: string): string {
  const bin = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export async function ghUser(token: string): Promise<{ login: string }> {
  const res = await call(token, 'GET', '/user');
  const j = (await res.json()) as { login?: string };
  return { login: String(j.login ?? '') };
}

export interface RepoInfo {
  private: boolean;
  fullName: string;
}

export async function ghRepo(token: string, repo: string): Promise<RepoInfo | null> {
  try {
    const res = await call(token, 'GET', '/repos/' + repo);
    const j = (await res.json()) as { private?: boolean; full_name?: string };
    return { private: j.private === true, fullName: String(j.full_name ?? repo) };
  } catch (e) {
    if (e instanceof GhError && e.kind === 'notfound') return null;
    throw e;
  }
}

export interface RemoteFile {
  text: string;
  /** The version id GitHub wants back when this file is replaced. */
  sha: string;
}

const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export async function ghGetFile(token: string, repo: string, path: string): Promise<RemoteFile | null> {
  let res: Response;
  try {
    res = await call(token, 'GET', '/repos/' + repo + '/contents/' + enc(path));
  } catch (e) {
    if (e instanceof GhError && e.kind === 'notfound') return null; // no file yet, or a brand-new empty repository
    throw e;
  }
  const j = (await res.json()) as { sha?: string; content?: string; encoding?: string };
  const sha = String(j.sha ?? '');
  if (!sha) throw new GhError('other', 200, 'GitHub returned something unexpected for the synced file.');
  if (j.encoding === 'base64' && j.content) return { sha, text: b64decode(j.content) };
  // Past one megabyte the listing comes back without content; fetch the blob itself.
  const blob = await call(token, 'GET', '/repos/' + repo + '/git/blobs/' + sha, undefined, 'application/vnd.github.raw+json');
  return { sha, text: await blob.text() };
}

/** Writes the file. Pass the sha from the read it was based on; a mismatch throws a 'conflict'. */
export async function ghPutFile(token: string, repo: string, path: string, text: string, sha: string | null, message: string): Promise<string> {
  const body: Record<string, string> = { message, content: b64encode(text) };
  if (sha) body.sha = sha;
  const res = await call(token, 'PUT', '/repos/' + repo + '/contents/' + enc(path), body);
  const j = (await res.json()) as { content?: { sha?: string } };
  return String(j.content?.sha ?? '');
}
