import { useState } from "react";

function isValidUrl(str) {
  try {
    const u = new URL(str.startsWith("http") ? str : `https://${str}`);
    return u.hostname.includes(".");
  } catch {
    return false;
  }
}

function normalise(str) {
  const s = str.trim();
  return s.startsWith("http") ? s : `https://${s}`;
}

export default function LinkInput({ sites, onSitesChange }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function persist(next) {
    setSaving(true);
    try {
      await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sites: next }),
      });
      onSitesChange(next);
    } finally {
      setSaving(false);
    }
  }

  function handleAdd(e) {
    e?.preventDefault();
    const url = input.trim();
    if (!url) return;
    if (!isValidUrl(url)) {
      setError("Please enter a valid URL");
      return;
    }
    const norm = normalise(url);
    if (sites.includes(norm)) {
      setError("Already in the list");
      return;
    }
    setError("");
    setInput("");
    persist([...sites, norm]);
  }

  function handleRemove(url) {
    persist(sites.filter((s) => s !== url));
  }

  function handleKey(e) {
    if (e.key === "Enter") handleAdd();
    else setError("");
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Input row */}
      <form onSubmit={handleAdd} className="relative flex items-center gap-3">
        <div className="relative flex-1 group">
          {/* Glow ring */}
          <div
            className="absolute -inset-0.5 rounded-2xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-300"
            style={{
              background:
                "linear-gradient(90deg, #2dd4bf44, #6366f144, #2dd4bf44)",
              filter: "blur(4px)",
            }}
          />
          <div className="relative flex items-center bg-[#0f1628] border border-[#1e2d4f] group-focus-within:border-teal-500/50 rounded-2xl transition-all duration-200 overflow-hidden">
            {/* Link icon */}
            <span className="pl-4 pr-2 text-[#4a6080] shrink-0">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </span>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="https://example.com/movie/550"
              className="flex-1 bg-transparent py-3.5 pr-4 text-slate-100 placeholder-[#2d4060] text-sm outline-none"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={saving || !input.trim()}
          className="shrink-0 relative px-5 py-3.5 rounded-2xl font-semibold text-sm text-[#060a14] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: saving
              ? "#1e2d4f"
              : "linear-gradient(135deg, #2dd4bf, #0ea5e9)",
            boxShadow: saving ? "none" : "0 0 20px #2dd4bf33",
          }}
        >
          {saving ? (
            <svg
              className="animate-spin w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8z"
              />
            </svg>
          ) : (
            "Add"
          )}
        </button>
      </form>

      {/* Error */}
      {error && (
        <p className="mt-2 ml-1 text-xs text-red-400 flex items-center gap-1">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </p>
      )}

      {/* Site chips */}
      {sites.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {sites.map((url) => (
            <li
              key={url}
              className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-[#0f1628] border border-[#1e2d4f] group hover:border-[#243460] transition-colors duration-150"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="shrink-0 w-2 h-2 rounded-full bg-teal-400/60" />
                <span className="text-sm text-slate-300 truncate">{url}</span>
              </div>
              <button
                onClick={() => handleRemove(url)}
                className="shrink-0 p-1 rounded-lg text-[#4a6080] hover:text-red-400 hover:bg-red-400/10 transition-all duration-150 opacity-0 group-hover:opacity-100"
                aria-label="Remove"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {sites.length === 0 && (
        <p className="mt-6 text-center text-sm text-[#2d4060]">
          No sites yet — add one above to start monitoring
        </p>
      )}
    </div>
  );
}
