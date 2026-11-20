import { FETCH_ROUTE_PREFIX, fetchSettingsHandler } from "./fetch-settings.js";
/** Lares web Host: Router-backed search/fetch providers and search settings. */
import { createRouteHandler, readJsonObject, sendJson } from "@olares/lares-core/tools/http";
import {
  currentSearchConfig,
  searchSelectionFromBody,
  setSearchSelectionFromRequest,
} from "@olares/lares-core/search/config";
import { createLaresSearchProvider } from "./provider.js";
import { createLaresFetchProvider } from "./fetch-provider.js";

export const name = "lares-router-search";
export const inject = ["web", "webServer"];

const ROUTE_PREFIX = "/api/lares/web-search";

function wantsRefresh(req) {
  return new URL(req.url ?? "/", "http://x").searchParams.get("refresh") === "1";
}

export async function currentConfig(options = {}) {
  return currentSearchConfig(options);
}

async function handleGetConfig(req, res) {
  sendJson(res, 200, await currentConfig({ refresh: wantsRefresh(req) }));
}

/** Switch default immediately: { defaultSearchModel: string|null, searchOff?: boolean }. */
async function handleSetDefault(req, res) {
  const body = await readJsonObject(req);
  sendJson(res, 200, await setSearchSelectionFromRequest(searchSelectionFromBody(body)));
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
  ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: FETCH_ROUTE_PREFIX, handler: fetchSettingsHandler }), "lares-router-fetch-routes");
  ctx.effect(() => ctx.web.registerSearchProvider(createLaresSearchProvider()), "lares-router-search-provider");
  ctx.effect(() => ctx.web.registerFetchProvider(createLaresFetchProvider()), "lares-router-fetch-provider");
  ctx.effect(
    () => ctx.webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler }),
    "lares-router-search-routes",
  );
}
