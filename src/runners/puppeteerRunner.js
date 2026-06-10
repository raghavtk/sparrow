import puppeteerExtra from "puppeteer-extra";
import puppeteer from "puppeteer";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import { DEFAULTS } from "../config.js";
import {
  attachVideoSniffer,
  buildTargetCandidates,
  chooseFingerprint,
  createBaseState,
  detectPlayerAndPlayback,
  humanizeDelay,
  parsePotentialBotProtection,
  tryAcceptCookies,
  waitForStreamSignal
} from "../probers/common.js";

puppeteerExtra.use(StealthPlugin());
puppeteerExtra.use(
  AdblockerPlugin({
    blockTrackers: true
  })
);

export async function runWithPuppeteer(siteUrl, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const log = cfg.log ?? { debug() {}, step() {}, warn() {} };
  const state = createBaseState();
  const fingerprint = chooseFingerprint();
  log.debug(
    `Puppeteer viewport ${fingerprint.viewport.width}x${fingerprint.viewport.height}`
  );

  const browser = await puppeteerExtra.launch({
    headless: cfg.headless ? "new" : false,
    defaultViewport: fingerprint.viewport,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage"
    ],
    executablePath: puppeteer.executablePath()
  });

  const page = await browser.newPage();
  await page.setUserAgent(fingerprint.userAgent);
  page.setDefaultNavigationTimeout(cfg.pageNavigationTimeoutMs);

  const startTime = Date.now();
  attachVideoSniffer(page, state, "puppeteer");

  page.on("framenavigated", () => {
    state.redirects += 1;
    state.adsArtifacts += 1;
  });

  browser.on("targetcreated", async (target) => {
    if (target.type() === "page") {
      const p = await target.page().catch(() => null);
      if (p && p !== page) {
        state.adsArtifacts += 1;
        log.debug("Puppeteer closed popup/ad window");
        await p.close().catch(() => null);
      }
    }
  });

  page.on("requestfailed", (req) => {
    const failure = req.failure();
    if (failure?.errorText) state.errors.push(failure.errorText);
  });

  try {
    const targets = buildTargetCandidates(siteUrl);
    log.debug(`Puppeteer will try ${targets.length} URL candidate(s)`);
    for (const candidate of targets) {
      if (Date.now() - startTime > cfg.siteDeadTimeoutMs) {
        log.debug("Puppeteer hit 45s site timeout; stopping candidate loop");
        break;
      }

      log.debug(`Puppeteer navigating to ${candidate}`);
      const response = await page.goto(candidate, { waitUntil: "domcontentloaded" }).catch((err) => {
        log.debug(`Puppeteer navigation failed: ${err.message}`);
        return null;
      });
      await humanizeDelay();
      state.finalUrl = page.url();
      log.debug(`Puppeteer landed on ${state.finalUrl}`);

      if (response) {
        const status = response.status();
        log.debug(`Puppeteer page HTTP status: ${status}`);
        if (status >= 500) state.errors.push(`Site returned ${status}`);
      }

      const html = await page.content();
      if (parsePotentialBotProtection(html)) {
        state.botProtectionDetected = true;
        log.debug("Puppeteer detected possible bot protection; waiting before continuing");
        await humanizeDelay(3000, 7000);
      }

      const cookiesAccepted = await tryAcceptCookies(page);
      if (cookiesAccepted) log.debug("Puppeteer accepted a cookie/consent banner");

      log.debug(`Puppeteer waiting up to ${cfg.streamDetectTimeoutMs}ms for stream request`);
      const streamFound = await waitForStreamSignal(state, cfg.streamDetectTimeoutMs);
      if (streamFound) {
        log.debug(`Puppeteer captured stream request: ${state.candidateStream.stream_url}`);
      } else {
        log.debug("Puppeteer did not capture a stream request in time");
      }

      const { playerFound, streamStarted } = await detectPlayerAndPlayback(page);
      log.debug(`Puppeteer player=${playerFound ? "yes" : "no"}, playback=${streamStarted ? "started" : "no"}`);
      state.playerFound = state.playerFound || playerFound;
      state.streamStarted = state.streamStarted || streamStarted;

      if (state.candidateStream && state.streamStarted) break;
    }

    state.redirects = Math.min(state.redirects, cfg.maxRedirects);
    const timedOut = Date.now() - startTime > cfg.siteDeadTimeoutMs;
    return {
      is_up: !timedOut && state.errors.every((e) => !/CONNECTION_REFUSED|NAME_NOT_RESOLVED/i.test(e)),
      final_url: state.finalUrl,
      player_found: state.playerFound,
      stream_started: state.streamStarted,
      stream_url: state.candidateStream?.stream_url ?? null,
      http_status: state.candidateStream?.http_status ?? null,
      ttfb_ms: state.candidateStream?.ttfb_ms ?? null,
      speed_mbps: state.candidateStream?.speed_mbps ?? null,
      redirects: state.redirects,
      ads_artifacts: state.adsArtifacts,
      bot_protection_detected: state.botProtectionDetected,
      error_message: timedOut ? "No player/stream within 45s" : state.errors.join(" | "),
      engine: "puppeteer"
    };
  } finally {
    await browser.close().catch(() => null);
  }
}
