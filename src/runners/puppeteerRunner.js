import { addExtra } from "puppeteer-extra";
import puppeteer from "puppeteer";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
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
  isIgnorableRequestFailure,
  parsePotentialBotProtection,
  probeSourcesUntilPlay,
  tryAcceptCookies,
} from "../probers/common.js";

const puppeteerExtra = addExtra(puppeteer);
puppeteerExtra.use(StealthPlugin());

puppeteerExtra.use(
  AdblockerPlugin({
    blockTrackers: true,
  }),
);

async function probeOnPage(
  page,
  _browser,
  siteUrl,
  cfg,
  log,
  state,
  startTime,
) {
  page.setDefaultNavigationTimeout(cfg.pageNavigationTimeoutMs);
  attachVideoSniffer(page, state, "puppeteer", {
    maxStreamCandidates: cfg.maxStreamCandidates,
  });
  page.on("request", (request) => {
    if (!request.isNavigationRequest()) return;
    try {
      if (
        request.frame() === page.mainFrame() &&
        request.redirectChain().length > 0
      )
        state.redirects += 1;
    } catch {
      /* Requests without a frame do not count as page redirects. */
    }
  });
  // Prefer page-scoped popup handling so shared browsers stay isolated.
  if (typeof page.on === "function") {
    page.on("popup", async (popup) => {
      state.adsArtifacts += 1;
      log.debug("Puppeteer closed popup/ad window");
      await popup.close().catch(() => null);
    });
  }
  page.on("requestfailed", (req) => {
    const failure = req.failure()?.errorText ?? "";
    if (!failure || isIgnorableRequestFailure(failure)) return;
    if (
      req.isNavigationRequest() &&
      req.frame() === page.mainFrame() &&
      isHardNavigationError(failure)
    ) {
      state.errors.push(failure);
      state.navigationErrors.push(failure);
    }
  });
  const targets = buildTargetCandidates(siteUrl);
  log.debug(`Puppeteer will try ${targets.length} URL candidate(s)`);
  for (const candidate of targets) {
    if (Date.now() - startTime > cfg.siteDeadTimeoutMs) {
      log.debug("Puppeteer hit site timeout; stopping candidate loop");
      break;
    }
    if (
      (state.workingSources?.length ?? 0) >= (state.targetWorking ?? 1) &&
      state.streamStarted
    ) {
      break;
    }
    log.debug(`Puppeteer navigating to ${candidate}`);
    let navError = null;
    const response = await page
      .goto(candidate, { waitUntil: "domcontentloaded" })
      .catch((err) => {
        navError = err.message;
        log.debug(`Puppeteer navigation failed: ${err.message}`);
        return null;
      });
    if (navError && isHardNavigationError(navError)) {
      state.errors.push(navError);
      state.navigationErrors.push(navError);
      state.finalUrl = page.url();
      log.warn(`Puppeteer hard navigation failure — fail fast: ${navError}`);
      break;
    }
    state.watchPageUrl = response?.url() ?? candidate;
    await humanizeDelay(100, 350);
    state.finalUrl = page.url();
    log.debug(`Puppeteer landed on ${state.finalUrl}`);
    if (response) {
      const status = response.status();
      state.pageHttpStatus = status;
      log.debug(`Puppeteer page HTTP status: ${status}`);
      if (status >= 500) state.errors.push(`Site returned ${status}`);
    }
    const html = await page.content();
    if (parsePotentialBotProtection(html)) {
      state.botProtectionDetected = true;
      log.debug(
        "Puppeteer detected possible bot protection; waiting before continuing",
      );
      await humanizeDelay(1500, 3000);
    }
    const cookiesAccepted = await tryAcceptCookies(page);
    if (cookiesAccepted)
      log.debug("Puppeteer accepted a cookie/consent banner");
    await captureContentTitle(page, state, candidate, log);
    await probeSourcesUntilPlay(page, state, cfg, log, startTime);
    state.finalUrl = page.url();
    if ((state.workingSources?.length ?? 0) >= (state.targetWorking ?? 1))
      break;
  }
  return buildProbeResult(state, "puppeteer", startTime, cfg);
}

export async function runWithPuppeteer(siteUrl, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const log = cfg.log ?? { debug() {}, step() {}, warn() {} };
  const state = createBaseState();
  const fingerprint = chooseFingerprint();
  const startTime = Date.now();
  log.debug(
    `Puppeteer viewport ${fingerprint.viewport.width}x${fingerprint.viewport.height}`,
  );
  if (cfg.browserPool?.withPuppeteerPage) {
    return cfg.browserPool.withPuppeteerPage(fingerprint, (page, browser) =>
      withProbeDeadline(page, state, "puppeteer", startTime, cfg, () =>
        probeOnPage(page, browser, siteUrl, cfg, log, state, startTime),
      ),
    );
  }
  const browser = await puppeteerExtra.launch({
    headless: cfg.headless ? "new" : false,
    defaultViewport: fingerprint.viewport,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
    ],
    executablePath:
      process.env.SPARROW_BROWSER_EXECUTABLE ||
      (await puppeteer.executablePath()),
  });
  const page = await browser.newPage();
  await page.setUserAgent(fingerprint.userAgent);
  try {
    return await withProbeDeadline(
      page,
      state,
      "puppeteer",
      startTime,
      cfg,
      () => probeOnPage(page, browser, siteUrl, cfg, log, state, startTime),
    );
  } finally {
    await browser.close().catch(() => null);
  }
}
