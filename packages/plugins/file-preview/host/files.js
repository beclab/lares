import { open, stat } from "node:fs/promises";
import { basename, extname, relative } from "node:path";
import { HttpError } from "../../shared/host/http.js";
import {
  resolveExistingWorkspacePath,
  resolveWorkspaceRoot,
  workspaceCandidate,
} from "../../shared/host/workspace-path.js";

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
    ".editorconfig", ".srt", ".vtt", ".ass", ".ssa",
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

export async function resolveWorkspaceFile(workspacePath, requestedPath) {
  if (typeof requestedPath !== "string" || !requestedPath.trim() || requestedPath.includes("\0")) {
    throw new HttpError("path_invalid", 400, "file path is required");
  }
  const root = await resolveWorkspaceRoot(workspacePath);
  const candidate = workspaceCandidate(root, requestedPath);
  const absolutePath = await resolveExistingWorkspacePath(root, candidate);
  const info = await stat(absolutePath).catch(() => {
    throw new HttpError("file_not_found", 404, "file was not found");
  });
  // Distinct from a missing file: a directory is a legitimate open target that
  // this route simply does not serve, and the caller decides what to do with it.
  if (!info.isFile()) throw new HttpError("path_not_file", 415, "path is not a regular file");
  return {
    absolutePath,
    path: relative(root, absolutePath),
    name: basename(absolutePath),
    size: info.size,
    modifiedAt: info.mtimeMs,
    device: info.dev,
    inode: info.ino,
    ...previewTypeForName(absolutePath),
  };
}

/**
 * The truncation cut is a byte offset, so it can land inside a multi-byte
 * character. Dropping that partial tail keeps a truncated preview from being
 * reported as a non-text file.
 */
function trimPartialUtf8(body) {
  for (let back = 1; back <= 3 && back <= body.length; back += 1) {
    const byte = body[body.length - back];
    if ((byte & 0xc0) === 0x80) continue;
    const width = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    return width > back ? body.subarray(0, body.length - back) : body;
  }
  return body;
}

export async function buildPreview(file) {
  const metadata = {
    path: file.path,
    name: file.name,
    kind: file.kind,
    mediaType: file.mediaType,
    size: file.size,
    modifiedAt: file.modifiedAt,
  };
  const knownText = ["text", "markdown"].includes(file.kind);
  if (!knownText && file.kind !== "unsupported") return metadata;
  const handle = await openVerified(file);
  try {
    const length = Math.min(file.size, MAX_PREVIEW_TEXT_BYTES + 1);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    const truncated = bytesRead > MAX_PREVIEW_TEXT_BYTES;
    const read = buffer.subarray(0, Math.min(bytesRead, MAX_PREVIEW_TEXT_BYTES));
    const body = truncated ? trimPartialUtf8(read) : read;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    if (!knownText && !looksLikeText(text)) return metadata;
    return {
      ...metadata,
      kind: knownText ? file.kind : "text",
      mediaType: knownText ? file.mediaType : "text/plain; charset=utf-8",
      text,
      truncated: file.size > MAX_PREVIEW_TEXT_BYTES,
    };
  } catch (error) {
    if (error instanceof TypeError) {
      if (!knownText) return metadata;
      throw new HttpError("file_not_text", 415, "file is not valid UTF-8 text");
    }
    throw error;
  } finally {
    await handle.close();
  }
}

async function openVerified(file) {
  let handle;
  try {
    handle = await open(file.absolutePath, "r");
    const info = await handle.stat();
    if (
      info.dev !== file.device
      || info.ino !== file.inode
      || info.size !== file.size
      || info.mtimeMs !== file.modifiedAt
    ) {
      throw new HttpError("file_changed", 409, "file changed while it was being opened");
    }
    return handle;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.code === "ENOENT") {
      throw new HttpError("file_not_found", 404, "file was not found");
    }
    throw error;
  }
}

function looksLikeText(text) {
  if (text.includes("\0")) return false;
  let controls = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code < 32 && char !== "\n" && char !== "\r" && char !== "\t") controls += 1;
  }
  return controls <= Math.max(2, text.length / 100);
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

async function sendFile(req, res, file, disposition) {
  const range = parseRange(req.headers.range, file.size);
  const handle = await openVerified(file);
  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, file.size - 1);
  const headers = {
    "accept-ranges": "bytes",
    "cache-control": "private, no-cache",
    "content-type": file.mediaType,
    "content-length": String(file.size === 0 ? 0 : end - start + 1),
    "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    "x-content-type-options": "nosniff",
  };
  if (range) headers["content-range"] = `bytes ${start}-${end}/${file.size}`;
  res.writeHead(range ? 206 : 200, headers);
  if (req.method === "HEAD" || file.size === 0) {
    await handle.close();
    res.end();
    return;
  }
  const stream = handle.createReadStream({ start, end, autoClose: true });
  stream.on("error", (error) => {
    if (!res.headersSent) res.destroy(error);
    else res.destroy();
  });
  stream.pipe(res);
}

export function sendRawFile(req, res, file) {
  if (!["image", "video", "audio", "pdf"].includes(file.kind)) {
    throw new HttpError("preview_unsupported", 415, "raw preview is not supported for this file");
  }
  // Video and audio are range-streamed, so their total size is not browser
  // memory pressure. Images and PDFs are consumed as whole documents.
  if (["image", "pdf"].includes(file.kind) && file.size > MAX_RAW_BYTES) {
    throw new HttpError("file_too_large", 413, `file exceeds ${MAX_RAW_BYTES} bytes`);
  }
  return sendFile(req, res, file, "inline");
}

/**
 * Saving a file is not previewing it: the kind and size limits guard what a
 * media element or iframe will be asked to hold, and neither says anything
 * about what the user may keep a copy of.
 */
export function sendFileDownload(req, res, file) {
  return sendFile(req, res, file, "attachment");
}
