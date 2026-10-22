import { fileURLToPath } from "node:url";
import { join, dirname, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import express from "express";
import { runMonitor } from "./src/monitor.js";
import { openStore } from "./src/store.js";
import { createJobs } from "./src/jobs.js";
import { assertPublicUrl, parseWatchUrl } from "./src/security.js";
import { discoverPages } from "./src/discovery.js";

const root = dirname(fileURLToPath(import.meta.url));
const MAX_SITES = 30;
const MAX_CONCURRENCY = 3;
const terminal = (run) => !["running", "cancelling"].includes(run.status);

function equalSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createApp({
  dbPath = process.env.SPARROW_DB_PATH ?? join(root, "results.db"),
  sitesFile = join(root, "sites.txt"),
  token = process.env.SPARROW_ACCESS_TOKEN,
  validateUrl = assertPublicUrl,
  monitor = runMonitor,
} = {}) {
  const app = express();
  app.set("trust proxy", process.env.SPARROW_TRUST_PROXY === "1" ? 1 : false);
  const initialSites = existsSync(sitesFile)
    ? readFileSync(sitesFile, "utf8")
        .split(/\r?\n/)
        .filter((s) => s.trim() && !s.trim().startsWith("#"))
        .flatMap((s) => {
          try {
            return [parseWatchUrl(s)];
          } catch {
            return [];
          }
        })
        .slice(0, MAX_SITES)
    : [];
  const store = openStore(dbPath, initialSites);
  const jobs = createJobs({ store, monitor, dbPath, validateUrl });
  const sessions = new Map();
  const loginAttempts = new Map();
  let discovery = null;
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    next();
  });
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.headers.origin &&
      req.headers.origin !== `${req.protocol}://${req.headers.host}`
    ) {
      return res
        .status(403)
        .json({ error: "Cross-origin changes are blocked" });
    }
    next();
  });
  const sessionId = (req) =>
    req.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("sparrow_session="))
      ?.slice(16);
  const authorized = (req) => {
    if (!token) return true;
    if (equalSecret(req.headers.authorization?.replace(/^Bearer /, ""), token))
      return true;
    const session = sessionId(req);
    return sessions.get(session) > Date.now();
  };
  app.get("/api/session", (req, res) =>
    res.json({ authenticated: authorized(req), privateAccess: Boolean(token) }),
  );
  app.post("/api/session", (req, res) => {
    const now = Date.now();
    for (const [key, value] of loginAttempts)
      if (value.reset < now) loginAttempts.delete(key);
    for (const [key, expires] of sessions)
      if (expires < now) sessions.delete(key);
    const attempt = loginAttempts.get(req.ip) ?? {
      count: 0,
      reset: now + 60_000,
    };
    if (++attempt.count > 10)
      return res
        .status(429)
        .json({ error: "Too many attempts. Try again in a minute." });
    loginAttempts.set(req.ip, attempt);
    if (token && !equalSecret(req.body.token, token))
      return res.status(401).json({ error: "Incorrect access key" });
    const id = randomBytes(32).toString("hex");
    sessions.set(id, now + 12 * 60 * 60 * 1000);
    res.cookie("sparrow_session", id, {
      httpOnly: true,
      sameSite: "strict",
      secure: req.secure,
      maxAge: 12 * 60 * 60 * 1000,
    });
    res.json({ authenticated: true, privateAccess: Boolean(token) });
  });
  app.delete("/api/session", (req, res) => {
    sessions.delete(sessionId(req));
    res.clearCookie("sparrow_session", {
      httpOnly: true,
      sameSite: "strict",
      secure: req.secure,
    });
    res.json({ authenticated: !token, privateAccess: Boolean(token) });
  });
  app.use("/api", (req, res, next) =>
    authorized(req)
      ? next()
      : res
          .status(401)
          .json({ error: "Enter your private access key to continue" }),
  );

  app.get("/api/sites", (_req, res) => res.json({ sites: store.sites() }));
  app.post("/api/sites", async (req, res) => {
    const url = await validateUrl(req.body.url);
    if (store.sites().length >= MAX_SITES && !store.sites().includes(url)) {
      return res
        .status(400)
        .json({ error: `Save at most ${MAX_SITES} watch pages` });
    }
    store.add(url);
    res.status(201).json({ sites: store.sites() });
  });
  app.delete("/api/sites", (req, res) => {
    store.remove(parseWatchUrl(req.body.url));
    res.json({ sites: store.sites() });
  });
  app.get("/api/results", (_req, res) => res.json({ results: store.latest() }));
  app.post("/api/discover", async (req, res) => {
    if (discovery || jobs.isBusy())
      return res
        .status(409)
        .json({ error: "Wait for the current browser check to finish" });
    const controller = new AbortController();
    discovery = { controller, promise: null };
    try {
      const url = await validateUrl(req.body.url);
      discovery.promise = discoverPages(url, {
        validateUrl,
        signal: controller.signal,
      });
      res.json(await discovery.promise);
    } finally {
      discovery = null;
    }
  });
  app.get("/api/history", (req, res) =>
    res.json({ results: store.history(new URL(req.query.url).href) }),
  );
  app.get("/api/runs/latest", (_req, res) =>
    res.json({ run: store.latestRun() }),
  );
  app.post("/api/runs", async (req, res) => {
    if (discovery)
      return res
        .status(409)
        .json({ error: "Listing discovery is in progress" });
    const sites = req.body.sites ?? store.sites();
    if (!Array.isArray(sites) || !sites.length || sites.length > MAX_SITES) {
      return res
        .status(400)
        .json({ error: `Choose between 1 and ${MAX_SITES} saved watch pages` });
    }
    const concurrency = req.body.concurrency ?? MAX_CONCURRENCY;
    if (
      !Number.isInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > MAX_CONCURRENCY
    ) {
      return res.status(400).json({
        error: `Concurrency must be between 1 and ${MAX_CONCURRENCY}`,
      });
    }
    const normalized = [...new Set(await Promise.all(sites.map(validateUrl)))];
    if (normalized.some((url) => !store.sites().includes(url)))
      return res
        .status(400)
        .json({ error: "Save the watch page before checking it" });
    if (discovery)
      return res
        .status(409)
        .json({ error: "Listing discovery is in progress" });
    res.status(202).json({ run: await jobs.start(normalized, concurrency) });
  });
  app.get("/api/runs/:id", (req, res) => {
    const run = store.run(req.params.id);
    if (!run) return res.status(404).json({ error: "Check not found" });
    res.json({ run });
  });
  app.post("/api/runs/:id/cancel", (req, res) => {
    const run = jobs.cancel(req.params.id);
    if (!run) return res.status(404).json({ error: "Check not found" });
    res.json({ run });
  });
  app.get("/api/runs/:id/events", (req, res) => {
    const run = store.run(req.params.id);
    if (!run) return res.status(404).json({ error: "Check not found" });
    res.set({
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const send = (id, event) => {
      if (!res.destroyed)
        res.write(`id: ${id}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const after = Number(req.headers["last-event-id"] ?? req.query.after ?? 0);
    for (const event of store.events(
      run.id,
      Number.isSafeInteger(after) ? after : 0,
    ))
      send(event.id, JSON.parse(event.data));
    if (terminal(run)) {
      res.write(`data: ${JSON.stringify({ type: "job_done", run })}\n\n`);
      return res.end();
    }
    const unsubscribe = jobs.subscribe(run.id, (id, event) => {
      if (!authorized(req)) return res.end();
      send(id, event);
      if (event.type === "job_done") res.end();
    });
    const heartbeat = setInterval(() => {
      if (!authorized(req)) return res.end();
      res.write(": heartbeat\n\n");
    }, 15_000);
    res.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API route not found" }),
  );
  app.use(express.static(join(root, "frontend/dist")));
  app.get("/{*path}", (_req, res) => {
    const index = join(root, "frontend/dist/index.html");
    if (existsSync(index)) res.sendFile(index);
    else res.status(404).send("Build the frontend first: npm run build");
  });
  app.use((err, _req, res, _next) => {
    res
      .status(err.status ?? 400)
      .json({ error: err.message || "Request failed" });
  });
  return {
    app,
    store,
    jobs,
    async close() {
      const pending = discovery;
      pending?.controller.abort();
      await pending?.promise?.catch(() => null);
      await jobs.close();
      store.close();
    },
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const host = process.env.HOST ?? "127.0.0.1";
  if (
    !["localhost", "127.0.0.1", "::1"].includes(host) &&
    !process.env.SPARROW_ACCESS_TOKEN
  ) {
    throw new Error(
      "Set SPARROW_ACCESS_TOKEN before listening beyond localhost",
    );
  }
  const service = createApp();
  const server = service.app.listen(
    Number(process.env.PORT ?? 3001),
    host,
    () => {
      console.log(`Sparrow → http://${host}:${server.address().port}`);
    },
  );
  server.on("error", (err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
  const shutdown = async () => {
    await service.close();
    server.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
