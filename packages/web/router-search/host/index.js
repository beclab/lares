/** Lares web-search Host: Router-backed ctx.web provider and settings routes. */
import { createRouteHandler, readJsonObject, sendJson } from "@lares/core/tools/http";
import {
  currentSearchConfig,
  defaultSearchModelFromBody,
  setDefaultSearchFromRequest,
} from "@lares/core/search/config";
import { createLaresSearchProvider } from "./provider.js";

export const name = "lares-router-search";
export const inject = ["web", "webServer"];

const ROUTE_PREFIX = "/api/lares/web-search";

export async function currentConfig() {
  return currentSearchConfig();
}

async function handleGetConfig(_req, res) {
  sendJson(res, 200, await currentConfig());
}

/** Switch default immediately: { defaultSearchModel: string|null }. */
async function handleSetDefault(req, res) {
  const body = await readJsonObject(req);
  sendJson(res, 200, await setDefaultSearchFromRequest(defaultSearchModelFromBody(body)));
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
  ctx.effect(() => ctx.web.registerSearchProvider(createLaresSearchProvider()), "lares-router-search-provider");
  ctx.effect(
    () => ctx.webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler }),
    "lares-router-search-routes",
  );
}
