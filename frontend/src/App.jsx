import { useState, useEffect } from "react";
import LinkInput from "./components/LinkInput";
import RunMonitor from "./components/RunMonitor";
import ResultsTable from "./components/ResultsTable";

const TABS = [
  { id: "sites", label: "Sites" },
  { id: "run", label: "Run" },
  { id: "results", label: "Results" },
];

function SparrowLogo() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M16 3C9 3 4 9 4 16s5 13 12 13 12-6 12-13S23 3 16 3z"
        fill="#0f1628"
        stroke="#2dd4bf"
        strokeWidth="1.5"
      />
      <path
        d="M16 8c-2 0-5 2-6 5 1-1 3-1 4 0-2 0-4 2-4 4 1-1 2-1 3-1-1 1-2 3-1 5 1-2 3-3 4-3s3 1 4 3c1-2 0-4-1-5 1 0 2 0 3 1 0-2-2-4-4-4 1-1 3-1 4 0-1-3-4-5-6-5z"
        fill="#2dd4bf"
        opacity="0.85"
      />
      <circle cx="13" cy="13" r="1" fill="#fbbf24" />
    </svg>
  );
}

export default function App() {
  const [tab, setTab] = useState("sites");
  const [sites, setSites] = useState([]);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    fetch("/api/sites")
      .then((r) => r.json())
      .then((d) => setSites(d.sites ?? []))
      .catch(() => {});
  }, []);

  function handleRunComplete() {
    setRefreshTick((t) => t + 1);
    // Don't auto-switch — user stays on Run tab so they can read the output.
    // The Results tab badge will light up to signal new data.
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#060a14" }}>
      {/* Ambient glow */}
      <div
        className="pointer-events-none fixed inset-0 overflow-hidden"
        aria-hidden
      >
        <div
          className="absolute top-[-20%] left-[10%] w-[600px] h-[600px] rounded-full opacity-[0.04]"
          style={{
            background: "radial-gradient(circle, #2dd4bf 0%, transparent 70%)",
          }}
        />
        <div
          className="absolute top-[20%] right-[5%] w-[400px] h-[400px] rounded-full opacity-[0.03]"
          style={{
            background: "radial-gradient(circle, #6366f1 0%, transparent 70%)",
          }}
        />
      </div>

      {/* Header */}
      <header
        className="sticky top-0 z-10 border-b border-[#0f1628]"
        style={{ background: "rgba(6,10,20,0.9)", backdropFilter: "blur(12px)" }}
      >
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center gap-3">
          <SparrowLogo />
          <span className="font-bold text-slate-100 tracking-tight">
            Sparrow
          </span>
          <span className="hidden sm:block text-xs text-[#2d4060] ml-1">
            Stream health monitor
          </span>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Site count pill */}
          <span
            className="text-xs px-2.5 py-1 rounded-full font-medium"
            style={{ background: "#0f1628", color: sites.length ? "#2dd4bf" : "#2d4060" }}
          >
            {sites.length} {sites.length === 1 ? "site" : "sites"}
          </span>
        </div>
      </header>

      {/* Main */}
      <main
        className={`flex-1 mx-auto w-full px-6 py-10 ${
          tab === "results" ? "max-w-5xl" : "max-w-3xl"
        }`}
      >
        {/* Hero */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-slate-100 leading-tight">
            Monitor your{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: "linear-gradient(90deg, #2dd4bf, #6366f1)",
              }}
            >
              streams
            </span>
          </h1>
          <p className="mt-2 text-sm text-[#4a6080] leading-relaxed">
            Add streaming sites, run a health probe, and track results — all
            without leaving this dashboard.
          </p>
        </div>

        {/* Tab bar */}
        <div
          className="flex gap-1 p-1 rounded-xl mb-8 w-fit"
          style={{ background: "#0a0e1a" }}
        >
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="relative px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
              style={
                tab === id
                  ? { color: "#e2e8f0", background: "#161f38" }
                  : { color: "#4a6080" }
              }
            >
              {label}
              {id === "results" && refreshTick > 0 && tab !== "results" && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-teal-400" />
              )}
            </button>
          ))}
        </div>

        {/* Tab content — always mounted, toggled with CSS so state survives tab switches */}
        <div>
          <section style={{ display: tab === "sites" ? "block" : "none" }}>
            <p className="mb-5 text-xs text-[#4a6080] uppercase tracking-widest font-semibold">
              Tracked Sites
            </p>
            <LinkInput sites={sites} onSitesChange={setSites} />
          </section>

          <section style={{ display: tab === "run" ? "block" : "none" }}>
            <p className="mb-5 text-xs text-[#4a6080] uppercase tracking-widest font-semibold">
              Run a check
            </p>
            <RunMonitor sites={sites} onRunComplete={handleRunComplete} />
          </section>

          <section style={{ display: tab === "results" ? "block" : "none" }}>
            <div className="flex items-center justify-between mb-5">
              <p className="text-xs text-[#4a6080] uppercase tracking-widest font-semibold">
                Past Results
              </p>
              <button
                onClick={() => setRefreshTick((t) => t + 1)}
                className="text-xs text-[#4a6080] hover:text-teal-400 flex items-center gap-1.5 transition-colors duration-150"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
                Refresh
              </button>
            </div>
            <ResultsTable refreshTick={refreshTick} />
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#0f1628] py-4">
        <p className="text-center text-xs text-[#1e2d4f]">
          Sparrow — sails into rough waters
        </p>
      </footer>
    </div>
  );
}
