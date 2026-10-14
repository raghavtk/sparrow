import { randomUUID } from "node:crypto";
import { createEventLogger } from "./logger.js";

export function createJobs({ store, monitor, dbPath, validateUrl }) {
  let active = null;
  const subscribers = new Map();

  function publish(id, event) {
    const eventId = store.event(id, event);
    for (const send of subscribers.get(id) ?? []) send(eventId, event);
  }

  async function start(sites, concurrency) {
    if (active)
      throw Object.assign(new Error("A check is already running"), {
        status: 409,
      });
    const id = randomUUID();
    const controller = new AbortController();
    const run = {
      id,
      sites,
      concurrency,
      created_at: new Date().toISOString(),
    };
    store.createRun(run);
    active = { id, controller, promise: null };
    const onEvent = (event) => {
      if (event.type === "site_result")
        store.updateRun(
          id,
          controller.signal.aborted ? "cancelling" : "running",
          event.completed,
        );
      publish(id, event);
    };
    active.promise = Promise.resolve().then(async () => {
      let status = "completed";
      let error = null;
      try {
        await monitor({
          sites,
          dbPath,
          headless: true,
          concurrency,
          signal: controller.signal,
          validateUrl,
          log: createEventLogger(onEvent),
          onEvent,
        });
        if (controller.signal.aborted) status = "cancelled";
      } catch (err) {
        status = controller.signal.aborted ? "cancelled" : "failed";
        error = status === "failed" ? err.message : null;
      } finally {
        const completed = store.run(id).completed;
        store.updateRun(id, status, completed, error);
        publish(id, { type: "job_done", run: store.run(id) });
        active = null;
      }
    });
    return store.run(id);
  }

  return {
    start,
    isBusy: () => Boolean(active),
    cancel(id) {
      if (active?.id !== id) return store.run(id);
      active.controller.abort();
      store.updateRun(id, "cancelling", store.run(id).completed);
      publish(id, { type: "job_update", run: store.run(id) });
      return store.run(id);
    },
    subscribe(id, send) {
      if (!subscribers.has(id)) subscribers.set(id, new Set());
      subscribers.get(id).add(send);
      return () => {
        subscribers.get(id)?.delete(send);
        if (!subscribers.get(id)?.size) subscribers.delete(id);
      };
    },
    async close() {
      const job = active;
      job?.controller.abort();
      await job?.promise;
    },
  };
}
