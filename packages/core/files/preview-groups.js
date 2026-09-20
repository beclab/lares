import { posixExtname } from "./filename.js";
import { isFilesPath } from "../drive/files-path.js";

const MEDIA_KINDS = new Set(["image", "video", "audio", "model3d"]);

/** Extensions that stay as user-facing Produced media after a fetch. */
const MEDIA_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
  ".mp4", ".webm", ".mov", ".m4v", ".ogv",
  ".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac",
  ".glb", ".gltf", ".obj",
]);

/** Formats TurnMedia can actually play; .gltf/.obj stay official chips. */
const INLINE_TURN_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
  ".mp4", ".webm", ".mov", ".m4v", ".ogv",
  ".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac",
  ".glb",
]);

function posixPath(path) {
  return String(path ?? "").replace(/\\/g, "/");
}

/**
 * Image / video / audio / 3D destinations are durable deliverables. Other
 * fetch targets (git APIs, chart YAML, JSON lists, READMEs) are workspace
 * scratch and must not become Produced chips.
 */
export function isMediaDeliverablePath(path) {
  return MEDIA_EXTENSIONS.has(posixExtname(posixPath(path)).toLowerCase());
}

/**
 * Media the turn-tail can play. Workspace and Files addresses use the same
 * player; a Files path is not a reason to fall back to an in-message link.
 */
export function isInlineTurnMediaPath(path) {
  return INLINE_TURN_EXTENSIONS.has(posixExtname(posixPath(path)).toLowerCase());
}

/** Default url_fetch / drive_fetch landing zone for non-final research files. */
export function isDownloadsScratchPath(path) {
  const normalized = posixPath(path);
  if (normalized === "downloads" || normalized.startsWith("downloads/")) return true;
  return /(?:^|\/)downloads(?:\/|$)/.test(normalized);
}

/**
 * Produced UI follows live workspace truth: media that still exists previews
 * inline; missing paths drop out; non-media under downloads/ is scratch even
 * while the file is briefly on disk.
 */
export function partitionPreviews(paths, previews) {
  const media = [];
  const files = [];
  const seen = new Set();
  let loading = false;
  for (const original of paths) {
    if (!previews.has(original)) {
      if (isInlineTurnMediaPath(original)) {
        loading = true;
        continue;
      }
      if (isFilesPath(original)) {
        files.push(original);
        continue;
      }
      loading = true;
      continue;
    }
    const preview = previews.get(original);
    if (preview === null) {
      if (isFilesPath(original)) files.push(original);
      continue;
    }
    const path = preview.path ?? original;
    if (seen.has(path)) continue;
    seen.add(path);
    if (MEDIA_KINDS.has(preview.kind)) {
      media.push(preview);
      continue;
    }
    if (isDownloadsScratchPath(path) || isDownloadsScratchPath(original)) continue;
    files.push(path);
  }
  return { media, files, loading };
}
