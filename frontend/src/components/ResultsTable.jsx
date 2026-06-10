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
  if (val == null) return <span className="text-[#2d4060]">—</span>;
  return `${typeof val === "number" ? val.toFixed(unit === "ms" ? 0 : 1) : val}${unit}`;
}

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
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
            {["Site", "Status", "TTFB", "Speed", "Engine", "Checked"].map((h) => (
              <th
                key={h}
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                style={{ color: "#4a6080" }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map((row) => (
            <tr
              key={row.id}
              className="border-b border-[#0f1628] transition-colors duration-100"
              style={{ background: "transparent" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#0f1628")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <td className="px-4 py-3 max-w-xs">
                <a
                  href={row.site_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-300 hover:text-teal-400 transition-colors duration-150 truncate block"
                  title={row.site_url}
                >
                  {new URL(row.site_url).hostname}
                </a>
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={row.classification} />
              </td>
              <td className="px-4 py-3 text-slate-400">
                {fmt(row.ttfb_ms, "ms")}
              </td>
              <td className="px-4 py-3 text-slate-400">
                {fmt(row.speed_mbps, " Mbps")}
              </td>
              <td className="px-4 py-3">
                <span
                  className="text-xs px-2 py-0.5 rounded font-mono"
                  style={{ background: "#0f1628", color: "#4a6080" }}
                >
                  {row.engine}
                </span>
              </td>
              <td className="px-4 py-3 text-[#4a6080] text-xs whitespace-nowrap">
                {timeAgo(row.checked_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
