/**
 * An Olares files path (`<fileType>/<extend>/<subPath…>`) names the user's
 * files backend, which this pod does not mount: nothing under it can be read,
 * edited, or previewed in place. The fetch destination is workspace-relative,
 * and it must be derivable from the call arguments alone — the produced-file
 * chip that opens the result is rendered from `presentCall`, before the
 * download runs — so a colliding name is refused rather than numbered.
 */
import { basename, extname } from "node:path/posix";
import { sanitizeFilename } from "../files/upload.js";
import { dataUrlFilename } from "./url-download.js";

/** Namespaces `olares-cli files download` serves. */
const DOWNLOADABLE = new Set([
  "drive", "cache", "sync", "external", "awss3", "google", "dropbox", "tencent",
]);
const DEFAULT_DIRECTORY = "downloads";

export const DRIVE_TRANSFER_TIMEOUT_MS = 30 * 60 * 1000;

export const DRIVE_IMPORT_PROMPT = [
  "Olares files paths (drive/…, sync/…, external/…, and the cloud-account namespaces) live in the",
  "user's files backend, not in this workspace: they cannot be read, edited, or previewed in place,",
  "and a download task started through olares-cli knowledge lands there too.",
  "Use drive_fetch to copy one such file into the workspace whenever the user wants to open, preview,",
  "or work on it.",
  "When the user asks to find or download an online image, video, audio, document, or other URL, use",
  "web search to find a direct public HTTP(S) URL, then use url_fetch to copy it into the workspace;",
  "do not use curl, wget, or shell for that download. Give destination a meaningful filename with the",
  "correct extension whenever the URL path lacks one.",
  "Never bypass a url_fetch rejection or failure with curl, wget, shell, Python, Node, a browser, or",
  "another network client. In particular, a non-public host refusal is a security boundary: report that",
  "the URL cannot be fetched and ask for a public URL or Olares Files path instead of trying it directly.",
  "When olares-cli router, FlowStudio, a skill, or another workflow generates media, normalize its final",
  "output before replying: use url_fetch for a returned HTTP(S) URL or a data: URL / base64 payload",
  "(wrap raw base64 as data:<mediaType>;base64,...), drive_fetch for an Olares Files path, or",
  "workspace_publish when the output is already a file in this session workspace. Do not stop at a task",
  "id, expiring URL, or unregistered shell-created path. After a skill or another shell command creates",
  "or transforms a file that ffmpeg_encode does not cover, call workspace_publish for each final output,",
  "not temporary intermediates. A subagent's own tool calls belong to its child turn and do not publish",
  "a file in the parent conversation: when a subagent reports a final workspace path, the parent must",
  "call workspace_publish on that path before replying.",
  "Use ffmpeg_encode to generate or transcode H.264 video, including burning SRT, VTT, ASS, or SSA",
  "subtitles into an input video. It writes the file with libx264 and publishes it for preview.",
  "Do not run ffmpeg or ffprobe in the shell for those jobs, and do not call workspace_publish",
  "afterwards. Report the encoder and speed from the tool result.",
  "Name every returned workspace path in markdown inline code so the UI can open it. The conversation",
  "renders produced images, video, and audio right below the reply, so put those mentions in the closing",
  "sentences and end the reply there: never name a produced file mid-reply and then continue with more",
  "prose, alternatives, or follow-up questions, which would strand the player far below the path.",
].join(" ");

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
const SUBTITLE_EXT = new Set([".ass", ".srt", ".ssa", ".vtt"]);
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
  const subtitlesRaw = args?.subtitles === undefined
    || args?.subtitles === null
    || String(args.subtitles).trim() === ""
    ? ""
    : parseWorkspaceRelative(args.subtitles, "subtitles");
  const patternRaw = String(args?.pattern ?? "").trim().toLowerCase();
  const pattern = patternRaw === "" ? "" : patternRaw;
  if (Boolean(inputRaw) === Boolean(pattern)) {
    throw new Error("ffmpeg_encode needs exactly one of input or pattern");
  }
  if (pattern && pattern !== PATTERN) {
    throw new Error(`pattern must be ${PATTERN}`);
  }
  if (subtitlesRaw && !inputRaw) {
    throw new Error("subtitles require an input video");
  }
  if (subtitlesRaw && !SUBTITLE_EXT.has(extname(subtitlesRaw).toLowerCase())) {
    throw new Error("subtitles must end in .ass, .srt, .ssa, or .vtt");
  }
  const width = evenDim(args?.width, 1280, "width");
  const height = evenDim(args?.height, 720, "height");
  const destination = defaultEncodeDestination(args, inputRaw, pattern);
  if (extname(destination).toLowerCase() !== ".mp4") {
    throw new Error("destination must end in .mp4");
  }
  return {
    input: inputRaw || null,
    subtitles: subtitlesRaw || null,
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
