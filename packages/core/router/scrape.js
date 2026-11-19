import { routerGatewayUrl, routerHeaders } from "./gateway.js";

export const ROUTER_DEFAULT_SCRAPE_ROUTE = "default-scrape";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_MAX_BODY_CHARS = 100_000;
const DEFAULT_TIMEOUT_MS = 60_000;

export class ScrapeError extends Error {
  constructor(message, code, options) {
    super(message, options);
    this.code = code;
  }
}

export function scrapeWebErrorCode(code) {
  return {
    invalid_url: "WEB_INVALID_URL",
    unavailable: "WEB_PROVIDER_CONFIGURED_UNAVAILABLE",
    credential: "WEB_PROVIDER_CREDENTIAL_MISSING",
    aborted: "WEB_ABORTED",
    timeout: "WEB_FETCH_TIMEOUT",
    too_large: "WEB_FETCH_TOO_LARGE",
  }[code] ?? "WEB_PROVIDER_ERROR";
}

function pageURL(raw) {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 2048) {
    throw new ScrapeError("A valid HTTP(S) URL is required", "invalid_url");
  }
  let parsed;
  try { parsed = new URL(raw.trim()); } catch {
    throw new ScrapeError("A valid HTTP(S) URL is required", "invalid_url");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new ScrapeError("A valid HTTP(S) URL without credentials is required", "invalid_url");
  }
  return parsed.href;
}

async function readRouterBody(response) {
  if (!response.body) throw new ScrapeError("Router scrape returned no document", "failed");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new ScrapeError("Router scrape response exceeds 1 MiB", "too_large");
      }
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

/**
 * Read one extracted document through Router, never fetch the target locally.
 * The result's statusCode describes Router's document response, not the origin
 * HTTP status, which Router's current scrape protocol does not expose.
 * @returns {Promise<{ url: string, statusCode: number, body: { kind: "text", content: string }, truncated: boolean }>}
 * @param {string} url
 * @param {{ model?: string, signal?: AbortSignal, timeoutMs?: number, maxBodyChars?: number, env?: NodeJS.ProcessEnv }} [opts]
 */
export async function routerScrape(url, opts = {}) {
  if (opts.signal?.aborted) throw new ScrapeError("Router scrape aborted", "aborted", { cause: opts.signal.reason });
  const target = pageURL(url);
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
    ? Math.min(Math.floor(opts.timeoutMs), 2_147_483_647) || 1
    : DEFAULT_TIMEOUT_MS;
  const maxBodyChars = Number.isFinite(opts.maxBodyChars) && opts.maxBodyChars > 0
    ? Math.min(Math.floor(opts.maxBodyChars), DEFAULT_MAX_BODY_CHARS) || 1
    : DEFAULT_MAX_BODY_CHARS;
  const env = opts.env ?? process.env;
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(opts.signal?.reason);
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("timeout"));
  }, timeoutMs);
  try {
    const response = await fetch(`${routerGatewayUrl(env)}/scrape`, {
      method: "POST",
      redirect: "error",
      headers: { ...routerHeaders(env), "content-type": "application/json" },
      body: JSON.stringify({ model: opts.model ?? ROUTER_DEFAULT_SCRAPE_ROUTE, url: target }),
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new ScrapeError("Router rejected Lares web fetch access", "credential");
    }
    let document;
    try { document = JSON.parse(await readRouterBody(response)); } catch (err) {
      if (err instanceof ScrapeError) throw err;
      throw new ScrapeError(`Router scrape returned an invalid document (HTTP ${response.status})`, "failed", { cause: err });
    }
    if (!response.ok) {
      const code = document?.error?.code;
      const unavailable = ["no_default_model", "model_not_found", "model_route_disabled", "scrape_unsupported_for_provider"].includes(code);
      throw new ScrapeError(`Router scrape returned HTTP ${response.status}${unavailable ? ` (${code})` : ""}`, unavailable ? "unavailable" : "failed");
    }
    if (document?.object !== "scrape" || document?.status !== "ok" || typeof document.markdown !== "string" || !document.markdown.trim()) {
      throw new ScrapeError("Router scrape returned no usable Markdown", "failed");
    }
    let finalURL;
    try { finalURL = document.url ? pageURL(document.url) : target; } catch (err) {
      throw new ScrapeError("Router scrape returned an invalid document URL", "failed", { cause: err });
    }
    let content = document.markdown.slice(0, maxBodyChars);
    // Do not split a UTF-16 surrogate pair at the presentation cap.
    if (/[\uD800-\uDBFF]$/.test(content)) content = content.slice(0, -1);
    if (opts.signal?.aborted) throw new ScrapeError("Router scrape aborted", "aborted");
    if (timedOut) throw new ScrapeError("Router scrape timed out", "timeout");
    return {
      url: finalURL,
      statusCode: response.status,
      body: { kind: "text", content },
      truncated: content.length < document.markdown.length,
    };
  } catch (err) {
    if (opts.signal?.aborted) throw new ScrapeError("Router scrape aborted", "aborted", { cause: err });
    if (timedOut) throw new ScrapeError("Router scrape timed out", "timeout", { cause: err });
    if (err instanceof ScrapeError) throw err;
    throw new ScrapeError("Router scrape request failed", "failed", { cause: err });
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
