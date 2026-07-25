# Sparrow

Named after Captain Jack Sparrow — because this tool sails into rough waters, dodges traps, and checks whether the stream still plays.

This project is a production-style Node.js monitor for checking whether **authorized** video websites are alive and able to start a stream.

It is intended for availability research, QA, and infrastructure monitoring. Do not use this tool against systems you are not authorized to test.

CLI and UI both drive the same in-process `runMonitor` core and write to the same SQLite database.

## Features

- Reads input URLs from `sites.txt` (one URL per line).
- Uses both:
  - `playwright-extra` + stealth plugin
  - `puppeteer-extra` + stealth plugin + adblocker plugin
- Handles common hostile UI conditions:
  - popups
  - iframe/ad noise
  - cookie banners
  - basic bot protection pages (Cloudflare-style detection and delayed retry behavior)
- Detects video stream network requests (`m3u8`, `mp4`, `webm` and relevant content types).
- Collects metrics:
  - video HTTP status
  - TTFB (ms)
  - approximate speed for first downloaded chunk up to 1MB (Mbps)
  - playback start signal (`video.currentTime` increases)
- Bounded site-level concurrency (default 3) with a shared Chromium browser pool so multi-site runs reuse browsers instead of relaunching per site.
- Retry once on failures.
- Stores all checks in SQLite (`results.db`).
- Prints CLI report classifications:
  - `WORKING`
  - `SLOW`
  - `BROKEN`
  - `REDIRECT-LOOP`
  - `TOO-MANY-ADS`
  - `DOWN`

## Requirements

- Node.js 20+
- npm 10+

## Install

```bash
npm install
npx playwright install chromium
cd frontend && npm install && cd ..
```

## Input file

Edit `sites.txt`:

```text
https://example.org
https://example.org/watch-movie/the-matrix-1999
```

Lines starting with `#` are ignored.

## Run — CLI

```bash
npm start
```

Or with custom options:

```bash
node src/index.js --sites sites.txt --db results.db --headless true --concurrency 3
```

Use `--headless false` for visible debugging.

Progress logging is enabled by default. Example output:

```text
[22:10:01] INFO  Reading sites from sites.txt
[22:10:01] INFO  Loaded 3 site(s):
[22:10:01] INFO    1. https://example.org/movie/550
[22:10:01] INFO  Concurrency: 3 (shared browser pool)
[22:10:01] ----  [1/3] Checking https://example.org/movie/550
[22:10:01] ----  Launching Playwright probe
[22:10:25]  OK   [1/3] BROKEN in 24.1s (player=yes, stream=no, engine=playwright)
```

Flags:

- `--sites <path>` — sites list (default `sites.txt`)
- `--db <path>` — SQLite path (default `results.db`)
- `--headless true|false` — browser visibility (default `true`)
- `--concurrency N` — max parallel site probes (default `3`)
- `--verbose` or `-v` — step-by-step browser actions
- `--quiet` or `-q` — suppress progress logs; only print the final table

## Run — UI

Start the API and Vite UI together:

```bash
npm run dev
```

Then open the Vite URL printed in the terminal (usually `http://localhost:5173`). The UI proxies `/api/*` to the Express server on port 3001.

Or API only (serves built UI from `frontend/dist` if present):

```bash
npm run server
```

Build the UI for that static serve path:

```bash
cd frontend && npm run build
```

The Run tab starts the same `runMonitor` core in-process (not a CLI subprocess). Stop aborts the run when the SSE connection closes. Overlapping runs return HTTP 409.

## API routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sites` | List URLs from `sites.txt` |
| `POST` | `/api/sites` | Replace `sites.txt` — body `{ "sites": ["https://…"] }` |
| `POST` | `/api/run` | Start a monitor run; streams SSE JSON events. Optional body: `{ "concurrency": 3, "headless": true }`. Rejects with 409 if a run is already active. |
| `GET` | `/api/results` | Latest 200 rows from `results.db` |

### SSE events from `POST /api/run`

| `type` | Meaning |
|--------|---------|
| `run_start` | Run began (`total`, `sites`, `concurrency`, …) |
| `log` | Progress line (`level`, `message`, `text`) |
| `site_start` | Site probe started |
| `site_result` | Site finished (`row`, `completed`/`total`) |
| `run_done` | Run finished or aborted (`counts`, `aborted`) |
| `done` | Stream complete (`code`) — UI completion signal |

## Output

- Console table summary (CLI).
- SQLite database file: `results.db` (shared by CLI and UI).

Table: `health_checks`

Important fields:
- `site_url`
- `final_url`
- `classification`
- `http_status`
- `ttfb_ms`
- `speed_mbps`
- `stream_started`
- `stream_url`
- `player_found`
- `ads_artifacts`
- `bot_protection_detected`
- `error_message`

## Classification logic

- `DOWN`: major connectivity/server failure, 5xx on stream, or no usable player/stream state within timeout context.
- `BROKEN`: site responds but player/stream behavior is invalid (no playback start).
- `SLOW`: stream works, but TTFB or speed is poor.
- `REDIRECT-LOOP`: redirect count reaches configured ceiling.
- `TOO-MANY-ADS`: ad/popup/iframe artifacts exceed threshold.
- `WORKING`: stream discovered and playback starts with acceptable performance.

## Notes on bot protection handling

The monitor includes practical anti-bot resilience:
- realistic user agents and viewport sizes
- randomized human-like delays
- cookie acceptance attempts
- detection of Cloudflare / challenge pages and waiting before retry

Some advanced anti-bot systems may still block automation. In those cases results are recorded with errors for operational awareness.

## Project structure

- `src/index.js` — CLI entry
- `src/monitor.js` — shared orchestration, events, concurrency, retry, reporting
- `src/browsers/pool.js` — shared Playwright/Puppeteer Chromium pool for a run
- `server.js` — Express API (in-process `runMonitor` + SSE)
- `frontend/` — React UI (Sites / Run / Results)
- `src/runners/playwrightRunner.js` — primary probe engine
- `src/runners/puppeteerRunner.js` — fallback probe engine
- `src/probers/common.js` — shared probing helpers
- `src/db.js` — SQLite persistence
- `src/classifier.js` — status classification
- `src/config.js` — tunable constants
- `src/logger.js` — CLI and event loggers

## Legal / ethics

Only test systems where you have explicit permission. This code is provided for educational and defensive availability monitoring use cases.
