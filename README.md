# Sparrow

Sparrow checks the playback evidence behind a watch page and keeps the results in a private dashboard. The CLI and dashboard share the same browser probing core and SQLite history.

## Run locally

Use **Node 22.14+ within Node 22 LTS** (`.nvmrc` pins the tested version). The locked frontend tooling requires a modern Node runtime.

```sh
npm ci
npx playwright install chromium
npm --prefix frontend ci
npm run build
npm run server
```

Open http://127.0.0.1:3001. Localhost is the default bind address. `npm run dev` runs Express plus Vite at http://localhost:5180.

## Dashboard

- **Overview:** one latest check per saved page, with observed playback, source instructions, freshness, popups and challenges. Search, filter, recheck an individual page, and expand playback evidence or up to 30 historical checks.
- **Saved pages:** add/remove individual watch URLs in SQLite. Changes from another browser cannot overwrite a stale copy of the entire list. `sites.txt` is imported once when the collection is first initialized.
- **Listing discovery:** open the listing input mode to extract up to 30 candidate watch links. Choose the intended title explicitly, save it, then check playback. Generic discovery only follows obvious same-origin watch/movie/episode/event/live links. It does not certify content or compatibility.
- **Activity:** saved progress events, completion/error state, and explicit cancellation. Closing or refreshing a tab only disconnects its progress subscription. It does not cancel the job.

A server restart marks unfinished jobs **interrupted**. Recheck to start a new job; the saved collection, results, history, and activity survive restarts.

## What a result establishes

A source normally receives a 10-second observation window. Sparrow samples the largest visible video player across main and nested frames, attempts playback once, and records playback advancement, stalled samples, media errors, observation duration, and player/frame URLs. Hidden, small, or explicitly marked advertisement/trailer videos are excluded. Dynamic frame replacements and media loops are handled.

Requests carry the source-attempt ID assigned before clicking. The selected player frame supplies attribution. Unattributed playback and default attempts that navigate away from the watch page remain unverified. A late response from an earlier attempt cannot supply the next mirror's metrics. Repeated URLs with different signing parameters do not count twice toward source coverage.

- **WORKING:** consistent playback observed during the sample.
- **SLOW:** playback observed, but the media response took over 3 seconds.
- **BROKEN:** page reachable, playback not verified.
- **DOWN:** page unavailable or main-page server failure.
- **REDIRECT-LOOP:** configured navigation limit reached without playback.

Popups and access challenges are separate signals. A failed advertising request does not make a working page DOWN. A failed mirror does not establish that the whole site is unavailable. `TOO-MANY-ADS` remains displayable for older history, but new popup counts do not override playback.

Speed is left unmeasured: reading a cached body or playlist does not establish media delivery throughput. Two observed source URLs establish source coverage, not independent infrastructure or long-term reliability. Generic heuristics cannot always distinguish an unmarked video ad or validate that a player contains the requested title. Results are dated observations, not guarantees.

## Compatibility

The generic watch-page prober recognizes common Server/Source/Mirror buttons and select options. Provider names in a label pattern are not a support claim. The adapter boundary currently contains conservative generic listing discovery; no site-specific compatibility is advertised without real examples and repeatable tests.

Controlled fixtures cover iframe playback, fast mirror selection, dead mirrors, stalled playback, advertising failures, popups, repeated signed URLs, listing discovery, private-network redirects, unrelated page navigation, and cross-frame media attribution. Real aggregator pages may require login or an access challenge; Sparrow reports uncertainty rather than solving challenges.

## Functional tests

```sh
npm test
npm --prefix frontend run lint
npm run build
```

The suite serves a checked-in, attributed CC0 video on a local fixture server and exercises real Chromium playback, API behavior, and the built React dashboard. It verifies source selection, playback confidence, access controls, bounded jobs, shared edits, reconnect after refresh, cancellation, latest-versus-history results, search, and mobile overflow. The test command builds the frontend first. Fixture-origin access is injected only in tests; there is no environment switch that disables destination validation.

`SPARROW_BROWSER_EXECUTABLE` optionally selects an already-installed Chromium-compatible executable. Normally Playwright uses its installed Chromium and Puppeteer uses its installed browser.

## Private access and resource limits

Set `SPARROW_ACCESS_TOKEN` to enable a private access-key screen and HttpOnly, SameSite session cookies. API clients can also use an `Authorization: Bearer ...` header. Listening beyond localhost requires the access token.

The API accepts HTTP/HTTPS URLs without credentials, on standard web ports. Private/reserved IPs and DNS answers are rejected. Browser requests and redirects are checked too, service workers are bypassed/blocked, WebSockets are blocked, and the Puppeteer fallback disables dedicated/shared workers. One browser job or listing discovery runs at a time, with at most 30 pages and 3 parallel probes. Each engine has a page deadline; cancellation closes active browser workers.

Use HTTPS and a private network/VPN or authenticated reverse proxy for shared deployment. Application DNS checks are defense in depth: they cannot pin Chromium's subsequent DNS resolution or replace egress isolation against DNS rebinding. An exposed worker host needs firewall rules blocking private networks, metadata endpoints, and other sensitive destinations. Chromium sandboxing is enabled for Playwright and explicit `--no-sandbox` launch arguments have been removed.

Configuration:

- `PORT` / `HOST`: default `3001` / `127.0.0.1`.
- `SPARROW_DB_PATH`: persistent SQLite path, default `results.db`.
- `SPARROW_ACCESS_TOKEN`: shared private access key; never stored by the frontend.
- `SPARROW_TRUST_PROXY=1`: trust one reverse proxy for HTTPS scheme detection. Enable only behind that proxy; then session cookies become Secure on HTTPS.

## Container scaffold

`Dockerfile` and `compose.yaml` build the frontend, install Chromium, run Node as a non-root user, persist SQLite at `/data/results.db`, and set CPU, memory, process, and shared-memory limits. Compose binds the published port to localhost.

```sh
# Set SPARROW_ACCESS_TOKEN in your environment first.
docker compose up --build -d
```

The container scaffold has not been exercised in this Windows session. Keeping Chromium's sandbox enabled requires a host/container configuration that supports unprivileged user namespaces and appropriate seccomp rules; do not solve launch failures by disabling the sandbox. Configure egress restrictions and an HTTPS reverse proxy before sharing it beyond the local machine.

## CLI

```sh
node src/index.js --sites sites.txt --db results.db --headless true --concurrency 3
```

`sites.txt` contains exact watch-page URLs, one per line; `#` starts a comment. Mixed titles keep their own metadata. There are no guessed Matrix watch paths. `--verbose` shows browser steps and `--quiet` keeps only the final report.

The dashboard uses system fonts, inline SVG icons, and plain CSS. Live checks update through SSE; idle dashboards refresh every 30 seconds while visible, pause polling in hidden tabs, and load archived activity only when opened.

## API

- `GET /api/session`, `POST /api/session` with `{ "token": "..." }`.
- `GET /api/sites`, `POST /api/sites` with `{ "url": "https://..." }`, `DELETE /api/sites` with the same shape.
- `POST /api/discover` with `{ "url": "https://..." }` returns candidate watch links for selection.
- `POST /api/runs` with optional `{ "sites": ["https://..."], "concurrency": 3 }` returns HTTP 202 and a run ID. URLs must already be saved.
- `GET /api/runs/latest`, `GET /api/runs/:id`.
- `GET /api/runs/:id/events` streams saved and live SSE events. Reconnection supports `Last-Event-ID` or `?after=<event-id>`.
- `POST /api/runs/:id/cancel` cancels explicitly.
- `GET /api/results` returns the latest check for each saved page.
- `GET /api/history?url=<encoded-watch-url>` returns up to 30 historical checks for that URL.

The former whole-list overwrite and disconnect-driven `POST /api/run` endpoints have been replaced by incremental edits and persistent jobs.

Only probe websites you are authorized to test.
