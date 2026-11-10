# Training Log

A gym log that knows the weights your gym actually has. You tap the plate the pin is in, not a number pad.

It runs in a browser, installs on a phone like an app, and works with no signal. Your log is stored on the device. Optionally it also syncs to a private GitHub repository of your own, so a phone and a computer stay on the same log.

## Using it

Open the site, then use **Settings → Install on this device** to put it on your home screen.

- **Today** starts a routine and walks through it lift by lift: last time's numbers, your cue, a rest timer, and the next set to log.
- **History** charts each lift against the weights available for it, and lists every session.
- **Plan** is where routines, lifts, and each lift's available weights are set up.
- **Settings** has sync, backup and export, units, theme, and the rest timer.

### Sync between devices

Sync keeps one file, `training-log.json`, in a private GitHub repository you own. Each device reads it, merges it with what it has (the newest copy of each session wins), and writes it back. Nothing goes to any server but GitHub's, and the file's change history on GitHub is a running backup.

1. Create a private repository named `training-log-data`.
2. Create a fine-grained personal access token limited to that one repository, with **Contents: Read and write**.
3. In the app, open **Settings → Sync** and paste the token. Do the same on each device.

The token is stored only on the device it was pasted into. It is never included in a backup or in the synced file.

### Backup

**Settings → Backup and export** saves the whole log as one JSON file, exports every set as a CSV spreadsheet, and brings a backup back in (either added to what's there, or replacing it).

### Feedback from Claude

Each session report has an **Ask Claude** button. By default it shares or copies the report so it can be pasted into a Claude chat, and the reply can be pasted back to keep with the session. With an Anthropic API key entered in Settings, it asks Claude directly instead.

## Working on it

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

`npm run icons` redraws the app icons from `scripts/make-icons.mjs`.

Pushing to `main` runs the tests, builds, and deploys to GitHub Pages (`.github/workflows/deploy.yml`).

### How it's put together

- **Preact + TypeScript + Vite.** `vite-plugin-pwa` generates the service worker that makes the app work offline and update itself.
- `src/lib/` has no UI in it and is where the tests point:
  - `types.ts` is the data model. Everything stored is a doc with an `id` and an `updatedAt`.
  - `store.ts` holds the docs in memory and writes each change through to IndexedDB (`idb.ts`).
  - `merge.ts` merges two copies of the log: for each id the newer doc wins, and deletions are docs too.
  - `sync.ts` and `github.ts` do the read, merge, write loop against the repository.
  - `backup.ts` reads and writes log files, rebuilding every field so a damaged file can't break the app.
  - `logic.ts` and `format.ts` are the training rules and the wording: today's plan, records, "50s × 10, 10, 9".
- `src/views/` are the four tabs. `src/sheets/` are the full-screen sheets that open over them. `src/ui.ts` tracks which are open and ties them to the browser's back button.
- `src/lib/device.ts` holds what must stay on one device: the sync token, the API key, the theme.

Personal data never belongs in this repository. `private/` is ignored by git for local backups and import files.
