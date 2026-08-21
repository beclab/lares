/** Lares model settings Host routes under /api/lares/models. */
import { createRouteHandler, readJsonObject, sendJson } from "../../shared/host/http.js";
import { currentDefault, listCatalog, refreshCatalog, saveDefault } from "./catalog.js";

export const name = "lares-models";
export const inject = ["webServer", "llm", "agentDefaultModel", "settings"];

const ROUTE_PREFIX = "/api/lares/models";

/** @param {import('@deepseek-ai/cordis').Context} ctx */
async function state(ctx) {
  const { models, failures } = await listCatalog(ctx);
  return { default: currentDefault(ctx), models, failures };
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
function routes(ctx) {
  return {
    "/": {
      GET: async (_req, res) => sendJson(res, 200, await state(ctx)),
    },
    "/default": {
      POST: async (req, res) => {
        const body = await readJsonObject(req);
        await saveDefault(ctx, body);
        sendJson(res, 200, await state(ctx));
      },
    },
    "/refresh": {
      POST: async (_req, res) => {
        await refreshCatalog(ctx);
        sendJson(res, 200, await state(ctx));
      },
    },
  };
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
function handler(ctx) {
  return createRouteHandler({
    prefix: ROUTE_PREFIX,
    routes: routes(ctx),
    fallbackCode: "models_failed",
  });
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler: handler(ctx) }),
    "lares-models-routes",
  );
}
