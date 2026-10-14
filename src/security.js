import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export function parseWatchUrl(value) {
  if (typeof value !== "string" || value.length > 2048)
    throw new Error("Enter a valid watch-page URL");
  const url = new URL(
    /^[a-z][a-z0-9+.-]*:/i.test(value.trim())
      ? value.trim()
      : `https://${value.trim()}`,
  );
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "Only HTTP and HTTPS URLs without credentials are supported",
    );
  }
  if (url.port && !["80", "443"].includes(url.port))
    throw new Error("Only standard web ports are supported");
  url.hash = "";
  return url.href;
}

export function isPublicAddress(address) {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 &&
        (b === 168 ||
          (b === 0 && [0, 2].includes(c)) ||
          (b === 88 && c === 99))) ||
      (a === 198 && ([18, 19].includes(b) || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  // Accept global unicast only; reject mapped IPv4, local, multicast and transition ranges.
  const [first, second = "0"] = ip.split(":");
  const prefix = Number.parseInt(first, 16);
  const subnet = Number.parseInt(second || "0", 16);
  return (
    isIP(ip) === 6 &&
    prefix >= 0x2000 &&
    prefix < 0x3fff &&
    prefix !== 0x2002 &&
    !(prefix === 0x2001 && (subnet < 0x200 || subnet === 0xdb8))
  );
}

export async function assertPublicUrl(value) {
  const normalized = parseWatchUrl(value);
  const host = new URL(normalized).hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicAddress(address))
  ) {
    throw new Error("Private and reserved network destinations are blocked");
  }
  return normalized;
}

export async function guardPlaywrightContext(context, validateUrl) {
  if (!validateUrl) return;
  await context.route("**/*", async (route) => {
    try {
      await validateUrl(route.request().url());
      await route.continue();
    } catch {
      await route.abort("blockedbyclient").catch(() => null);
    }
  });
  // WebSocket traffic is not intercepted by normal HTTP routing.
  if (context.routeWebSocket)
    await context.routeWebSocket("**/*", (socket) => socket.close());
}

export async function guardPuppeteerPage(page, validateUrl) {
  if (!validateUrl) return;
  await page.setBypassServiceWorker(true);
  await page.evaluateOnNewDocument(() => {
    for (const name of ["WebSocket", "Worker", "SharedWorker"]) {
      Object.defineProperty(window, name, {
        configurable: false,
        writable: false,
        value: class {
          constructor() {
            throw new DOMException(
              "Disabled in guarded probes",
              "SecurityError",
            );
          }
        },
      });
    }
    if (navigator.serviceWorker)
      navigator.serviceWorker.register = () =>
        Promise.reject(
          new DOMException("Disabled in guarded probes", "SecurityError"),
        );
  });
  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    if (request.isInterceptResolutionHandled()) return;
    try {
      await validateUrl(request.url());
      if (!request.isInterceptResolutionHandled()) await request.continue();
    } catch {
      if (!request.isInterceptResolutionHandled())
        await request.abort("blockedbyclient").catch(() => null);
    }
  });
}
