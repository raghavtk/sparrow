# Sparrow

Named after Captain Jack Sparrow, because this tool sails into rough waters, dodges traps, and checks whether the stream still plays.

Sparrow checks whether a video watch page plays and shows the evidence in a local dashboard. Save watch URLs, run a check, and compare the latest results with previous checks. The dashboard and CLI share the same browser probes and SQLite history.

A check is a short, timestamped observation. It cannot guarantee that a stream will keep playing or contains the title you intended to watch. Only probe websites you are authorized to test.

## Quick start

Use **Node 22.14 or later within Node 22 LTS**. The tested version is pinned in `.nvmrc`.

```sh
npm ci
npx playwright install chromium
npm --prefix frontend ci
npm run build
npm run server
```

Open [Sparrow](http://127.0.0.1:3001). The server listens on localhost by default.

1. Open **Saved pages** and add an exact watch-page URL.
2. Select **Check all pages**, or recheck one page from Overview.
3. Expand **Playback evidence & history** to inspect source attempts and previous results.

For development, run `npm run dev`. This starts the API and Vite; open [the development dashboard](http://localhost:5180).

## Using the dashboard

- **Overview** shows one latest result per saved page, including playback status, source instructions, check age, popups, and access challenges. Search, filter, sort, or recheck individual pages.
- **Saved pages** lets you add and remove watch URLs. Listing discovery offers up to 30 candidate links from a listing page; choose the intended title before saving and checking it. Discovery recognizes obvious same-origin watch, movie, episode, event, and live links.
- **Activity** shows progress, saved events, completion or errors, and a cancel button. Refreshing or closing a tab does not cancel a check.

The collection, results, history, and activity persist in SQLite. A server restart marks unfinished jobs **interrupted**; start a new check to retry. An existing `sites.txt` is imported when the dashboard collection is first initialized.

The frontend uses plain CSS, system fonts, and inline SVG icons. Live checks update through server-sent events. Idle dashboards refresh every 30 seconds while visible, pause polling in hidden tabs, and load archived activity when opened.

## Reading results

Each source normally gets about 10 seconds of observation. Sparrow looks for the largest visible video player in the page or its nested frames, attempts playback, and records advancement, stalls, media errors, and player URLs. Small, hidden, or explicitly marked advertisement and trailer videos are excluded.

- **WORKING:** sustained playback with attributed media was observed.
- **SLOW:** playback was observed, but the media response took over 3 seconds to begin.
- **BROKEN:** the page was reachable, but playback was not verified.
- **DOWN:** the page was unavailable or returned a main-page server error.
- **REDIRECT-LOOP:** the configured redirect limit was reached without playback.

Popup counts and access challenges appear separately from playback status. Failed advertising requests do not make a playable page unavailable, and a failed mirror does not establish that the whole site is down. Older history may show `TOO-MANY-ADS`; new checks do not use popup counts to override playback.

Media evidence belongs to the source attempt and player frame that produced it. A response from an earlier mirror or another frame cannot supply the current source's metrics. Unattributed playback, and default attempts that navigate away from the watch page, remain unverified. Signed variants of the same URL do not count as separate working sources.

### Limits

- Delivery speed is unmeasured. A cached response or playlist does not establish media throughput.
- Multiple observed sources indicate coverage, not independent infrastructure or long-term reliability.
- Generic heuristics may miss unusual source controls, mistake an unmarked ad for content, or fail to identify the requested title.
- Login and access challenges can prevent verification. Sparrow reports these conditions and does not solve challenges.

The generic prober recognizes common Server, Source, and Mirror buttons and select options. No site-specific compatibility is guaranteed.

## Configuration and private access

Configuration is read from environment variables:

- `HOST`: bind address; defaults to `127.0.0.1`.
- `PORT`: HTTP port; defaults to `3001`.
- `SPARROW_DB_PATH`: SQLite file path; defaults to `results.db`.
- `SPARROW_ACCESS_TOKEN`: enables the private access-key screen and API authentication. Required when listening beyond localhost.
- `SPARROW_TRUST_PROXY=1`: trusts one reverse proxy for HTTPS scheme detection. Enable only behind that proxy; session cookies then use Secure on HTTPS.
- `SPARROW_BROWSER_EXECUTABLE`: optional path to an installed Chromium-compatible browser. Otherwise, Playwright and Puppeteer use their installed browsers.

Authentication uses HttpOnly, SameSite session cookies. API clients can send `Authorization: Bearer <token>`. The frontend does not persist the access key.

The dashboard accepts at most 30 saved pages and 3 parallel probes. One check job or listing discovery runs at a time. Each browser engine has a page deadline, and cancellation closes active workers.

### Shared deployment

Use HTTPS with a private network, VPN, or authenticated reverse proxy. Accepted destinations are HTTP/HTTPS URLs without credentials on standard web ports. Private and reserved IP addresses and DNS answers are rejected; browser requests and redirects are checked as well. Service workers are bypassed or blocked, WebSockets are blocked, and the Puppeteer fallback disables dedicated and shared workers.

These application checks do not replace network isolation. They cannot pin Chromium's subsequent DNS resolution, so an exposed worker needs firewall rules blocking private networks, metadata endpoints, and other sensitive destinations. Playwright enables Chromium sandboxing, and explicit `--no-sandbox` launch arguments are not used.

## Containers

The Docker scaffold builds the frontend, installs Chromium, runs Node as a non-root user, and persists SQLite in a named volume at `/data/results.db`. Compose binds port 3001 to localhost and sets CPU, memory, process, and shared-memory limits.

Set `SPARROW_ACCESS_TOKEN` in your environment, then run:

```sh
docker compose up --build -d
```

The container runtime has not been validated. Chromium sandboxing requires host support for unprivileged user namespaces and appropriate seccomp rules. Configure that support rather than disabling the sandbox. Add egress restrictions and an HTTPS reverse proxy before sharing the service beyond the local machine.

## CLI

Create `sites.txt` with one exact watch URL per line. Lines beginning with `#` are comments.

```sh
node src/index.js --sites sites.txt --db results.db --headless true --concurrency 3
```

Each page keeps its own title metadata. `--verbose` shows browser steps; `--quiet` keeps only the final report.

## Development and tests

```sh
npm test
npm --prefix frontend run lint
npm run build
```

`npm test` builds the frontend before running functional tests. The suite serves an attributed CC0 video locally and exercises real Chromium playback, the API, and the React dashboard.

Scenarios cover iframe playback, mirror selection, stalls, ad failures, popups, signed duplicate URLs, media attribution, unrelated navigation, listing discovery, access controls, private-network redirects, bounded jobs, shared edits, reconnection, cancellation, result history, search, mobile layout, and idle network traffic. Fixture-origin access is injected only in tests; no environment switch disables destination validation.

## API reference

Requests with a body use JSON. Protected deployments require a session cookie or bearer token.

- `GET /api/session`: inspect authentication status.
- `POST /api/session` with `{ "token": "..." }`: sign in.
- `GET /api/sites`: list saved watch URLs.
- `POST /api/sites` with `{ "url": "https://..." }`: save a watch URL.
- `DELETE /api/sites` with the same body: remove a watch URL.
- `POST /api/discover` with `{ "url": "https://..." }`: return candidate watch links for selection.
- `POST /api/runs` with optional `{ "sites": ["https://..."], "concurrency": 3 }`: start a check and return HTTP 202 with a run ID. Selected URLs must already be saved.
- `GET /api/runs/latest`: retrieve the latest run.
- `GET /api/runs/:id`: retrieve a run by ID.
- `GET /api/runs/:id/events`: stream saved and live events. Reconnect with `Last-Event-ID` or `?after=<event-id>`.
- `POST /api/runs/:id/cancel`: cancel a run.
- `GET /api/results`: retrieve the latest check for each saved page.
- `GET /api/history?url=<encoded-watch-url>`: retrieve up to 30 historical checks for a URL.
