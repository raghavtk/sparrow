import { createBrowserPool } from "./browsers/pool.js";
import { chooseFingerprint } from "./probers/common.js";
import { genericAdapter } from "./adapters/generic.js";

export async function discoverPages(url, { validateUrl, signal } = {}) {
  const controller = new AbortController();
  const pool = createBrowserPool({
    headless: true,
    validateUrl,
    signal: controller.signal,
  });
  const cancel = () => {
    controller.abort();
    pool.close().catch(() => null);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(cancel, 20_000);
  try {
    if (signal?.aborted) throw new Error("Discovery cancelled");
    return await pool.withPlaywrightPage(chooseFingerprint(), async (page) => {
      page.on("popup", (popup) => popup.close().catch(() => null));
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
      if (response?.status() >= 400)
        throw new Error(`Listing page returned HTTP ${response.status()}`);
      // Allow a bounded interval for client-rendered listing links.
      await page.waitForTimeout(800);
      const pages = await genericAdapter.discoverWatchPages(page);
      return {
        pages,
        final_url: page.url(),
        adapter: genericAdapter.name,
        note: "Discovered links are candidates. Select the intended title, then check playback.",
      };
    });
  } catch (err) {
    if (controller.signal.aborted)
      throw new Error("Discovery timed out or was cancelled");
    throw err;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
    await pool.close();
  }
}
