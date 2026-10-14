import { RESULT_STATUS } from "./config.js";

export function classifyResult(metrics) {
  if (!metrics.stream_started && metrics.redirects >= metrics.maxRedirects)
    return RESULT_STATUS.REDIRECT_LOOP;
  // Connectivity / hard failures only — aggregator "tried N sources, none played" is BROKEN.
  if (!metrics.is_up) return RESULT_STATUS.DOWN;
  if (!metrics.stream_started && metrics.page_http_status >= 500) {
    return RESULT_STATUS.DOWN;
  }

  // Page (or source UI) reachable but no source advanced playback.
  if (!metrics.stream_started) return RESULT_STATUS.BROKEN;

  const slowByTtfb =
    typeof metrics.ttfb_ms === "number" && metrics.ttfb_ms > 3000;
  if (slowByTtfb) return RESULT_STATUS.SLOW;

  return RESULT_STATUS.WORKING;
}
