import { DEFAULTS } from "../config.js";
import { sleep, randomFrom, randomInt, isVideoRequest } from "../utils.js";

export function createBaseState() {
  return {
    candidateStream: null,
    candidateStreams: [],
    sourcesFound: [],
    sourcesTried: [],
    workingSource: null,
    workingSources: [],
    targetWorking: 1,
    playerFound: false,
    streamStarted: false,
    redirects: 0,
    adsArtifacts: 0,
    botProtectionDetected: false,
    errors: [],
    finalUrl: null,
    contentTitle: null
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

/** ≤3 UI servers → 1 working; ≥4 → 2 working. */
export function targetWorkingCount(uiServerCount, cfg = DEFAULTS) {
  const threshold = cfg.dualWorkingServerThreshold ?? DEFAULTS.dualWorkingServerThreshold;
  return uiServerCount <= threshold ? 1 : 2;
}

export function hostFromUrl(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Guess a human title from a watch URL slug (fallback when the page is opaque). */
export function guessTitleFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const skip = new Set([
      "watch",
      "movie",
      "movies",
      "film",
      "title",
      "info",
      "player",
      "pages",
      "stream",
      "embed",
      "watch-movie"
    ]);
    let slug = null;
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const part = decodeURIComponent(parts[i]).replace(/\.(html?|php)$/i, "");
      if (!part || skip.has(part.toLowerCase())) continue;
      if (/^\d+$/.test(part)) continue;
      slug = part;
      break;
    }
    if (!slug) return null;
    // "936075-michael" / "the-matrix-1999"
    slug = slug.replace(/^\d{3,8}[-_]+/, "");
    slug = slug.replace(/[-_+]+/g, " ").replace(/\s+/g, " ").trim();
    if (!slug || slug.length < 2) return null;
    return titleCaseWords(slug).slice(0, 120);
  } catch {
    return null;
  }
}

function titleCaseWords(text) {
  return String(text)
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      if (/^\d{4}$/.test(w)) return w;
      if (w.length <= 2 && w.toLowerCase() !== "a") return w.toLowerCase();
      return w[0].toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

function brandTokensFromUrl(pageUrl) {
  if (!pageUrl) return [];
  try {
    const host = new URL(pageUrl).hostname.replace(/^www\./i, "");
    const base = host.split(".")[0] || "";
    const tokens = new Set([host, base]);
    // flickystream → flicky stream variants
    const spaced = base.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/stream|flix|play|cinema|movies?/gi, "").trim();
    if (spaced) tokens.add(spaced);
    tokens.add(base.replace(/(stream|flix|movies?|play|tv|watch)$/i, ""));
    return [...tokens].filter((t) => t && t.length >= 3);
  } catch {
    return [];
  }
}

/** True when the string is basically the site brand (FlickyStream, Cinezo, …). */
export function isLikelySiteBrand(title, pageUrl) {
  if (!title) return true;
  const compact = title.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!compact) return true;
  for (const brand of brandTokensFromUrl(pageUrl)) {
    const b = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!b || b.length < 3) continue;
    if (compact === b || compact.includes(b) || b.includes(compact)) return true;
  }
  // Generic streaming-site sounding single/double tokens with no year
  if (
    title.split(/\s+/).length <= 2 &&
    /stream|flix|cinema|movies?|watch|play$/i.test(compact) &&
    !/\d{4}/.test(title)
  ) {
    return true;
  }
  return false;
}

export function scoreMovieTitle(title, pageUrl, source = "page") {
  if (!title) return -1;
  if (isLikelySiteBrand(title, pageUrl)) return 0;
  let score = 10;
  if (source === "jsonld") score += 20; // schema.org Movie/TV name is authoritative
  if (source === "url") score += 12;
  if (source === "page") score += 6;
  if (source === "og") score += 8;
  if (/\(\s*(19|20)\d{2}\s*\)/.test(title) || /\b(19|20)\d{2}\b/.test(title)) score += 4;
  if (title.split(/\s+/).length >= 2) score += 2;
  if (title.length >= 2 && title.length <= 80) score += 1;
  // Prefer concise titles over review blurbs
  if (title.length > 80) score -= 8;
  return score;
}

export function cleanContentTitle(raw, pageUrl) {
  if (!raw) return null;
  let t = String(raw).trim().replace(/\s+/g, " ");
  if (!t) return null;

  // Prefer the left side of "Title | Site" / "Title - Site" / "Title — Watch"
  const parts = t.split(/\s+[|\u2013\u2014]\s+|\s+-\s+/);
  if (parts.length > 1) {
    const ranked = parts
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => ({ p, score: scoreMovieTitle(p, pageUrl, "page") }))
      .sort((a, b) => b.score - a.score);
    if (ranked[0]?.score > 0) t = ranked[0].p;
    else t = parts[0].trim();
  }

  t = t.replace(
    /\b(watch(\s+online)?|online\s+free|full\s+movie|streaming|free\s+online|hd)\b/gi,
    ""
  );
  t = t.replace(/\s{2,}/g, " ").replace(/^[\s\-–—|:]+|[\s\-–—|:]+$/g, "");

  try {
    if (pageUrl) {
      const host = new URL(pageUrl).hostname.replace(/^www\./i, "");
      const hostRe = new RegExp(host.replace(/\./g, "\\."), "ig");
      t = t.replace(hostRe, "").replace(/\s{2,}/g, " ").trim();
      for (const brand of brandTokensFromUrl(pageUrl)) {
        const re = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig");
        t = t.replace(re, "").replace(/\s{2,}/g, " ").trim();
      }
    }
  } catch {
    // ignore
  }

  if (!t || /^(home|movies?|watch|streaming)$/i.test(t)) return null;
  if (isLikelySiteBrand(t, pageUrl)) return null;
  return t.slice(0, 120);
}

/**
 * Pull movie/TV name candidates from the rendered DOM:
 * JSON-LD Movie, og:title, h1, poster alt, etc.
 */
async function collectTitleCandidatesFromPage(page, pageUrl) {
  const rawList = await page.evaluate(() => {
    const out = [];
    const push = (value, source) => {
      const s = (value || "").toString().trim();
      if (s) out.push({ value: s, source });
    };

    // schema.org Movie / TVSeries — strongest on-page signal
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent || "null");
        const nodes = Array.isArray(data) ? data : [data];
        for (const node of nodes) {
          if (!node || typeof node !== "object") continue;
          const graph = Array.isArray(node["@graph"]) ? node["@graph"] : [node];
          for (const item of graph) {
            if (!item || typeof item !== "object") continue;
            const type = item["@type"];
            const types = Array.isArray(type) ? type : [type];
            if (types.some((t) => /^(Movie|TVSeries|TVEpisode|VideoObject)$/i.test(String(t)))) {
              push(item.name || item.headline, "jsonld");
            }
          }
        }
      } catch {
        // ignore bad json-ld
      }
    }

    push(document.querySelector('meta[property="og:title"]')?.content, "og");
    push(document.querySelector('meta[name="twitter:title"]')?.content, "og");
    push(document.querySelector('meta[name="title"]')?.content, "og");
    push(document.querySelector('[itemprop="name"]')?.getAttribute("content"), "page");
    push(document.querySelector('[itemprop="name"]')?.textContent, "page");

    for (const h of document.querySelectorAll("h1")) {
      push(h.innerText || h.textContent, "page");
    }
    for (const h of document.querySelectorAll("h2")) {
      const text = (h.innerText || h.textContent || "").trim();
      if (text && text.length <= 80) push(text, "page");
    }

    for (const el of document.querySelectorAll(
      ".movie-title, .film-title, .media-title, .title, [class*='movie-title'], [class*='film-title'], [class*='detail-title']"
    )) {
      push(el.innerText || el.textContent, "page");
    }

    // Poster / hero image alt often is exactly the title
    for (const img of document.querySelectorAll(
      "img[alt], img[class*='poster'], img[class*='Poster']"
    )) {
      const alt = (img.getAttribute("alt") || "").trim();
      if (alt && alt.length >= 2 && alt.length <= 80) push(alt, "page");
    }

    push(document.title, "og");
    return out;
  });

  const scored = [];
  for (const { value, source } of rawList) {
    const cleaned = cleanContentTitle(value, pageUrl);
    if (!cleaned) continue;
    scored.push({
      title: cleaned,
      score: scoreMovieTitle(cleaned, pageUrl, source),
      source
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/** Read movie title from the live page; wait briefly for JS-rendered SPA titles. */
export async function extractContentTitle(page, pageUrl) {
  const fromUrl = guessTitleFromUrl(pageUrl);
  try {
    const deadline = Date.now() + 2_800;
    let best = null;
    while (Date.now() <= deadline) {
      const scored = await collectTitleCandidatesFromPage(page, pageUrl);
      if (scored[0]?.score > 0) {
        best = scored[0].title;
        // json-ld / strong og hit — no need to keep waiting
        if (scored[0].score >= 18) break;
      }
      await sleep(350);
    }
    if (best) return best;
    return fromUrl;
  } catch {
    return fromUrl;
  }
}

/** Capture movie title into probe state — page content first, URL as fallback. */
export async function captureContentTitle(page, state, pageUrl, log) {
  const url = pageUrl || state.finalUrl;
  const fromUrl = guessTitleFromUrl(url) || guessTitleFromUrl(state.finalUrl);
  const fromPage = await extractContentTitle(page, url);

  const candidates = [];
  if (fromPage) {
    candidates.push({ title: fromPage, score: scoreMovieTitle(fromPage, url, "page") + 4 });
  }
  if (fromUrl) {
    candidates.push({ title: fromUrl, score: scoreMovieTitle(fromUrl, url, "url") });
  }
  if (state.contentTitle && !isLikelySiteBrand(state.contentTitle, url)) {
    candidates.push({
      title: state.contentTitle,
      score: scoreMovieTitle(state.contentTitle, url, "page")
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates.find((c) => c.score > 0);
  if (best) state.contentTitle = best.title;

  if (state.contentTitle) {
    log?.debug?.(`Movie title: ${state.contentTitle}`);
  } else {
    log?.debug?.("Movie title: (not found on page or URL)");
  }
  return state.contentTitle;
}

/** Human-facing name — never raw "default". */
export function displayNameForSource({ kind, label, stream_url } = {}) {
  const cleaned = (label || "").trim();
  if (kind === "default" || cleaned.toLowerCase() === "default") {
    const host = hostFromUrl(stream_url);
    return host ? `Auto · ${host}` : "Auto";
  }
  if (cleaned) return cleaned;
  const host = hostFromUrl(stream_url);
  return host || "Unknown";
}

export function pickBestWorking(workingSources = []) {
  if (!workingSources.length) return null;
  const scored = [...workingSources].sort((a, b) => {
    const at = typeof a.ttfb_ms === "number" ? a.ttfb_ms : Number.POSITIVE_INFINITY;
    const bt = typeof b.ttfb_ms === "number" ? b.ttfb_ms : Number.POSITIVE_INFINITY;
    return at - bt;
  });
  return scored[0];
}

export function meetsWorkingTarget(probed, cfg = DEFAULTS) {
  const uiCount = (probed?.sources_found || []).filter((s) => s.kind === "ui").length;
  const target = probed?.target_working ?? targetWorkingCount(uiCount, cfg);
  const working = Array.isArray(probed?.working_sources)
    ? probed.working_sources.length
    : probed?.working_source
      ? 1
      : 0;
  return working >= target;
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

function rememberStream(state, stream, maxCandidates) {
  if (state.candidateStreams.some((s) => s.stream_url === stream.stream_url)) {
    return false;
  }
  if (state.candidateStreams.length >= maxCandidates) return false;
  state.candidateStreams.push(stream);
  if (!state.candidateStream) state.candidateStream = stream;

  if (!state.sourcesFound.some((s) => s.kind === "network" && s.url === stream.stream_url)) {
    const displayName = displayNameForSource({
      kind: "network",
      label: null,
      stream_url: stream.stream_url
    });
    state.sourcesFound.push({
      kind: "network",
      url: stream.stream_url,
      label: displayName,
      display_name: displayName
    });
  }
  return true;
}

export function attachVideoSniffer(pageLike, state, engineName, options = {}) {
  const maxCandidates = options.maxStreamCandidates ?? DEFAULTS.maxStreamCandidates;
  const sampleBodies = options.sampleBodies !== false;
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
      const headers =
        headersCandidate && typeof headersCandidate.then === "function"
          ? await headersCandidate
          : headersCandidate;
      const contentType = headers?.["content-type"] ?? headers?.["Content-Type"] ?? "";
      if (!isVideoRequest(url, contentType)) return;
      if (state.candidateStreams.some((s) => s.stream_url === url)) return;
      if (state.candidateStreams.length >= maxCandidates) return;

      const start = requestStartTimes.get(url) ?? Date.now();
      const ttfbMs = Date.now() - start;
      const status = getPropValue(res, "status");

      let speedMbps = null;
      // Sample a few bodies so multiple working sources can carry Mbps.
      const shouldSample = sampleBodies && state.candidateStreams.length < 4;
      if (shouldSample) {
        try {
          const contentLength = Number(
            headers?.["content-length"] ?? headers?.["Content-Length"] ?? NaN
          );
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
      }

      rememberStream(
        state,
        {
          stream_url: url,
          http_status: status,
          ttfb_ms: ttfbMs,
          speed_mbps: speedMbps,
          engine: engineName
        },
        maxCandidates
      );
    } catch (err) {
      state.errors.push(`Video sniff error: ${err.message}`);
    }
  });
}

/**
 * Wait until at least one stream is known, or a new stream appears after `baselineCount`.
 */
export async function waitForStreamSignal(state, timeoutMs, baselineCount = 0) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (state.candidateStreams.length > baselineCount) return true;
    if (baselineCount === 0 && state.candidateStream) return true;
    await sleep(150);
  }
  return state.candidateStreams.length > baselineCount || Boolean(state.candidateStream);
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

async function resetPlayback(page) {
  try {
    await page.evaluate(() => {
      const video = document.querySelector("video");
      if (!video) return;
      try {
        video.pause();
        video.currentTime = 0;
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }
}

/**
 * Open collapsed Server/Source dropdowns so hidden options become discoverable.
 */
export async function openSourceMenus(page, log) {
  try {
    const clicked = await page.evaluate(() => {
      const triggerRe =
        /servers?|sources?|mirrors?|providers?|select\s*(server|source)|change\s*(server|source)|video\s*server/i;
      const skipRe = /accept|cookie|sign|login|share|download|close|×|✕/i;
      const candidates = [
        ...document.querySelectorAll(
          'button, a, [role="button"], [aria-haspopup], select, summary, .dropdown-toggle, [class*="dropdown"]'
        )
      ];
      let n = 0;
      for (const el of candidates) {
        if (!(el instanceof HTMLElement)) continue;
        if (el.tagName === "SELECT") {
          // Focus select so options exist in DOM for discovery; don't change value yet.
          el.focus();
          n += 1;
          continue;
        }
        const label = (el.innerText || el.getAttribute("aria-label") || el.title || "")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 60);
        if (!label || label.length > 40 || skipRe.test(label)) continue;
        if (!triggerRe.test(label) && !/server|source|mirror|provider/i.test(el.className || "")) {
          continue;
        }
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        try {
          el.click();
          n += 1;
        } catch {
          // ignore
        }
        if (n >= 4) break;
      }
      return n;
    });
    if (clicked) {
      log?.debug?.(`Opened ${clicked} server/source menu trigger(s)`);
      await humanizeDelay(250, 500);
    }
    return clicked;
  } catch {
    return 0;
  }
}

/**
 * Tag visible Server / Source / Mirror-style controls so we can click them later.
 * Includes <select> options and short numbered labels near player chrome.
 */
export async function discoverSourceControls(page, maxControls = 12) {
  try {
    return await page.evaluate((limit) => {
      const labelRe =
        /server|source|mirror|hd\s*\d+|vip|embed|player\s*\d+|option\s*\d+|vidcloud|filemoon|streamtape|dood|mixdrop|mp4upload|upstream|voe|rabbit|luluvdo|supermega|^s\s*\d+$|^server\s*\d+$|^\d+$/i;
      const classRe = /server|source|mirror|embed|provider|host|player-btn|btn-server/i;
      const skipRe =
        /accept|cookie|sign|login|register|subscribe|share|download|trailer|facebook|twitter|reddit|discord|^close$|closing|×|✕|dismiss|cancel|menu|home|search/i;
      const nodes = [
        ...document.querySelectorAll(
          [
            "button",
            "a",
            '[role="tab"]',
            '[role="button"]',
            '[role="option"]',
            "[data-server]",
            "[data-source]",
            "[data-provider]",
            ".server-item",
            ".server-btn",
            ".source-btn",
            ".source-item",
            "[class*='server']",
            "[class*='source']",
            "[class*='mirror']",
            "[class*='provider']",
            "li",
            "select option"
          ].join(",")
        )
      ];
      const seen = new Set();
      const out = [];

      const pushControl = (el, label) => {
        const cleaned = label.trim().replace(/\s+/g, " ").slice(0, 80);
        if (!cleaned || cleaned.length > 40) return;
        if (skipRe.test(cleaned)) return;
        // Bare numbers only if nested under a server/source-ish parent.
        if (/^\d{1,2}$/.test(cleaned)) {
          const parentText = (el.closest("[class*='server'], [class*='source'], [class*='mirror'], [class*='provider'], select, ul, ol")?.className || "") +
            (el.parentElement?.className || "");
          if (!classRe.test(String(parentText)) && el.tagName !== "OPTION") return;
        }
        const className = typeof el.className === "string" ? el.className : "";
        const matchesLabel = labelRe.test(cleaned);
        const matchesClass = classRe.test(className) || el.tagName === "OPTION";
        if (!matchesLabel && !matchesClass) return;
        if (!matchesLabel && matchesClass && cleaned.split(" ").length > 4) return;

        const key = cleaned.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);

        const id = `sparrow-src-${out.length}`;
        el.setAttribute("data-sparrow-source", id);
        out.push({ id, label: cleaned, kind: "ui", display_name: cleaned });
      };

      for (const el of nodes) {
        if (!(el instanceof HTMLElement) && !(el instanceof HTMLOptionElement)) continue;
        if (el instanceof HTMLOptionElement) {
          if (!el.value && !el.textContent?.trim()) continue;
          // Skip placeholder options
          const optLabel = (el.textContent || el.label || el.value || "").trim();
          if (!optLabel || /select|choose|pick/i.test(optLabel)) continue;
          pushControl(el, optLabel);
          if (out.length >= limit) break;
          continue;
        }

        const style = window.getComputedStyle(el);
        // Allow options inside open menus even if briefly visibility-hidden; skip display:none.
        if (style.display === "none") continue;

        const rawLabel =
          el.getAttribute("data-server") ||
          el.getAttribute("data-source") ||
          el.getAttribute("data-provider") ||
          el.getAttribute("aria-label") ||
          el.title ||
          el.innerText ||
          "";
        pushControl(el, rawLabel);
        if (out.length >= limit) break;
      }
      return out;
    }, maxControls);
  } catch {
    return [];
  }
}

async function clickSourceControl(page, controlId) {
  const selector = `[data-sparrow-source="${controlId}"]`;
  try {
    const handled = await page.evaluate((id) => {
      const el = document.querySelector(`[data-sparrow-source="${id}"]`);
      if (!el) return false;
      if (el instanceof HTMLOptionElement) {
        const select = el.parentElement;
        if (select instanceof HTMLSelectElement) {
          select.value = el.value;
          select.dispatchEvent(new Event("input", { bubbles: true }));
          select.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }
      el.click();
      return true;
    }, controlId);
    if (handled) return true;
  } catch {
    // fall through
  }
  try {
    if (typeof page.locator === "function") {
      const el = page.locator(selector).first();
      await el.click({ timeout: 1500 });
      return true;
    }
    const handle = await page.$(selector);
    if (!handle) return false;
    await handle.click();
    return true;
  } catch {
    return false;
  }
}

function pickStreamForAttempt(state, baselineCount) {
  const newer = state.candidateStreams.slice(baselineCount);
  if (newer.length) return newer[newer.length - 1];
  if (state.candidateStreams.length) {
    return state.candidateStreams[state.candidateStreams.length - 1];
  }
  return state.candidateStream;
}

function buildAttemptRecord(attempt, stream, extras = {}) {
  const base = {
    label: attempt.label,
    kind: attempt.kind,
    stream_url: stream?.stream_url ?? null,
    player_found: extras.player_found ?? false,
    stream_started: extras.stream_started ?? false,
    http_status: stream?.http_status ?? null,
    ttfb_ms: stream?.ttfb_ms ?? null,
    speed_mbps: stream?.speed_mbps ?? null,
    ...extras
  };
  base.display_name = displayNameForSource(base);
  return base;
}

/**
 * Try default load, then Server/Source/Mirror UI controls, until enough sources play.
 * targetWorking = 1 if ≤3 UI servers, else 2.
 */
export async function probeSourcesUntilPlay(page, state, cfg, log, startTime) {
  const remainingMs = () => Math.max(0, cfg.siteDeadTimeoutMs - (Date.now() - startTime));
  const maxAttempts = cfg.maxSourceAttempts ?? DEFAULTS.maxSourceAttempts;
  const perAttemptMs = cfg.sourceAttemptTimeoutMs ?? DEFAULTS.sourceAttemptTimeoutMs;

  if (!Array.isArray(state.workingSources)) state.workingSources = [];

  // Aggregators often hide Server 1/2/3 inside a closed dropdown — open first.
  await openSourceMenus(page, log);
  let uiControls = await discoverSourceControls(page, maxAttempts);
  if (uiControls.length === 0) {
    await humanizeDelay(400, 800);
    await openSourceMenus(page, log);
    uiControls = await discoverSourceControls(page, maxAttempts);
  }

  for (const control of uiControls) {
    if (!state.sourcesFound.some((s) => s.kind === "ui" && s.label === control.label)) {
      state.sourcesFound.push({
        kind: "ui",
        label: control.label,
        display_name: control.display_name || control.label,
        url: null
      });
    }
  }

  const uiCount = uiControls.length;
  state.targetWorking = targetWorkingCount(uiCount, cfg);
  log.debug(
    `Found ${uiCount} UI source control(s); target working = ${state.targetWorking}`
  );

  const attempts = [
    { kind: "default", label: "default", clickId: null },
    ...uiControls.map((c) => ({ kind: "ui", label: c.label, clickId: c.id }))
  ].slice(0, maxAttempts);

  for (const attempt of attempts) {
    if (remainingMs() < 2_000) {
      log.debug("Source attempt budget exhausted");
      break;
    }
    if (state.workingSources.length >= state.targetWorking) break;

    // Skip UI controls already recorded as working (same label).
    if (
      attempt.kind === "ui" &&
      state.workingSources.some((w) => w.label === attempt.label)
    ) {
      continue;
    }

    if (attempt.clickId) {
      log.debug(`Trying UI source: ${attempt.label}`);
      await resetPlayback(page);
      const clicked = await clickSourceControl(page, attempt.clickId);
      if (!clicked) {
        state.sourcesTried.push(
          buildAttemptRecord(attempt, null, {
            player_found: false,
            stream_started: false,
            error: "click_failed"
          })
        );
        continue;
      }
      await humanizeDelay(200, 500);
    } else {
      log.debug("Trying Auto source (no UI click)");
      if (state.workingSources.length > 0) await resetPlayback(page);
    }

    const baselineCount = state.candidateStreams.length;
    const requireNewStream = Boolean(attempt.clickId) || state.workingSources.length > 0;
    const streamWaitMs = Math.min(perAttemptMs, remainingMs());
    const streamFound = await waitForStreamSignal(
      state,
      streamWaitMs,
      requireNewStream ? baselineCount : 0
    );
    if (streamFound) {
      const latest = pickStreamForAttempt(state, baselineCount);
      log.debug(
        `Captured stream for ${attempt.label}: ${latest?.stream_url ?? "(unknown)"}`
      );
    } else {
      log.debug(`No new stream for ${attempt.label}`);
    }

    const observeMs = Math.min(2_000, Math.max(800, remainingMs() / 4));
    const { playerFound, streamStarted: playbackAdvanced } = await detectPlayerAndPlayback(
      page,
      observeMs
    );
    const stream = pickStreamForAttempt(state, baselineCount);
    const gotNewStream = state.candidateStreams.length > baselineCount;
    // After the first working source, require a new network stream so we don't
    // count the same already-playing video as a second server.
    const countedWorking = requireNewStream
      ? playbackAdvanced && gotNewStream
      : playbackAdvanced;

    log.debug(
      `Source ${attempt.label}: player=${playerFound ? "yes" : "no"}, playback=${countedWorking ? "started" : "no"}`
    );
    state.playerFound = state.playerFound || playerFound;

    const record = buildAttemptRecord(attempt, stream, {
      player_found: playerFound,
      stream_started: countedWorking
    });
    state.sourcesTried.push(record);

    if (countedWorking) {
      state.streamStarted = true;
      state.candidateStream = stream ?? state.candidateStream;
      const working = {
        label: attempt.label,
        kind: attempt.kind,
        display_name: record.display_name,
        stream_url: stream?.stream_url ?? null,
        http_status: stream?.http_status ?? null,
        ttfb_ms: stream?.ttfb_ms ?? null,
        speed_mbps: stream?.speed_mbps ?? null
      };
      if (
        !state.workingSources.some(
          (w) =>
            (w.label && w.label === working.label) ||
            (w.stream_url && working.stream_url && w.stream_url === working.stream_url)
        )
      ) {
        state.workingSources.push(working);
      }
      state.workingSource = pickBestWorking(state.workingSources);
      log.debug(
        `Working source (${state.workingSources.length}/${state.targetWorking}): ${working.display_name}` +
          (stream?.stream_url ? ` → ${stream.stream_url}` : "")
      );
    }
  }

  state.workingSource = pickBestWorking(state.workingSources);

  return {
    sourcesFound: state.sourcesFound,
    sourcesTried: state.sourcesTried,
    workingSource: state.workingSource,
    workingSources: state.workingSources,
    targetWorking: state.targetWorking
  };
}

/** Shared result object for both runners. */
export function buildProbeResult(state, engine, startTime, cfg) {
  const timedOut = Date.now() - startTime > cfg.siteDeadTimeoutMs;
  const hardDown = state.errors.some((e) => isHardNavigationError(e));
  const navigated =
    Boolean(state.finalUrl) && !/^about:blank/i.test(state.finalUrl || "");
  const isUp = navigated && !hardDown;

  const workingSources = state.workingSources ?? [];
  const winner = pickBestWorking(workingSources) ?? state.workingSource;
  const stream = state.candidateStream;
  const sourcesFound = state.sourcesFound;
  const sourcesTried = state.sourcesTried;
  const targetWorking = state.targetWorking ?? 1;

  let errorMessage = state.errors.join(" | ");
  if (!state.streamStarted && sourcesTried.length > 0) {
    const note = `No working source among ${sourcesTried.length} attempt(s) (${sourcesFound.length} found)`;
    errorMessage = errorMessage ? `${errorMessage} | ${note}` : note;
  } else if (
    state.streamStarted &&
    workingSources.length < targetWorking &&
    targetWorking > 1
  ) {
    const note = `Partial reliability: ${workingSources.length}/${targetWorking} working sources`;
    errorMessage = errorMessage ? `${errorMessage} | ${note}` : note;
  } else if (timedOut && !state.streamStarted) {
    errorMessage = errorMessage || "No player/stream within site timeout";
  }

  return {
    is_up: isUp,
    final_url: state.finalUrl,
    player_found: state.playerFound,
    stream_started: state.streamStarted || workingSources.length > 0,
    stream_url: winner?.stream_url ?? stream?.stream_url ?? null,
    http_status: winner?.http_status ?? stream?.http_status ?? null,
    ttfb_ms: winner?.ttfb_ms ?? stream?.ttfb_ms ?? null,
    speed_mbps: winner?.speed_mbps ?? stream?.speed_mbps ?? null,
    redirects: Math.min(state.redirects, cfg.maxRedirects),
    ads_artifacts: state.adsArtifacts,
    bot_protection_detected: state.botProtectionDetected,
    sources_found: sourcesFound,
    sources_tried: sourcesTried,
    working_source: winner
      ? { ...winner, display_name: displayNameForSource(winner) }
      : null,
    working_sources: workingSources.map((w) => ({
      ...w,
      display_name: displayNameForSource(w)
    })),
    target_working: targetWorking,
    title: state.contentTitle || guessTitleFromUrl(state.finalUrl) || null,
    error_message: errorMessage || null,
    engine
  };
}
