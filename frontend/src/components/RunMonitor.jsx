import { useState, useRef, useEffect } from "react";

const STATUS_RE = /\b(WORKING|SLOW|BROKEN|DOWN|REDIRECT-LOOP|TOO-MANY-ADS)\b/g;

const STATUS_COLORS = {
  WORKING: "#2dd4bf",
  SLOW: "#fbbf24",
  BROKEN: "#f97316",
  DOWN: "#ef4444",
  "REDIRECT-LOOP": "#a855f7",
  "TOO-MANY-ADS": "#ec4899",
};

function coloriseLine(line) {
  const parts = [];
  let last = 0;
  let match;
  STATUS_RE.lastIndex = 0;
  while ((match = STATUS_RE.exec(line)) !== null) {
    if (match.index > last) parts.push(line.slice(last, match.index));
    parts.push(
      <span key={match.index} style={{ color: STATUS_COLORS[match[0]], fontWeight: 600 }}>
        {match[0]}
      </span>
    );
    last = match.index + match[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

export default function RunMonitor({ sites, onRunComplete }) {
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState([]);
  const [exitCode, setExitCode] = useState(null);
  const logRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines]);

  async function startRun() {
    setRunning(true);
    setLines([]);
    setExitCode(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        signal: ctrl.signal,
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop();
        for (const part of parts) {
          const line = part.replace(/^data: /, "").trim();
          if (!line) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === "done") {
              setExitCode(msg.code);
              setRunning(false);
              onRunComplete?.();
            } else {
              const text = msg.text ?? "";
              const newLines = text.split("\n").filter(Boolean);
              setLines((prev) => [...prev, ...newLines]);
            }
          } catch {
            /* ignore malformed */
          }
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        setLines((prev) => [...prev, `[error] ${err.message}`]);
      }
      setRunning(false);
    }
  }

  function stopRun() {
    abortRef.current?.abort();
    setRunning(false);
  }

  const canRun = sites.length > 0;

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Controls */}
      <div className="flex items-center gap-3">
        {!running ? (
          <button
            onClick={startRun}
            disabled={!canRun}
            className="flex items-center gap-2 px-5 py-3 rounded-2xl font-semibold text-sm transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            style={
              canRun
                ? {
                    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                    color: "#fff",
                    boxShadow: "0 0 24px #6366f133",
                  }
                : { background: "#1e2d4f", color: "#4a6080" }
            }
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <polygon points="5,3 19,12 5,21" />
            </svg>
            Run Monitor
          </button>
        ) : (
          <button
            onClick={stopRun}
            className="flex items-center gap-2 px-5 py-3 rounded-2xl font-semibold text-sm text-white transition-all duration-200"
            style={{
              background: "linear-gradient(135deg, #ef4444, #dc2626)",
              boxShadow: "0 0 20px #ef444433",
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
            Stop
          </button>
        )}

        {running && (
          <div className="flex items-center gap-2 text-sm text-teal-400">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-400" />
            </span>
            Probing sites…
          </div>
        )}

        {!running && exitCode !== null && (
          <span
            className="text-sm"
            style={{ color: exitCode === 0 ? "#2dd4bf" : "#ef4444" }}
          >
            {exitCode === 0 ? "✓ Completed successfully" : `✗ Exited with code ${exitCode}`}
          </span>
        )}

        {!canRun && !running && (
          <span className="text-xs text-[#2d4060]">Add sites first to run a check</span>
        )}
      </div>

      {/* Terminal log */}
      {lines.length > 0 && (
        <div
          ref={logRef}
          className="mt-4 rounded-xl border border-[#1e2d4f] bg-[#060a14] p-4 h-64 overflow-y-auto font-mono text-xs leading-relaxed"
          style={{ color: "#7dd3fc" }}
        >
          {lines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {coloriseLine(line)}
            </div>
          ))}
          {running && (
            <div className="inline-block w-2 h-3.5 bg-teal-400 animate-pulse ml-0.5" />
          )}
        </div>
      )}
    </div>
  );
}
