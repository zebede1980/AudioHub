# AudioHub

A self-hosted audio library and player. Point it at folders of audio files, browse and play them
from a phone-friendly web UI, and pull in new content from Soundgasm imports — with ratings, tags,
AI transcription, lossless-to-MP3 conversion, and optional syncing of your favorites to a second
(e.g. cloud) instance.

Single-user by design: one admin login, no multi-tenant concerns, built to run on your own
hardware behind your own reverse proxy.

## Features

**Library & playback**
- Folder browsing with cover art, duration, and incremental rescans — a moved or renamed file is
  detected by content fingerprint and re-linked, not treated as a new import.
- Full player: play/pause, seek, ±15s/+30s skip (also available right on the persistent mini-player
  at the bottom of the screen), adjustable speed (0.75×–2×), volume.
- **Resume across sessions** — reopening the app (or relaunching the installed PWA) picks up right
  where you left off, loaded and ready without auto-playing.
- Lock-screen / headset media-key controls via the Media Session API — play, pause, skip from your
  phone's lock screen or Bluetooth headphones.
- Installable as a PWA (add to home screen) for a native-app feel on mobile.

**Organization**
- Star ratings (1–5) on individual files and whole folders — click the currently-set star again to
  clear a rating.
- Freeform tags: create, apply, and browse your library by tag (match *any* or *all* selected).
- History, Recently Added, and Top Rated are all fully interactive — rate, tag, view transcripts,
  and play directly from any of these lists, not read-only summaries.
- Full-text search across titles, filenames, and parsed author/series, plus folder-name search.
- Bulk cleanup: delete every 1-star *file* in one action, or review 1-star *folders* one by one
  before deleting them — the review screen shows each folder's real recursive file count and size,
  flags anything suspicious inside (a highly rated file, a transcript, a recent play), and lets you
  play any file without losing your place. Nothing is deleted until you tick a folder and confirm.
- Trash: deleted folders are moved to a `.audiohub-trash` directory inside their library root, not
  erased. Restore one from Settings → Trash (ratings, tags, and transcripts come back with it) or
  empty it early; anything older than 30 days is purged automatically at startup and nightly. Set
  `TRASH_RETENTION_DAYS` to change the window.

**Import & content pipeline**
- **Import from Soundgasm** — bulk-import a whole profile, or quick-import a single track from any
  URL. The two are fully independent: a quick import from one uploader never blocks on or depends
  on whatever profile happens to be loaded in the bulk-import flow.
- **AI transcription** — local speech-to-text via [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
  (no cloud API, nothing leaves your server), triggered per file, per row in any list, or per whole
  folder, with live progress and cancel. Asking for more files while a batch runs appends them to
  its queue rather than being refused. Tuned against whisper's repetition spiral — no text context
  carried between windows (`WHISPER_MAX_CONTEXT`), non-speech tokens suppressed
  (`WHISPER_SUPPRESS_NON_SPEECH`), and voice-activity detection to skip silence (`WHISPER_VAD`,
  ~1MB model fetched into `/data` on first use). Any transcript that still ends up repeating one
  sentence is flagged as degraded in the UI, with a one-click re-run.
- **Convert to MP3** — batch-convert lossless (WAV/FLAC) files to MP3 in place; ratings, tags, play
  history, and playback position all carry over onto the converted file.

**Cloud sync**
- Push your top-rated files (3+, 4+, or 5-only, your choice) to a second AudioHub instance — e.g.
  a small cloud box with far less storage than your main library, so it only ever holds your
  favorites.
- Ratings, tags, and transcripts travel with the file, not just the audio — the remote copy is a
  real match, not a bare file dump.
- API-key authenticated (not your login), diffed by content hash against what the remote already
  has so a re-run only transfers audio that's actually new (rating/tag/transcript edits are cheap
  to re-send and always kept in sync), and automatically removes the remote copy if a file drops
  below the rating threshold or is deleted locally.
- Configured entirely through each instance's own Settings page — no shared config files or
  environment variables to keep in sync between machines.

## Stack

- **Backend**: Fastify + TypeScript, SQLite (via `better-sqlite3`/Drizzle), plain hand-written SQL
  migrations applied automatically on boot.
- **Frontend**: React + TypeScript, Vite, Tailwind, TanStack Query, installable as a PWA.
- **Runtime**: a single Docker image serving both — Fastify serves the built frontend and the API
  from one process. `docker-publish.yml` also publishes it to GHCR on every push to `main`.

## Installation

Everything here assumes Docker and Docker Compose are already installed on the machine that will
run AudioHub, and that you have folders of audio files somewhere it can reach.

**1. Get the code**
```bash
git clone https://github.com/zebede1980/AudioHub.git
cd AudioHub
```

**2. Point it at your library**

Open `docker-compose.yml` and edit the `volumes:` section under the `audiohub` service to mount
your own audio folders/drives — the existing entries are examples, replace or extend them for your
setup. Each mounted path becomes something you can pick from when adding a library folder inside
the app in step 6; mounting a whole drive here does **not** mean the whole drive gets scanned.

**3. Configure secrets**
```bash
cp .env.example .env
```
Generate a session secret and an admin password hash:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # -> SESSION_SECRET

cd backend && npm ci && npm run hash-password -- 'your-password'           # -> ADMIN_PASSWORD_HASH
cd ..
```
Fill all three values into `.env` (`SESSION_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`).
**Important**: `docker-compose.yml` interpolates `$` in `.env` values — double every `$` the
hash script printed (`$argon2id$v=19$...` → `$$argon2id$$v=19$$...`) or the container starts with a
mangled password hash and login fails. `.env.example` has the same reminder inline.

**4. Build and start it**
```bash
docker compose up -d --build
```
This also builds and bakes in the whisper.cpp speech-to-text binary, so the first build can take a
few minutes; later rebuilds are much faster thanks to Docker layer caching.

**5. Put it behind a reverse proxy**

The container only binds to `127.0.0.1:8420` on the host — it's not directly reachable from your
network or the internet. Point your own nginx (or Nginx Proxy Manager, Caddy, Traefik, etc.) at
that port to terminate TLS and give it a domain/hostname. `docker-compose.cloud.yml`'s comments
walk through an example nginx/NPM configuration if you need a starting point.

**6. First login and library setup**

Open the app at whatever address your reverse proxy exposes, sign in with the admin username and
password from step 3, then **Settings → Add a folder**, using the *container* path from the
`volumes:` mount in step 2 (not the Windows/host path — see the hint text in that form). Click
**Scan** next to the folder you just added to index it; after that it also rescans automatically
every night, or on demand any time from the same Settings page.

That's it — everything else (tags, transcription, conversion, cloud sync, etc.) is configured from
within the app itself, no further file or environment editing required.

### Deploying a second (e.g. cloud) instance to sync to

`docker-compose.cloud.yml` is an example for a *remote* instance — it pulls a prebuilt image from
GitHub Container Registry instead of building from source, and expects a much smaller local
`./library` volume (synced content only, not your whole collection). See the comments at the top of
that file for first-time setup, including making the published GHCR image pullable (it's private by
default) and an example nginx/Nginx Proxy Manager configuration.

Once both instances are running, configure the sync relationship from each one's own **Settings →
Cloud sync** section — generate an API key on the receiving (cloud) side, then paste that key and
the cloud instance's URL into the pushing (local) side.

## Local development

```bash
# backend
cd backend && npm ci && npm run dev      # http://127.0.0.1:8420

# frontend, in another terminal
cd frontend && npm ci && npm run dev     # http://localhost:5173, proxies /api to 8420
```

`npm test` (inside `backend/`) runs the (currently light) test suite with Node's built-in test
runner.

## Project layout

```
backend/    Fastify API — routes/, scanner/, scraper/ (Soundgasm import), converter/,
            transcription/, sync/ (cloud sync), db/ (schema + migrations)
frontend/   React app — routes/ (pages), components/, api/hooks/ (TanStack Query hooks),
            player/ (the persistent audio element, playback store, media session integration)
```
