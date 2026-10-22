import https from "node:https";
import { createBrowserPool } from "../src/browsers/pool.js";

// Public diagnostics linked by Cloudflare's October 2026 incident advisory.
const valid = "https://nodejs.org/";
const revoked = [
  "https://dv-g3b-emudhra.we-have-a-problem.com/",
  "https://dv-g3b-aaa-emudhra.we-have-a-problem.com/",
];
const certificateError =
  /CERT_(?:REVOKED|AUTHORITY_INVALID)|UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE/;
let failures = 0;

async function check(name, visit) {
  for (const url of [valid, ...revoked]) {
    const shouldReject = url !== valid;
    try {
      await visit(url);
      if (shouldReject)
        throw new Error("Compromised certificate chain accepted");
      console.log(`PASS ${name}: valid HTTPS accepted`);
    } catch (error) {
      if (
        shouldReject &&
        certificateError.test(`${error.code} ${error.message}`)
      ) {
        console.log(
          `PASS ${name}: revoked chain rejected (${new URL(url).hostname})`,
        );
      } else {
        failures += 1;
        console.error(`FAIL ${name}: ${url}: ${error.message.split("\n")[0]}`);
      }
    }
  }
}

await check(
  `Node ${process.version}`,
  (url) =>
    new Promise((resolve, reject) => {
      const request = https.get(url, (response) => {
        response.destroy();
        if (response.statusCode >= 200 && response.statusCode < 400) resolve();
        else reject(new Error(`Unexpected HTTP ${response.statusCode}`));
      });
      request.setTimeout(15000, () =>
        request.destroy(new Error("TLS check timed out")),
      );
      request.on("error", reject);
    }),
);

const pool = createBrowserPool();
try {
  for (const [name, method] of [
    ["Playwright", "withPlaywrightPage"],
    ["Puppeteer", "withPuppeteerPage"],
  ]) {
    try {
      await pool[method](
        {
          viewport: { width: 1000, height: 800 },
          userAgent: "Sparrow TLS diagnostic",
        },
        async (page) => {
          await check(name, async (url) => {
            const response = await page.goto(url, {
              timeout: 15000,
              waitUntil: "domcontentloaded",
            });
            if (!response || response.status() >= 400)
              throw new Error(`Unexpected HTTP ${response?.status()}`);
          });
        },
      );
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${name}: ${error.message.split("\n")[0]}`);
    }
  }
} finally {
  await pool.close();
}

console.log(
  "Results cover these test chains and verifier paths only, not every certificate or application.",
);
process.exitCode = failures ? 1 : 0;
