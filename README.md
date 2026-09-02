# AudioHub

A self-hosted audio library and player. Point it at folders of audio files, browse and play them
from a phone-friendly web UI, and pull in new content from Soundgasm imports — with ratings, tags,
AI transcription, lossless-to-MP3 conversion, and optional syncing of your favorites to a second
(e.g. cloud) instance.

Single-user by design: one admin login, no multi-tenant concerns, built to run on your own
hardware behind your own reverse proxy.

## Features

- **Library browsing** — folders and tracks scanned from disk, with cover art, duration, and
  incremental rescans (moved/renamed files are detected, not re-imported).
- **Ratings & tags** — star ratings on files and folders, freeform tags, all filterable/browsable.
  Bulk-delete everything at a given star rating, per file or per folder.
- **Import from Soundgasm** — bulk import a whole profile, or quick-import a single track from any
  URL, independent of whatever else is mid-import.
- **AI transcription** — local speech-to-text via [whisper.cpp](https://github.com/ggml-org/whisper.cpp),
  no cloud API, triggered per file or per folder.
- **Convert to MP3** — batch-convert lossless (WAV/FLAC) files down to MP3 in place, ratings and
  history preserved.
- **History & recently added** — cross-library views, fully interactive (rate/tag/play), not just
  read-only lists.
- **Cloud sync** — push your 4/5-star files to a second AudioHub instance (e.g. a small cloud box
  with less storage than your main library). API-key authenticated, diffed against what the remote
  already has, and cleans up the remote copy automatically if a file drops below the threshold.

## Stack

- **Backend**: Fastify + TypeScript, SQLite (via `better-sqlite3`/Drizzle), plain hand-written SQL
  migrations applied on boot.
- **Frontend**: React + TypeScript, Vite, Tailwind, TanStack Query, installable as a PWA.
- **Runtime**: a single Docker image serving both — Fastify serves the built frontend and the API
  from one process.

## Running it

### Your main instance (owns the real library)

`docker-compose.yml` builds the image from source and expects your library on mounted drives —
edit the `volumes:` section for your own paths.

```bash
cp .env.example .env
# fill in .env — see that file for what each value means and a docker-compose $ escaping gotcha
docker compose up -d --build
```

Generate the admin password hash with:

```bash
cd backend && npm ci && npm run hash-password -- 'your-password'
```

Paste the printed hash into `.env` as instructed there (mind the `$` escaping note).

### A second instance to sync to (e.g. a cloud box)

`docker-compose.cloud.yml` is an example for a *remote* instance — it pulls a prebuilt image from
GitHub Container Registry instead of building from source, and expects a much smaller local
`./library` volume (synced content only, not your whole collection). See the comments at the top
of that file for first-time setup, including making the published GHCR image pullable.

Images are published automatically by `.github/workflows/docker-publish.yml` on every push to
`main`.

Once both instances are up, configure the sync relationship from each instance's own **Settings →
Cloud sync** section — no shared config files, it's all done through the UI with an API key you
generate on the receiving side.

## Local development

```bash
# backend
cd backend && npm ci && npm run dev      # http://127.0.0.1:8420

# frontend, in another terminal
cd frontend && npm ci && npm run dev     # http://localhost:5173, proxies /api to 8420
```

`backend/npm test` runs the (currently light) test suite with Node's built-in test runner.

## Project layout

```
backend/    Fastify API — routes/, scanner/, scraper/ (Soundgasm import), converter/,
            transcription/, sync/ (cloud sync), db/ (schema + migrations)
frontend/   React app — routes/ (pages), components/, api/hooks/ (TanStack Query hooks)
```
