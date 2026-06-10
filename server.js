import express from "express";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { spawn } from "child_process";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;

app.use(express.json());
app.use(express.static(join(__dirname, "frontend/dist")));

const SITES_FILE = join(__dirname, "sites.txt");
const DB_FILE = join(__dirname, "results.db");

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

// POST /api/run — spawn CLI, stream output as Server-Sent Events
app.post("/api/run", (_req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const child = spawn(
    "node",
    ["src/index.js", "--sites", "sites.txt", "--db", "results.db"],
    { cwd: __dirname }
  );

  const send = (type, text) =>
    res.write(`data: ${JSON.stringify({ type, text })}\n\n`);

  child.stdout.on("data", (d) => send("stdout", d.toString()));
  child.stderr.on("data", (d) => send("stderr", d.toString()));
  child.on("close", (code) => {
    res.write(`data: ${JSON.stringify({ type: "done", code })}\n\n`);
    res.end();
  });

  req.on("close", () => child.kill());
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

// SPA fallback
app.get("*", (_req, res) => {
  const dist = join(__dirname, "frontend/dist/index.html");
  if (existsSync(dist)) res.sendFile(dist);
  else res.status(404).send("Run `cd frontend && npm run build` first.");
});

app.listen(PORT, () =>
  console.log(`\n  Sparrow API  →  http://localhost:${PORT}\n`)
);
