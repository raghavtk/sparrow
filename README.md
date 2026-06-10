# Sparrow

Named after Captain Jack Sparrow — because this tool sails into rough waters, dodges traps, and checks whether the stream still plays.

This project is a production-style Node.js monitor for checking whether **authorized** video websites are alive and able to start a stream.

It is intended for availability research, QA, and infrastructure monitoring. Do not use this tool against systems you are not authorized to test.

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
```

## Input file

Edit `sites.txt`:

```text
https://example.org
https://example.org/watch-movie/the-matrix-1999
```

Lines starting with `#` are ignored.

## Run

```bash
npm start
```

Or with custom paths:

```bash
node src/index.js --sites sites.txt --db results.db --headless true
```

Use `--headless false` for visible debugging.

Progress logging is enabled by default. Example output:

```text
[22:10:01] INFO  Reading sites from sites.txt
[22:10:01] INFO  Loaded 3 site(s):
[22:10:01] INFO    1. https://example.org/movie/550
[22:10:01] ----  [1/3] Checking https://example.org/movie/550
[22:10:01] ----  Attempt 1/2: launching Playwright probe
[22:10:45]  OK   [1/3] BROKEN in 44.2s (player=yes, stream=no, engine=playwright)
```

Flags:

- `--verbose` or `-v` — step-by-step browser actions (navigation, stream wait, bot protection)
- `--quiet` or `-q` — suppress progress logs; only print the final table

## Output

- Console table summary.
- SQLite database file: `results.db`.

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

- `src/index.js` - CLI entry
- `src/monitor.js` - orchestration + retry + reporting
- `src/runners/playwrightRunner.js` - primary probe engine
- `src/runners/puppeteerRunner.js` - fallback probe engine
- `src/probers/common.js` - shared probing helpers
- `src/db.js` - SQLite persistence
- `src/classifier.js` - status classification
- `src/config.js` - tunable constants

## Legal / ethics

Only test systems where you have explicit permission. This code is provided for educational and defensive availability monitoring use cases.
