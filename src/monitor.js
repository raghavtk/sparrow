import fs from "node:fs/promises";
import { DEFAULTS, RESULT_STATUS } from "./config.js";
import { initDb, writeResult } from "./db.js";
import { classifyResult } from "./classifier.js";
import { runWithPlaywright } from "./runners/playwrightRunner.js";
import { runWithPuppeteer } from "./runners/puppeteerRunner.js";
import { normalizeUrl, nowIso, safeNum, formatProbeSummary } from "./utils.js";

async function readSitesFile(path) {
  const raw = await fs.readFile(path, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"))
    .map(normalizeUrl)
    .filter(Boolean);
}

async function probeWithRetry(site, options, log) {
  let lastError = null;
  const maxAttempts = options.retryAttempts + 1;

  for (let attempt = 0; attempt <= options.retryAttempts; attempt += 1) {
    const attemptNum = attempt + 1;
    log.step(`Attempt ${attemptNum}/${maxAttempts}: launching Playwright probe`);
    try {
      const primary = await runWithPlaywright(site, { ...options, log });
      log.debug(`Playwright finished: ${formatProbeSummary(primary)}`);
      if (primary.stream_started || primary.stream_url) {
        log.success(`Playwright detected stream activity for ${site}`);
        return primary;
      }

      log.step(`Playwright found no stream; launching Puppeteer fallback`);
      const fallback = await runWithPuppeteer(site, { ...options, log });
      log.debug(`Puppeteer finished: ${formatProbeSummary(fallback)}`);
      if (fallback.stream_started || fallback.stream_url) {
        log.success(`Puppeteer detected stream activity for ${site}`);
        return fallback;
      }

      lastError = new Error(
        `No stream detected on attempt ${attemptNum} (playwright + puppeteer)`
      );
      log.warn(lastError.message);

      if (attempt === options.retryAttempts) {
        return fallback;
      }

      log.step(`Retrying ${site} in 2s...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (err) {
      lastError = err;
      log.warn(`Attempt ${attemptNum} failed: ${err.message}`);
      if (attempt === options.retryAttempts) break;
      log.step(`Retrying ${site} in 2s after error...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  return {
    is_up: false,
    final_url: null,
    player_found: false,
    stream_started: false,
    stream_url: null,
    http_status: null,
    ttfb_ms: null,
    speed_mbps: null,
    redirects: 0,
    ads_artifacts: 0,
    bot_protection_detected: false,
    error_message: `Probe failed after retry: ${lastError?.message ?? "unknown error"}`,
    engine: "none"
  };
}

function buildOutputRow(site, probed, classification) {
  return {
    checked_at: nowIso(),
    site_url: site,
    final_url: probed.final_url,
    classification,
    is_up: probed.is_up,
    http_status: safeNum(probed.http_status),
    ttfb_ms: safeNum(probed.ttfb_ms),
    speed_mbps: safeNum(probed.speed_mbps),
    stream_started: probed.stream_started,
    stream_url: probed.stream_url,
    player_found: probed.player_found,
    redirects: probed.redirects,
    ads_artifacts: probed.ads_artifacts,
    bot_protection_detected: probed.bot_protection_detected,
    error_message: probed.error_message || null,
    engine: probed.engine
  };
}

function reportRowsForConsole(rows) {
  return rows.map((r) => ({
    site: r.site_url,
    status: r.classification,
    up: r.is_up ? "yes" : "no",
    stream: r.stream_started ? "started" : "no",
    http: r.http_status ?? "-",
    ttfb_ms: r.ttfb_ms ? Math.round(r.ttfb_ms) : "-",
    speed_mbps: r.speed_mbps ? r.speed_mbps.toFixed(2) : "-",
    ads: r.ads_artifacts,
    redirects: r.redirects,
    engine: r.engine
  }));
}

export async function runMonitor({ sitesFile, dbPath, headless, log }) {
  const options = {
    ...DEFAULTS,
    headless
  };

  log.info(`Reading sites from ${sitesFile}`);
  const sites = await readSitesFile(sitesFile);
  if (sites.length === 0) {
    throw new Error(`No sites found in ${sitesFile}`);
  }

  log.info(`Loaded ${sites.length} site(s):`);
  sites.forEach((site, index) => {
    log.info(`  ${index + 1}. ${site}`);
  });
  log.info(`Writing results to ${dbPath}`);
  log.info(`Headless mode: ${headless ? "on" : "off"}`);

  const db = initDb(dbPath);
  const rows = [];
  const startedAt = Date.now();

  for (let index = 0; index < sites.length; index += 1) {
    const site = sites[index];
    const siteNum = index + 1;
    log.step(`[${siteNum}/${sites.length}] Checking ${site}`);

    const siteStartedAt = Date.now();
    const probed = await probeWithRetry(site, options, log);

    const classification = classifyResult({
      ...probed,
      maxRedirects: DEFAULTS.maxRedirects,
      maxAdsArtifactsBeforeFlag: DEFAULTS.maxAdsArtifactsBeforeFlag
    });

    const row = buildOutputRow(site, probed, classification);
    writeResult(db, row);
    rows.push(row);

    const elapsedSec = ((Date.now() - siteStartedAt) / 1000).toFixed(1);
    log.success(
      `[${siteNum}/${sites.length}] ${classification} in ${elapsedSec}s (${formatProbeSummary(probed)})`
    );
    if (row.error_message) {
      log.warn(`  note: ${row.error_message}`);
    }
    if (row.final_url && row.final_url !== site) {
      log.debug(`  final URL: ${row.final_url}`);
    }
    if (row.stream_url) {
      log.debug(`  stream URL: ${row.stream_url}`);
    }
  }

  db.close();

  const totalElapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  log.info(`Finished all checks in ${totalElapsedSec}s`);

  const counts = rows.reduce(
    (acc, row) => {
      acc.total += 1;
      if (row.classification === RESULT_STATUS.WORKING) acc.working += 1;
      if (row.classification === RESULT_STATUS.SLOW) acc.slow += 1;
      if (row.classification === RESULT_STATUS.BROKEN) acc.broken += 1;
      if (row.classification === RESULT_STATUS.DOWN) acc.down += 1;
      if (row.classification === RESULT_STATUS.REDIRECT_LOOP) acc.redirectLoop += 1;
      if (row.classification === RESULT_STATUS.TOO_MANY_ADS) acc.tooManyAds += 1;
      return acc;
    },
    {
      total: 0,
      working: 0,
      slow: 0,
      broken: 0,
      down: 0,
      redirectLoop: 0,
      tooManyAds: 0
    }
  );

  return {
    rows,
    table: reportRowsForConsole(rows),
    counts
  };
}
