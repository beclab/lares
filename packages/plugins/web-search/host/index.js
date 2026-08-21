/** Lares web-search Host: Router-backed ctx.web provider and settings routes. */
import { createRouteHandler, readJsonObject, sendJson } from "../../shared/host/http.js";
import { readConfig, setDefaultSearchModel } from "./config.js";
import { createLaresSearchProvider } from "./provider.js";
import { fetchRouterSearchModels } from "./router.js";

export const name = "lares-web-search";
export const inject = ["web", "webServer"];

const ROUTE_PREFIX = "/api/lares/web-search";

export async function currentConfig() {
  const searchModels = await fetchRouterSearchModels();
  const configured = readConfig().defaultSearchModel;
  return {
    defaultSearchModel: configured,
    searchModels,
  };
}

async function handleGetConfig(_req, res) {
  sendJson(res, 200, await currentConfig());
}

/** Switch default immediately: { defaultSearchModel: string|null }. */
async function handleSetDefault(req, res) {
  const body = await readJsonObject(req);
  const id = body.defaultSearchModel === null ? null : body.defaultSearchModel;
  if (id !== null && typeof id !== "string") {
    sendJson(res, 400, { error: { code: "bad_model", message: "invalid defaultSearchModel" } });
    return;
  }
  try {
    const searchModels = await fetchRouterSearchModels();
    const saved = setDefaultSearchModel(id, searchModels);
    sendJson(res, 200, {
      defaultSearchModel: saved.defaultSearchModel,
      searchModels,
    });
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "bad_request";
    const status = err && typeof err === "object" && "status" in err && typeof err.status === "number"
      ? err.status
      : 400;
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, status, { error: { code, message } });
  }
}

/** @type {Record<string, Record<string, (req, res) => Promise<void>>>} */
const ROUTES = {
  "/config": { GET: handleGetConfig },
  "/config/default": { POST: handleSetDefault },
};

const handler = createRouteHandler({
  prefix: ROUTE_PREFIX,
  routes: ROUTES,
  fallbackCode: "web_search_failed",
});

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.effect(() => ctx.web.registerSearchProvider(createLaresSearchProvider()), "lares-web-search-provider");
  ctx.effect(
    () => ctx.webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler }),
    "lares-web-search-routes",
  );
}
