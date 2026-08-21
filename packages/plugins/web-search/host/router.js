import { WebError } from "@deepseek-ai/dsh-web";
import { routerCatalogRows } from "../../shared/host/router-catalog.js";

const DEFAULT_TIMEOUT_MS = 20_000;

function routerUrl() {
  return (process.env.LLM_GATEWAY_URL ?? "http://router-svc.router-shared/v1").replace(/\/+$/, "");
}

function routerHeaders() {
  const apiKey = process.env.DINA_ROUTER_API_KEY?.trim();
  return {
    ...(apiKey
      ? { authorization: `Bearer ${apiKey}` }
      : { "x-caller-appid": process.env.OLARES_APP_ID?.trim() || "dina" }),
    accept: "application/json",
  };
}

/**
 * @param {unknown} payload
 * @returns {{ id: string, name: string }[]}
 */
export function searchModelsFromRouterCatalog(payload) {
  return routerCatalogRows(payload)
    .filter((model) => model.mode === "search")
    .map(({ id, name }) => ({ id, name }));
}

/** List the search services Router currently offers to Dina. */
export async function fetchRouterSearchModels() {
  const response = await fetch(`${routerUrl()}/models`, {
    method: "GET",
    headers: routerHeaders(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`Router /models returned ${response.status}`), {
      code: "router_unavailable",
      status: 503,
    });
  }
  return searchModelsFromRouterCatalog(await response.json());
}

/**
 * @param {unknown} payload
 * @returns {import('@deepseek-ai/dsh-web').WebSearchSource[]}
 */
export function searchSourcesFromRouter(payload) {
  if (!payload || typeof payload !== "object") return [];
  const results = /** @type {{ results?: unknown }} */ (payload).results;
  if (!Array.isArray(results)) return [];

  const sources = [];
  for (const item of results) {
    if (sources.length >= 10) break;
    if (!item || typeof item !== "object") continue;
    const row = /** @type {Record<string, unknown>} */ (item);
    const url = String(row.url ?? "").trim();
    if (!url || url.length > 2_048) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    } catch {
      continue;
    }
    const title = String(row.title ?? "").trim().slice(0, 500);
    const snippet = String(row.snippet ?? row.content ?? "").trim().slice(0, 5_000);
    const publishedAt = String(row.publishedAt ?? row.published_at ?? "").trim().slice(0, 100);
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
 * @param {string} model
 * @param {string} query
 * @param {{ maxResults?: number, signal?: AbortSignal, timeoutMs?: number }} [opts]
 */
export async function routerSearch(model, query, opts = {}) {
  const selectedModel = model.trim();
  const q = query.trim();
  if (!selectedModel) {
    throw new WebError("No Router search service selected", "WEB_PROVIDER_CONFIGURED_UNAVAILABLE");
  }
  if (!q) throw new WebError("query is required", "WEB_PROVIDER_ERROR");

  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs = Number.isFinite(opts.timeoutMs)
    ? Math.max(1, Number(opts.timeoutMs))
    : DEFAULT_TIMEOUT_MS;
  const onAbort = () => controller.abort(opts.signal?.reason);
  if (opts.signal) {
    if (opts.signal.aborted) {
      throw new WebError("Router search aborted", "WEB_ABORTED", { cause: opts.signal.reason });
    }
    opts.signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("timeout"));
  }, timeoutMs);

  try {
    const response = await fetch(`${routerUrl()}/search`, {
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
      throw new WebError("Router rejected Dina search access", "WEB_PROVIDER_CREDENTIAL_MISSING");
    }
    if (!response.ok) {
      throw new WebError(`Router search returned ${response.status}`, "WEB_PROVIDER_ERROR");
    }
    return {
      sources: searchSourcesFromRouter(await response.json()),
      truncated: false,
    };
  } catch (err) {
    if (err instanceof WebError) throw err;
    if (opts.signal?.aborted) {
      throw new WebError("Router search aborted", "WEB_ABORTED", { cause: err });
    }
    if (timedOut) {
      throw new WebError("Router search timed out", "WEB_PROVIDER_ERROR", { cause: err });
    }
    throw new WebError(`Router search request failed: ${String(err)}`, "WEB_PROVIDER_ERROR", {
      cause: err,
    });
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
