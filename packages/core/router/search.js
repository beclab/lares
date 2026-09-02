import { catalogCache } from "./catalog-cache.js";
import { routerCatalogRows } from "./catalog.js";
import { routerGatewayUrl, routerHeaders } from "./gateway.js";

export class SearchError extends Error {
  constructor(message, code, options) {
    super(message, options);
    this.code = code;
  }
}

export const SEARCH_WEB_CODES = {
  no_model: "WEB_PROVIDER_CONFIGURED_UNAVAILABLE",
  empty_query: "WEB_PROVIDER_ERROR",
  aborted: "WEB_ABORTED",
  timeout: "WEB_PROVIDER_ERROR",
  credential: "WEB_PROVIDER_CREDENTIAL_MISSING",
  failed: "WEB_PROVIDER_ERROR",
};

export function searchWebErrorCode(code) {
  return SEARCH_WEB_CODES[code] ?? "WEB_PROVIDER_ERROR";
}

export function searchModelsFromRouterCatalog(payload) {
  return routerCatalogRows(payload)
    .filter((model) => model.mode === "search")
    .map(({ id, name }) => ({ id, name }));
}

export function searchSourcesFromRouter(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.results)) return [];
  const sources = [];
  for (const item of payload.results) {
    if (sources.length >= 10) break;
    if (!item || typeof item !== "object") continue;
    const url = String(item.url ?? "").trim();
    if (!url || url.length > 2_048) continue;
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) continue;
    } catch {
      continue;
    }
    const title = String(item.title ?? "").trim().slice(0, 500);
    const snippet = String(item.snippet ?? item.content ?? "").trim().slice(0, 5_000);
    const publishedAt = String(item.publishedAt ?? item.published_at ?? "").trim().slice(0, 100);
    sources.push({
      url,
      ...(title ? { title } : {}),
      ...(snippet ? { snippet } : {}),
      ...(publishedAt ? { publishedAt } : {}),
    });
  }
  return sources;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export async function fetchRouterSearchModels() {
  const { payload } = await catalogCache.get();
  return searchModelsFromRouterCatalog(payload);
}

/**
 * @param {string} model
 * @param {string} query
 * @param {{ maxResults?: number, signal?: AbortSignal, timeoutMs?: number }} [opts]
 */
export async function routerSearch(model, query, opts = {}) {
  const selectedModel = model.trim();
  const q = query.trim();
  if (!selectedModel) {
    throw new SearchError("No Router search service selected", "no_model");
  }
  if (!q) throw new SearchError("query is required", "empty_query");

  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs = Number.isFinite(opts.timeoutMs)
    ? Math.max(1, Number(opts.timeoutMs))
    : DEFAULT_TIMEOUT_MS;
  const onAbort = () => controller.abort(opts.signal?.reason);
  if (opts.signal) {
    if (opts.signal.aborted) {
      throw new SearchError("Router search aborted", "aborted", { cause: opts.signal.reason });
    }
    opts.signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("timeout"));
  }, timeoutMs);

  try {
    const response = await fetch(`${routerGatewayUrl()}/search`, {
      method: "POST",
      redirect: "error",
      headers: {
        ...routerHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: selectedModel,
        query: q,
        max_results: Math.max(1, Math.min(Number(opts.maxResults ?? 5) || 5, 10)),
      }),
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw new SearchError("Router rejected Lares search access", "credential");
    }
    if (!response.ok) {
      throw new SearchError(`Router search returned ${response.status}`, "failed");
    }
    return {
      sources: searchSourcesFromRouter(await response.json()),
      truncated: false,
    };
  } catch (err) {
    if (err instanceof SearchError) throw err;
    if (opts.signal?.aborted) {
      throw new SearchError("Router search aborted", "aborted", { cause: err });
    }
    if (timedOut) {
      throw new SearchError("Router search timed out", "timeout", { cause: err });
    }
    throw new SearchError(`Router search request failed: ${String(err)}`, "failed", { cause: err });
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
