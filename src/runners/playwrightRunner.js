import { chromium } from "playwright";
import { DEFAULTS } from "../config.js";
import { withProbeDeadline } from "../probers/deadline.js";
import {
  attachVideoSniffer,
  buildProbeResult,
  buildTargetCandidates,
  captureContentTitle,
  chooseFingerprint,
  createBaseState,
  humanizeDelay,
  isHardNavigationError,
  parsePotentialBotProtection,
  probeSourcesUntilPlay,
  tryAcceptCookies,
} from "../probers/common.js";

async function probeOnPage(page, siteUrl, cfg, log, state, startTime) {
  page.setDefaultNavigationTimeout(cfg.pageNavigationTimeoutMs);
  page.setDefaultTimeout(cfg.pageNavigationTimeoutMs);
  attachVideoSniffer(page, state, "playwright", {
    maxStreamCandidates: cfg.maxStreamCandidates,
  });
  page.on("request", (request) => {
    if (!request.isNavigationRequest()) return;
    try {
      if (request.frame() === page.mainFrame() && request.redirectedFrom())
        state.redirects += 1;
    } catch {
      /* Requests without a frame do not count as page redirects. */
    }
  });
  page.on("popup", async (popup) => {
    state.adsArtifacts += 1;
    log.debug("Playwright closed popup/ad window");
    await popup.close().catch(() => null);
  });
  page.on("requestfailed", (req) => {
    const msg = req.failure()?.errorText ?? "";
    if (
      req.isNavigationRequest() &&
      req.frame() === page.mainFrame() &&
      isHardNavigationError(msg)
    ) {
      state.errors.push(msg);
      state.navigationErrors.push(msg);
    }
  });
  const targets = buildTargetCandidates(siteUrl);
  log.debug(`Playwright will try ${targets.length} URL candidate(s)`);
  for (const candidate of targets) {
    if (Date.now() - startTime > cfg.siteDeadTimeoutMs) {
      log.debug("Playwright hit site timeout; stopping candidate loop");
      break;
    }
    if (
      (state.workingSources?.length ?? 0) >= (state.targetWorking ?? 1) &&
      state.streamStarted
    ) {
      break;
    }
    log.debug(`Playwright navigating to ${candidate}`);
    let navError = null;
    const response = await page
      .goto(candidate, { waitUntil: "domcontentloaded" })
      .catch((err) => {
        navError = err.message;
        log.debug(`Playwright navigation failed: ${err.message}`);
        return null;
      });
    if (navError && isHardNavigationError(navError)) {
      state.errors.push(navError);
      state.navigationErrors.push(navError);
      state.finalUrl = page.url();
      log.warn(`Playwright hard navigation failure — fail fast: ${navError}`);
      break;
    }
    state.watchPageUrl = response?.url() ?? candidate;
    await humanizeDelay(100, 350);
    state.finalUrl = page.url();
    log.debug(`Playwright landed on ${state.finalUrl}`);
    if (response) {
      const status = response.status();
      state.pageHttpStatus = status;
      log.debug(`Playwright page HTTP status: ${status}`);
      if (status >= 500) {
        state.errors.push(`Site returned ${status}`);
      }
    }
    const html = await page.content();
    if (parsePotentialBotProtection(html)) {
      state.botProtectionDetected = true;
      log.debug(
        "Playwright detected possible bot protection; waiting before continuing",
      );
      await humanizeDelay(1500, 3000);
    }
    const cookiesAccepted = await tryAcceptCookies(page);
    if (cookiesAccepted)
      log.debug("Playwright accepted a cookie/consent banner");
    await captureContentTitle(page, state, candidate, log);
    await probeSourcesUntilPlay(page, state, cfg, log, startTime);
    state.finalUrl = page.url();
    // Enough working sources for this page — skip remaining URL path candidates.
    if ((state.workingSources?.length ?? 0) >= (state.targetWorking ?? 1))
      break;
  }
  return buildProbeResult(state, "playwright", startTime, cfg);
}

export async function runWithPlaywright(siteUrl, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const log = cfg.log ?? { debug() {}, step() {}, warn() {} };
  const state = createBaseState();
  const fingerprint = chooseFingerprint();
  const startTime = Date.now();
  log.debug(
    `Playwright viewport ${fingerprint.viewport.width}x${fingerprint.viewport.height}`,
  );
  if (cfg.browserPool?.withPlaywrightPage) {
    return cfg.browserPool.withPlaywrightPage(fingerprint, (page) =>
      withProbeDeadline(page, state, "playwright", startTime, cfg, () =>
        probeOnPage(page, siteUrl, cfg, log, state, startTime),
      ),
    );
  }
  // Standalone fallback (CLI unit use without a pool)
  const browser = await chromium.launch({
    headless: cfg.headless,
    chromiumSandbox: true,
    executablePath: process.env.SPARROW_BROWSER_EXECUTABLE || undefined,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
    ],
  });
  const context = await browser.newContext({
    viewport: fingerprint.viewport,
    userAgent: fingerprint.userAgent,
    javaScriptEnabled: true,
  });
  const page = await context.newPage();
  try {
    return await withProbeDeadline(
      page,
      state,
      "playwright",
      startTime,
      cfg,
      () => probeOnPage(page, siteUrl, cfg, log, state, startTime),
    );
  } finally {
    await context.close().catch(() => null);
    await browser.close().catch(() => null);
  }
}
