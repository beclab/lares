import { createReadStream } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { HttpError } from "../../shared/host/http.js";

export const MAX_PREVIEW_TEXT_BYTES = 1024 * 1024;
export const MAX_RAW_BYTES = 200 * 1024 * 1024;

const IMAGE_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".bmp", "image/bmp"],
]);
const VIDEO_TYPES = new Map([
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".mov", "video/quicktime"],
  [".m4v", "video/x-m4v"],
  [".ogv", "video/ogg"],
]);
const AUDIO_TYPES = new Map([
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".ogg", "audio/ogg"],
  [".m4a", "audio/mp4"],
  [".aac", "audio/aac"],
  [".flac", "audio/flac"],
]);
const TEXT_EXTENSIONS = new Set([
  "",
  ".txt", ".log", ".json", ".csv", ".tsv", ".yaml", ".yml", ".toml", ".xml",
  ".html", ".htm", ".css", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".sh", ".bash", ".zsh", ".env", ".ini", ".cfg", ".conf", ".rs",
  ".go", ".java", ".kt", ".c", ".h", ".cpp", ".hpp", ".sql", ".r", ".rb",
  ".php", ".swift", ".vue", ".svelte", ".mdx", ".gitignore", ".dockerignore",
  ".editorconfig",
]);

export function previewTypeForName(name) {
  const extension = extname(name).toLowerCase();
  if (IMAGE_TYPES.has(extension)) return { kind: "image", mediaType: IMAGE_TYPES.get(extension) };
  if (VIDEO_TYPES.has(extension)) return { kind: "video", mediaType: VIDEO_TYPES.get(extension) };
  if (AUDIO_TYPES.has(extension)) return { kind: "audio", mediaType: AUDIO_TYPES.get(extension) };
  if (extension === ".pdf") return { kind: "pdf", mediaType: "application/pdf" };
  if (extension === ".md" || extension === ".markdown") {
    return { kind: "markdown", mediaType: "text/markdown; charset=utf-8" };
  }
  if (TEXT_EXTENSIONS.has(extension)) return { kind: "text", mediaType: "text/plain; charset=utf-8" };
  return { kind: "unsupported", mediaType: "application/octet-stream" };
}

function isInside(root, target) {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

export async function resolveWorkspaceFile(workspacePath, requestedPath) {
  if (typeof requestedPath !== "string" || !requestedPath.trim() || requestedPath.includes("\0")) {
    throw new HttpError("path_invalid", 400, "file path is required");
  }
  const root = await realpath(workspacePath).catch(() => {
    throw new HttpError("workspace_unavailable", 409, "session workspace is unavailable");
  });
  const candidate = resolve(root, requestedPath);
  if (!isInside(root, candidate)) {
    throw new HttpError("path_forbidden", 403, "file path leaves the session workspace");
  }
  const absolutePath = await realpath(candidate).catch(() => {
    throw new HttpError("file_not_found", 404, "file was not found");
  });
  if (!isInside(root, absolutePath)) {
    throw new HttpError("path_forbidden", 403, "file path leaves the session workspace");
  }
  const info = await stat(absolutePath).catch(() => {
    throw new HttpError("file_not_found", 404, "file was not found");
  });
  if (!info.isFile()) throw new HttpError("file_not_found", 404, "path is not a file");
  return {
    absolutePath,
    path: relative(root, absolutePath),
    name: basename(absolutePath),
    size: info.size,
    modifiedAt: info.mtimeMs,
    ...previewTypeForName(absolutePath),
  };
}

export async function buildPreview(file) {
  if (!["text", "markdown"].includes(file.kind)) {
    return {
      path: file.path,
      name: file.name,
      kind: file.kind,
      mediaType: file.mediaType,
      size: file.size,
    };
  }
  const handle = await open(file.absolutePath, "r");
  try {
    const length = Math.min(file.size, MAX_PREVIEW_TEXT_BYTES + 1);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    const body = buffer.subarray(0, Math.min(bytesRead, MAX_PREVIEW_TEXT_BYTES));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return {
      path: file.path,
      name: file.name,
      kind: file.kind,
      mediaType: file.mediaType,
      size: file.size,
      text,
      truncated: file.size > MAX_PREVIEW_TEXT_BYTES,
    };
  } catch (error) {
    if (error instanceof TypeError) {
      throw new HttpError("file_not_text", 415, "file is not valid UTF-8 text");
    }
    throw error;
  } finally {
    await handle.close();
  }
}

export function parseRange(value, size) {
  if (value === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(value).trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) {
    throw new HttpError("range_not_satisfiable", 416, "invalid byte range");
  }
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) {
      throw new HttpError("range_not_satisfiable", 416, "invalid byte range");
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
    throw new HttpError("range_not_satisfiable", 416, "invalid byte range");
  }
  return { start, end: Math.min(end, size - 1) };
}

export function sendRawFile(req, res, file) {
  if (!["image", "video", "audio", "pdf"].includes(file.kind)) {
    throw new HttpError("preview_unsupported", 415, "raw preview is not supported for this file");
  }
  if (file.size > MAX_RAW_BYTES) {
    throw new HttpError("file_too_large", 413, `file exceeds ${MAX_RAW_BYTES} bytes`);
  }
  const range = parseRange(req.headers.range, file.size);
  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, file.size - 1);
  const headers = {
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=60",
    "content-type": file.mediaType,
    "content-length": String(file.size === 0 ? 0 : end - start + 1),
    "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    "x-content-type-options": "nosniff",
  };
  if (range) headers["content-range"] = `bytes ${start}-${end}/${file.size}`;
  res.writeHead(range ? 206 : 200, headers);
  if (req.method === "HEAD" || file.size === 0) {
    res.end();
    return;
  }
  createReadStream(file.absolutePath, { start, end }).pipe(res);
}
