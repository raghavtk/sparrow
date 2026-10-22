import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createApp } from "../server.js";
import { runWithPuppeteer } from "../src/runners/puppeteerRunner.js";
import { runWithPlaywright } from "../src/runners/playwrightRunner.js";
import { createBrowserPool } from "../src/browsers/pool.js";
import { classifyResult } from "../src/classifier.js";
import { guardPlaywrightContext, assertPublicUrl } from "../src/security.js";
import { createFixtures } from "./fixtures.mjs";

let browser, fixtures, directory;
const services = [];
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "sparrow-tests-"));
  browser = await chromium.launch({
    executablePath: process.env.SPARROW_BROWSER_EXECUTABLE || undefined,
  });
  fixtures = await createFixtures(browser);
});
after(async () => {
  for (const service of services) {
    await service.close();
    await new Promise((resolve) => service.server.close(resolve));
  }
  await fixtures?.close();
  await browser?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function service(options = {}) {
  const instance = createApp({
    dbPath: join(directory, `results-${services.length}.db`),
    sitesFile: join(directory, "missing.txt"),
    ...options,
  });
  const server = instance.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const result = {
    ...instance,
    server,
    origin: `http://127.0.0.1:${server.address().port}`,
  };
  services.push(result);
  return result;
}
async function api(instance, path, method = "GET", body, headers = {}) {
  const response = await fetch(instance.origin + path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json(),
    headers: response.headers,
  };
}
async function probe(path, extra = {}) {
  const pool = createBrowserPool();
  try {
    return await runWithPlaywright(fixtures.origin + path, {
      browserPool: pool,
      playbackObserveMs: 2000,
      siteDeadTimeoutMs: 18_000,
      ...extra,
    });
  } finally {
    await pool.close();
  }
}
const classify = (row) =>
  classifyResult({ ...row, maxRedirects: 10, maxAdsArtifactsBeforeFlag: 7 });

test("an iframe watch page reports real playback and the iframe's media evidence", async () => {
  const result = await probe("/watch/iframe");
  assert.equal(classify(result), "WORKING");
  assert.equal(result.title, "The Iframe Film");
  assert.ok(result.working_source.playback_seconds >= 0.8);
  assert.equal(
    result.working_source.stream_url,
    fixtures.origin + "/clip.webm",
  );
  assert.equal(result.working_source.frame_url, fixtures.origin + "/player");
});

test("fast source selection finds Server 2 after a dead mirror without inheriting its URL", async () => {
  const result = await probe("/watch/mirrors");
  assert.equal(classify(result), "WORKING");
  assert.equal(result.working_source.label, "Server 2");
  assert.equal(
    result.working_source.stream_url,
    fixtures.origin + "/clip.webm",
  );
  const failed = result.sources_tried.find((a) => a.label === "Server 1");
  assert.deepEqual(
    result.sources_found
      .filter((source) => source.kind === "ui")
      .map((source) => source.label),
    ["Server 1", "Server 2"],
  );
  assert.equal(failed.stream_started, false);
  assert.equal(failed.stream_url, fixtures.origin + "/dead.webm");
  assert.equal(failed.http_status, 404);
});

test("a player that stalls is not recommended as a working source", async () => {
  const result = await probe("/watch/stalled");
  assert.equal(result.player_found, true);
  assert.equal(result.stream_started, false);
  assert.equal(classify(result), "BROKEN");
  assert.ok(result.sources_tried[0].buffering_samples > 0);
});

test("failed ad requests and eight popups do not hide successful content playback", async () => {
  const result = await probe("/watch/ads");
  assert.equal(result.is_up, true);
  assert.equal(classify(result), "WORKING");
  assert.equal(result.ads_artifacts, 8);
});

test("a watch-page HTTP 503 is unavailable, with page status kept separate", async () => {
  const result = await probe("/watch/unavailable", { maxSourceAttempts: 1 });
  assert.equal(classify(result), "DOWN");
  assert.equal(result.page_http_status, 503);
});

test("different server labels and signed URLs do not establish distinct working streams", async () => {
  const result = await probe("/watch/duplicate", { siteDeadTimeoutMs: 24_000 });
  assert.equal(result.target_working, 2);
  assert.equal(result.working_sources.length, 1);
  assert.ok(
    result.sources_tried.filter((attempt) => attempt.stream_started).length > 1,
  );
});

test("private access, unsafe destinations and job limits are enforced through the API", async () => {
  const instance = await service({ token: "test-access-key" });
  assert.equal((await api(instance, "/api/sites")).status, 401);
  assert.equal(
    (await api(instance, "/api/session", "POST", { token: "wrong" })).status,
    401,
  );
  const login = await api(instance, "/api/session", "POST", {
    token: "test-access-key",
  });
  const headers = { Cookie: login.headers.get("set-cookie").split(";")[0] };
  for (const url of [
    "http://127.0.0.1",
    "http://169.254.169.254",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
    "http://[2001::1]",
    "http://[2001:db8::1]",
    "ftp://example.com",
    "https://user:pass@example.com",
    "http://2130706433",
  ]) {
    assert.equal(
      (await api(instance, "/api/sites", "POST", { url }, headers)).status,
      400,
      url,
    );
  }
  assert.equal(
    (
      await api(
        instance,
        "/api/sites",
        "POST",
        { url: "https://8.8.8.8/watch" },
        headers,
      )
    ).status,
    201,
  );
  assert.equal(
    (await api(instance, "/api/runs", "POST", { concurrency: 999 }, headers))
      .status,
    400,
  );
  assert.equal(
    (
      await api(
        instance,
        "/api/runs",
        "POST",
        { sites: Array(31).fill("https://8.8.8.8/watch") },
        headers,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await api(
        instance,
        "/api/sites",
        "DELETE",
        { url: "https://8.8.8.8/watch" },
        { ...headers, Origin: "https://other.example" },
      )
    ).status,
    403,
  );
});

test("shared saved-page edits do not overwrite another person's collection", async () => {
  const instance = await service();
  await Promise.all([
    api(instance, "/api/sites", "POST", { url: "https://8.8.8.8/watch/one" }),
    api(instance, "/api/sites", "POST", { url: "https://1.1.1.1/watch/two" }),
  ]);
  assert.equal((await api(instance, "/api/sites")).body.sites.length, 2);
  await api(instance, "/api/sites", "DELETE", {
    url: "https://8.8.8.8/watch/one",
  });
  assert.deepEqual((await api(instance, "/api/sites")).body.sites, [
    "https://1.1.1.1/watch/two",
  ]);
});

test("browser subrequests to private destinations are blocked while allowed content plays", async () => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    await guardPlaywrightContext(context, async (url) =>
      url.startsWith(fixtures.origin + "/") ? url : assertPublicUrl(url),
    );
    const page = await context.newPage();
    const blocked = [];
    page.on("requestfailed", (request) => blocked.push(request.url()));
    await page.goto(fixtures.origin + "/watch/private-request");
    await page.waitForTimeout(500);
    assert.ok(blocked.includes("http://127.0.0.1:1/private"));
    assert.ok(blocked.includes("http://127.0.0.1:1/redirect-target"));
  } finally {
    await context.close();
  }
});

test("refreshing a running dashboard reconnects, cancellation is explicit, and completed checks show source evidence", async () => {
  const validateUrl = async (url) => {
    if (new URL(url).origin !== fixtures.origin)
      throw new Error("Only the test fixture origin is allowed");
    return new URL(url).href;
  };
  const instance = await service({ validateUrl });
  const url = fixtures.origin + "/watch/iframe";
  await api(instance, "/api/sites", "POST", { url });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  try {
    await page.goto(instance.origin);
    await page
      .getByRole("button", { name: "Check all pages", exact: true })
      .click();
    await page.getByText("Checking playback", { exact: true }).waitFor();
    const running = (await api(instance, "/api/runs/latest")).body.run;
    assert.equal((await api(instance, "/api/runs", "POST", {})).status, 409);
    await page.reload();
    await page
      .getByRole("button", { name: "Cancel check", exact: true })
      .waitFor();
    assert.equal(
      (await api(instance, `/api/runs/${running.id}`)).body.run.status,
      "running",
    );
    await page
      .getByRole("button", { name: "Cancel check", exact: true })
      .click();
    await page
      .getByText("Check cancelled", { exact: true })
      .waitFor({ timeout: 20_000 });
    await page
      .getByRole("button", { name: "Check all pages", exact: true })
      .click();
    await page
      .getByText("Check complete", { exact: true })
      .waitFor({ timeout: 40_000 });
    await page.getByText("The Iframe Film", { exact: true }).waitFor();
    await page.getByText("Playback observed", { exact: true }).last().waitFor();
    await page
      .getByText("Playback evidence & history", { exact: true })
      .click();
    await page
      .getByText("Sustained playback observed", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Load check history", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Refresh check history", exact: true })
      .waitFor();
    assert.equal((await api(instance, "/api/results")).body.results.length, 1);
    assert.equal(
      (await api(instance, `/api/history?url=${encodeURIComponent(url)}`)).body
        .results.length,
      1,
    );
    await page
      .getByRole("button", { name: "Check all pages", exact: true })
      .click();
    await page.getByText("Checking playback", { exact: true }).waitFor();
    await page
      .getByText("Check complete", { exact: true })
      .waitFor({ timeout: 40_000 });
    assert.equal((await api(instance, "/api/results")).body.results.length, 1);
    assert.equal(
      (await api(instance, `/api/history?url=${encodeURIComponent(url)}`)).body
        .results.length,
      2,
    );
    await page
      .getByRole("textbox", { name: "Search watch pages" })
      .fill("a different title");
    await page
      .getByText("No pages match these filters.", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await page.getByText("The Iframe Film", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("link", { name: "Open watch page", exact: true })
        .getAttribute("href"),
      url,
    );
    // Reloading completed results should not replay logs or poll every few seconds.
    const idleRequests = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        idleRequests.push(new URL(request.url()).pathname);
    });
    await page.reload();
    await page.getByText("The Iframe Film", { exact: true }).waitFor();
    await page.waitForTimeout(500);
    assert.ok(!idleRequests.some((path) => path.endsWith("/events")));
    idleRequests.length = 0;
    await page.waitForTimeout(6000);
    assert.deepEqual(
      idleRequests,
      [],
      "Idle results should remain quiet between refreshes",
    );
    await page.getByRole("button", { name: "Activity", exact: true }).click();
    await page.getByText("Check complete", { exact: true }).waitFor();
    await page.waitForTimeout(500);
    assert.ok(idleRequests.some((path) => path.endsWith("/events")));
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    assert.deepEqual(consoleErrors, []);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  } finally {
    await page.close();
  }
});

test("listing discovery offers intended watch pages for selection without saving or probing unrelated links", async () => {
  const instance = await service({
    validateUrl: async (url) => {
      if (new URL(url).origin !== fixtures.origin)
        throw new Error("Only the test fixture is allowed");
      return new URL(url).href;
    },
  });
  const result = await api(instance, "/api/discover", "POST", {
    url: fixtures.origin + "/catalog",
  });
  assert.equal(result.status, 200);
  assert.deepEqual(
    result.body.pages.map((page) => page.title),
    ["The Iframe Film", "Fast Mirror Film"],
  );
  assert.equal((await api(instance, "/api/sites")).body.sites.length, 0);
  assert.ok(!fixtures.requests.some((path) => path.includes("matrix")));
  await api(instance, "/api/sites", "POST", { url: result.body.pages[0].url });
  assert.deepEqual((await api(instance, "/api/sites")).body.sites, [
    fixtures.origin + "/watch/iframe",
  ]);
});

test("an unresponsive page releases its browser worker at the configured deadline", async () => {
  const started = Date.now();
  const result = await probe("/watch/unresponsive", {
    siteDeadTimeoutMs: 2500,
  });
  assert.equal(result.stream_started, false);
  assert.match(result.error_message, /time limit/i);
  assert.ok(
    Date.now() - started < 8000,
    "The browser worker must not stay occupied indefinitely",
  );
});

test("a playable source with delayed media response is reported as slow without a fabricated speed", async () => {
  const result = await probe("/watch/slow", { playbackObserveMs: 8000 });
  assert.equal(result.stream_started, true);
  assert.equal(classify(result), "SLOW");
  assert.equal(result.speed_mbps, null);
  assert.ok(result.ttfb_ms >= 3000);
});

test("a saved page with malformed title escaping renders an honest fallback without crashing the dashboard", async () => {
  const instance = await service({
    validateUrl: async (url) => new URL(url).href,
  });
  await api(instance, "/api/sites", "POST", {
    url: fixtures.origin + "/watch/%ZZ",
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(instance.origin);
    await page
      .getByRole("heading", { name: "Title not identified", exact: true })
      .waitFor();
    assert.deepEqual(errors, []);
    assert.equal(
      await page
        .getByRole("link", { name: "Open watch page", exact: true })
        .getAttribute("href"),
      fixtures.origin + "/watch/%ZZ",
    );
  } finally {
    await page.close();
  }
});

test("playback after the watch page navigates to unrelated content is not recommended for the original title", async () => {
  const result = await probe("/watch/navigation-ad");
  assert.equal(result.stream_started, false);
  assert.equal(result.working_source, null);
  assert.equal(result.final_url, fixtures.origin + "/advertisement");
  assert.ok(
    result.sources_tried.some((attempt) => attempt.outcome === "page_changed"),
  );
});

test("unattributed iframe playback cannot inherit another frame's media URL or response metrics", async () => {
  const result = await probe("/watch/unattributed");
  assert.equal(result.stream_started, false);
  assert.ok(
    result.sources_tried[0].playback_seconds >= 0.8,
    "The real iframe video advanced",
  );
  assert.equal(result.sources_tried[0].outcome, "attribution_unverified");
  assert.equal(result.stream_url, null);
  assert.equal(result.http_status, null);
  assert.equal(result.ttfb_ms, null);
});

test("a marked advertising iframe cannot qualify a stalled content player as working", async () => {
  const result = await probe("/watch/embedded-ad");
  assert.equal(result.player_found, true);
  assert.equal(result.stream_started, false);
  assert.equal(result.working_source, null);
  assert.equal(result.http_status, null);
});

test("signing out revokes a copied session cookie without revoking another browser", async () => {
  const instance = await service({ token: "private-fixture-key" });
  const signIn = async () => {
    const login = await api(instance, "/api/session", "POST", {
      token: "private-fixture-key",
    });
    return { Cookie: login.headers.get("set-cookie").split(";")[0] };
  };
  const first = await signIn();
  const second = await signIn();
  assert.equal(
    (await api(instance, "/api/sites", "GET", undefined, first)).status,
    200,
  );
  const logout = await api(
    instance,
    "/api/session",
    "DELETE",
    undefined,
    first,
  );
  assert.equal(logout.status, 200);
  assert.equal(logout.body.authenticated, false);
  assert.match(logout.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/);
  assert.equal(
    (await api(instance, "/api/sites", "GET", undefined, first)).status,
    401,
  );
  assert.equal(
    (await api(instance, "/api/sites", "GET", undefined, second)).status,
    200,
  );
  assert.equal(
    (
      await api(instance, "/api/sites", "GET", undefined, {
        Authorization: "Bearer private-fixture-key",
      })
    ).status,
    200,
  );
});

test("Puppeteer fallback observes real iframe playback with attributed media", async () => {
  const pool = createBrowserPool();
  try {
    const result = await runWithPuppeteer(fixtures.origin + "/watch/iframe", {
      browserPool: pool,
      playbackObserveMs: 2000,
      siteDeadTimeoutMs: 18_000,
    });
    assert.equal(classify(result), "WORKING");
    assert.equal(
      result.working_source.stream_url,
      fixtures.origin + "/clip.webm",
    );
    assert.equal(result.working_source.frame_url, fixtures.origin + "/player");
  } finally {
    await pool.close();
  }
});

test("private dashboard signs out, hides saved data, and permits a fresh login", async () => {
  const instance = await service({ token: "browser-fixture-key" });
  const page = await browser.newPage();
  try {
    await page.goto(instance.origin);
    await page
      .getByLabel("Access key", { exact: true })
      .fill("browser-fixture-key");
    await page
      .getByRole("button", { name: "Unlock workspace", exact: true })
      .click();
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByLabel("Access key", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("textbox", { name: "Search watch pages" }).count(),
      0,
    );
    await page.reload();
    await page
      .getByLabel("Access key", { exact: true })
      .fill("browser-fixture-key");
    await page
      .getByRole("button", { name: "Unlock workspace", exact: true })
      .click();
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  } finally {
    await page.close();
  }
});

test("dashboard separates recent playback from old evidence and preserves details in compact view", async () => {
  const instance = await service();
  const urls = ["fresh", "old", "unavailable", "new"].map(
    (slug) => fixtures.origin + "/watch/" + slug,
  );
  for (const url of urls) instance.store.add(url);
  const now = Date.now();
  const rows = [
    {
      id: 900,
      site_url: urls[0],
      title: "Fresh Film",
      classification: "WORKING",
      stream_started: true,
      is_up: true,
      checked_at: new Date(now - 5 * 60000).toISOString(),
    },
    {
      id: 901,
      site_url: urls[1],
      title: "Older Film",
      classification: "WORKING",
      stream_started: true,
      is_up: true,
      checked_at: new Date(now - 2 * 3600000).toISOString(),
    },
    {
      id: 902,
      site_url: urls[2],
      title: "Unavailable Film",
      classification: "DOWN",
      stream_started: false,
      is_up: false,
      checked_at: new Date(now - 60000).toISOString(),
    },
  ];
  const page = await browser.newPage();
  try {
    await page.route("**/api/results", (route) =>
      route.fulfill({ json: { results: rows } }),
    );
    await page.goto(instance.origin);
    await page
      .getByRole("heading", { name: "Fresh Film", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Played recently 1", exact: true })
      .click();
    assert.deepEqual(await page.locator(".result-card h3").allTextContents(), [
      "Fresh Film",
    ]);
    await page
      .getByRole("button", { name: "Recheck due 1", exact: true })
      .click();
    assert.deepEqual(await page.locator(".result-card h3").allTextContents(), [
      "Older Film",
    ]);
    await page
      .getByText(
        "This source played in an earlier check. Recheck before relying on it.",
        { exact: true },
      )
      .waitFor();
    await page
      .getByRole("button", { name: "Needs attention 2", exact: true })
      .click();
    assert.deepEqual(
      (await page.locator(".result-card h3").allTextContents()).sort(),
      ["Older Film", "Unavailable Film"],
    );
    await page.getByRole("button", { name: "Compact", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "Compact", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    const card = page
      .locator(".result-card")
      .filter({
        has: page.getByRole("heading", {
          name: "Unavailable Film",
          exact: true,
        }),
      });
    await card
      .getByText(
        "The watch page was unavailable. Confirm the URL still opens before trying another check.",
        { exact: true },
      )
      .waitFor();
    await card
      .getByText("Playback evidence & history", { exact: true })
      .click();
    await card
      .getByText("No source-attempt evidence was recorded for this check.", {
        exact: true,
      })
      .waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page
      .getByRole("button", { name: "Not checked 1", exact: true })
      .click();
    assert.equal(await page.locator(".result-card").count(), 1);
    await page
      .getByText("Run a check to see which source plays.", { exact: true })
      .waitFor();
  } finally {
    await page.close();
  }
});
