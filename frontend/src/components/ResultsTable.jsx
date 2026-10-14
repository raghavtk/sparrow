import { useState } from "react";
import Icon from "./Icon";
import {
  request,
  relativeTime,
  sourceName,
  safeWebUrl,
  watchTitle,
} from "../api";

const STATUS = {
  WORKING: { label: "Playback observed", tone: "mint", icon: "check" },
  SLOW: { label: "Plays · slow response", tone: "amber", icon: "clock" },
  BROKEN: { label: "Playback unverified", tone: "amber", icon: "alert" },
  DOWN: { label: "Page unavailable", tone: "rose", icon: "close" },
  "REDIRECT-LOOP": {
    label: "Redirect limit reached",
    tone: "rose",
    icon: "alert",
  },
  "TOO-MANY-ADS": {
    label: "Playback unverified",
    tone: "amber",
    icon: "alert",
  },
  UNCHECKED: { label: "Not checked yet", tone: "neutral", icon: "clock" },
};
const FILTERS = [
  { id: "all", label: "All pages" },
  { id: "plays", label: "Played recently" },
  { id: "attention", label: "Needs attention" },
  { id: "unchecked", label: "Not checked" },
];

function Badge({ status }) {
  const meta = STATUS[status] ?? STATUS.BROKEN;
  return (
    <span className={`status-badge ${meta.tone}`}>
      <Icon name={meta.icon} size={13} />
      {meta.label}
    </span>
  );
}

function Evidence({ row }) {
  const attempts = row.sources_tried ?? [];
  return (
    <div className="evidence-content">
      <div className="evidence-metrics">
        <div>
          <span>Page HTTP</span>
          <strong>{row.page_http_status ?? "Not recorded"}</strong>
        </div>
        <div>
          <span>Media HTTP</span>
          <strong>{row.http_status ?? "Not recorded"}</strong>
        </div>
        <div>
          <span>Media response</span>
          <strong>
            {row.ttfb_ms != null
              ? `${Math.round(row.ttfb_ms)} ms`
              : "Not measured"}
          </strong>
        </div>
        <div>
          <span>Engine</span>
          <strong>{row.engine ?? "—"}</strong>
        </div>
      </div>
      {row.error_message && <p className="detail-note">{row.error_message}</p>}
      {attempts.length ? (
        <div className="attempt-list">
          {attempts.map((attempt, index) => (
            <div
              className="attempt-row"
              key={`${attempt.attempt_id ?? attempt.label}-${index}`}
            >
              <span
                className={`attempt-dot ${attempt.stream_started ? "mint" : "amber"}`}
              />
              <div>
                <strong>{sourceName(attempt)}</strong>
                <span>
                  {attempt.reason ??
                    (attempt.stream_started
                      ? "Playback observed"
                      : "Playback could not be verified")}
                </span>
              </div>
              <div className="attempt-measure">
                <strong>
                  {attempt.playback_seconds != null
                    ? `${attempt.playback_seconds.toFixed(1)}s advanced`
                    : "No sample recorded"}
                </strong>
                <span>
                  {attempt.observed_ms
                    ? `${(attempt.observed_ms / 1000).toFixed(1)}s observation · ${attempt.buffering_samples ?? 0} stalled samples`
                    : "Earlier check · limited evidence"}
                </span>
              </div>
              <span
                className={`attempt-outcome ${attempt.stream_started ? "mint" : "amber"}`}
              >
                {attempt.stream_started ? "Played" : "Unverified"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">
          No source-attempt evidence was recorded for this check.
        </p>
      )}
      <p className="input-hint">
        Delivery speed is not estimated from playlist or cached response bodies.
        Popups and challenges are reported separately from playback.
      </p>
    </div>
  );
}

function ResultCard({ row, now, onRecheck, disabled }) {
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const meta = STATUS[row.classification] ?? STATUS.BROKEN;
  const url = new URL(row.site_url);
  const best = row.working_source ?? row.working_sources?.[0];
  const working = row.working_sources ?? [];
  const pageChanged = row.sources_tried?.some(
    (attempt) => attempt.outcome === "page_changed",
  );
  const sourceUnverified = row.sources_tried?.some(
    (attempt) => attempt.outcome === "attribution_unverified",
  );
  const stale =
    row.checked_at && now - new Date(row.checked_at).getTime() > 60 * 60 * 1000;
  const openUrl = safeWebUrl(row.site_url);
  async function loadHistory() {
    setLoadingHistory(true);
    setHistoryError("");
    try {
      const data = await request(
        `/history?url=${encodeURIComponent(row.site_url)}`,
      );
      setHistory(data.results);
    } catch (err) {
      setHistoryError(err.message);
    } finally {
      setLoadingHistory(false);
    }
  }
  return (
    <article className={`result-card ${meta.tone}`}>
      <div className="card-main">
        <div className="card-head">
          <div className="site-avatar">
            {url.hostname
              .replace(/^www\./, "")
              .slice(0, 1)
              .toUpperCase()}
          </div>
          <div className="card-title">
            <span className="site-host">{url.hostname}</span>
            <h3>{watchTitle(row)}</h3>
          </div>
          <Badge status={row.classification} />
        </div>
        <p className="watch-path" title={row.site_url}>
          {url.pathname}
          {url.search}
        </p>
        <div
          className={`source-recommendation ${row.stream_started ? "has-source" : ""}`}
        >
          <Icon name={row.stream_started ? "play" : "activity"} size={19} />
          <div>
            <span className="tiny-label">
              {row.stream_started ? "SOURCE TO CHOOSE" : "PLAYBACK RESULT"}
            </span>
            <strong>
              {row.stream_started
                ? sourceName(best)
                : row.classification === "UNCHECKED"
                  ? "Ready for a first check"
                  : !row.is_up && row.checked_at
                    ? "Page could not be reached"
                    : pageChanged
                      ? "Watch page navigated away"
                      : sourceUnverified
                        ? "Playback observed · source unverified"
                        : row.player_found
                          ? "Player found · playback unverified"
                          : row.is_up
                            ? "No content player identified"
                            : "Page could not be reached"}
            </strong>
            <p>
              {row.stream_started
                ? best?.kind === "ui"
                  ? `Open the watch page and select “${sourceName(best)}” in its source menu.`
                  : "Open the watch page and use its default player."
                : row.classification === "UNCHECKED"
                  ? "Run a check to see which source plays."
                  : "Recheck for fresh evidence or inspect the source attempts below."}
            </p>
          </div>
        </div>
        <div className="signals">
          <span>
            <Icon name="link" size={13} />
            {working.length} source{working.length === 1 ? "" : "s"} played
            {row.target_working > working.length && row.stream_started
              ? " · target incomplete"
              : ""}
          </span>
          <span className={row.ads_artifacts > 0 ? "signal-warning" : ""}>
            {row.checked_at
              ? `${row.ads_artifacts ?? 0} popups encountered`
              : "No observations yet"}
          </span>
          {Boolean(row.bot_protection_detected) && (
            <span className="signal-warning">Access challenge detected</span>
          )}
        </div>
        <div className="card-actions">
          <a
            className="button open-button"
            href={openUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open watch page
            <Icon name="arrow" size={15} />
          </a>
          <button
            className="button subtle"
            disabled={disabled}
            onClick={() => onRecheck(row.site_url)}
          >
            <Icon name="refresh" size={14} />
            Recheck
          </button>
          <time
            className={`card-time ${stale ? "stale" : ""}`}
            dateTime={row.checked_at}
            title={
              row.checked_at
                ? new Date(row.checked_at).toLocaleString()
                : "Never checked"
            }
          >
            <Icon name="clock" size={13} />
            {relativeTime(row.checked_at, now)}
            {stale && <span>Recheck recommended</span>}
          </time>
        </div>
      </div>
      {row.checked_at && (
        <details className="card-details">
          <summary>
            Playback evidence & history
            <Icon name="chevron" size={14} />
          </summary>
          <Evidence row={row} />
          <div className="history-section">
            <button
              className="button subtle"
              onClick={loadHistory}
              disabled={loadingHistory}
            >
              <Icon name="clock" size={14} />
              {loadingHistory
                ? "Loading history…"
                : history
                  ? "Refresh check history"
                  : "Load check history"}
            </button>
            {historyError && (
              <p role="alert" className="run-error">
                {historyError}
              </p>
            )}
            {history && (
              <div className="history-list">
                {history.map((check) => (
                  <div key={check.id}>
                    <time title={check.checked_at}>
                      {new Date(check.checked_at).toLocaleString()}
                    </time>
                    <Badge status={check.classification} />
                    <span>{sourceName(check.working_source)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      )}
    </article>
  );
}

export default function ResultsTable({
  rows,
  now,
  loading,
  onRecheck,
  disabled,
  onRefresh,
  onAdd,
}) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const matches = (row, id) =>
    id === "all" ||
    (id === "plays" && row.stream_started) ||
    (id === "attention" &&
      !row.stream_started &&
      row.classification !== "UNCHECKED") ||
    (id === "unchecked" && row.classification === "UNCHECKED");
  const visible = rows
    .filter(
      (row) =>
        matches(row, filter) &&
        `${row.title ?? ""} ${row.site_url}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => {
      if (sort === "playback")
        return (
          Number(Boolean(b.stream_started)) -
            Number(Boolean(a.stream_started)) ||
          (a.ttfb_ms ?? Infinity) - (b.ttfb_ms ?? Infinity)
        );
      return new Date(b.checked_at ?? 0) - new Date(a.checked_at ?? 0);
    });
  return (
    <section aria-label="Latest playback results">
      <div className="section-heading">
        <div>
          <h2>
            Latest checks <span className="count-label">{rows.length}</span>
          </h2>
          <p>
            One current result per saved page. Expand a card to inspect the
            evidence.
          </p>
        </div>
        <button className="button subtle" onClick={onRefresh}>
          <Icon name="refresh" size={15} />
          Refresh
        </button>
      </div>
      <div className="results-toolbar">
        <div className="filter-tabs" role="group" aria-label="Filter results">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              aria-pressed={filter === item.id}
              className={filter === item.id ? "active" : ""}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              <span>{rows.filter((r) => matches(r, item.id)).length}</span>
            </button>
          ))}
        </div>
        <div className="toolbar-search">
          <Icon name="search" size={15} />
          <input
            aria-label="Search watch pages"
            placeholder="Search pages…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="results-caption">
        <span>
          {visible.length} page{visible.length === 1 ? "" : "s"}{" "}
          {filter !== "all" || query
            ? "matching your filters"
            : "in your collection"}
        </span>
        <label>
          Sort by{" "}
          <select
            aria-label="Sort results"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="recent">Most recent</option>
            <option value="playback">Playback, then response</option>
          </select>
        </label>
      </div>
      {loading ? (
        <div className="results-grid" aria-label="Loading results">
          {[1, 2].map((i) => (
            <div key={i} className="skeleton-card" />
          ))}
        </div>
      ) : !rows.length ? (
        <div className="empty-state panel">
          <span className="empty-icon">
            <Icon name="bird" size={32} />
          </span>
          <h3>A working stream starts with a watch page.</h3>
          <p>
            Save a movie, episode, or event link. Sparrow will check its sources
            and keep the evidence here.
          </p>
          <button className="button primary" onClick={onAdd}>
            <Icon name="plus" size={16} />
            Add your first page
          </button>
        </div>
      ) : !visible.length ? (
        <div className="empty-state panel">
          <Icon name="search" size={28} />
          <h3>No pages match these filters.</h3>
          <p>Try another title, domain, or playback filter.</p>
          <button
            className="button subtle"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="results-grid">
          {visible.map((row) => (
            <ResultCard
              key={`${row.site_url}:${row.id ?? "unchecked"}`}
              row={row}
              now={now}
              onRecheck={onRecheck}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </section>
  );
}
