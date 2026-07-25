import fs from "node:fs/promises";
import { DEFAULTS, RESULT_STATUS } from "./config.js";
import { initDb, writeResult } from "./db.js";
import { classifyResult } from "./classifier.js";
import { createBrowserPool } from "./browsers/pool.js";
import { runWithPlaywright } from "./runners/playwrightRunner.js";
import { runWithPuppeteer } from "./runners/puppeteerRunner.js";
import { normalizeUrl, nowIso, safeNum, formatProbeSummary } from "./utils.js";
import { meetsWorkingTarget } from "./probers/common.js";

function isHardDown(probed) {
  const msg = probed?.error_message ?? "";
  return /CONNECTION_REFUSED|NAME_NOT_RESOLVED|ERR_CONNECTION|ENOTFOUND|ECONNREFUSED/i.test(
    msg
  );
}

function preferProbe(a, b) {
  if (!a) return b;
  if (!b) return a;
  const score = (p) =>
    (Array.isArray(p.working_sources) ? p.working_sources.length * 10 : 0) +
    (p.stream_started || p.working_source ? 16 : 0) +
    (p.stream_url ? 4 : 0) +
    (Array.isArray(p.sources_found) ? Math.min(p.sources_found.length, 3) : 0) +
    (p.player_found ? 2 : 0) +
    (p.is_up ? 1 : 0);
  return score(b) > score(a) ? b : a;
}

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

function abortError(message = "Monitor run aborted") {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function emit(onEvent, event) {
  if (typeof onEvent === "function") onEvent(event);
}

async function probeOnce(site, options, log, signal) {
  log.step(`Launching Playwright probe`);
  const primary = await runWithPlaywright(site, { ...options, log });
  assertNotAborted(signal);
  log.debug(`Playwright finished: ${formatProbeSummary(primary)}`);

  // Exit early only when enough working sources met the reliability target.
  if (meetsWorkingTarget(primary, options)) {
    log.success(`Playwright met working-source target for ${site}`);
    return primary;
  }

  if (isHardDown(primary)) {
    log.warn(`Skipping Puppeteer fallback — hard connectivity failure`);
    return primary;
  }

  if (primary.working_sources?.length) {
    log.step(
      `Playwright found ${primary.working_sources.length}/${primary.target_working ?? "?"} working; trying Puppeteer for more`
    );
  } else {
    log.step(`Playwright found no stream; launching Puppeteer fallback`);
  }
  const fallback = await runWithPuppeteer(site, {
    ...options,
    log,
    siteDeadTimeoutMs: options.fallbackSiteDeadTimeoutMs ?? DEFAULTS.fallbackSiteDeadTimeoutMs,
    streamDetectTimeoutMs:
      options.fallbackStreamDetectTimeoutMs ?? DEFAULTS.fallbackStreamDetectTimeoutMs
  });
  assertNotAborted(signal);
  log.debug(`Puppeteer finished: ${formatProbeSummary(fallback)}`);

  if (meetsWorkingTarget(fallback, options)) {
    log.success(`Puppeteer met working-source target for ${site}`);
    return fallback;
  }

  return preferProbe(primary, fallback);
}

async function probeWithRetry(site, options, log, signal) {
  let lastError = null;
  const maxAttempts = options.retryAttempts + 1;

  for (let attempt = 0; attempt <= options.retryAttempts; attempt += 1) {
    assertNotAborted(signal);
    const attemptNum = attempt + 1;
    try {
      if (attempt > 0) {
        log.step(`Retry ${attemptNum}/${maxAttempts} after hard error`);
      }
      // "No stream" is a valid result — do not burn another full engine cycle.
      return await probeOnce(site, options, log, signal);
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      lastError = err;
      log.warn(`Attempt ${attemptNum} failed: ${err.message}`);
      if (attempt === options.retryAttempts) break;
      log.step(`Retrying ${site} in 1s after error...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
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
    sources_found: [],
    sources_tried: [],
    working_source: null,
    working_sources: [],
    target_working: 1,
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
    sources_found: probed.sources_found ?? [],
    sources_tried: probed.sources_tried ?? [],
    working_source: probed.working_source ?? null,
    working_sources: probed.working_sources ?? [],
    target_working: probed.target_working ?? null,
    error_message: probed.error_message || null,
    engine: probed.engine
  };
}

function formatSourcesCell(row) {
  const workingList = Array.isArray(row.working_sources) ? row.working_sources : [];
  const names = workingList
    .map((w) => w.display_name || w.label)
    .filter(Boolean);
  const tried = Array.isArray(row.sources_tried) ? row.sources_tried.length : 0;
  const target = row.target_working ?? 1;
  if (names.length) {
    return `${names.join(" + ")} (${names.length}/${target})`;
  }
  if (tried) return `0/${target} working (${tried} tried)`;
  return "-";
}

function reportRowsForConsole(rows) {
  return rows.map((r) => ({
    site: r.site_url,
    status: r.classification,
    up: r.is_up ? "yes" : "no",
    stream: r.stream_started ? "started" : "no",
    sources: formatSourcesCell(r),
    http: r.http_status ?? "-",
    ttfb_ms: r.ttfb_ms ? Math.round(r.ttfb_ms) : "-",
    speed_mbps: r.speed_mbps ? r.speed_mbps.toFixed(2) : "-",
    ads: r.ads_artifacts,
    redirects: r.redirects,
    engine: r.engine
  }));
}

function tallyCounts(rows) {
  return rows.reduce(
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
}

/** One DB connection; sync writes stay serialized on the Node event loop. */
function createSerializedWriter(db) {
  return {
    write(row) {
      writeResult(db, row);
    }
  };
}

/**
 * Bounded concurrency pool. Workers stop claiming new sites when aborted;
 * in-flight probes may still finish. Waits for all workers before returning
 * so the caller can safely close the DB.
 */
async function mapPool(items, concurrency, signal, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let hardError = null;

  async function worker() {
    while (true) {
      if (signal?.aborted || hardError) return;
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index], index);
      } catch (err) {
        if (err?.name === "AbortError" || signal?.aborted) return;
        hardError = err;
        throw err;
      }
    }
  }

  const poolSize = Math.max(1, Math.min(concurrency, items.length));
  const settled = await Promise.allSettled(
    Array.from({ length: poolSize }, () => worker())
  );

  if (hardError) throw hardError;

  for (const outcome of settled) {
    if (outcome.status === "rejected" && outcome.reason?.name !== "AbortError") {
      throw outcome.reason;
    }
  }

  return results;
}

export async function runMonitor({
  sitesFile,
  dbPath,
  headless,
  log,
  onEvent,
  signal,
  concurrency
} = {}) {
  const options = {
    ...DEFAULTS,
    headless
  };

  const siteConcurrency = Math.max(
    1,
    Number.isFinite(concurrency) ? concurrency : DEFAULTS.concurrency
  );

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
  log.info(`Concurrency: ${siteConcurrency} (shared browser pool)`);

  emit(onEvent, {
    type: "run_start",
    total: sites.length,
    sites,
    dbPath,
    headless,
    concurrency: siteConcurrency
  });

  const db = initDb(dbPath);
  const writer = createSerializedWriter(db);
  const browserPool = createBrowserPool({ headless });
  const probeOptions = { ...options, browserPool };
  const rowsByIndex = new Array(sites.length);
  const startedAt = Date.now();
  let completed = 0;

  try {
    assertNotAborted(signal);

    await mapPool(sites, siteConcurrency, signal, async (site, index) => {
      assertNotAborted(signal);

      const siteNum = index + 1;
      log.step(`[${siteNum}/${sites.length}] Checking ${site}`);
      emit(onEvent, {
        type: "site_start",
        site,
        index,
        total: sites.length,
        completed
      });

      const siteStartedAt = Date.now();
      const probed = await probeWithRetry(site, probeOptions, log, signal);
      assertNotAborted(signal);

      const classification = classifyResult({
        ...probed,
        maxRedirects: DEFAULTS.maxRedirects,
        maxAdsArtifactsBeforeFlag: DEFAULTS.maxAdsArtifactsBeforeFlag
      });

      const row = buildOutputRow(site, probed, classification);
      writer.write(row);
      rowsByIndex[index] = row;
      completed += 1;

      const elapsedSec = Number(((Date.now() - siteStartedAt) / 1000).toFixed(1));
      log.success(
        `[${completed}/${sites.length}] ${classification} in ${elapsedSec}s (${formatProbeSummary(probed)})`
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
      if (Array.isArray(row.working_sources) && row.working_sources.length) {
        log.debug(
          `  working: ${row.working_sources.map((w) => w.display_name || w.label).join(", ")}`
        );
      } else if (Array.isArray(row.sources_tried) && row.sources_tried.length) {
        log.debug(
          `  sources: ${row.sources_found?.length ?? 0} found, ${row.sources_tried.length} tried, none played`
        );
      }

      emit(onEvent, {
        type: "site_result",
        site,
        index,
        total: sites.length,
        completed,
        elapsedSec,
        row
      });

      return row;
    });

    if (signal?.aborted) throw abortError();
  } catch (err) {
    await browserPool.close().catch(() => null);
    db.close();
    const partial = rowsByIndex.filter(Boolean);
    const aborted = err?.name === "AbortError";
    emit(onEvent, {
      type: "run_done",
      aborted,
      code: 1,
      counts: tallyCounts(partial),
      elapsedSec: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
      error: aborted ? undefined : err.message
    });
    throw err;
  }

  await browserPool.close().catch(() => null);
  db.close();

  const rows = rowsByIndex;
  const totalElapsedSec = Number(((Date.now() - startedAt) / 1000).toFixed(1));
  log.info(`Finished all checks in ${totalElapsedSec}s`);

  const counts = tallyCounts(rows);
  emit(onEvent, {
    type: "run_done",
    aborted: false,
    code: 0,
    counts,
    elapsedSec: totalElapsedSec
  });

  return {
    rows,
    table: reportRowsForConsole(rows),
    counts
  };
}
