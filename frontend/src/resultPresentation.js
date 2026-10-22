const FRESHNESS_MS = 60 * 60 * 1000;

export function isRecent(row, now) {
  const age = now - new Date(row.checked_at).getTime();
  return Boolean(row.checked_at) && age >= 0 && age <= FRESHNESS_MS;
}

export function recheckDue(row, now) {
  return Boolean(row.checked_at) && !isRecent(row, now);
}

export function nextStep(row) {
  if (row.classification === "UNCHECKED")
    return "Run a check to see which source plays.";
  if (row.bot_protection_detected)
    return "This page presented an access challenge. Inspect it in your browser; Sparrow cannot verify playback through the challenge.";
  if (row.sources_tried?.some((attempt) => attempt.outcome === "page_changed"))
    return "The page opened different content. Confirm the saved URL points to the intended watch page before checking again.";
  if (row.classification === "DOWN")
    return "The watch page was unavailable. Confirm the URL still opens before trying another check.";
  if (row.classification === "REDIRECT-LOOP")
    return "Navigation exceeded the redirect limit. Check the saved URL for a direct watch-page link.";
  if (row.player_found)
    return "A player was found, but playback was not verified. Expand the evidence to see which sources were attempted.";
  return "No content player was identified. Confirm this is a watch page rather than a listing, then inspect the evidence.";
}
