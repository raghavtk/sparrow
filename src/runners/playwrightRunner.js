import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { DEFAULTS } from "../config.js";
import {
  attachVideoSniffer,
  buildProbeResult,
  buildTargetCandidates,
  chooseFingerprint,
  createBaseState,
  humanizeDelay,
  isHardNavigationError,
  parsePotentialBotProtection,
  probeSourcesUntilPlay,
  tryAcceptCookies
} from "../probers/common.js";

chromium.use(StealthPlugin());

async function probeOnPage(page, siteUrl, cfg, log, state, startTime) {
  page.setDefaultNavigationTimeout(cfg.pageNavigationTimeoutMs);
  page.setDefaultTimeout(cfg.pageNavigationTimeoutMs);
  attachVideoSniffer(page, state, "playwright", {
    maxStreamCandidates: cfg.maxStreamCandidates
  });
  let mainNavigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    mainNavigations += 1;
    // Initial load is not a redirect; only subsequent main-frame navigations count.
    if (mainNavigations > 1) state.redirects += 1;
  });
  page.on("popup", async (popup) => {
    state.adsArtifacts += 1;
    log.debug("Playwright closed popup/ad window");
    await popup.close().catch(() => null);
  });
  page.on("requestfailed", (req) => {
    const msg = req.failure()?.errorText ?? "";
    if (isHardNavigationError(msg)) {
      state.errors.push(msg);
    }
  });
  const targets = buildTargetCandidates(siteUrl);
  log.debug(`Playwright will try ${targets.length} URL candidate(s)`);
  for (const candidate of targets) {
    if (Date.now() - startTime > cfg.siteDeadTimeoutMs) {
      log.debug("Playwright hit site timeout; stopping candidate loop");
      break;
    }
    if ((state.workingSources?.length ?? 0) >= (state.targetWorking ?? 1) && state.streamStarted) {
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
      state.finalUrl = page.url();
      log.warn(`Playwright hard navigation failure — fail fast: ${navError}`);
      break;
    }
    await humanizeDelay(100, 350);
    state.finalUrl = page.url();
    log.debug(`Playwright landed on ${state.finalUrl}`);
    if (response) {
      const status = response.status();
      log.debug(`Playwright page HTTP status: ${status}`);
      if (status >= 500) {
        state.errors.push(`Site returned ${status}`);
      }
    }
    const html = await page.content();
    if (parsePotentialBotProtection(html)) {
      state.botProtectionDetected = true;
      log.debug("Playwright detected possible bot protection; waiting before continuing");
      await humanizeDelay(1500, 3000);
    }
    const cookiesAccepted = await tryAcceptCookies(page);
    if (cookiesAccepted) log.debug("Playwright accepted a cookie/consent banner");
    await probeSourcesUntilPlay(page, state, cfg, log, startTime);
    // Enough working sources for this page — skip remaining URL path candidates.
    if ((state.workingSources?.length ?? 0) >= (state.targetWorking ?? 1)) break;
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
    `Playwright viewport ${fingerprint.viewport.width}x${fingerprint.viewport.height}`
  );
  if (cfg.browserPool?.withPlaywrightPage) {
    return cfg.browserPool.withPlaywrightPage(fingerprint, (page) =>
      probeOnPage(page, siteUrl, cfg, log, state, startTime)
    );
  }
  // Standalone fallback (CLI unit use without a pool)
  const browser = await chromium.launch({
    headless: cfg.headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage"
    ]
  });
  const context = await browser.newContext({
    viewport: fingerprint.viewport,
    userAgent: fingerprint.userAgent,
    javaScriptEnabled: true
  });
  const page = await context.newPage();
  try {
    return await probeOnPage(page, siteUrl, cfg, log, state, startTime);
  } finally {
    await context.close().catch(() => null);
    await browser.close().catch(() => null);
  }
}
