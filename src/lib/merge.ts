// Merging two copies of the log without a server deciding. Each doc carries the
// time it was last changed; for any id, the newer copy wins. Deletions are docs
// too (tombstones), so they win or lose the same way.

import type { ConfigDoc, Doc, DocMap } from './types';

export interface MergeResult {
  merged: DocMap;
  /** Ids whose winning copy came from the other side: write these locally. */
  takeRemote: string[];
  /** True when the other side is missing something we have, so it needs a push. */
  remoteStale: boolean;
}

/** Stable text for a doc, so two copies can be compared regardless of key order. */
export function canon(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
}

export function mergeDocs(local: DocMap, remote: DocMap): MergeResult {
  const merged: DocMap = {};
  const takeRemote: string[] = [];
  let remoteStale = false;
  const ids = new Set([...Object.keys(local), ...Object.keys(remote)]);
  for (const id of ids) {
    const a = local[id], b = remote[id];
    if (a && !b) { merged[id] = a; remoteStale = true; continue; }
    if (b && !a) { merged[id] = b; takeRemote.push(id); continue; }
    if (a.updatedAt > b.updatedAt) { merged[id] = a; remoteStale = true; }
    else if (b.updatedAt > a.updatedAt) { merged[id] = b; takeRemote.push(id); }
    else if (canon(a) === canon(b)) merged[id] = a;
    else { merged[id] = b; takeRemote.push(id); } // same stamp, different content: pick one side everywhere
  }
  return { merged, takeRemote, remoteStale };
}

/**
 * Joining two setups that were built separately (a phone that already has routines
 * meeting a synced log for the first time). Nothing is dropped: lifts and routines
 * are unioned by id, and where both sides define the same id the synced one is kept.
 */
export function combineConfigs(local: ConfigDoc, remote: ConfigDoc, now: number): ConfigDoc {
  const routines = remote.routines.map((r) => ({ ...r, liftIds: r.liftIds.slice() }));
  const have = new Set(routines.map((r) => r.id));
  for (const r of local.routines) if (!have.has(r.id)) routines.push({ ...r, liftIds: r.liftIds.slice() });
  return { id: 'config', type: 'config', updatedAt: now, routines, lifts: { ...local.lifts, ...remote.lifts }, prefs: { ...remote.prefs } };
}

export function hasSetup(c: ConfigDoc | undefined): boolean {
  return !!c && (c.routines.length > 0 || Object.keys(c.lifts).length > 0);
}

/**
 * One doc per line, config first, so the synced file diffs cleanly in version history.
 * `passthrough` holds entries read from the file that this version couldn't make sense
 * of (written by a newer version, say). They are written back untouched, never dropped.
 */
export function serializeDocs(docs: DocMap, extra: Record<string, unknown> = {}, passthrough: unknown[] = []): string {
  const rank = (d: Doc) => (d.id === 'config' ? 0 : d.id === 'active' ? 1 : 2);
  const list = Object.values(docs).sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const head: Record<string, unknown> = { format: 'training-log', version: 2, ...extra };
  const lines = Object.keys(head).map((k) => ' ' + JSON.stringify(k) + ': ' + JSON.stringify(head[k]) + ',');
  const rows = [...list.map((d) => JSON.stringify(d)), ...passthrough.map((x) => JSON.stringify(x)).filter((x) => x !== undefined)];
  return '{\n' + lines.join('\n') + '\n "docs": [\n' + rows.map((r) => '  ' + r).join(',\n') + '\n ]\n}\n';
}
