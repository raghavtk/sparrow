import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import puppeteerExtra from "puppeteer-extra";
import puppeteer from "puppeteer";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";

chromium.use(StealthPlugin());
puppeteerExtra.use(StealthPlugin());
puppeteerExtra.use(
  AdblockerPlugin({
    blockTrackers: true
  })
);

const LAUNCH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-extensions"
];

/**
 * Shared Chromium processes for a monitor run.
 * One Playwright browser (many contexts) + one Puppeteer browser (many pages)
 * avoids paying launch cost on every site / retry / fallback.
 */
export function createBrowserPool({ headless = true } = {}) {
  let pwBrowser = null;
  let pwLaunch = null;
  let ppBrowser = null;
  let ppLaunch = null;
  let closed = false;

  async function getPlaywrightBrowser() {
    if (closed) throw new Error("Browser pool is closed");
    if (pwBrowser?.isConnected?.() ?? pwBrowser) return pwBrowser;
    if (!pwLaunch) {
      pwLaunch = chromium
        .launch({
          headless,
          args: LAUNCH_ARGS
        })
        .then((browser) => {
          pwBrowser = browser;
          pwLaunch = null;
          return browser;
        })
        .catch((err) => {
          pwLaunch = null;
          throw err;
        });
    }
    return pwLaunch;
  }

  async function getPuppeteerBrowser() {
    if (closed) throw new Error("Browser pool is closed");
    if (ppBrowser?.connected) return ppBrowser;
    if (!ppLaunch) {
      ppLaunch = puppeteerExtra
        .launch({
          headless: headless ? "new" : false,
          args: LAUNCH_ARGS,
          executablePath: puppeteer.executablePath()
        })
        .then((browser) => {
          ppBrowser = browser;
          ppLaunch = null;
          return browser;
        })
        .catch((err) => {
          ppLaunch = null;
          throw err;
        });
    }
    return ppLaunch;
  }

  async function withPlaywrightPage(fingerprint, fn) {
    const browser = await getPlaywrightBrowser();
    const context = await browser.newContext({
      viewport: fingerprint.viewport,
      userAgent: fingerprint.userAgent,
      javaScriptEnabled: true
    });
    const page = await context.newPage();
    try {
      return await fn(page, context);
    } finally {
      await context.close().catch(() => null);
    }
  }

  async function withPuppeteerPage(fingerprint, fn) {
    const browser = await getPuppeteerBrowser();
    // Isolate concurrent probes so popup cleanup cannot close another site's tabs.
    const context =
      typeof browser.createBrowserContext === "function"
        ? await browser.createBrowserContext()
        : null;
    const page = context ? await context.newPage() : await browser.newPage();
    try {
      await page.setViewport(fingerprint.viewport).catch(() => null);
      await page.setUserAgent(fingerprint.userAgent);
      return await fn(page, browser);
    } finally {
      if (context) await context.close().catch(() => null);
      else await page.close().catch(() => null);
    }
  }

  async function close() {
    closed = true;
    const jobs = [];
    if (pwBrowser) jobs.push(pwBrowser.close().catch(() => null));
    if (ppBrowser) jobs.push(ppBrowser.close().catch(() => null));
    pwBrowser = null;
    ppBrowser = null;
    await Promise.all(jobs);
  }

  return {
    withPlaywrightPage,
    withPuppeteerPage,
    close
  };
}
