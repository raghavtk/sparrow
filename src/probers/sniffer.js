import { DEFAULTS } from "../config.js";
import { isVideoRequest } from "../utils.js";

export function attachVideoSniffer(page, state, engine, options = {}) {
  const requests = new WeakMap();
  const limit = options.maxStreamCandidates ?? DEFAULTS.maxStreamCandidates;
  page.on("request", (request) => {
    let frame = null;
    try {
      frame = request.frame();
    } catch {
      /* service worker */
    }
    requests.set(request, {
      started: Date.now(),
      attemptId: state.activeAttemptId ?? "initial",
      frame,
    });
  });
  page.on("response", async (response) => {
    const request = response.request();
    const observation = requests.get(request);
    if (!observation) return;
    const received = Date.now();
    try {
      const headers = await response.headers();
      const url = response.url();
      // Blob/data responses are local browser reads, not attributable media delivery.
      if (!["http:", "https:"].includes(new URL(url).protocol)) return;
      if (!isVideoRequest(url, headers["content-type"] ?? "")) return;
      const candidates = state.candidateStreams.filter(
        (s) => s.attempt_id === observation.attemptId,
      );
      if (
        candidates.length >= limit ||
        candidates.some(
          (s) => s.stream_url === url && s.frame === observation.frame,
        )
      )
        return;
      const stream = {
        stream_url: url,
        attempt_id: observation.attemptId,
        frame: observation.frame,
        frame_url: observation.frame?.url() ?? null,
        http_status: response.status(),
        ttfb_ms: received - observation.started,
        speed_mbps: null,
        engine,
      };
      state.candidateStreams.push(stream);
      if (
        !state.sourcesFound.some((s) => s.kind === "network" && s.url === url)
      ) {
        state.sourcesFound.push({
          kind: "network",
          url,
          label: new URL(url).hostname,
          display_name: new URL(url).hostname,
        });
      }
    } catch (err) {
      state.errors.push(
        `Media response could not be inspected: ${err.message}`,
      );
    }
  });
}
