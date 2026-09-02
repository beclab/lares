/**
 * An Olares files path (`<fileType>/<extend>/<subPath…>`) names one object on
 * the user's files backend. Preview serves it in place; drive_fetch copies it
 * into the session workspace only when a later edit or transcode needs a local
 * file. A produced-file chip is rendered from `presentCall` before the tool
 * runs, so the path in the arguments is the path the UI opens.
 */
import { posixBasename as basename, posixExtname as extname, sanitizeFilename } from "../files/filename.js";
import { isFilesPath, parseFilesPath } from "./files-path.js";

export { isFilesPath, parseFilesPath } from "./files-path.js";

const DEFAULT_DIRECTORY = "downloads";

const DATA_NAMES = new Map([
  ["image/jpeg", "download.jpg"],
  ["image/jpg", "download.jpg"],
  ["image/png", "download.png"],
  ["image/gif", "download.gif"],
  ["image/webp", "download.webp"],
  ["image/bmp", "download.bmp"],
  ["video/mp4", "download.mp4"],
  ["video/webm", "download.webm"],
  ["video/quicktime", "download.mov"],
  ["audio/mpeg", "download.mp3"],
  ["audio/wav", "download.wav"],
  ["audio/ogg", "download.ogg"],
  ["audio/mp4", "download.m4a"],
  ["audio/aac", "download.aac"],
  ["audio/flac", "download.flac"],
  ["application/pdf", "download.pdf"],
  ["model/gltf-binary", "download.glb"],
  ["model/gltf+json", "download.gltf"],
  ["model/obj", "download.obj"],
]);

function dataUrlFilename(mediaType) {
  return DATA_NAMES.get(String(mediaType ?? "").split(";", 1)[0].trim().toLowerCase()) ?? null;
}

export const DRIVE_TRANSFER_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Default media-loading contract. A pasted or requested file must land on the
 * conversation preview without extra user wording. Knowledge / Wise / yt-dlp
 * may land in Olares Files; that path is previewable as-is. Copying into the
 * workspace is only for edit or transcode.
 */
export const DRIVE_IMPORT_PROMPT = [
  "When the user pastes, shares, or asks to find, download, show, or play an image, video, audio,",
  "document, or other file, load it into this conversation so it previews under the reply. That is",
  "the default: they do not need to say preview in chat, don't just give a link, or don't open Files.",
  "Never reply with only a hyperlink, and never tell them to open Olares Files instead. Size is never",
  "a reason to skip preview.",
  "Olares files paths (drive/…, sync/…, cache/…, external/…, and the cloud-account namespaces)",
  "are previewable in this app. Any file under drive/Home is included — Documents, Pictures, Music,",
  "Movies, Downloads, Code, and the rest — not only Downloads. After knowledge / Wise / yt-dlp /",
  "torrent lands a file there, workspace_publish that files path immediately and name it in",
  "markdown inline code. Do not copy it into the workspace only to preview it.",
  "Direct public HTTP(S) file URLs and data: URLs use url_fetch; never curl, wget, or shell.",
  "Give destination a meaningful filename with the correct extension whenever the URL path lacks one.",
  "drive_fetch copies one files-backend file into the workspace when a later edit or transcode",
  "(for example ffmpeg_encode) needs it there. url_fetch and ffmpeg_encode already publish their",
  "workspace output. workspace_publish is for a file that already exists in the workspace or on",
  "the files backend that those tools did not produce. Do not call it after drive_fetch, url_fetch,",
  "or ffmpeg_encode. A subagent's own tool calls belong to its child turn: when a subagent reports",
  "a final path, the parent must call workspace_publish on that path before replying.",
  "Never bypass a url_fetch rejection or failure with curl, wget, shell, Python, Node, a browser, or",
  "another network client. A non-public host refusal is a security boundary: report that the URL",
  "cannot be fetched and ask for a public URL or Olares Files path instead of trying it directly.",
  "Use ffmpeg_encode to generate or transcode H.264 video, including burning SRT, VTT, ASS, or SSA",
  "subtitles into an input video. Do not transcode merely so a file can be previewed: webm, mp4,",
  "images, and audio preview as-is from a files path or after url_fetch. Do not run ffmpeg or ffprobe",
  "in the shell for those jobs. Report the encoder and speed from the tool result.",
  "Name every returned workspace or Olares files path in markdown inline code so the UI can open it.",
  "The conversation renders produced images, video, and audio right below the reply, so put those",
  "mentions in the closing sentences and end the reply there: never name a produced file mid-reply",
  "and then continue with more prose, alternatives, or follow-up questions, which would strand the",
  "player far below the path.",
].join(" ");

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
  const source = parseFilesPath(args?.path);
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
  if (isFilesPath(raw)) {
    return { path: parseFilesPath(raw), origin: "files" };
  }
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
  return { path: segments.join("/"), origin: "workspace" };
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
