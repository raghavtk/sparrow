import { useEffect, useState, useCallback } from "react";

const STATUS_META = {
  WORKING: { color: "#2dd4bf", bg: "#0d2e2a", label: "Working" },
  SLOW: { color: "#fbbf24", bg: "#2a1e08", label: "Slow" },
  BROKEN: { color: "#f97316", bg: "#2a1208", label: "Broken" },
  DOWN: { color: "#ef4444", bg: "#2a0808", label: "Down" },
  "REDIRECT-LOOP": { color: "#a855f7", bg: "#1e0a2a", label: "Redirect Loop" },
  "TOO-MANY-ADS": { color: "#ec4899", bg: "#2a081e", label: "Too Many Ads" },
};

function StatusBadge({ status }) {
  const meta = STATUS_META[status] ?? { color: "#94a3b8", bg: "#1e2d4f", label: status };
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold"
      style={{ color: meta.color, background: meta.bg }}
    >
      {meta.label}
    </span>
  );
}

function fmt(val, unit = "") {
  if (val == null || val === "") return <span className="text-[#2d4060]">—</span>;
  if (typeof val === "number") {
    return `${val.toFixed(unit === "ms" ? 0 : 1)}${unit}`;
  }
  return `${val}${unit}`;
}

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function displayName(source) {
  if (!source) return null;
  if (source.display_name) return source.display_name;
  if (source.label && source.label.toLowerCase() !== "default") return source.label;
  if (source.stream_url) {
    try {
      return `Auto · ${new URL(source.stream_url).hostname}`;
    } catch {
      return "Auto";
    }
  }
  if (source.kind === "default" || source.label === "default") return "Auto";
  return source.label || "Unknown";
}

function workingSummary(row) {
  const working = Array.isArray(row.working_sources)
    ? row.working_sources
    : row.working_source
      ? [row.working_source]
      : [];
  const target = row.target_working ?? 1;
  const names = working.map(displayName).filter(Boolean);
  if (!names.length) {
    const tried = Array.isArray(row.sources_tried) ? row.sources_tried.length : 0;
    return tried ? `0/${target} working` : null;
  }
  return {
    names,
    ratio: `${names.length}/${target}`,
    reliable: names.length >= target && target >= 2,
    partial: names.length > 0 && names.length < target && target > 1,
  };
}

function reliabilityNote(row) {
  const summary = workingSummary(row);
  if (!summary || typeof summary === "string") return null;
  if (summary.reliable) return "Reliable (2+ working)";
  if (summary.partial) return `Partial (${summary.ratio} working)`;
  return null;
}

function attemptOutcome(attempt) {
  if (attempt.error === "click_failed") return { label: "Click failed", color: "#f97316" };
  if (attempt.stream_started) return { label: "Played", color: "#2dd4bf" };
  return { label: "No play", color: "#94a3b8" };
}

function truncateUrl(url, max = 48) {
  if (!url) return null;
  return url.length > max ? `${url.slice(0, max)}…` : url;
}

function WorkingCell({ row }) {
  const summary = workingSummary(row);
  if (!summary) return <span className="text-[#2d4060]">—</span>;
  if (typeof summary === "string") {
    return <span className="text-slate-500 text-xs">{summary}</span>;
  }
  return (
    <div className="min-w-0">
      <div className="text-slate-300 text-xs font-medium truncate" title={summary.names.join(", ")}>
        {summary.names.join(" · ")}
      </div>
      <div className="text-[10px] mt-0.5" style={{ color: summary.reliable ? "#2dd4bf" : "#4a6080" }}>
        {summary.ratio} working
        {summary.reliable ? " · reliable" : summary.partial ? " · partial" : ""}
      </div>
    </div>
  );
}

function SourceBreakdown({ row }) {
  const tried = Array.isArray(row.sources_tried) ? row.sources_tried : [];
  const note = reliabilityNote(row);

  if (!tried.length) {
    return (
      <p className="text-xs text-[#4a6080] px-4 py-3">
        No server attempts recorded for this run.
        {row.error_message ? ` ${row.error_message}` : ""}
      </p>
    );
  }

  return (
    <div className="px-4 pb-4 pt-1">
      {note && (
        <p
          className="text-[11px] mb-2 font-medium"
          style={{ color: note.startsWith("Reliable") ? "#2dd4bf" : "#fbbf24" }}
        >
          {note}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-[#1e2d4f]">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr style={{ background: "#0a0e1a" }}>
              {["Server", "Outcome", "HTTP", "TTFB", "Speed", "Stream"].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 text-left font-semibold uppercase tracking-wider"
                  style={{ color: "#4a6080" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tried.map((attempt, idx) => {
              const outcome = attemptOutcome(attempt);
              const played = Boolean(attempt.stream_started);
              return (
                <tr
                  key={`${displayName(attempt)}-${idx}`}
                  className="border-t border-[#0f1628]"
                  style={{ background: played ? "rgba(45,212,191,0.06)" : "transparent" }}
                >
                  <td className="px-3 py-2 text-slate-200 font-medium whitespace-nowrap">
                    {displayName(attempt)}
                  </td>
                  <td className="px-3 py-2" style={{ color: outcome.color }}>
                    {outcome.label}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{fmt(attempt.http_status)}</td>
                  <td className="px-3 py-2 text-slate-400">
                    {fmt(attempt.ttfb_ms, "ms")}
                  </td>
                  <td className="px-3 py-2 text-slate-400">
                    {fmt(attempt.speed_mbps, " Mbps")}
                  </td>
                  <td className="px-3 py-2 text-[#4a6080] max-w-[14rem] truncate font-mono">
                    {attempt.stream_url ? (
                      <span title={attempt.stream_url}>{truncateUrl(attempt.stream_url)}</span>
                    ) : (
                      <span className="text-[#2d4060]">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {row.stream_url && (
        <p className="mt-2 text-[10px] text-[#2d4060] font-mono truncate" title={row.stream_url}>
          Best stream: {row.stream_url}
        </p>
      )}
    </div>
  );
}

function ResultRow({ row }) {
  const [open, setOpen] = useState(false);
  let hostname = row.site_url;
  try {
    hostname = new URL(row.site_url).hostname;
  } catch {
    // keep raw
  }

  return (
    <>
      <tr
        className="border-b border-[#0f1628] cursor-pointer transition-colors duration-100"
        style={{ background: open ? "#0f1628" : "transparent" }}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.background = "#0c1220";
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = "transparent";
        }}
      >
        <td className="px-3 py-3 w-8 text-[#4a6080]">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            style={{
              transform: open ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 150ms ease",
            }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </td>
        <td className="px-3 py-3 max-w-[11rem]">
          <a
            href={row.site_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-300 hover:text-teal-400 transition-colors duration-150 truncate block"
            title={row.site_url}
            onClick={(e) => e.stopPropagation()}
          >
            {hostname}
          </a>
        </td>
        <td className="px-3 py-3">
          <StatusBadge status={row.classification} />
        </td>
        <td className="px-3 py-3 max-w-[12rem]">
          <WorkingCell row={row} />
        </td>
        <td className="px-3 py-3 text-slate-400 whitespace-nowrap">
          {fmt(row.ttfb_ms, "ms")}
        </td>
        <td className="px-3 py-3 text-slate-400 whitespace-nowrap">
          {fmt(row.speed_mbps, " Mbps")}
        </td>
        <td className="px-3 py-3">
          <span
            className="text-xs px-2 py-0.5 rounded font-mono"
            style={{ background: "#0f1628", color: "#4a6080" }}
          >
            {row.engine}
          </span>
        </td>
        <td className="px-3 py-3 text-[#4a6080] text-xs whitespace-nowrap">
          {timeAgo(row.checked_at)}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-[#0f1628]">
          <td colSpan={8} style={{ background: "#0a0e1a" }}>
            <SourceBreakdown row={row} />
          </td>
        </tr>
      )}
    </>
  );
}

export default function ResultsTable({ refreshTick }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/results");
      const data = await r.json();
      setResults(data.results ?? []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshTick]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-3 text-sm text-[#2d4060]">
        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        Loading results…
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-[#2d4060]">
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="opacity-30"
        >
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="9" y1="21" x2="9" y2="9" />
        </svg>
        <p className="text-sm">No results yet — run a monitor check first</p>
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto rounded-xl border border-[#1e2d4f]">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-[#1e2d4f]" style={{ background: "#0a0e1a" }}>
            <th className="px-3 py-3 w-8" />
            {["Site", "Status", "Working", "TTFB", "Speed", "Engine", "Checked"].map((h) => (
              <th
                key={h}
                className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                style={{ color: "#4a6080" }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map((row) => (
            <ResultRow key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
