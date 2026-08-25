/**
 * An Olares files path (`<fileType>/<extend>/<subPath…>`) names the user's
 * files backend, which this pod does not mount: nothing under it can be read,
 * edited, or previewed in place. The fetch destination is workspace-relative,
 * and it must be derivable from the call arguments alone — the produced-file
 * chip that opens the result is rendered from `presentCall`, before the
 * download runs — so a colliding name is refused rather than numbered.
 */
import { basename, extname } from "node:path/posix";
import { sanitizeFilename } from "../../file-input/host/storage.js";
import { dataUrlFilename } from "./url-download.js";

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

function parseDataSource(value) {
  const raw = String(value ?? "").trim();
  if (!raw.toLowerCase().startsWith("data:")) return null;
  const comma = raw.indexOf(",");
  if (comma < 5) throw new Error("data URL is missing a payload");
  const meta = raw.slice(5, comma);
  const parts = meta.split(";").map((part) => part.trim()).filter(Boolean);
  const mediaType = (parts.find((part) => part.includes("/")) || "application/octet-stream")
    .split(";", 1)[0]
    .trim()
    .toLowerCase() || "application/octet-stream";
  return { source: "data:", mediaType };
}

function parseUrlSource(value) {
  const data = parseDataSource(value);
  if (data) return data;
  const raw = String(value ?? "").trim();
  if (raw === "" || raw.length > 4_096 || raw.includes("\0")) {
    throw new Error("url is required and must be at most 4096 characters");
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`"${raw}" is not a valid URL`);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname) {
    throw new Error("url_fetch accepts only public HTTP(S) URLs without embedded credentials");
  }
  url.hash = "";
  return { source: url.href, mediaType: null };
}

function urlFilename(source) {
  const url = new URL(source);
  let name;
  try {
    name = decodeURIComponent(basename(url.pathname));
  } catch {
    name = basename(url.pathname);
  }
  const safe = sanitizeFilename(name || "download");
  return extname(safe) === "" ? null : safe;
}

export function resolveUrlFetch(args) {
  const parsed = parseUrlSource(args?.url);
  if (parsed.source === "data:") {
    const inferred = dataUrlFilename(parsed.mediaType);
    if ((args?.destination === undefined || String(args.destination).trim() === "") && inferred === null) {
      throw new Error("destination with a file extension is required when the data URL has no known media type");
    }
    return {
      kind: "data",
      source: "data:",
      destination: parseDestination(args?.destination, inferred ?? "download.bin"),
    };
  }
  const inferred = urlFilename(parsed.source);
  if ((args?.destination === undefined || String(args.destination).trim() === "") && inferred === null) {
    throw new Error("destination with a file extension is required when the URL path has no extension");
  }
  return {
    kind: "http",
    source: parsed.source,
    destination: parseDestination(args?.destination, inferred ?? "download.bin"),
  };
}

export function describeUrlFetch(args) {
  try {
    return resolveUrlFetch(args);
  } catch {
    return null;
  }
}

export function resolveWorkspacePublish(args) {
  const raw = String(args?.path ?? "").trim().replace(/\\/g, "/");
  const segments = raw.split("/");
  if (
    raw === ""
    || raw.startsWith("/")
    || raw.endsWith("/")
    || raw.includes("\0")
    || segments.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error("path must name one existing file inside the workspace");
  }
  return { path: segments.join("/") };
}

export function describeWorkspacePublish(args) {
  try {
    return resolveWorkspacePublish(args);
  } catch {
    return null;
  }
}

const PATTERN = "testsrc2";
const VIDEO_EXT = new Set([".mp4", ".mkv", ".mov"]);
const DEFAULT_ENCODE_DIRECTORY = "outputs";
const PATTERN_RATE = 30;

function parseWorkspaceRelative(value, label) {
  const raw = String(value ?? "").trim().replace(/\\/g, "/");
  const segments = raw.split("/");
  if (
    raw === ""
    || raw.startsWith("/")
    || raw.endsWith("/")
    || raw.includes("\0")
    || segments.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`${label} must name one file inside the workspace`);
  }
  return segments.join("/");
}

function evenDim(value, fallback, label) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 16 || n > 3840) {
    throw new Error(`${label} must be an integer from 16 to 3840`);
  }
  return n - (n % 2);
}

function parseDuration(value, required) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error("duration is required when generating a pattern");
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0.1 || n > 600) {
    throw new Error("duration must be between 0.1 and 600 seconds");
  }
  return n;
}

function lavfiSource(width, height) {
  return `${PATTERN}=size=${width}x${height}:rate=${PATTERN_RATE}`;
}

function defaultEncodeDestination(args, input, pattern) {
  if (args?.destination !== undefined && String(args.destination).trim() !== "") {
    return parseWorkspaceRelative(args.destination, "destination");
  }
  if (input) {
    const name = basename(input);
    const stem = extname(name) === "" ? name : name.slice(0, -extname(name).length);
    return `${DEFAULT_ENCODE_DIRECTORY}/${stem}.mp4`;
  }
  return `${DEFAULT_ENCODE_DIRECTORY}/${pattern}.mp4`;
}

export function resolveFfmpegEncode(args) {
  const inputRaw = args?.input === undefined || args?.input === null || String(args.input).trim() === ""
    ? ""
    : parseWorkspaceRelative(args.input, "input");
  const patternRaw = String(args?.pattern ?? "").trim().toLowerCase();
  const pattern = patternRaw === "" ? "" : patternRaw;
  if (Boolean(inputRaw) === Boolean(pattern)) {
    throw new Error("ffmpeg_encode needs exactly one of input or pattern");
  }
  if (pattern && pattern !== PATTERN) {
    throw new Error(`pattern must be ${PATTERN}`);
  }
  const width = evenDim(args?.width, 1280, "width");
  const height = evenDim(args?.height, 720, "height");
  const destination = defaultEncodeDestination(args, inputRaw, pattern);
  if (!VIDEO_EXT.has(extname(destination).toLowerCase())) {
    throw new Error("destination must end in .mp4, .mkv, or .mov");
  }
  return {
    input: inputRaw || null,
    pattern: pattern || null,
    lavfi: pattern ? lavfiSource(width, height) : null,
    duration: parseDuration(args?.duration, Boolean(pattern)),
    destination,
    overwrite: args?.overwrite === true,
  };
}

export function describeFfmpegEncode(args) {
  try {
    return resolveFfmpegEncode(args);
  } catch {
    return null;
  }
}
