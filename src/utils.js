import { VALID_VIDEO_EXTENSIONS } from "./config.js";

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function normalizeUrl(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function isVideoRequest(url = "", contentType = "") {
  const lowerUrl = url.toLowerCase();
  const lowerType = contentType.toLowerCase();
  if (VALID_VIDEO_EXTENSIONS.some((ext) => lowerUrl.includes(ext))) return true;
  if (
    lowerType.includes("application/vnd.apple.mpegurl") ||
    lowerType.includes("application/x-mpegurl") ||
    lowerType.includes("video/mp4") ||
    lowerType.includes("video/webm")
  ) {
    return true;
  }
  return false;
}

export function parseArgs(argv) {
  const args = {
    sites: "sites.txt",
    db: "results.db",
    headless: true,
    verbose: false,
    quiet: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--sites" && value) args.sites = value;
    if (key === "--db" && value) args.db = value;
    if (key === "--headless" && value) args.headless = value !== "false";
    if (key === "--verbose" || key === "-v") args.verbose = true;
    if (key === "--quiet" || key === "-q") args.quiet = true;
  }
  return args;
}

export function formatProbeSummary(probed) {
  const parts = [
    `player=${probed.player_found ? "yes" : "no"}`,
    `stream=${probed.stream_started ? "started" : "no"}`,
    `engine=${probed.engine}`
  ];
  if (probed.http_status) parts.push(`http=${probed.http_status}`);
  if (probed.ttfb_ms) parts.push(`ttfb=${Math.round(probed.ttfb_ms)}ms`);
  if (probed.bot_protection_detected) parts.push("bot-protection=yes");
  return parts.join(", ");
}

export function nowIso() {
  return new Date().toISOString();
}

export function safeNum(value, fallback = null) {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return value;
}
