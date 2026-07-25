import { DEFAULTS } from "../config.js";
import { sleep, randomFrom, randomInt, isVideoRequest } from "../utils.js";

export function createBaseState() {
  return {
    candidateStream: null,
    playerFound: false,
    streamStarted: false,
    redirects: 0,
    adsArtifacts: 0,
    botProtectionDetected: false,
    errors: [],
    finalUrl: null
  };
}

export function buildTargetCandidates(baseUrl) {
  const candidates = [baseUrl];
  try {
    const u = new URL(baseUrl);
    if (!/watch|movie|stream/i.test(u.pathname)) {
      for (const path of DEFAULTS.commonWatchPaths) {
        candidates.push(`${u.origin}${path}`);
      }
    }
  } catch {
    return candidates;
  }
  return [...new Set(candidates)];
}

export function chooseFingerprint() {
  return {
    userAgent: randomFrom(DEFAULTS.userAgents),
    viewport: randomFrom(DEFAULTS.realisticViewports)
  };
}

export async function humanizeDelay(min = 200, max = 900) {
  await sleep(randomInt(min, max));
}

export function parsePotentialBotProtection(content = "") {
  const lower = content.toLowerCase();
  return (
    lower.includes("checking your browser") ||
    lower.includes("cloudflare") ||
    lower.includes("attention required") ||
    lower.includes("ddos-guard") ||
    lower.includes("just a moment")
  );
}

/** DNS / TCP failures where waiting for a stream cannot help. */
export function isHardNavigationError(message = "") {
  return /NAME_NOT_RESOLVED|ERR_NAME_NOT_RESOLVED|CONNECTION_REFUSED|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_ADDRESS_UNREACHABLE|ENOTFOUND|ECONNREFUSED|NS_ERROR_UNKNOWN_HOST/i.test(
    message
  );
}

/** Adblocker / DevTools noise — not site failures. */
export function isIgnorableRequestFailure(message = "") {
  return /ERR_BLOCKED_BY_CLIENT|ERR_ABORTED|ERR_FAILED/i.test(message);
}

export async function tryAcceptCookies(pageApi) {
  const selectors = [
    "button:has-text('Accept')",
    "button:has-text('I agree')",
    "button:has-text('Agree')",
    "#onetrust-accept-btn-handler",
    ".cookie-accept",
    "[aria-label*='accept' i]"
  ];

  for (const selector of selectors) {
    try {
      if (typeof pageApi.locator === "function") {
        const btn = await pageApi.locator(selector).first();
        if (await btn.isVisible({ timeout: 300 })) {
          await btn.click({ timeout: 800 });
          await humanizeDelay(80, 200);
          return true;
        }
      } else {
        const btn = await pageApi.$(selector);
        if (btn) {
          await btn.click().catch(() => null);
          await humanizeDelay(150, 400);
          return true;
        }
      }
    } catch {
      // ignore single selector failures
    }
  }
  return false;
}

export function attachVideoSniffer(pageLike, state, engineName) {
  const requestStartTimes = new Map();
  const getPropValue = (obj, key) => {
    const candidate = obj?.[key];
    if (typeof candidate === "function") return candidate.call(obj);
    return candidate;
  };

  pageLike.on("request", (req) => {
    const url = getPropValue(req, "url");
    requestStartTimes.set(url, Date.now());
  });

  pageLike.on("response", async (res) => {
    try {
      const url = getPropValue(res, "url");
      const headersCandidate = getPropValue(res, "headers");
      const headers = headersCandidate && typeof headersCandidate.then === "function" ? await headersCandidate : headersCandidate;
      const contentType = headers?.["content-type"] ?? headers?.["Content-Type"] ?? "";
      if (!isVideoRequest(url, contentType)) return;
      if (state.candidateStream) return;

      const start = requestStartTimes.get(url) ?? Date.now();
      const ttfbMs = Date.now() - start;
      const status = getPropValue(res, "status");

      let speedMbps = null;
      try {
        const contentLength = Number(
          headers?.["content-length"] ?? headers?.["Content-Length"] ?? NaN
        );
        // Skip draining huge progressive downloads — that alone can dominate runtime.
        if (Number.isFinite(contentLength) && contentLength > DEFAULTS.sampleDownloadBytes * 4) {
          speedMbps = null;
        } else {
          const readStart = Date.now();
          const bodyBuffer = await Promise.race([
            res.body(),
            sleep(2500).then(() => null)
          ]);
          if (bodyBuffer) {
            const capped = Math.min(bodyBuffer.length, DEFAULTS.sampleDownloadBytes);
            const elapsedSec = Math.max((Date.now() - readStart) / 1000, 0.001);
            speedMbps = (capped * 8) / elapsedSec / 1_000_000;
          }
        }
      } catch {
        // If body cannot be read (stream chunked/cors), keep metric null.
      }

      state.candidateStream = {
        stream_url: url,
        http_status: status,
        ttfb_ms: ttfbMs,
        speed_mbps: speedMbps,
        engine: engineName
      };
    } catch (err) {
      state.errors.push(`Video sniff error: ${err.message}`);
    }
  });
}

export async function waitForStreamSignal(state, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (state.candidateStream) return true;
    await sleep(150);
  }
  return Boolean(state.candidateStream);
}

export async function detectPlayerAndPlayback(page, observeMs = 2000) {
  const playerFound = await page.evaluate(() => {
    const hasVideo = !!document.querySelector("video");
    const hasIframePlayer = !!document.querySelector(
      "iframe[src*='embed'], iframe[src*='player']"
    );
    return hasVideo || hasIframePlayer;
  });

  let streamStarted = false;
  if (playerFound) {
    streamStarted = await page.evaluate(async (maxMs) => {
      const video = document.querySelector("video");
      if (!video) return false;
      try {
        if (video.paused) {
          await video.play().catch(() => null);
        }
      } catch {
        // ignore play error
      }
      const startTime = video.currentTime;
      const deadline = Date.now() + maxMs;
      while (Date.now() < deadline) {
        if (video.currentTime > startTime + 0.2) return true;
        await new Promise((r) => setTimeout(r, 200));
      }
      return video.currentTime > startTime + 0.2;
    }, observeMs);
  }

  return { playerFound, streamStarted };
}
