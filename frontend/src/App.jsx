import { useState } from "react";
import useSparrow from "./hooks/useSparrow";
import Icon from "./components/Icon";
import LinkInput from "./components/LinkInput";
import RunMonitor from "./components/RunMonitor";
import ResultsTable from "./components/ResultsTable";
import { isRecent } from "./resultPresentation";

const NAVIGATION = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "saved", label: "Saved pages", icon: "link" },
  { id: "activity", label: "Activity", icon: "activity" },
];

export default function App() {
  const [view, setView] = useState("overview");
  const sparrow = useSparrow({ includeHistory: view === "activity" });
  const [key, setKey] = useState("");
  const start = (sites) => sparrow.start(sites).catch(() => {});
  const latest = new Map(sparrow.results.map((r) => [r.site_url, r]));
  const rows = sparrow.sites.map(
    (url) => latest.get(url) ?? { site_url: url, classification: "UNCHECKED" },
  );
  const played = rows.filter(
    (r) => r.stream_started && isRecent(r, sparrow.now),
  ).length;
  const untested = rows.filter((r) => r.classification === "UNCHECKED").length;
  const needsAttention = rows.length - played - untested;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Sparrow home">
          <span className="brand-mark">
            <Icon name="bird" size={26} />
          </span>
          <span>
            Sparrow<span className="brand-caption">STREAM OBSERVATORY</span>
          </span>
        </a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          {NAVIGATION.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? "selected" : ""}`}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => setView(item.id)}
            >
              <Icon name={item.icon} />
              {item.label}
              {item.id === "saved" && (
                <span className="nav-count">{sparrow.sites.length}</span>
              )}
              {item.id === "activity" && sparrow.running && (
                <span className="live-dot" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="tiny-label">A LITTLE MORE CERTAINTY</span>
          <p>Know which source played before you press play.</p>
          <span className="muted">
            Observed, timestamped, and ready to recheck.
          </span>
        </div>
        {sparrow.session?.privateAccess && sparrow.session?.authenticated && (
          <button
            className="button secondary"
            disabled={sparrow.busy}
            onClick={() => sparrow.logout().catch(() => {})}
          >
            Sign out
          </button>
        )}
        <div className="workspace-status">
          <span className="live-dot" />
          {sparrow.session?.privateAccess
            ? "Private workspace"
            : "Local workspace"}
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="breadcrumb">
            Workspace <Icon name="chevron" size={13} />
            <strong>{NAVIGATION.find((item) => item.id === view).label}</strong>
          </span>
          <span className="topbar-note">
            <Icon name="clock" size={14} />
            Playback evidence, not promises
          </span>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <span className="eyebrow">WATCH WITH CONFIDENCE</span>
              <h1>
                {view === "overview"
                  ? "Find your next working stream."
                  : view === "saved"
                    ? "Your watch-page collection."
                    : "A clear view of every check."}
              </h1>
              <p>
                {view === "overview"
                  ? "Recent playback checks, the source to choose, and the details that matter."
                  : view === "saved"
                    ? "Save exact movie, episode, or event pages. Each page keeps its own history."
                    : "Follow progress live. You can leave this page and reconnect at any time."}
              </p>
            </div>
            {sparrow.session?.authenticated && (
              <button
                className="button primary"
                disabled={
                  !sparrow.sites.length || sparrow.running || sparrow.busy
                }
                onClick={() => start()}
              >
                <Icon name="play" size={16} />
                {sparrow.running ? "Check in progress" : "Check all pages"}
              </button>
            )}
          </div>
          {sparrow.error && (
            <div className="error-banner" role="alert">
              <Icon name="alert" />
              {sparrow.error}
              <button className="button subtle" onClick={sparrow.refresh}>
                Retry
              </button>
            </div>
          )}
          {!sparrow.session?.authenticated && sparrow.session ? (
            <form
              className="login-panel panel"
              onSubmit={(event) => {
                event.preventDefault();
                sparrow
                  .login(key)
                  .then(() => setKey(""))
                  .catch(() => {});
              }}
            >
              <span className="eyebrow">PRIVATE ACCESS</span>
              <h2>Welcome to your workspace.</h2>
              <p className="muted">
                Enter the access key configured for this Sparrow instance.
              </p>
              <label htmlFor="access-key">Access key</label>
              <input
                id="access-key"
                type="password"
                autoComplete="current-password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                required
              />
              <button className="button primary" disabled={sparrow.busy}>
                Unlock workspace
              </button>
            </form>
          ) : (
            <>
              {view === "overview" && (
                <>
                  <div className="stats-grid">
                    <div className="stat">
                      <span className="stat-icon mint">
                        <Icon name="check" />
                      </span>
                      <div>
                        <span className="stat-label">Played recently</span>
                        <strong>{played.toString().padStart(2, "0")}</strong>
                        <span className="stat-description">
                          Playback observed within the last hour
                        </span>
                      </div>
                    </div>
                    <div className="stat">
                      <span className="stat-icon amber">
                        <Icon name="alert" />
                      </span>
                      <div>
                        <span className="stat-label">Needs attention</span>
                        <strong>
                          {needsAttention.toString().padStart(2, "0")}
                        </strong>
                        <span className="stat-description">
                          Unverified, unavailable, or due for recheck
                        </span>
                      </div>
                    </div>
                    <div className="stat">
                      <span className="stat-icon neutral">
                        <Icon name="link" />
                      </span>
                      <div>
                        <span className="stat-label">Saved watch pages</span>
                        <strong>
                          {rows.length.toString().padStart(2, "0")}
                        </strong>
                        <span className="stat-description">
                          {untested} waiting for a first check
                        </span>
                      </div>
                    </div>
                  </div>
                  <RunMonitor sparrow={sparrow} compact />
                  <ResultsTable
                    rows={rows}
                    now={sparrow.now}
                    loading={sparrow.loading}
                    onRecheck={(url) => start([url])}
                    disabled={sparrow.running || sparrow.busy}
                    onRefresh={sparrow.refresh}
                    onAdd={() => setView("saved")}
                  />
                  <div className="evidence-note">
                    <Icon name="activity" />
                    <p>
                      <strong>A snapshot, not a guarantee.</strong> Playback is
                      sampled for about 10 seconds per source. Sites can change,
                      streams can expire, and a short check cannot establish
                      long-term reliability.
                    </p>
                  </div>
                </>
              )}
              {view === "saved" && (
                <LinkInput
                  sites={sparrow.sites}
                  add={sparrow.add}
                  remove={sparrow.remove}
                  discover={sparrow.discover}
                  busy={sparrow.busy}
                  onCheck={(url) => start([url])}
                  running={sparrow.running}
                />
              )}
              {view === "activity" && <RunMonitor sparrow={sparrow} />}
            </>
          )}
          <footer className="page-footer">
            <span>
              Sparrow <span className="muted">/ Stream observatory</span>
            </span>
            <span className="muted">
              {sparrow.sites.length} saved pages · up to 3 parallel checks
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
