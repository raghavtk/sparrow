export const DEFAULTS = {
  /** Wait for a sniffed m3u8/mp4 request after each navigation. */
  streamDetectTimeoutMs: 18_000,
  /** Hard ceiling per engine attempt for one site. */
  siteDeadTimeoutMs: 35_000,
  pageNavigationTimeoutMs: 20_000,
  /** Only retries hard thrown errors — "no stream" is not retried. */
  retryAttempts: 1,
  /** Parallel site probes sharing pooled Chromium processes. */
  concurrency: 3,
  headless: true,
  /** Cap bytes read when estimating Mbps (avoid draining huge segments). */
  sampleDownloadBytes: 256_000,
  /** Shorter budget for Puppeteer fallback after Playwright already ran. */
  fallbackSiteDeadTimeoutMs: 22_000,
  fallbackStreamDetectTimeoutMs: 12_000,
  maxRedirects: 10,
  maxAdsArtifactsBeforeFlag: 7,
  realisticViewports: [
    { width: 1366, height: 768 },
    { width: 1536, height: 864 },
    { width: 1920, height: 1080 }
  ],
  commonWatchPaths: [
    "/watch-movie/the-matrix-1999",
    "/movie/the-matrix-1999",
    "/watch/the-matrix-1999",
    "/the-matrix-1999"
  ],
  userAgents: [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  ]
};

export const VALID_VIDEO_EXTENSIONS = [".m3u8", ".mp4", ".webm"];

export const RESULT_STATUS = {
  WORKING: "WORKING",
  SLOW: "SLOW",
  BROKEN: "BROKEN",
  REDIRECT_LOOP: "REDIRECT-LOOP",
  TOO_MANY_ADS: "TOO-MANY-ADS",
  DOWN: "DOWN"
};
