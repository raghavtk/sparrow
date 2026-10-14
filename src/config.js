export const DEFAULTS = {
  playbackObserveMs: 10_000,
  /** Hard ceiling per engine attempt for one site (room for dual working sources). */
  siteDeadTimeoutMs: 48_000,
  pageNavigationTimeoutMs: 20_000,
  /** Only retries hard thrown errors — "no stream" is not retried. */
  retryAttempts: 1,
  /** Parallel site probes sharing pooled Chromium processes. */
  concurrency: 3,
  headless: true,
  /** Max distinct network stream URLs kept per source attempt. */
  maxStreamCandidates: 8,
  /** Max source attempts (default load + UI Server/Source/Mirror clicks). */
  maxSourceAttempts: 6,
  /** Shorter budget for Puppeteer fallback after Playwright already ran. */
  fallbackSiteDeadTimeoutMs: 30_000,
  /** UI servers ≤ this count need only 1 working source; above need 2. */
  dualWorkingServerThreshold: 3,
  maxRedirects: 10,
  realisticViewports: [
    { width: 1366, height: 768 },
    { width: 1536, height: 864 },
    { width: 1920, height: 1080 },
  ],
  userAgents: [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  ],
};

export const VALID_VIDEO_EXTENSIONS = [".m3u8", ".mp4", ".webm"];

export const RESULT_STATUS = {
  WORKING: "WORKING",
  SLOW: "SLOW",
  BROKEN: "BROKEN",
  REDIRECT_LOOP: "REDIRECT-LOOP",
  TOO_MANY_ADS: "TOO-MANY-ADS",
  DOWN: "DOWN",
};
