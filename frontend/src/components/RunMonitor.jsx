import Icon from "./Icon";
import { relativeTime } from "../api";

const LABELS = {
  running: "Checking playback",
  cancelling: "Cancelling check",
  completed: "Check complete",
  cancelled: "Check cancelled",
  failed: "Check failed",
  interrupted: "Check interrupted",
};

export default function RunMonitor({ sparrow, compact = false }) {
  const { run, running, events, connected, busy } = sparrow;
  if (!run && compact) return null;
  if (!run)
    return (
      <div className="panel empty-state">
        <Icon name="activity" size={32} />
        <h3>Ready for your first check.</h3>
        <p>
          Save a watch page, then choose “Check all pages” to observe playback.
        </p>
      </div>
    );
  const progress = run.total
    ? Math.round((run.completed / run.total) * 100)
    : 0;
  const runEvents = events.filter((event) => event.id.startsWith(`${run.id}:`));
  const logs = runEvents.filter((event) => event.type === "log");
  const completedSites = new Set(
    runEvents
      .filter((event) => event.type === "site_result")
      .map((event) => event.site),
  );
  return (
    <section
      className={`run-panel panel ${compact ? "compact" : ""}`}
      aria-label="Check progress"
    >
      <div className="run-summary">
        <span className={`run-icon ${running ? "mint" : "neutral"}`}>
          <Icon
            name={
              running
                ? "activity"
                : run.status === "completed"
                  ? "check"
                  : "stop"
            }
          />
        </span>
        <div className="run-copy">
          <strong>{LABELS[run.status]}</strong>
          <span>
            {run.completed} of {run.total} pages checked ·{" "}
            {running
              ? connected
                ? "Live updates connected"
                : "Reconnecting to live updates…"
              : relativeTime(run.finished_at, sparrow.now)}
          </span>
        </div>
        {running ? (
          <button
            className="button subtle"
            disabled={busy || run.status === "cancelling"}
            onClick={() => sparrow.cancel().catch(() => {})}
          >
            <Icon name="stop" size={14} />
            {run.status === "cancelling" ? "Cancelling…" : "Cancel check"}
          </button>
        ) : (
          <span className="run-id">{run.id.slice(0, 8)}</span>
        )}
      </div>
      {running && (
        <div
          className="progress-track"
          role="progressbar"
          aria-label="Pages checked"
          aria-valuenow={run.completed}
          aria-valuemin={0}
          aria-valuemax={run.total}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
      )}
      {run.error && <p className="run-error">{run.error}</p>}
      {!compact && (
        <>
          <div className="run-sites">
            {run.sites.map((url) => (
              <div key={url}>
                <Icon
                  name={
                    completedSites.has(url) || run.status === "completed"
                      ? "check"
                      : "clock"
                  }
                  size={16}
                />
                <span>{url}</span>
              </div>
            ))}
          </div>
          <details className="log-details">
            <summary>
              Technical activity <span>{logs.length} recent events</span>
            </summary>
            <div className="log-output">
              {logs.length ? (
                logs.map((event) => (
                  <div className={`log-${event.level}`} key={event.id}>
                    {event.text ?? event.message}
                  </div>
                ))
              ) : (
                <p>
                  Activity is replayed while a check is active. Saved results
                  contain the playback evidence.
                </p>
              )}
            </div>
          </details>
        </>
      )}
    </section>
  );
}
