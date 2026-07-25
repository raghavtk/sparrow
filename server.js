import express from "express";
import { readFileSync, writeFileSync, existsSync } from "fs";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { runMonitor } from "./src/monitor.js";
import { createEventLogger } from "./src/logger.js";
import { DEFAULTS } from "./src/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;

app.use(express.json());
app.use(express.static(join(__dirname, "frontend/dist")));

const SITES_FILE = join(__dirname, "sites.txt");
const DB_FILE = join(__dirname, "results.db");

/** Reject overlapping monitor runs. */
let activeAbort = null;

// GET /api/sites — read and parse sites.txt
app.get("/api/sites", (_req, res) => {
  try {
    const content = readFileSync(SITES_FILE, "utf8");
    const sites = content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    res.json({ sites });
  } catch {
    res.json({ sites: [] });
  }
});

// POST /api/sites — overwrite sites.txt with new list
app.post("/api/sites", (req, res) => {
  const { sites } = req.body;
  if (!Array.isArray(sites)) {
    return res.status(400).json({ error: "sites must be an array" });
  }
  writeFileSync(SITES_FILE, sites.join("\n") + (sites.length ? "\n" : ""), "utf8");
  res.json({ ok: true });
});

// POST /api/run — in-process monitor, stream structured events as SSE
app.post("/api/run", async (req, res) => {
  if (activeAbort) {
    return res.status(409).json({ error: "A monitor run is already in progress" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const abortController = new AbortController();
  activeAbort = abortController;

  const send = (event) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  // Abort only on real client disconnect. Do NOT use req.on("close"):
  // for POST+JSON the request stream closes as soon as the body is read,
  // which was aborting every run immediately (~1s, no DB rows).
  const onClientClose = () => {
    if (!res.writableFinished) {
      abortController.abort();
    }
  };
  res.on("close", onClientClose);

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const concurrency =
    Number.isFinite(body.concurrency) && body.concurrency >= 1
      ? Math.floor(body.concurrency)
      : DEFAULTS.concurrency;
  const headless = body.headless !== false;

  const log = createEventLogger(send);

  try {
    await runMonitor({
      sitesFile: SITES_FILE,
      dbPath: DB_FILE,
      headless,
      concurrency,
      log,
      onEvent: send,
      signal: abortController.signal
    });
    // Backward-compat for UI that still keys off type:"done"
    send({ type: "done", code: 0 });
  } catch (err) {
    const aborted = err?.name === "AbortError" || abortController.signal.aborted;
    if (!aborted) {
      send({
        type: "log",
        level: "error",
        message: err.message,
        text: `[ERR ] ${err.message}`
      });
    }
    send({ type: "done", code: 1, aborted });
  } finally {
    res.off("close", onClientClose);
    activeAbort = null;
    if (!res.writableEnded) res.end();
  }
});

// GET /api/results — latest 200 rows from SQLite
app.get("/api/results", (_req, res) => {
  if (!existsSync(DB_FILE)) return res.json({ results: [] });
  try {
    const db = new Database(DB_FILE, { readonly: true });
    const results = db
      .prepare(
        "SELECT * FROM health_checks ORDER BY checked_at DESC LIMIT 200"
      )
      .all();
    db.close();
    res.json({ results });
  } catch {
    res.json({ results: [] });
  }
});

// SPA fallback — Express 5 requires a named wildcard parameter
app.get("/{*path}", (_req, res) => {
  const dist = join(__dirname, "frontend/dist/index.html");
  if (existsSync(dist)) res.sendFile(dist);
  else res.status(404).send("Run `cd frontend && npm run build` first.");
});

const server = app.listen(PORT, () => {
  console.log(`\n  Sparrow API  →  http://localhost:${PORT}`);
  console.log(
    `  probe build   →  v2-pool-failfast  concurrency=${DEFAULTS.concurrency}\n`
  );
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\n  Port ${PORT} already in use — an old Sparrow API is probably still running.`
    );
    console.error(`  Kill it with:  fuser -k ${PORT}/tcp\n`);
  } else {
    console.error(`Failed to start API:`, err);
  }
  process.exit(1);
});
