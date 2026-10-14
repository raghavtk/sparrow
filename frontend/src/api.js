export async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(body.error ?? "Request failed"), {
      status: response.status,
    });
  return body;
}

export function relativeTime(iso, now) {
  if (!iso) return "Never checked";
  const minutes = Math.max(
    0,
    Math.floor(((now ?? Date.now()) - new Date(iso).getTime()) / 60_000),
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export function sourceName(source) {
  if (!source) return "Automatic player";
  if (source.kind === "default" || source.label === "default")
    return "Automatic player";
  return source.display_name || source.label || "Unnamed source";
}

export function safeWebUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function watchTitle(row) {
  if (
    row.title &&
    !/^(sorry,? you have been blocked|attention required!?|just a moment[.!]*|access denied)$/i.test(
      row.title,
    )
  )
    return row.title;
  const slug = new URL(row.site_url).pathname.split("/").filter(Boolean).at(-1);
  if (!slug || /^\d+$/.test(slug)) return "Title not identified";
  try {
    return decodeURIComponent(slug).replace(/[-_]/g, " ");
  } catch {
    return "Title not identified";
  }
}
