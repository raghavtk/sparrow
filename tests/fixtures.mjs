import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

export async function createFixtures() {
  const media = await readFile(
    new URL("./assets/playback.webm", import.meta.url),
  );
  const video =
    '<video muted loop controls style="width:640px;height:360px" src="/clip.webm"></video>';
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    const path = new URL(req.url, "http://fixture").pathname;
    if (path === "/blob-player") {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(
        `<video muted loop controls style="width:640px;height:360px"></video><script>const v=document.querySelector('video');window.onmessage=(event)=>{v.src=URL.createObjectURL(new Blob([event.data],{type:'video/webm'}));v.play()};</script>`,
      );
    }
    if (path === "/redirect-private") {
      res.writeHead(302, { Location: "http://127.0.0.1:1/redirect-target" });
      return res.end();
    }
    if (path === "/clip.webm" || path === "/slow.webm") {
      if (path === "/slow.webm") {
        setTimeout(() => {
          res.writeHead(200, {
            "Content-Type": "video/webm",
            "Content-Length": media.length,
          });
          res.end(media);
        }, 3200);
        return;
      }
      res.writeHead(200, {
        "Content-Type": "video/webm",
        "Content-Length": media.length,
      });
      return res.end(media);
    }
    if (path === "/dead.webm") {
      res.writeHead(404);
      return res.end("Dead mirror");
    }
    if (path === "/watch/unavailable") {
      res.writeHead(503, { "Content-Type": "text/html" });
      return res.end("Temporarily unavailable");
    }
    const titles = {
      "/watch/iframe": "The Iframe Film",
      "/watch/mirrors": "Fast Mirror Film",
      "/watch/stalled": "Stalled Film",
      "/watch/ads": "Film With Popups",
      "/watch/duplicate": "Duplicate Mirror Film",
    };
    let body = video;
    if (path === "/watch/slow")
      body = video.replace("/clip.webm", "/slow.webm");
    if (path === "/watch/unresponsive")
      body = "<script>setTimeout(() => { while (true) {} }, 50)</script>";
    if (path === "/watch/iframe")
      body =
        '<iframe title="Content player" src="/player" width="680" height="400"></iframe>';
    if (path === "/watch/mirrors")
      body = `<video muted loop controls style="width:640px;height:360px"></video>
      <button class="btn btn-ghost">Music</button><button class="btn btn-ghost">Drama</button><button class="btn btn-ghost">Favorite</button><button class="btn btn-ghost">Watchlist</button>
      <select aria-label="Genre"><option>Comedy</option><option>Drama</option></select>
      <button data-server="Server 1" onclick="const v=document.querySelector('video');v.src='/dead.webm';v.load()">Server 1</button>
      <button data-server="Server 2" onclick="const v=document.querySelector('video');v.src='/clip.webm';v.load();v.play()">Server 2</button>`;
    if (path === "/watch/stalled")
      body +=
        '<script>document.querySelector("video").addEventListener("playing",()=>setTimeout(()=>document.querySelector("video").pause(),500))</script>';
    if (path === "/watch/navigation-ad")
      body =
        '<script>setTimeout(()=>location.href="/advertisement",700)</script>';
    if (path === "/watch/embedded-ad")
      body =
        '<video muted controls style="width:640px;height:360px"></video><div data-ad><iframe src="/player" width="680" height="400"></iframe></div>';
    if (path === "/watch/unattributed")
      body =
        '<iframe src="/blob-player" width="680" height="400"></iframe><script>const f=document.querySelector("iframe");f.addEventListener("load",async()=>{const bytes=await (await fetch("/clip.webm")).arrayBuffer();f.contentWindow.postMessage(bytes,"*",[bytes])})</script>';
    if (path === "/watch/ads")
      body +=
        '<img src="http://ad.invalid/tracking.gif"><script>for(let i=0;i<8;i++)window.open("about:blank")</script>';
    if (path === "/watch/duplicate")
      body += Array.from(
        { length: 4 },
        (_, i) =>
          `<button data-server="Server ${i + 1}" onclick="const v=document.querySelector('video');v.src='/clip.webm?token=${i}';v.load();v.play()">Server ${i + 1}</button>`,
      ).join("");
    if (path === "/catalog")
      body =
        '<h1>Film library</h1><a href="/watch/iframe">The Iframe Film</a><a href="/watch/mirrors">Fast Mirror Film</a><a href="/privacy">Privacy</a>';
    if (path === "/watch/private-request")
      body +=
        '<img src="http://127.0.0.1:1/private"><iframe src="/redirect-private"></iframe>';
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      `<!doctype html><html><head><title>${titles[path] ?? "Fixture"}</title><script type="application/ld+json">${JSON.stringify({ "@type": "Movie", name: titles[path] ?? "Fixture" })}</script></head><body>${body}</body></html>`,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
