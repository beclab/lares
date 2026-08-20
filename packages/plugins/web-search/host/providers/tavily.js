import { WebError } from "@deepseek-ai/dsh-web";
import { assertBearerKey } from "../credential.js";

export const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const DEFAULT_TIMEOUT_MS = 20_000;
const PROBE_ATTEMPTS = 3;
const PROBE_RETRY_DELAY_MS = 800;

/**
 * @param {unknown} payload
 * @returns {import('@deepseek-ai/dsh-web').WebSearchSource[]}
 */
export function mapTavilyPayload(payload) {
  const raw = payload && typeof payload === "object" ? /** @type {Record<string, unknown>} */ (payload).results : null;
  if (!Array.isArray(raw)) return [];
  /** @type {import('@deepseek-ai/dsh-web').WebSearchSource[]} */
  const sources = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = /** @type {Record<string, unknown>} */ (entry);
    const url = String(row.url ?? "").trim();
    if (!url) continue;
    const title = String(row.title ?? "").trim();
    const snippet = String(row.content ?? "").trim();
    sources.push({
      url,
      ...(title ? { title } : {}),
      ...(snippet ? { snippet } : {}),
    });
  }
  return sources;
}

/**
 * @param {string} apiKey
 * @param {string} query
 * @param {{ maxResults?: number, timeoutMs?: number, signal?: AbortSignal }} [opts]
 */
export async function tavilySearch(apiKey, query, opts = {}) {
  const key = apiKey.trim();
  const q = query.trim();
  assertBearerKey(key, "Tavily");
  if (!q) throw new WebError("query is required", "WEB_PROVIDER_ERROR");

  const limit = Math.max(1, Math.min(Number(opts.maxResults ?? 5) || 5, 10));
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const onAbort = () => controller.abort(opts.signal?.reason);
  if (opts.signal) {
    if (opts.signal.aborted) throw new WebError("Tavily search aborted", "WEB_ABORTED", { cause: opts.signal.reason });
    opts.signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);

  try {
    const response = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: q,
        max_results: limit,
        search_depth: "basic",
      }),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new WebError("Tavily API key is invalid or unauthorized", "WEB_PROVIDER_CREDENTIAL_MISSING");
    }
    if (!response.ok) {
      const detail = await errorDetail(response);
      throw new WebError(`Tavily error (HTTP ${response.status}): ${detail}`, "WEB_PROVIDER_ERROR");
    }

    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      throw new WebError("Tavily returned invalid JSON", "WEB_PROVIDER_ERROR", { cause: err });
    }
    if (!payload || typeof payload !== "object") {
      throw new WebError("Tavily returned unexpected payload", "WEB_PROVIDER_ERROR");
    }

    return {
      sources: mapTavilyPayload(payload),
      truncated: false,
    };
  } catch (err) {
    if (err instanceof WebError) throw err;
    if (opts.signal?.aborted || controller.signal.aborted) {
      throw new WebError("Tavily search aborted", "WEB_ABORTED", { cause: err });
    }
    throw new WebError(`Tavily request failed: ${String(err)}`, "WEB_PROVIDER_ERROR", { cause: err });
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Probe Tavily with a minimal search. Auth fails fast; transient errors retry.
 * @param {string} apiKey
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function probeTavily(apiKey, opts = {}) {
  const started = performance.now();
  let lastError = "";
  for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt++) {
    try {
      const result = await tavilySearch(apiKey, "Dina connectivity probe", {
        maxResults: 1,
        timeoutMs: opts.timeoutMs ?? 15_000,
      });
      const sample = result.sources[0]?.title || result.sources[0]?.url || null;
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - started),
        sample,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof WebError && err.code === "WEB_PROVIDER_CREDENTIAL_MISSING") {
        return { ok: false, error: message };
      }
      lastError = message;
      if (attempt + 1 < PROBE_ATTEMPTS) {
        await sleep(PROBE_RETRY_DELAY_MS);
      }
    }
  }
  return { ok: false, error: lastError || "Tavily probe failed" };
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

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
