import { useState } from "react";
import Icon from "./Icon";

export default function LinkInput({
  sites,
  add,
  remove,
  discover,
  busy,
  onCheck,
  running,
}) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("watch");
  const [discovery, setDiscovery] = useState(null);
  async function submit(event) {
    event.preventDefault();
    try {
      if (mode === "listing") setDiscovery(await discover(input.trim()));
      else {
        await add(input.trim());
        setInput("");
      }
    } catch {
      /* App displays the API error. */
    }
  }
  return (
    <div className="saved-content">
      <form className="panel add-panel" onSubmit={submit}>
        <div>
          <span className="eyebrow">ADD TO YOUR COLLECTION</span>
          <h2>One watch page. Every available source.</h2>
          <p className="muted">
            Paste an exact watch-page URL, or discover candidate links from a
            listing.
          </p>
        </div>
        <div className="input-modes" role="group" aria-label="Input mode">
          <button
            type="button"
            className={mode === "watch" ? "active" : ""}
            aria-pressed={mode === "watch"}
            onClick={() => setMode("watch")}
          >
            Watch page
          </button>
          <button
            type="button"
            className={mode === "listing" ? "active" : ""}
            aria-pressed={mode === "listing"}
            onClick={() => setMode("listing")}
          >
            Listing or event page
          </button>
        </div>
        <label htmlFor="watch-url" className="tiny-label">
          {mode === "watch" ? "WATCH-PAGE URL" : "LISTING-PAGE URL"}
        </label>
        <div className="input-row">
          <div className="url-input">
            <Icon name="link" />
            <input
              id="watch-url"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                mode === "watch"
                  ? "https://example.com/watch/title"
                  : "https://example.com/movies"
              }
              autoComplete="off"
              required
            />
          </div>
          <button
            className="button primary"
            disabled={busy || !input.trim() || (mode === "listing" && running)}
          >
            <Icon name={mode === "watch" ? "plus" : "search"} size={16} />
            {busy
              ? "Working…"
              : mode === "watch"
                ? "Save page"
                : "Discover links"}
          </button>
        </div>
        <p className="input-hint">
          HTTP / HTTPS · 30 pages maximum · Private network addresses are
          blocked
        </p>
      </form>
      {discovery && (
        <div className="panel discovery-panel">
          <div className="section-heading">
            <div>
              <h2>{discovery.pages.length} candidate watch links</h2>
              <p>
                Select the intended movie, episode, or event. Discovery does not
                verify playback.
              </p>
            </div>
          </div>
          {discovery.pages.length ? (
            discovery.pages.map((page) => (
              <div className="saved-row" key={page.url}>
                <div className="saved-url">
                  <strong>{page.title}</strong>
                  <span>{page.url}</span>
                </div>
                <button
                  className="button subtle"
                  disabled={busy || sites.includes(page.url)}
                  onClick={() => add(page.url).catch(() => {})}
                >
                  {sites.includes(page.url) ? "Saved" : "Save page"}
                </button>
              </div>
            ))
          ) : (
            <p className="muted">
              No obvious watch links found. Paste an exact watch-page URL
              instead.
            </p>
          )}
        </div>
      )}
      <div className="section-heading">
        <div>
          <h2>
            Saved pages <span className="count-label">{sites.length}</span>
          </h2>
          <p>
            Edits are shared immediately. Check history stays with each URL.
          </p>
        </div>
      </div>
      {!sites.length ? (
        <div className="empty-state panel">
          <Icon name="link" size={32} />
          <h3>Your collection starts here.</h3>
          <p>Save a watch page above, then run its first playback check.</p>
        </div>
      ) : (
        <div className="saved-list">
          {sites.map((url, index) => (
            <div className="saved-row" key={url}>
              <span className="row-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="saved-url">
                <strong>{new URL(url).hostname}</strong>
                <span>{new URL(url).pathname}</span>
              </div>
              <button
                className="button subtle"
                disabled={busy || running}
                onClick={() => onCheck(url)}
              >
                <Icon name="refresh" size={15} />
                Check
              </button>
              <button
                className="icon-button"
                aria-label={`Remove ${url}`}
                disabled={busy}
                onClick={() => remove(url).catch(() => {})}
              >
                <Icon name="close" size={17} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
