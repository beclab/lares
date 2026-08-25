/**
 * An Olares files path (`<fileType>/<extend>/<subPath…>`) names the user's
 * files backend, which this pod does not mount: nothing under it can be read,
 * edited, or previewed in place. The fetch destination is workspace-relative,
 * and it must be derivable from the call arguments alone — the produced-file
 * chip that opens the result is rendered from `presentCall`, before the
 * download runs — so a colliding name is refused rather than numbered.
 */
import { basename } from "node:path/posix";
import { sanitizeFilename } from "../../file-input/host/storage.js";

/** Namespaces `olares-cli files download` serves. */
const DOWNLOADABLE = new Set([
  "drive", "cache", "sync", "external", "awss3", "google", "dropbox", "tencent",
]);
const DEFAULT_DIRECTORY = "downloads";

function parseSource(value) {
  const source = String(value ?? "").trim();
  if (source === "" || source.includes("\0")) {
    throw new Error("path is required, e.g. drive/Home/Downloads/clip.webm");
  }
  if (source.startsWith("/") || /^[a-z]+:/i.test(source)) {
    throw new Error(`"${source}" is not an Olares files path; expected <fileType>/<extend>/<subPath>`);
  }
  if (source.endsWith("/")) {
    throw new Error(`"${source}" names a directory; drive_fetch fetches a single file`);
  }
  const segments = source.split("/");
  if (!DOWNLOADABLE.has(segments[0])) {
    throw new Error(
      `"${segments[0]}" is not a downloadable namespace; expected one of ${[...DOWNLOADABLE].join(", ")}`,
    );
  }
  if (segments.length < 3 || segments.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`"${source}" is malformed; expected <fileType>/<extend>/<subPath>`);
  }
  return source;
}

function parseDestination(value, source) {
  const name = sanitizeFilename(basename(source));
  const raw = String(value ?? "").trim().replace(/\\/g, "/");
  if (raw === "") return `${DEFAULT_DIRECTORY}/${name}`;
  const trailing = raw.endsWith("/");
  const segments = raw.split("/").filter((part) => part !== "");
  if (raw.startsWith("/") || segments.some((part) => part === "." || part === "..")) {
    throw new Error(`"${value}" must be a relative path inside the workspace`);
  }
  if (segments.length === 0) throw new Error("destination must name a path inside the workspace");
  return [...segments, ...(trailing ? [name] : [])].join("/");
}

/**
 * @returns the validated source and the workspace-relative destination.
 * @throws when either argument cannot name one fetchable file.
 */
export function resolveFetch(args) {
  const source = parseSource(args?.path);
  return { source, destination: parseDestination(args?.destination, source) };
}

/**
 * The same resolution for the pure presenters, which also run on replayed logs:
 * arguments that no longer resolve render as a plain card instead of throwing.
 */
export function describeFetch(args) {
  try {
    return resolveFetch(args);
  } catch {
    return null;
  }
}
