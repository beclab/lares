import { WebError } from "@deepseek-ai/dsh-web";
import { mapTavilyPayload } from "./tavily.js";

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * @param {unknown} payload
 * @returns {import('@deepseek-ai/dsh-web').WebSearchSource[]}
 */
export function mapDinaPayload(payload) {
  const raw = payload && typeof payload === "object" ? /** @type {Record<string, unknown>} */ (payload).sources : null;
  if (!Array.isArray(raw)) return [];
  /** @type {import('@deepseek-ai/dsh-web').WebSearchSource[]} */
  const sources = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = /** @type {Record<string, unknown>} */ (entry);
    const url = String(row.url ?? "").trim();
    if (!url) continue;
    const title = String(row.title ?? "").trim();
    const snippet = String(row.snippet ?? "").trim();
    const publishedAt = String(row.publishedAt ?? "").trim();
    sources.push({
      url,
      ...(title ? { title } : {}),
      ...(snippet ? { snippet } : {}),
      ...(publishedAt ? { publishedAt } : {}),
    });
  }
  return sources;
}

/**
 * @param {{
 *   url: string,
 *   apiKey: string,
 *   protocol: 'dina' | 'tavily-compat',
 *   query: string,
 *   maxResults?: number,
 *   timeoutMs?: number,
 *   signal?: AbortSignal,
 * }} opts
 */
export async function customSearch(opts) {
  const endpoint = opts.url.trim();
  const key = opts.apiKey.trim();
  const q = opts.query.trim();
  if (!endpoint || !URL.canParse(endpoint)) {
    throw new WebError("Custom search URL is invalid", "WEB_PROVIDER_ERROR");
  }
  if (!key) throw new WebError("Custom search API key is required", "WEB_PROVIDER_CREDENTIAL_MISSING");
  if (!q) throw new WebError("query is required", "WEB_PROVIDER_ERROR");

  const limit = Math.max(1, Math.min(Number(opts.maxResults ?? 5) || 5, 10));
  const protocol = opts.protocol === "tavily-compat" ? "tavily-compat" : "dina";
  const body =
    protocol === "tavily-compat"
      ? { query: q, max_results: limit, search_depth: "basic" }
      : { query: q, maxResults: limit };

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const onAbort = () => controller.abort(opts.signal?.reason);
  if (opts.signal) {
    if (opts.signal.aborted) {
      throw new WebError("Custom search aborted", "WEB_ABORTED", { cause: opts.signal.reason });
    }
    opts.signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new WebError("Custom search API key is invalid or unauthorized", "WEB_PROVIDER_CREDENTIAL_MISSING");
    }
    if (!response.ok) {
      const detail = await errorDetail(response);
      throw new WebError(`Custom search error (HTTP ${response.status}): ${detail}`, "WEB_PROVIDER_ERROR");
    }

    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      throw new WebError("Custom search returned invalid JSON", "WEB_PROVIDER_ERROR", { cause: err });
    }
    if (!payload || typeof payload !== "object") {
      throw new WebError("Custom search returned unexpected payload", "WEB_PROVIDER_ERROR");
    }

    const sources = protocol === "tavily-compat" ? mapTavilyPayload(payload) : mapDinaPayload(payload);
    return { sources, truncated: false };
  } catch (err) {
    if (err instanceof WebError) throw err;
    if (opts.signal?.aborted || controller.signal.aborted) {
      throw new WebError("Custom search aborted", "WEB_ABORTED", { cause: err });
    }
    throw new WebError(`Custom search request failed: ${String(err)}`, "WEB_PROVIDER_ERROR", { cause: err });
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * @param {{ url: string, apiKey: string, protocol: 'dina' | 'tavily-compat' }} opts
 */
export async function probeCustom(opts) {
  const started = performance.now();
  try {
    const result = await customSearch({
      ...opts,
      query: "Dina connectivity probe",
      maxResults: 1,
      timeoutMs: 15_000,
    });
    const sample = result.sources[0]?.title || result.sources[0]?.url || null;
    return {
      ok: true,
      latencyMs: Math.round(performance.now() - started),
      sample,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** @param {Response} response */
async function errorDetail(response) {
  try {
    const body = await response.json();
    if (body && typeof body === "object") {
      for (const key of ["detail", "message", "error"]) {
        const value = /** @type {Record<string, unknown>} */ (body)[key];
        if (value) return String(value).slice(0, 240);
      }
    }
  } catch {
    /* fall through */
  }
  const text = (await response.text().catch(() => "")).trim();
  return text.slice(0, 240) || response.statusText || "unknown error";
}
