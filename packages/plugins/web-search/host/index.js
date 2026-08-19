/**
 * Dina web-search Host: registers ctx.web provider `dina` and settings routes.
 */
import { isProviderId, publicConfig, readConfig, setDefaultProvider, writeProvider } from "./config.js";
import { createDinaSearchProvider } from "./provider.js";
import { probeCustom } from "./providers/custom.js";
import { probeTavily } from "./providers/tavily.js";

export const name = "dina-web-search";
export const inject = ["web", "webServer"];

const ROUTE_PREFIX = "/api/dina/web-search";

/** @param {import('node:http').IncomingMessage} req */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > 64 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

/** @returns {Promise<Record<string, unknown>>} */
async function parseJsonBody(req, res) {
  const raw = await readBody(req);
  if (raw.length === 0) return {};
  try {
    const body = JSON.parse(raw.toString("utf8"));
    if (!body || typeof body !== "object") {
      sendJson(res, 400, { error: { code: "bad_request", message: "invalid JSON body" } });
      return null;
    }
    return /** @type {Record<string, unknown>} */ (body);
  } catch {
    sendJson(res, 400, { error: { code: "bad_request", message: "invalid JSON body" } });
    return null;
  }
}

async function handleGetConfig(_req, res) {
  sendJson(res, 200, publicConfig());
}

/**
 * Resolve the credentials a request should use, falling back to stored secrets.
 * @returns {{ provider: 'tavily' } & { apiKey: string }
 *   | { provider: 'custom', url: string, apiKey: string }
 *   | { error: { status: number, code: string, message: string } }}
 */
function resolveCreds(provider, body) {
  const stored = readConfig();
  if (provider === "tavily") {
    const apiKey =
      typeof body.apiKey === "string" && body.apiKey.trim()
        ? body.apiKey.trim()
        : stored.providers.tavily.apiKey;
    if (!apiKey) {
      return { error: { status: 400, code: "missing_key", message: "Tavily API key is required" } };
    }
    return { provider: "tavily", apiKey };
  }

  const url =
    typeof body.url === "string" && body.url.trim() ? body.url.trim() : stored.providers.custom.url;
  const apiKey =
    typeof body.apiKey === "string" && body.apiKey.trim()
      ? body.apiKey.trim()
      : stored.providers.custom.apiKey;
  if (!url || !URL.canParse(url)) {
    return { error: { status: 400, code: "missing_url", message: "Custom search URL is required" } };
  }
  if (!apiKey) {
    return { error: { status: 400, code: "missing_key", message: "Custom search API key is required" } };
  }
  return { provider: "custom", url, apiKey };
}

/** @param {{ provider: string, apiKey: string, url?: string }} creds */
function probe(creds) {
  if (creds.provider === "tavily") return probeTavily(creds.apiKey);
  return probeCustom({ url: creds.url, apiKey: creds.apiKey, protocol: "dina" });
}

/**
 * Save one provider card: { provider, apiKey?, url? }.
 * Persisting requires a passing probe — a saved provider is a tested one.
 */
async function handleSaveProvider(req, res) {
  const body = await parseJsonBody(req, res);
  if (!body) return;
  if (!isProviderId(body.provider)) {
    sendJson(res, 400, { error: { code: "bad_provider", message: "provider must be tavily or custom" } });
    return;
  }
  const creds = resolveCreds(body.provider, body);
  if ("error" in creds) {
    sendJson(res, creds.error.status, { error: { code: creds.error.code, message: creds.error.message } });
    return;
  }
  const result = await probe(creds);
  if (!result.ok) {
    sendJson(res, 400, { ...result, error: { code: "test_failed", message: result.error } });
    return;
  }
  const saved =
    creds.provider === "tavily"
      ? writeProvider("tavily", { apiKey: creds.apiKey })
      : writeProvider("custom", { url: creds.url, apiKey: creds.apiKey });
  sendJson(res, 200, { ...result, config: publicConfig(saved) });
}

/** Switch default immediately: { defaultProvider: "tavily"|"custom"|null } */
async function handleSetDefault(req, res) {
  const body = await parseJsonBody(req, res);
  if (!body) return;
  const id = body.defaultProvider === null ? null : body.defaultProvider;
  if (id !== null && !isProviderId(id)) {
    sendJson(res, 400, { error: { code: "bad_provider", message: "invalid defaultProvider" } });
    return;
  }
  try {
    sendJson(res, 200, publicConfig(setDefaultProvider(id)));
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "bad_request";
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 400, { error: { code, message } });
  }
}

/** Dry-run probe of draft credentials; never persists. */
async function handleTest(req, res) {
  const body = await parseJsonBody(req, res);
  if (!body) return;

  const provider = isProviderId(body.provider) ? body.provider : readConfig().defaultProvider;
  if (!isProviderId(provider)) {
    sendJson(res, 400, { error: { code: "bad_provider", message: "provider is required" } });
    return;
  }
  const creds = resolveCreds(provider, body);
  if ("error" in creds) {
    sendJson(res, creds.error.status, { error: { code: creds.error.code, message: creds.error.message } });
    return;
  }
  sendJson(res, 200, await probe(creds));
}

/** @type {Record<string, Record<string, (req, res) => Promise<void>>>} */
const ROUTES = {
  "/config": { GET: handleGetConfig },
  "/config/provider": { POST: handleSaveProvider },
  "/config/default": { POST: handleSetDefault },
  "/test": { POST: handleTest },
};

function route(req, res) {
  const method = (req.method ?? "GET").toUpperCase();
  const path = new URL(req.url ?? "/", "http://x").pathname.slice(ROUTE_PREFIX.length) || "/";
  const handlers = ROUTES[path.replace(/\/+$/, "") || "/"];
  if (!handlers) {
    sendJson(res, 404, { error: { code: "not_found", message: `no web-search route ${path}` } });
    return;
  }
  const handler = handlers[method];
  if (!handler) {
    sendJson(res, 405, { error: { code: "method_not_allowed", message: `${method} not allowed` } });
    return;
  }
  Promise.resolve(handler(req, res)).catch((err) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: { code: "web_search_failed", message } });
  });
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.effect(() => ctx.web.registerSearchProvider(createDinaSearchProvider()), "dina-web-search-provider");
  ctx.effect(
    () => ctx.webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler: route }),
    "dina-web-search-routes",
  );
}
