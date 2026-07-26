import { useEffect, useState, useCallback } from "react";

const STATUS_META = {
  WORKING: { color: "#2dd4bf", bg: "#0d2e2a", label: "Working" },
  SLOW: { color: "#fbbf24", bg: "#2a1e08", label: "Slow" },
  BROKEN: { color: "#f97316", bg: "#2a1208", label: "Broken" },
  DOWN: { color: "#ef4444", bg: "#2a0808", label: "Down" },
  "REDIRECT-LOOP": { color: "#a855f7", bg: "#1e0a2a", label: "Redirect Loop" },
  "TOO-MANY-ADS": { color: "#ec4899", bg: "#2a081e", label: "Too Many Ads" },
};

const ADS_NOISY_AT = 4;

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

function Chip({ label, color, bg, title }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide whitespace-nowrap"
      style={{ color, background: bg }}
      title={title}
    >
      {label}
    </span>
  );
}

function fmt(val, unit = "") {
  if (val == null || val === "") return <span className="text-[#2d4060]">-</span>;
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

/** Prefer movie name; ignore stored site brands like "FlickyStream". */
function movieNameFromRow(row) {
  const url = row.site_url || row.final_url || "";
  let hostBrand = "";
  try {
    hostBrand = new URL(url).hostname.replace(/^www\./i, "").split(".")[0] || "";
  } catch {
    // ignore
  }
  const looksLikeBrand = (name) => {
    if (!name) return true;
    const compact = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const brand = hostBrand.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (brand && (compact === brand || compact.includes(brand) || brand.includes(compact))) {
      return true;
    }
    return (
      name.split(/\s+/).length <= 2 &&
      /stream|flix|cinema|movies?|watch|play$/i.test(compact) &&
      !/\d{4}/.test(name)
    );
  };

  if (row.title && !looksLikeBrand(row.title)) return row.title;

  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const skip = new Set([
      "watch",
      "movie",
      "movies",
      "film",
      "title",
      "info",
      "player",
      "pages",
      "stream",
      "embed",
      "watch-movie",
    ]);
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      let part = decodeURIComponent(parts[i]).replace(/\.(html?|php)$/i, "");
      if (!part || skip.has(part.toLowerCase()) || /^\d+$/.test(part)) continue;
      part = part.replace(/^\d{3,8}[-_]+/, "").replace(/[-_+]+/g, " ").trim();
      if (part.length < 2) continue;
      return part
        .split(/\s+/)
        .map((w) => (w.length <= 2 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
        .join(" ");
    }
  } catch {
    // ignore
  }
  return row.title && !looksLikeBrand(row.title) ? row.title : null;
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

function adsSignal(row) {
  const n = Number(row.ads_artifacts) || 0;
  if (n <= 0) {
    return {
      short: "Clean",
      detail: "0 popup ads closed",
      color: "#2dd4bf",
      bg: "#0d2e2a",
    };
  }
  if (n < ADS_NOISY_AT) {
    return {
      short: `${n} ads`,
      detail: `${n} popup/ad window(s) closed during probe`,
      color: "#fbbf24",
      bg: "#2a1e08",
    };
  }
  return {
    short: `Noisy · ${n}`,
    detail: `${n} popup/ad windows: page is ad-heavy`,
    color: "#ec4899",
    bg: "#2a081e",
  };
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

function truncateUrl(url, max = 56) {
  if (!url) return null;
  return url.length > max ? `${url.slice(0, max)}…` : url;
}

function WorkingCell({ row }) {
  const summary = workingSummary(row);
  if (!summary) return <span className="text-[#2d4060]">-</span>;
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

function SignalsCell({ row }) {
  const ads = adsSignal(row);
  const redirects = Number(row.redirects) || 0;
  const bot = Boolean(row.bot_protection_detected);
  const player = Boolean(row.player_found);

  return (
    <div className="flex flex-wrap gap-1 max-w-[11rem]">
      <Chip label={ads.short} color={ads.color} bg={ads.bg} title={ads.detail} />
      {redirects > 0 && (
        <Chip
          label={`${redirects} redir`}
          color={redirects >= 10 ? "#a855f7" : "#94a3b8"}
          bg={redirects >= 10 ? "#1e0a2a" : "#0f1628"}
          title={`${redirects} main-frame redirect(s) after load`}
        />
      )}
      {bot && (
        <Chip
          label="Challenge"
          color="#fbbf24"
          bg="#2a1e08"
          title="Access challenge page detected (Cloudflare-style gate)"
        />
      )}
      {!player && (
        <Chip
          label="No player"
          color="#f97316"
          bg="#2a1208"
          title="No video/iframe player found on the page"
        />
      )}
    </div>
  );
}

function ProbeSnapshot({ row }) {
  const ads = adsSignal(row);
  const redirects = Number(row.redirects) || 0;
  const bot = Boolean(row.bot_protection_detected);
  const player = Boolean(row.player_found);
  const note = reliabilityNote(row);
  const tried = Array.isArray(row.sources_tried) ? row.sources_tried.length : 0;
  const found = Array.isArray(row.sources_found) ? row.sources_found.length : 0;
  const working = Array.isArray(row.working_sources)
    ? row.working_sources.length
    : row.working_source
      ? 1
      : 0;
  const target = row.target_working ?? 1;

  const cells = [
    { label: "Ads", value: ads.short, hint: ads.detail, color: ads.color },
    {
      label: "Redirects",
      value: String(redirects),
      hint: redirects ? `${redirects} main-frame navigation(s) after first load` : "No extra redirects",
      color: redirects >= 10 ? "#a855f7" : "#94a3b8",
    },
    {
      label: "Challenge page",
      value: bot ? "Yes" : "No",
      hint: bot
        ? "Access challenge / Cloudflare-style gate detected"
        : "No access challenge detected",
      color: bot ? "#fbbf24" : "#2dd4bf",
    },
    {
      label: "Player",
      value: player ? "Found" : "Missing",
      hint: player ? "Video or embed player present" : "No player element found",
      color: player ? "#2dd4bf" : "#f97316",
    },
    {
      label: "Sources",
      value: `${working}/${target} · ${tried} tried`,
      hint: `${found} discovered, ${tried} attempted, ${working} played (target ${target})`,
      color: working >= target ? "#2dd4bf" : working > 0 ? "#fbbf24" : "#94a3b8",
    },
  ];

  return (
    <div className="mb-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {cells.map((c) => (
          <div
            key={c.label}
            className="rounded-lg border border-[#1e2d4f] px-3 py-2"
            style={{ background: "#060a14" }}
            title={c.hint}
          >
            <div className="text-[10px] uppercase tracking-wider font-semibold text-[#4a6080]">
              {c.label}
            </div>
            <div className="mt-1 text-xs font-semibold" style={{ color: c.color }}>
              {c.value}
            </div>
          </div>
        ))}
      </div>

      {(note || row.error_message) && (
        <div className="mt-2 space-y-1">
          {note && (
            <p
              className="text-[11px] font-medium"
              style={{ color: note.startsWith("Reliable") ? "#2dd4bf" : "#fbbf24" }}
            >
              {note}
            </p>
          )}
          {row.error_message && (
            <p className="text-[11px] text-slate-500 leading-relaxed">
              <span className="text-[#4a6080] font-semibold uppercase tracking-wider mr-1.5">
                Note
              </span>
              {row.error_message}
            </p>
          )}
        </div>
      )}

      {(() => {
        const best =
          (Array.isArray(row.working_sources) && row.working_sources[0]
            ? [...row.working_sources].sort((a, b) => {
                const at = typeof a.ttfb_ms === "number" ? a.ttfb_ms : Infinity;
                const bt = typeof b.ttfb_ms === "number" ? b.ttfb_ms : Infinity;
                return at - bt;
              })[0]
            : null) || row.working_source;
        const name = displayName(best);
        if (!name && !row.stream_url) return null;
        return (
          <div className="mt-2 space-y-1">
            {name && (
              <p className="text-[11px] text-[#4a6080]">
                <span className="font-semibold uppercase tracking-wider mr-1.5">
                  Best server
                </span>
                <span className="text-slate-200 font-semibold">{name}</span>
                {Array.isArray(row.working_sources) && row.working_sources.length > 1 && (
                  <span className="text-slate-500">
                    {" "}
                    · also{" "}
                    {row.working_sources
                      .map(displayName)
                      .filter((n) => n && n !== name)
                      .join(", ")}
                  </span>
                )}
              </p>
            )}
            {row.stream_url && (
              <p className="text-[10px] text-[#2d4060] font-mono truncate" title={row.stream_url}>
                stream file (technical): {truncateUrl(row.stream_url, 72)}
              </p>
            )}
          </div>
        );
      })()}

      {row.final_url && row.final_url !== row.site_url && (
        <p className="mt-1 text-[11px] text-[#4a6080]">
          <span className="font-semibold uppercase tracking-wider mr-1.5">Landed on</span>
          <a
            href={row.final_url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-slate-500 hover:text-teal-400 break-all"
            onClick={(e) => e.stopPropagation()}
          >
            {truncateUrl(row.final_url, 96)}
          </a>
        </p>
      )}
    </div>
  );
}

function SourceBreakdown({ row }) {
  const tried = Array.isArray(row.sources_tried) ? row.sources_tried : [];

  return (
    <div className="px-4 pb-4 pt-2" onClick={(e) => e.stopPropagation()}>
      <ProbeSnapshot row={row} />

      {tried.length === 0 ? (
        <p className="text-xs text-[#4a6080]">
          No server attempts recorded for this run.
        </p>
      ) : (
        <>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-[#4a6080] mb-2">
            Per-server attempts
          </p>
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
                          <span className="text-[#2d4060]">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
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
  const movieName = movieNameFromRow(row);

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
        <td className="px-3 py-3 max-w-[9rem]">
          <div
            className="text-slate-200 text-xs font-semibold truncate"
            title={movieName || undefined}
          >
            {movieName || <span className="text-[#2d4060] font-normal">-</span>}
          </div>
        </td>
        <td className="px-3 py-3 max-w-[10rem]">
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
        <td className="px-3 py-3 max-w-[11rem]">
          <WorkingCell row={row} />
        </td>
        <td className="px-3 py-3">
          <SignalsCell row={row} />
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
          <td colSpan={10} style={{ background: "#0a0e1a" }}>
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
        <p className="text-sm">No results yet. Run a monitor check first.</p>
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto rounded-xl border border-[#1e2d4f]">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-[#1e2d4f]" style={{ background: "#0a0e1a" }}>
            <th className="px-3 py-3 w-8" />
            {["Name", "Site", "Status", "Working", "Signals", "TTFB", "Speed", "Engine", "Checked"].map(
              (h) => (
                <th
                  key={h}
                  className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "#4a6080" }}
                >
                  {h}
                </th>
              )
            )}
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
