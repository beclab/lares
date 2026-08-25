import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { constants } from "node:fs";
import { link, open, rename, rm } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";

export const MAX_URL_DOWNLOAD_BYTES = 200 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const MAX_ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 2 * 60 * 1000;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const blocked4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) {
  blocked4.addSubnet(network, prefix, "ipv4");
}
const blocked6 = new BlockList();
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
]) {
  blocked6.addSubnet(network, prefix, "ipv6");
}

function downloadError(message, retryable = false) {
  return Object.assign(new Error(message), { retryable });
}

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 0) return false;
  return family === 4
    ? !blocked4.check(address, "ipv4")
    : !blocked6.check(address, "ipv6");
}

export async function assertPublicUrl(value, lookupFn = lookup) {
  const url = value instanceof URL ? value : new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname) {
    throw downloadError("url_fetch accepts only public HTTP(S) URLs without embedded credentials");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookupFn(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw downloadError(`url_fetch refused non-public host ${url.hostname}`);
  }
  return { url, addresses };
}

/**
 * The addresses that already passed {@link assertPublicUrl}. Connection uses
 * this lookup rather than asking DNS again, so a later private answer cannot
 * replace the public one (DNS rebinding).
 */
export function pinLookup(addresses) {
  const records = addresses.map(({ address, family }) => ({
    address,
    family: family === 6 || family === "IPv6" ? 6 : 4,
  }));
  return (hostname, options, callback) => {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    if (options?.all) {
      callback(null, records);
      return;
    }
    callback(null, records[0].address, records[0].family);
  };
}

export function nodeFetch(url, { signal, headers, lookup: lookupOption } = {}) {
  return new Promise((resolve, reject) => {
    const target = url instanceof URL ? url : new URL(url);
    const lib = target.protocol === "https:" ? https : http;
    const req = lib.request(target, {
      method: "GET",
      headers,
      lookup: lookupOption,
      signal,
    }, (incoming) => {
      const headerBag = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) headerBag.append(name, item);
        } else {
          headerBag.set(name, value);
        }
      }
      const status = incoming.statusCode ?? 500;
      const noBody = [101, 204, 205, 304].includes(status);
      resolve(new Response(noBody ? null : Readable.toWeb(incoming), {
        status,
        headers: headerBag,
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function publicResponse(source, signal, fetchFn, lookupFn) {
  let url = new URL(source);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const resolved = await assertPublicUrl(url, lookupFn);
    const response = await fetchFn(url, {
      method: "GET",
      redirect: "manual",
      signal,
      lookup: pinLookup(resolved.addresses),
      headers: {
        accept: "*/*",
        "user-agent": "Lares/1.0 workspace-url-fetch",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw downloadError(`URL redirect ${response.status} has no location`);
      if (redirects === MAX_REDIRECTS) throw downloadError(`URL exceeded ${MAX_REDIRECTS} redirects`);
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw downloadError(
        `URL returned HTTP ${response.status}`,
        RETRYABLE_STATUS.has(response.status),
      );
    }
    if (response.body === null) throw downloadError("URL response has no body");
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_URL_DOWNLOAD_BYTES) {
      await response.body.cancel();
      throw downloadError(`URL file exceeds ${MAX_URL_DOWNLOAD_BYTES} bytes`);
    }
    return response;
  }
  throw downloadError("URL redirect resolution failed");
}

async function writeResponse(response, absolutePath, overwrite) {
  const temporary = `${absolutePath}.lares-download-${randomUUID()}.tmp`;
  let handle;
  let bytes = 0;
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    for await (const chunk of response.body) {
      const body = Buffer.from(chunk);
      bytes += body.length;
      if (bytes > MAX_URL_DOWNLOAD_BYTES) {
        throw downloadError(`URL file exceeds ${MAX_URL_DOWNLOAD_BYTES} bytes`);
      }
      await handle.write(body);
    }
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (overwrite) {
      await rename(temporary, absolutePath);
    } else {
      await link(temporary, absolutePath);
      await rm(temporary);
    }
    return {
      bytes,
      mediaType: response.headers.get("content-type")?.split(";", 1)[0] || "application/octet-stream",
    };
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
}

function attemptSignal(parent) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("url_fetch timed out")), ATTEMPT_TIMEOUT_MS);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("url_fetch aborted"));
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

export async function downloadUrl(source, absolutePath, options = {}) {
  const {
    signal = new AbortController().signal,
    overwrite = false,
    fetchFn = nodeFetch,
    lookupFn = lookup,
    retryDelayMs = 250,
  } = options;
  let lastError;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const scoped = attemptSignal(signal);
    try {
      const response = await publicResponse(source, scoped.signal, fetchFn, lookupFn);
      return await writeResponse(response, absolutePath, overwrite);
    } catch (error) {
      lastError = error;
      if (signal.aborted) throw signal.reason ?? error;
      const retryable = error?.retryable === true
        || (error instanceof TypeError)
        || scoped.signal.aborted;
      if (!retryable || attempt === MAX_ATTEMPTS - 1) throw error;
    } finally {
      scoped.dispose();
    }
    await wait(retryDelayMs * (2 ** attempt), signal);
  }
  throw lastError;
}

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
]);

export function dataUrlFilename(mediaType) {
  return DATA_NAMES.get(String(mediaType ?? "").split(";", 1)[0].trim().toLowerCase()) ?? null;
}

/**
 * Decode a `data:` URL without touching the network. Router / FlowStudio image
 * payloads often arrive this way rather than as an HTTP URL.
 */
export function decodeDataUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw.toLowerCase().startsWith("data:")) {
    throw downloadError("url is not a data URL");
  }
  const comma = raw.indexOf(",");
  if (comma < 5) throw downloadError("data URL is missing a payload");
  const meta = raw.slice(5, comma);
  const payload = raw.slice(comma + 1);
  const parts = meta.split(";").map((part) => part.trim()).filter(Boolean);
  const base64 = parts.some((part) => part.toLowerCase() === "base64");
  const mediaType = (parts.find((part) => part.includes("/")) || "application/octet-stream")
    .split(";", 1)[0]
    .trim()
    .toLowerCase() || "application/octet-stream";
  let bytes;
  try {
    if (base64) {
      const encoded = payload.replace(/\s+/g, "");
      const maxEncoded = Math.ceil(MAX_URL_DOWNLOAD_BYTES / 3) * 4;
      if (
        encoded.length > maxEncoded
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
      ) {
        throw new Error("invalid base64");
      }
      bytes = Buffer.from(encoded, "base64");
    } else {
      bytes = Buffer.from(decodeURIComponent(payload));
    }
  } catch {
    throw downloadError("data URL payload is not valid");
  }
  if (bytes.length === 0) throw downloadError("data URL payload is empty");
  if (bytes.length > MAX_URL_DOWNLOAD_BYTES) {
    throw downloadError(`URL file exceeds ${MAX_URL_DOWNLOAD_BYTES} bytes`);
  }
  return { bytes, mediaType };
}

export async function saveDataUrl(source, absolutePath, { overwrite = false } = {}) {
  const decoded = decodeDataUrl(source);
  const response = new Response(decoded.bytes, {
    headers: { "content-type": decoded.mediaType, "content-length": String(decoded.bytes.length) },
  });
  return writeResponse(response, absolutePath, overwrite);
}
