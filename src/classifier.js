import { RESULT_STATUS } from "./config.js";

export function classifyResult(metrics) {
  if (metrics.redirects >= metrics.maxRedirects) return RESULT_STATUS.REDIRECT_LOOP;
  if (metrics.ads_artifacts >= metrics.maxAdsArtifactsBeforeFlag) {
    return RESULT_STATUS.TOO_MANY_ADS;
  }

  // Connectivity / hard failures only — aggregator "tried N sources, none played" is BROKEN.
  if (!metrics.is_up) return RESULT_STATUS.DOWN;
  if (typeof metrics.http_status === "number" && metrics.http_status >= 500) {
    return RESULT_STATUS.DOWN;
  }

  // Page (or source UI) reachable but no source advanced playback.
  if (!metrics.stream_started) return RESULT_STATUS.BROKEN;

  const slowByTtfb = typeof metrics.ttfb_ms === "number" && metrics.ttfb_ms > 3000;
  const slowBySpeed = typeof metrics.speed_mbps === "number" && metrics.speed_mbps < 1.5;
  if (slowByTtfb || slowBySpeed) return RESULT_STATUS.SLOW;

  return RESULT_STATUS.WORKING;
}
