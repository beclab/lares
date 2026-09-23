import { open, stat } from "node:fs/promises";
import { basename, extname, relative } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { filesPathAfterPrefix, isFilesNamespace, parseFilesPath } from "../drive/files-path.js";
import { HttpError } from "../tools/http.js";
import {
  resolveExistingWorkspacePath,
  resolveWorkspaceRoot,
  workspaceCandidate,
  workspaceFileAlias,
} from "../workspace/path.js";
import { resolveLocalPreviewFile } from "./preview-local.js";

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
const MODEL3D_TYPES = new Map([
  [".glb", "model/gltf-binary"],
]);
const TEXT_EXTENSIONS = new Set([
  "",
  ".txt", ".log", ".json", ".csv", ".tsv", ".yaml", ".yml", ".toml", ".xml",
  ".html", ".htm", ".css", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".sh", ".bash", ".zsh", ".env", ".ini", ".cfg", ".conf", ".rs",
  ".go", ".java", ".kt", ".c", ".h", ".cpp", ".hpp", ".sql", ".r", ".rb",
  ".php", ".swift", ".vue", ".svelte", ".mdx", ".gitignore", ".dockerignore",
  ".editorconfig", ".srt", ".vtt", ".ass", ".ssa",
  ".gltf", ".obj",
]);

export function previewQueryFromUrl(reqUrl) {
  const url = new URL(reqUrl ?? "/", "http://x");
  const path = url.searchParams.get("path");
  if (!path) throw new HttpError("path_invalid", 400, "file path is required");
  return { path, sessionId: url.searchParams.get("sessionId") };
}

function asPreviewHttpError(error) {
  if (error instanceof HttpError) return error;
  const code = error?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (code === "file_not_found") return new HttpError("file_not_found", 404, "file was not found");
  if (code === "path_not_file") return new HttpError("path_not_file", 415, "path is not a regular file");
  if (code === "path_invalid") return new HttpError("path_invalid", 400, message);
  return new HttpError("file_preview_failed", 502, message);
}

export async function resolveFilesPreviewFile(requestedPath, deps = {}) {
  let source;
  try {
    source = parseFilesPath(requestedPath);
  } catch (error) {
    throw new HttpError("path_invalid", 400, error instanceof Error ? error.message : String(error));
  }
  try {
    if (typeof deps.stat !== "function") {
      throw new HttpError("files_unavailable", 503, "Olares Files client is unavailable");
    }
    const info = await deps.stat(source, deps);
    return {
      origin: "files",
      path: info.path,
      name: info.name,
      size: info.size,
      modifiedAt: info.modifiedAt,
      ...previewTypeForName(info.name),
    };
  } catch (error) {
    throw asPreviewHttpError(error);
  }
}

function joinedFilesAddress(workspacePath, root, requestedPath) {
  return filesPathAfterPrefix(workspacePath, requestedPath)
    ?? filesPathAfterPrefix(root, requestedPath);
}

export async function fileFromPreviewRequest(reqUrl, resolveWorkspace, deps = {}) {
  const { path, sessionId } = previewQueryFromUrl(reqUrl);
  if (isFilesNamespace(path)) return resolveFilesPreviewFile(path, deps);
  const local = await (deps.resolveLocal ?? resolveLocalPreviewFile)(path, deps);
  if (local) return { ...local, ...previewTypeForName(local.absolutePath) };
  const workspace = await resolveWorkspace(sessionId);
  const root = await resolveWorkspaceRoot(workspace.path);
  try {
    return await resolveWorkspaceFile(root, path);
  } catch (error) {
    // A real workspace file of the same name wins. dsh joins Files addresses
    // onto cwd; that prefix may be the lexical workspace path or its realpath.
    const joined = error?.code === "file_not_found" || error?.code === "path_forbidden";
    const address = joined ? joinedFilesAddress(workspace.path, root, path) : null;
    if (address === null) throw error;
    return resolveFilesPreviewFile(address, deps);
  }
}

async function ensurePreviewBytes(file, deps = {}) {
  if (file.absolutePath) return file;
  throw new HttpError("file_preview_failed", 500, "file has no local path");
}

export function previewTypeForName(name) {
  const extension = extname(name).toLowerCase();
  if (IMAGE_TYPES.has(extension)) return { kind: "image", mediaType: IMAGE_TYPES.get(extension) };
  if (VIDEO_TYPES.has(extension)) return { kind: "video", mediaType: VIDEO_TYPES.get(extension) };
  if (AUDIO_TYPES.has(extension)) return { kind: "audio", mediaType: AUDIO_TYPES.get(extension) };
  if (MODEL3D_TYPES.has(extension)) return { kind: "model3d", mediaType: MODEL3D_TYPES.get(extension) };
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
  let candidate;
  try {
    candidate = workspaceCandidate(root, requestedPath);
  } catch (error) {
    const alias = workspaceFileAlias(root, requestedPath);
    if (!alias || error?.code !== "path_forbidden") throw error;
    try {
      candidate = workspaceCandidate(root, alias);
    } catch {
      throw error;
    }
  }
  const absolutePath = await resolveExistingWorkspacePath(root, candidate).catch((error) => {
    if (workspaceFileAlias(root, requestedPath) && error?.code === "file_not_found") {
      throw new HttpError("path_forbidden", 403, "path leaves the session workspace");
    }
    throw error;
  });
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

export async function buildPreview(file, deps) {
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
  if (file.origin === "files") {
    if (typeof deps?.readFilesRaw !== "function") {
      throw new HttpError("files_unavailable", 503, "Olares Files client is unavailable");
    }
    let raw;
    try {
      raw = await deps.readFilesRaw(file.path, MAX_PREVIEW_TEXT_BYTES + 1);
    } catch (error) {
      throw asPreviewHttpError(error);
    }
    const truncated = file.size > MAX_PREVIEW_TEXT_BYTES || raw.truncated;
    const read = raw.bytes.subarray(0, MAX_PREVIEW_TEXT_BYTES);
    const body = truncated ? trimPartialUtf8(read) : read;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
      if (!knownText && !looksLikeText(text)) return metadata;
      return {
        ...metadata,
        kind: knownText ? file.kind : "text",
        mediaType: knownText ? file.mediaType : "text/plain; charset=utf-8",
        text,
        truncated,
      };
    } catch (error) {
      if (error instanceof TypeError) {
        if (!knownText) return metadata;
        throw new HttpError("file_not_text", 415, "file is not valid UTF-8 text");
      }
      throw error;
    }
  }
  const local = await ensurePreviewBytes(file, deps);
  const handle = await openVerified(local);
  try {
    const length = Math.min(local.size, MAX_PREVIEW_TEXT_BYTES + 1);
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
      truncated: local.size > MAX_PREVIEW_TEXT_BYTES,
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

export async function openVerified(file) {
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

function filesDispositionHeaders(file, disposition) {
  return {
    "accept-ranges": "bytes",
    "cache-control": "private, no-cache",
    "content-type": file.mediaType,
    "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    "x-content-type-options": "nosniff",
  };
}

async function sendFilesFile(req, res, file, disposition, deps = {}) {
  // HEAD is answered from the listing we already did. Files has no HEAD verb;
  // a 1-byte GET probe must not become the download preflight's size.
  if (req.method === "HEAD") {
    const range = parseRange(req.headers.range, file.size);
    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, file.size - 1);
    const headers = {
      ...filesDispositionHeaders(file, disposition),
      "content-length": String(file.size === 0 ? 0 : end - start + 1),
    };
    if (range) headers["content-range"] = `bytes ${start}-${end}/${file.size}`;
    res.writeHead(range ? 206 : 200, headers);
    res.end();
    return;
  }
  if (typeof deps.openFilesRaw !== "function") {
    throw new HttpError("files_unavailable", 503, "Olares Files client is unavailable");
  }
  let response;
  try {
    response = await deps.openFilesRaw(file.path, {
      method: "GET",
      range: req.headers.range,
    });
  } catch (error) {
    throw asPreviewHttpError(error);
  }
  const headers = filesDispositionHeaders(file, disposition);
  for (const name of ["accept-ranges", "content-length", "content-range"]) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }
  res.writeHead(response.status, headers);
  if (!response.body) {
    res.end();
    return;
  }
  await pipeline(Readable.fromWeb(response.body), res);
}

/**
 * The rendition this request asked for, or null for the stored bytes.
 *
 * Only an image on the files backend has one, because only there does a
 * resized copy already exist: the backend renders it once and caches it. A
 * conversation showing a 4000px generation at a few hundred pixels wide is
 * the case this exists for. Opening the file and downloading it both stay on
 * the original, so what is displayed and what is kept stay separate choices.
 */
export function previewSizeFromUrl(reqUrl, file) {
  if (file?.origin !== "files" || file?.kind !== "image") return null;
  const size = new URL(reqUrl ?? "/", "http://x").searchParams.get("size");
  return ["thumb", "big"].includes(size) ? size : null;
}

/**
 * A rendition is not the stored bytes, so it carries neither the original's
 * length nor byte ranges. HEAD is answered without fetching one: the only
 * honest length is the rendered one, and rendering a copy to describe and
 * then discard is worse than omitting a header HEAD does not require.
 */
async function sendFilesRendition(req, res, file, size, deps = {}) {
  const headers = {
    "cache-control": "private, no-cache",
    "content-type": file.mediaType,
    "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    "x-content-type-options": "nosniff",
  };
  if (req.method === "HEAD") {
    res.writeHead(200, headers);
    res.end();
    return;
  }
  if (typeof deps.openFilesPreview !== "function") {
    throw new HttpError("files_unavailable", 503, "Olares Files client is unavailable");
  }
  let response;
  try {
    response = await deps.openFilesPreview(file.path, { size });
  } catch (error) {
    throw asPreviewHttpError(error);
  }
  headers["content-type"] = response.headers.get("content-type") || file.mediaType;
  const length = response.headers.get("content-length");
  if (length) headers["content-length"] = length;
  res.writeHead(response.status, headers);
  if (!response.body) {
    res.end();
    return;
  }
  await pipeline(Readable.fromWeb(response.body), res);
}

export async function sendRawFile(req, res, file, deps) {
  if (!["image", "video", "audio", "pdf", "model3d"].includes(file.kind)) {
    throw new HttpError("preview_unsupported", 415, "raw preview is not supported for this file");
  }
  // Video and audio are range-streamed, so their total size is not browser
  // memory pressure. Images, PDFs, and 3D meshes are consumed as whole documents.
  if (["image", "pdf", "model3d"].includes(file.kind) && file.size > MAX_RAW_BYTES) {
    throw new HttpError("file_too_large", 413, `file exceeds ${MAX_RAW_BYTES} bytes`);
  }
  const size = previewSizeFromUrl(req.url, file);
  if (size) return sendFilesRendition(req, res, file, size, deps);
  if (file.origin === "files") return sendFilesFile(req, res, file, "inline", deps);
  return sendFile(req, res, await ensurePreviewBytes(file, deps), "inline");
}

/**
 * Saving a file is not previewing it: the kind and size limits guard what a
 * media element or iframe will be asked to hold, and neither says anything
 * about what the user may keep a copy of.
 */
export async function sendFileDownload(req, res, file, deps) {
  if (file.origin === "files") return sendFilesFile(req, res, file, "attachment", deps);
  return sendFile(req, res, await ensurePreviewBytes(file, deps), "attachment");
}
