import { sleep } from "../utils.js";

const AD_SELECTOR =
  '[data-ad], [class*="advert"], [class*="trailer"], [id*="advert"], [class~="ads"], [class~="ad"], [aria-label*="advertisement" i]';

async function isContentFrame(frame) {
  for (
    let current = frame;
    current.parentFrame?.();
    current = current.parentFrame()
  ) {
    const element = await current.frameElement();
    try {
      const eligible = await element.evaluate((iframe, selector) => {
        const rect = iframe.getBoundingClientRect();
        const style = getComputedStyle(iframe);
        return (
          rect.width >= 160 &&
          rect.height >= 90 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          !iframe.closest(selector)
        );
      }, AD_SELECTOR);
      if (!eligible) return false;
    } finally {
      await element.dispose();
    }
  }
  return true;
}

function framesFor(page) {
  return typeof page.frames === "function" ? page.frames() : [page];
}

async function sampleFrame(frame, probeId) {
  try {
    if (!(await isContentFrame(frame))) return [];
    const videos = await frame.evaluate(
      ({ attemptId, adSelector }) => {
        return [...document.querySelectorAll("video")].flatMap(
          (video, index) => {
            const rect = video.getBoundingClientRect();
            const style = getComputedStyle(video);
            if (
              rect.width < 160 ||
              rect.height < 90 ||
              style.visibility === "hidden" ||
              style.display === "none" ||
              video.closest(adSelector)
            )
              return [];
            video.dataset.sparrowVideo ??= `${Date.now()}-${index}`;
            if (video.dataset.sparrowPlayAttempt !== attemptId) {
              video.dataset.sparrowPlayAttempt = attemptId;
              if (video.paused && !video.ended) video.play().catch(() => null);
            }
            return [
              {
                id: video.dataset.sparrowVideo,
                src: video.currentSrc || video.src || "",
                time: video.currentTime,
                paused: video.paused,
                ended: video.ended,
                ready: video.readyState,
                error: video.error?.code ?? null,
                duration: video.duration,
                loop: video.loop,
                area: rect.width * rect.height,
              },
            ];
          },
        );
      },
      { attemptId: probeId, adSelector: AD_SELECTOR },
    );
    return videos.map((video) => ({
      ...video,
      frame,
      frame_url: frame.url?.() ?? null,
    }));
  } catch {
    // A detached or cross-origin frame may disappear during source switching.
    return [];
  }
}

export async function detectPlayerAndPlayback(page, observeMs = 10_000) {
  const started = Date.now();
  const probeId = `${started}-${Math.random()}`;
  const tracks = new Map();
  const frameIds = new Map();
  let playerFound = false;
  // Sampling from Node keeps observation bounded and notices newly attached player frames.
  do {
    const snapshots = (
      await Promise.all(
        framesFor(page).map((frame) => sampleFrame(frame, probeId)),
      )
    ).flat();
    playerFound ||= snapshots.length > 0;
    const largest = Math.max(0, ...snapshots.map((s) => s.area));
    for (const video of snapshots.filter((s) => s.area >= largest * 0.8)) {
      if (!frameIds.has(video.frame)) frameIds.set(video.frame, frameIds.size);
      const key = `${frameIds.get(video.frame)}|${video.id}|${video.src}`;
      let track = tracks.get(key);
      if (!track || track.frame !== video.frame) {
        track = {
          ...video,
          initial: video.time,
          previous: video.time,
          firstSeen: Date.now(),
          advancedSeconds: 0,
          advancing: 0,
          buffering: 0,
          samples: 0,
          lastSeen: Date.now(),
        };
        tracks.set(key, track);
      } else {
        track.samples++;
        let delta = video.time - track.previous;
        if (
          video.loop &&
          Number.isFinite(video.duration) &&
          track.previous > video.duration - 1 &&
          video.time < 1
        ) {
          delta = video.duration - track.previous + video.time;
        }
        if (delta > 0.05 && delta < 1.2 && !video.paused && video.ready >= 2) {
          track.advancing++;
          track.advancedSeconds += delta;
        } else track.buffering++;
        Object.assign(track, video, {
          previous: video.time,
          lastSeen: Date.now(),
        });
      }
    }
    if (Date.now() - started >= observeMs) break;
    await sleep(Math.min(400, observeMs - (Date.now() - started)));
  } while (Date.now() - started <= observeMs + 100);

  const observations = [...tracks.values()].map((track) => {
    const observedMs = Date.now() - track.firstSeen;
    const advanced = track.advancedSeconds;
    const verified =
      Date.now() - track.lastSeen < 800 &&
      observedMs >= Math.max(1200, observeMs * 0.8) &&
      track.samples >= 3 &&
      track.advancing > track.buffering &&
      advanced >= Math.max(0.8, (observedMs / 1000) * 0.5) &&
      !track.error &&
      !track.paused &&
      !track.ended;
    return {
      playerFound: true,
      streamStarted: verified,
      frame: track.frame,
      frame_url: track.frame_url,
      player_url: track.src,
      playback_seconds: Number(advanced.toFixed(2)),
      observed_ms: observedMs,
      buffering_samples: track.buffering,
      media_error: track.error,
      outcome: verified
        ? "verified"
        : track.error
          ? "media_error"
          : advanced > 0
            ? "stalled"
            : "unverified",
    };
  });
  return (
    observations.find((o) => o.streamStarted) ??
    observations.sort((a, b) => b.playback_seconds - a.playback_seconds)[0] ?? {
      playerFound,
      streamStarted: false,
      outcome: "no_player",
      observed_ms: Date.now() - started,
    }
  );
}

export async function resetPlayback(page) {
  await Promise.all(
    framesFor(page).map((frame) =>
      frame
        .evaluate(() => {
          for (const video of document.querySelectorAll("video")) video.pause();
        })
        .catch(() => null),
    ),
  );
}
