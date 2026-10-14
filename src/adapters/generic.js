/** Conservative discovery fallback. Links are candidates until explicitly selected and probed. */
export const genericAdapter = {
  name: "generic",
  async discoverWatchPages(page) {
    return page.evaluate(() => {
      const candidates = new Map();
      for (const anchor of document.querySelectorAll("a[href]")) {
        try {
          const url = new URL(anchor.href, location.href);
          if (
            url.origin !== location.origin ||
            !["https:", "http:"].includes(url.protocol) ||
            !/\/(watch(?:-movie)?|movies?|episodes?|events?|live|stream)\//i.test(
              url.pathname,
            ) ||
            /trailer|login|signup|download/i.test(
              `${url.pathname} ${anchor.textContent}`,
            )
          )
            continue;
          url.hash = "";
          const title = (
            anchor.innerText ||
            anchor.getAttribute("aria-label") ||
            anchor.querySelector("img")?.alt ||
            ""
          )
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 120);
          candidates.set(url.href, {
            url: url.href,
            title: title || url.pathname,
          });
          if (candidates.size >= 30) break;
        } catch {
          /* Ignore malformed links. */
        }
      }
      return [...candidates.values()];
    });
  },
};
