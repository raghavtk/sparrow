import { initDb } from "./db.js";

const JSON_FIELDS = [
  "sources_found",
  "sources_tried",
  "working_source",
  "working_sources",
];

export function decodeResult(row) {
  if (!row) return null;
  const result = { ...row };
  for (const field of JSON_FIELDS) {
    try {
      result[field] = JSON.parse(row[field] ?? "null");
    } catch {
      result[field] = null;
    }
  }
  result.sources_found ??= [];
  result.sources_tried ??= [];
  result.working_sources ??= [];
  return result;
}

export function openStore(path, initialSites = []) {
  const db = initDb(path);
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS entries (url TEXT PRIMARY KEY, added_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL,
      finished_at TEXT, sites TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0,
      concurrency INTEGER NOT NULL, error TEXT
    );
    CREATE TABLE IF NOT EXISTS run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_by_run ON run_events(run_id, id);
    CREATE INDEX IF NOT EXISTS checks_by_site ON health_checks(site_url, id DESC);
  `);
  db.transaction(() => {
    if (
      !db.prepare("SELECT 1 FROM settings WHERE key = 'entries_imported'").get()
    ) {
      const insert = db.prepare("INSERT OR IGNORE INTO entries VALUES (?, ?)");
      for (const url of initialSites) insert.run(url, new Date().toISOString());
      db.prepare("INSERT INTO settings VALUES ('entries_imported', '1')").run();
    }
    db.prepare(
      "UPDATE runs SET status = 'interrupted', finished_at = ?, error = 'Server restarted during this run; recheck to continue' WHERE status IN ('running', 'cancelling')",
    ).run(new Date().toISOString());
  })();
  const readRun = (row) =>
    row
      ? {
          ...row,
          sites: JSON.parse(row.sites),
          total: JSON.parse(row.sites).length,
        }
      : null;

  return {
    db,
    sites: () =>
      db
        .prepare("SELECT url FROM entries ORDER BY added_at, url")
        .all()
        .map((r) => r.url),
    add: (url) =>
      db
        .prepare("INSERT OR IGNORE INTO entries VALUES (?, ?)")
        .run(url, new Date().toISOString()),
    remove: (url) => db.prepare("DELETE FROM entries WHERE url = ?").run(url),
    latest: () =>
      db
        .prepare(
          `SELECT h.* FROM health_checks h JOIN
      (SELECT site_url, MAX(id) AS id FROM health_checks GROUP BY site_url) latest ON h.id = latest.id
      JOIN entries e ON e.url = h.site_url ORDER BY h.id DESC`,
        )
        .all()
        .map(decodeResult),
    history: (url) =>
      db
        .prepare(
          "SELECT * FROM health_checks WHERE site_url = ? ORDER BY id DESC LIMIT 30",
        )
        .all(url)
        .map(decodeResult),
    createRun: (run) =>
      db
        .prepare(
          "INSERT INTO runs (id, status, created_at, sites, concurrency) VALUES (@id, 'running', @created_at, @sites, @concurrency)",
        )
        .run({ ...run, sites: JSON.stringify(run.sites) }),
    run: (id) => readRun(db.prepare("SELECT * FROM runs WHERE id = ?").get(id)),
    latestRun: () =>
      readRun(
        db.prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT 1").get(),
      ),
    updateRun: (id, status, completed, error = null) =>
      db
        .prepare(
          "UPDATE runs SET status = ?, completed = ?, error = ?, finished_at = ? WHERE id = ?",
        )
        .run(
          status,
          completed,
          error,
          ["running", "cancelling"].includes(status)
            ? null
            : new Date().toISOString(),
          id,
        ),
    event: (id, event) =>
      Number(
        db
          .prepare("INSERT INTO run_events (run_id, data) VALUES (?, ?)")
          .run(id, JSON.stringify(event)).lastInsertRowid,
      ),
    events: (id, after = 0) =>
      db
        .prepare(
          "SELECT id, data FROM run_events WHERE run_id = ? AND id > ? ORDER BY id",
        )
        .all(id, after),
    close: () => {
      if (db.open) db.close();
    },
  };
}
