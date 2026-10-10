import { isInlineTurnMediaPath } from "./preview-groups.js";
import { LARES_PUBLISHED_KEY } from "./published-turn-data.js";

/** Same rule as dsh-client-ui-deliverables: only edit/diff call views produce files. */
export function producedPathsFromView(view) {
  if (!view || !Array.isArray(view.locations)) return [];
  const writable = view.card === "diff" || (view.card === "generic" && view.kind === "edit");
  if (!writable) return [];
  const paths = [];
  const seen = new Set();
  for (const location of view.locations) {
    const path = location?.path;
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

export function producedForClosing(owner) {
  const deliverables = owner.turn.data.get("deliverables");
  const produced = deliverables?.produced ?? [];
  const presented = deliverables?.presented ?? [];
  const published = owner.turn.data.get(LARES_PUBLISHED_KEY)?.published ?? [];
  const paths = [];
  const seen = new Set();
  for (const item of produced) {
    if (item.seq > owner.seq || seen.has(item.path)) continue;
    seen.add(item.path);
    paths.push(item.path);
  }
  for (const item of presented) {
    if (item.seq >= owner.seq || seen.has(item.path)) continue;
    seen.add(item.path);
    paths.push(item.path);
  }
  for (const item of published) {
    if (item.seq > owner.seq || seen.has(item.path)) continue;
    seen.add(item.path);
    paths.push(item.path);
  }
  return paths;
}

export function selectProducedFiles(owner) {
  const paths = producedForClosing(owner);
  return paths.length === 0 ? null : paths;
}

/**
 * Playable produced media for the turn-tail preview. Workspace and Files
 * addresses share that seat so a `drive/…` image is not left as a prose link.
 */
export function selectInlineTurnMedia(owner) {
  const paths = producedForClosing(owner).filter(isInlineTurnMediaPath);
  return paths.length === 0 ? null : paths;
}

function listedPaths(files) {
  if (!Array.isArray(files)) return [];
  const paths = [];
  for (const file of files) {
    const path = typeof file === "string" ? file : file?.path;
    if (typeof path !== "string") continue;
    const normalized = path.trim().replace(/\\/g, "/");
    if (normalized) paths.push(normalized);
  }
  return paths;
}

/**
 * Playable media a turn published. The web turn tail reads the projection of
 * these events; a client that only has the session log has to read the events.
 * media_generate names its files when the call returns, so they are not on the
 * tool-call arguments.
 */
export function turnMediaPathsFromEvent(event) {
  const data = event?.data;
  if (event?.type === "deliverables/presented" || (
    event?.type === "media/generation-settled"
    && String(data?.status ?? "").toLowerCase() === "completed"
  )) {
    return listedPaths(data?.files).filter(isInlineTurnMediaPath);
  }
  return [];
}
