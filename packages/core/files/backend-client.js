import { HttpError } from "../tools/http.js";
import { parseFilesPath } from "../drive/files-path.js";
import { findFilesChild, isDirectoryItem, itemModifiedAt, itemSize } from "../drive/ls.js";
import { identityFromHeaders, olaresUsername } from "../olares/identity.js";

const MAX_ERROR_BYTES = 256;

function headerValue(headers, name) {
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(name) ?? "";
  }
  const raw = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(raw) ? raw.join(",") : String(raw ?? "");
}

function hasAuthCookie(cookie) {
  return cookie.split(";").some((part) => {
    const [name, ...rest] = part.trim().split("=");
    return name === "auth_token" && rest.join("=").trim() !== "";
  });
}

function explicitToken(headers) {
  const direct = headerValue(headers, "x-authorization").trim();
  if (direct) return direct;
  const authorization = headerValue(headers, "authorization").trim();
  if (!authorization) return "";
  return authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : authorization;
}

export function filesCredentialFromHeaders(headers) {
  const identity = identityFromHeaders(headers ?? {});
  const user = olaresUsername(identity.user);
  const cookie = headerValue(headers, "cookie").trim();
  const token = explicitToken(headers);
  const authenticatedCookie = hasAuthCookie(cookie) ? cookie : "";
  if (!user || (!authenticatedCookie && !token)) {
    throw new HttpError("files_no_credential", 401, "request carried no Olares Files credential");
  }
  return { user, cookie: authenticatedCookie, token };
}

function filesBaseUrl(template, user) {
  const source = String(template ?? "").trim().replace(/\/+$/, "");
  if (!source) {
    throw new HttpError("files_unavailable", 503, "LARES_FILES_BASE_URL is not configured");
  }
  const value = source.replaceAll("{user}", user);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpError("files_unavailable", 503, "LARES_FILES_BASE_URL is invalid");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new HttpError("files_unavailable", 503, "LARES_FILES_BASE_URL must be an HTTP(S) origin");
  }
  return parsed.origin;
}

function encodeFilesPath(path) {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

async function boundedErrorBody(response) {
  try {
    const text = await response.text();
    return text.trim().slice(0, MAX_ERROR_BYTES);
  } catch {
    return "";
  }
}

async function checked(response, method, pathname) {
  if (response.status >= 200 && response.status < 300) return response;
  if (
    (response.status >= 300 && response.status < 400)
    || response.status === 401
    || response.status === 403
  ) {
    await response.body?.cancel().catch(() => {});
    throw new HttpError("files_unauthenticated", 401, "Olares Files refused the browser credential");
  }
  if (response.status === 404) {
    await response.body?.cancel().catch(() => {});
    throw new HttpError("file_not_found", 404, "file was not found");
  }
  const detail = await boundedErrorBody(response);
  throw new HttpError(
    "files_unavailable",
    502,
    `${method} ${pathname} failed with ${response.status}${detail ? `: ${detail}` : ""}`,
  );
}

async function readAtMost(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) return { bytes: Buffer.alloc(0), truncated: false };
  const chunks = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      const remaining = maxBytes - total;
      if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
      total += chunk.length;
      if (total > maxBytes) {
        truncated = true;
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { bytes: Buffer.concat(chunks), truncated };
}

export class FilesRequestClient {
  constructor({ baseUrl, credential, fetchFn = fetch, signal }) {
    this.baseUrl = baseUrl;
    this.credential = credential;
    this.fetchFn = fetchFn;
    this.signal = signal;
  }

  headers(extra = {}) {
    return {
      ...(this.credential.cookie ? { cookie: this.credential.cookie } : {}),
      ...(this.credential.token ? { "x-authorization": this.credential.token } : {}),
      ...extra,
    };
  }

  async fetchRaw(method, pathname, options = {}) {
    try {
      return await this.fetchFn(`${this.baseUrl}${pathname}`, {
        method,
        headers: this.headers({ "accept-encoding": "identity", ...options.headers }),
        redirect: "manual",
        signal: options.signal ?? this.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new HttpError(
        "files_unavailable",
        502,
        `Olares Files request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async request(method, pathname, options = {}) {
    return checked(await this.fetchRaw(method, pathname, options), method, pathname);
  }

  /**
   * Metadata for one Files object. The backend's file resource URL can embed
   * bytes or 500; the supported probe is the parent listing, same as
   * `olares-cli files download`.
   */
  async stat(source) {
    const path = parseFilesPath(source);
    const cut = path.lastIndexOf("/");
    const parent = path.slice(0, cut);
    const name = path.slice(cut + 1);
    const response = await this.request("GET", `/api/resources/${encodeFilesPath(parent)}/`);
    let envelope;
    try {
      envelope = await response.json();
    } catch {
      throw new HttpError("files_unavailable", 502, "Olares Files listing was not JSON");
    }
    const item = findFilesChild(envelope, name);
    if (!item) throw new HttpError("file_not_found", 404, "file was not found");
    if (isDirectoryItem(item)) throw new HttpError("path_not_file", 415, "path is not a regular file");
    return {
      path,
      name,
      size: itemSize(item),
      modifiedAt: itemModifiedAt(item),
    };
  }

  /**
   * Files raw is GET `?inline=true`. HEAD is not a Files verb; incoming HEAD
   * still GETs a bounded range so the caller can drop the body.
   */
  rawPath(source) {
    return `/api/raw/${encodeFilesPath(parseFilesPath(source))}?inline=true`;
  }

  openRaw(source, options = {}) {
    const range = options.range
      ?? (options.method === "HEAD" ? "bytes=0-0" : undefined);
    return this.request("GET", this.rawPath(source), {
      headers: range ? { range } : {},
      signal: options.signal,
    });
  }

  /**
   * Files renditions are GET `/api/preview/<path>?size=`. The backend resizes
   * once and caches the result: `big` fits the image inside 1000x1000, `thumb`
   * is a 256x256 JPEG. A format it cannot resize comes back as the stored
   * bytes, so this never fails merely for being asked.
   */
  previewPath(source, size) {
    const path = encodeFilesPath(parseFilesPath(source));
    return `/api/preview/${path}?size=${encodeURIComponent(size)}`;
  }

  openPreview(source, options = {}) {
    return this.request("GET", this.previewPath(source, options.size ?? "big"), {
      signal: options.signal,
    });
  }

  async readRaw(source, maxBytes, options = {}) {
    const response = await this.openRaw(source, {
      range: `bytes=0-${maxBytes}`,
      signal: options.signal,
    });
    return readAtMost(response, maxBytes);
  }
}

export function filesClientFromRequest(req, options = {}) {
  const credential = filesCredentialFromHeaders(req?.headers ?? {});
  const template = options.baseUrl ?? options.env?.LARES_FILES_BASE_URL ?? process.env.LARES_FILES_BASE_URL;
  return new FilesRequestClient({
    baseUrl: filesBaseUrl(template, credential.user),
    credential,
    fetchFn: options.fetchFn,
    signal: options.signal,
  });
}
