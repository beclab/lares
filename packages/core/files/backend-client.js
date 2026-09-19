import { HttpError } from "../tools/http.js";
import { parseFilesPath } from "../drive/files-path.js";
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

function itemLeaf(item) {
  const raw = String(item?.name ?? item?.fileName ?? "").replace(/\/$/, "");
  return raw.split("/").at(-1) ?? "";
}

function isDirectoryItem(item) {
  if (item?.isDir === true || item?.isDirectory === true) return true;
  const type = String(item?.type ?? "").toLowerCase();
  return type === "dir" || type === "directory" || String(item?.name ?? "").endsWith("/");
}

function listingItems(envelope) {
  if (Array.isArray(envelope?.items)) return envelope.items;
  if (Array.isArray(envelope?.data)) return envelope.data;
  if (Array.isArray(envelope?.data?.items)) return envelope.data.items;
  if (Array.isArray(envelope?.data?.data)) return envelope.data.data;
  return [];
}

function itemModifiedAt(item) {
  const value = Date.parse(item?.modified ?? item?.mtime ?? item?.modTime ?? "");
  return Number.isFinite(value) ? value : 0;
}

function itemSize(item) {
  const value = Number(item?.size ?? item?.fileSize);
  return Number.isFinite(value) && value >= 0 ? value : 0;
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

  async request(method, pathname, options = {}) {
    let response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${pathname}`, {
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
    return checked(response, method, pathname);
  }

  async stat(source) {
    const path = parseFilesPath(source);
    const cut = path.lastIndexOf("/");
    const parent = `${path.slice(0, cut)}/`;
    const name = path.slice(cut + 1);
    const pathname = `/api/resources/${encodeFilesPath(parent)}`;
    const response = await this.request("GET", pathname);
    const raw = await readAtMost(response, 8 * 1024 * 1024);
    if (raw.truncated) {
      throw new HttpError("files_unavailable", 502, "Olares Files listing exceeded the read limit");
    }
    let envelope;
    try {
      envelope = JSON.parse(raw.bytes.toString("utf8"));
    } catch {
      throw new HttpError("files_unavailable", 502, "Olares Files returned an invalid listing");
    }
    const item = listingItems(envelope).find((candidate) => itemLeaf(candidate) === name);
    if (!item) throw new HttpError("file_not_found", 404, "file was not found");
    if (isDirectoryItem(item)) {
      throw new HttpError("path_not_file", 415, "path is not a regular file");
    }
    return {
      path,
      name,
      size: itemSize(item),
      modifiedAt: itemModifiedAt(item),
    };
  }

  openRaw(source, options = {}) {
    const path = parseFilesPath(source);
    const pathname = `/api/raw/${encodeFilesPath(path)}`;
    return this.request(options.method ?? "GET", pathname, {
      headers: options.range ? { range: options.range } : {},
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
