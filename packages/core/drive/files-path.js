/** Namespaces `olares-cli files download` serves. */
const DOWNLOADABLE = new Set([
  "drive", "cache", "sync", "external", "awss3", "google", "dropbox", "tencent",
]);

/**
 * Files UI and knowledge sometimes omit `drive/` or prefix a slash on a real
 * files address. Only those shapes unwrap; a POSIX path stays rejected.
 */
function canonicalizeFilesAddress(value) {
  let source = String(value ?? "").trim();
  if (source.startsWith("/")) {
    const rest = source.slice(1);
    const first = rest.split("/", 1)[0];
    if (first === "Home" || DOWNLOADABLE.has(first)) source = rest;
  }
  if (source === "Home" || source.startsWith("Home/")) source = `drive/${source}`;
  return source;
}

/**
 * @returns a validated `<fileType>/<extend>/<subPath>` files-backend address.
 * @throws when the value is empty, a URL, a directory, or outside downloadable namespaces.
 */
export function parseFilesPath(value) {
  const source = canonicalizeFilesAddress(value);
  if (source === "" || source.includes("\0")) {
    throw new Error("path is required, e.g. drive/Home/Documents/clip.webm");
  }
  if (source.startsWith("/") || /^[a-z]+:/i.test(source)) {
    throw new Error(`"${source}" is not an Olares files path; expected <fileType>/<extend>/<subPath>`);
  }
  if (source.endsWith("/")) {
    throw new Error(`"${source}" names a directory; expected a single file`);
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

export function isFilesPath(value) {
  try {
    parseFilesPath(value);
    return true;
  } catch {
    return false;
  }
}
