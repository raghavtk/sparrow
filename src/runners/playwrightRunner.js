import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
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

chromium.use(StealthPlugin());

export async function runWithPlaywright(siteUrl, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const log = cfg.log ?? { debug() {}, step() {}, warn() {} };
  const state = createBaseState();
  const fingerprint = chooseFingerprint();
  log.debug(
    `Playwright viewport ${fingerprint.viewport.width}x${fingerprint.viewport.height}`
  );

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
  page.setDefaultNavigationTimeout(cfg.pageNavigationTimeoutMs);
  page.setDefaultTimeout(cfg.pageNavigationTimeoutMs);

  const startTime = Date.now();
  attachVideoSniffer(page, state, "playwright");

  page.on("framenavigated", () => {
    state.redirects += 1;
    state.adsArtifacts += 1;
  });

  page.on("popup", async (popup) => {
    state.adsArtifacts += 1;
    log.debug("Playwright closed popup/ad window");
    await popup.close().catch(() => null);
  });

  page.on("requestfailed", (req) => {
    const msg = req.failure()?.errorText ?? "";
    if (/ERR_CONNECTION_REFUSED|NAME_NOT_RESOLVED|TIMED_OUT/i.test(msg)) {
      state.errors.push(msg);
    }
  });

  try {
    const targets = buildTargetCandidates(siteUrl);
    log.debug(`Playwright will try ${targets.length} URL candidate(s)`);
    for (const candidate of targets) {
      if (Date.now() - startTime > cfg.siteDeadTimeoutMs) {
        log.debug("Playwright hit 45s site timeout; stopping candidate loop");
        break;
      }

      log.debug(`Playwright navigating to ${candidate}`);
      const response = await page.goto(candidate, { waitUntil: "domcontentloaded" }).catch((err) => {
        log.debug(`Playwright navigation failed: ${err.message}`);
        return null;
      });
      await humanizeDelay();
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
        await humanizeDelay(3000, 7000);
      }

      const cookiesAccepted = await tryAcceptCookies(page);
      if (cookiesAccepted) log.debug("Playwright accepted a cookie/consent banner");

      log.debug(`Playwright waiting up to ${cfg.streamDetectTimeoutMs}ms for stream request`);
      const streamFound = await waitForStreamSignal(state, cfg.streamDetectTimeoutMs);
      if (streamFound) {
        log.debug(`Playwright captured stream request: ${state.candidateStream.stream_url}`);
      } else {
        log.debug("Playwright did not capture a stream request in time");
      }

      const { playerFound, streamStarted } = await detectPlayerAndPlayback(page);
      log.debug(`Playwright player=${playerFound ? "yes" : "no"}, playback=${streamStarted ? "started" : "no"}`);
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
      engine: "playwright"
    };
  } finally {
    await context.close().catch(() => null);
    await browser.close().catch(() => null);
  }
}
