import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "../api";

export default function useSparrow({ includeHistory = false } = {}) {
  const [session, setSession] = useState(null);
  const [sites, setSites] = useState([]);
  const [results, setResults] = useState([]);
  const [run, setRun] = useState(null);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const sessionGeneration = useRef(0);
  const refresh = useCallback(async () => {
    const generation = sessionGeneration.current;
    try {
      const [saved, latest, jobs] = await Promise.all([
        request("/sites"),
        request("/results"),
        request("/runs/latest"),
      ]);
      if (generation !== sessionGeneration.current) return;
      setSites(saved.sites);
      setResults(latest.results);
      setRun(jobs.run);
      setNow(Date.now());
      setError("");
    } catch (err) {
      if (generation !== sessionGeneration.current) return;
      if (err.status === 401) setSession({ authenticated: false });
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    request("/session")
      .then(setSession)
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);
  useEffect(() => {
    if (!session?.authenticated) return;
    Promise.resolve().then(refresh);
    const refreshVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const interval = setInterval(refreshVisible, 30000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [session?.authenticated, refresh]);

  const runId = run?.id;
  const running = ["running", "cancelling"].includes(run?.status);
  useEffect(() => {
    if (!session?.authenticated || !runId || (!running && !includeHistory))
      return;
    let refreshTimer;
    const stream = new EventSource(`/api/runs/${runId}/events`);
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    stream.onmessage = (message) => {
      const event = JSON.parse(message.data);
      setEvents((previous) => {
        const id = `${runId}:${message.lastEventId}`;
        if (previous.some((item) => item.id === id)) return previous;
        return [
          ...previous.filter((item) => item.id.startsWith(`${runId}:`)),
          { ...event, id },
        ].slice(-150);
      });
      if (event.type === "site_result" && running) {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh, 250);
      }
      if (event.type === "job_update") setRun(event.run);
      if (event.type === "job_done") {
        setRun(event.run);
        stream.close();
        clearTimeout(refreshTimer);
        if (running) refresh();
      }
    };
    return () => {
      stream.close();
      clearTimeout(refreshTimer);
    };
  }, [runId, running, includeHistory, session?.authenticated, refresh]);

  async function action(fn) {
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setBusy(false);
    }
  }

  return {
    session,
    sites,
    results,
    run,
    running,
    events,
    error,
    loading,
    busy,
    connected,
    refresh,
    now,
    logout: () =>
      action(async () => {
        const session = await request("/session", { method: "DELETE" });
        sessionGeneration.current += 1;
        setSites([]);
        setResults([]);
        setRun(null);
        setEvents([]);
        setSession(session);
      }),
    login: (token) =>
      action(async () =>
        setSession(
          await request("/session", {
            method: "POST",
            body: JSON.stringify({ token }),
          }),
        ),
      ),
    add: (url) =>
      action(async () => {
        const data = await request("/sites", {
          method: "POST",
          body: JSON.stringify({ url }),
        });
        setSites(data.sites);
      }),
    remove: (url) =>
      action(async () => {
        const data = await request("/sites", {
          method: "DELETE",
          body: JSON.stringify({ url }),
        });
        setSites(data.sites);
        await refresh();
      }),
    discover: (url) =>
      action(() =>
        request("/discover", { method: "POST", body: JSON.stringify({ url }) }),
      ),
    start: (selected) =>
      action(async () => {
        const data = await request("/runs", {
          method: "POST",
          body: JSON.stringify(selected ? { sites: selected } : {}),
        });
        setEvents([]);
        setRun(data.run);
      }),
    cancel: () =>
      action(async () => {
        const data = await request(`/runs/${run.id}/cancel`, {
          method: "POST",
          body: "{}",
        });
        setRun(data.run);
      }),
  };
}
