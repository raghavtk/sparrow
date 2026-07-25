import Database from "better-sqlite3";
import { nowIso } from "./utils.js";

const SOURCE_COLUMNS = [
  "sources_found",
  "sources_tried",
  "working_source",
  "working_sources",
  "target_working"
];

function ensureSourceColumns(db) {
  const existing = new Set(
    db.prepare(`PRAGMA table_info(health_checks)`).all().map((row) => row.name)
  );
  for (const column of SOURCE_COLUMNS) {
    if (!existing.has(column)) {
      const type = column === "target_working" ? "INTEGER" : "TEXT";
      db.exec(`ALTER TABLE health_checks ADD COLUMN ${column} ${type}`);
    }
  }
}

function toJson(value) {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function initDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS health_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checked_at TEXT NOT NULL,
      site_url TEXT NOT NULL,
      final_url TEXT,
      classification TEXT NOT NULL,
      is_up INTEGER NOT NULL,
      http_status INTEGER,
      ttfb_ms REAL,
      speed_mbps REAL,
      stream_started INTEGER NOT NULL,
      stream_url TEXT,
      player_found INTEGER NOT NULL,
      redirects INTEGER NOT NULL,
      ads_artifacts INTEGER NOT NULL,
      bot_protection_detected INTEGER NOT NULL,
      error_message TEXT,
      engine TEXT NOT NULL,
      sources_found TEXT,
      sources_tried TEXT,
      working_source TEXT,
      working_sources TEXT,
      target_working INTEGER
    );
  `);

  ensureSourceColumns(db);

  return db;
}

export function writeResult(db, result) {
  const stmt = db.prepare(`
    INSERT INTO health_checks (
      checked_at,
      site_url,
      final_url,
      classification,
      is_up,
      http_status,
      ttfb_ms,
      speed_mbps,
      stream_started,
      stream_url,
      player_found,
      redirects,
      ads_artifacts,
      bot_protection_detected,
      error_message,
      engine,
      sources_found,
      sources_tried,
      working_source,
      working_sources,
      target_working
    ) VALUES (
      @checked_at,
      @site_url,
      @final_url,
      @classification,
      @is_up,
      @http_status,
      @ttfb_ms,
      @speed_mbps,
      @stream_started,
      @stream_url,
      @player_found,
      @redirects,
      @ads_artifacts,
      @bot_protection_detected,
      @error_message,
      @engine,
      @sources_found,
      @sources_tried,
      @working_source,
      @working_sources,
      @target_working
    )
  `);

  stmt.run({
    checked_at: result.checked_at ?? nowIso(),
    site_url: result.site_url,
    final_url: result.final_url ?? null,
    classification: result.classification,
    is_up: result.is_up ? 1 : 0,
    http_status: result.http_status ?? null,
    ttfb_ms: result.ttfb_ms ?? null,
    speed_mbps: result.speed_mbps ?? null,
    stream_started: result.stream_started ? 1 : 0,
    stream_url: result.stream_url ?? null,
    player_found: result.player_found ? 1 : 0,
    redirects: result.redirects ?? 0,
    ads_artifacts: result.ads_artifacts ?? 0,
    bot_protection_detected: result.bot_protection_detected ? 1 : 0,
    error_message: result.error_message ?? null,
    engine: result.engine,
    sources_found: toJson(result.sources_found),
    sources_tried: toJson(result.sources_tried),
    working_source: toJson(result.working_source),
    working_sources: toJson(result.working_sources),
    target_working: result.target_working ?? null
  });
}
