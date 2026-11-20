import { createRouteHandler, readJsonObject, sendJson } from "@olares/lares-core/tools/http";
import { currentFetchConfig, fetchSelectionFromBody, setFetchSelectionFromRequest } from "@olares/lares-core/fetch/config";

export const FETCH_ROUTE_PREFIX = "/api/lares/web-fetch";
export const fetchSettingsHandler = createRouteHandler({
  prefix: FETCH_ROUTE_PREFIX,
  routes: {
    "/config": { GET: async (req, res) => sendJson(res, 200, await currentFetchConfig({ refresh: new URL(req.url ?? "/", "http://x").searchParams.get("refresh") === "1" })) },
    "/config/default": { POST: async (req, res) => sendJson(res, 200, await setFetchSelectionFromRequest(fetchSelectionFromBody(await readJsonObject(req)))) },
  },
  fallbackCode: "web_fetch_failed",
});
