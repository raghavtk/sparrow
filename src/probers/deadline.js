import { buildProbeResult } from "./common.js";

/** A page running hostile or unresponsive JavaScript must not occupy a worker forever. */
export async function withProbeDeadline(
  page,
  state,
  engine,
  startTime,
  cfg,
  probe,
) {
  let expired = false;
  const timer = setTimeout(
    () => {
      expired = true;
      page.close().catch(() => null);
    },
    Math.max(1, cfg.siteDeadTimeoutMs - (Date.now() - startTime)),
  );
  try {
    return await probe();
  } catch (err) {
    if (!expired) throw err;
    state.errors.push("Playback check reached its time limit");
    return buildProbeResult(state, engine, startTime, cfg);
  } finally {
    clearTimeout(timer);
  }
}
