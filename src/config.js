export const DEFAULTS = {
  streamDetectTimeoutMs: 30_000,
  siteDeadTimeoutMs: 45_000,
  pageNavigationTimeoutMs: 30_000,
  retryAttempts: 1,
  headless: true,
  sampleDownloadBytes: 1_000_000,
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
