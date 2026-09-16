/** Lares model settings Host routes under /api/lares/models. */
import { createRouteHandler, readJsonObject, sendJson } from "@olares/lares-core/tools/http";
import { watchRouterCatalog } from "./catalog-events.js";
import { catalogPanelState, onCatalogRevision, catalogRevision, refreshCatalog, saveDefault } from "./catalog.js";

export const name = "lares-chat-model";
export const inject = ["webServer", "llm", "agentDefaultModel", "settings"];

const ROUTE_PREFIX = "/api/lares/models";

/**
 * The chat catalog reaches dsh only through settings.yaml, which only a
 * refresh writes — the cache TTL that backs search and STT cannot reconcile
 * it. So NATS is the fast path and this is what makes it eventually correct.
 */
const DEFAULT_RECONCILE_MS = 60_000;

function reconcileIntervalMs(env = process.env) {
  const raw = String(env.LARES_CATALOG_RECONCILE_MS ?? "").trim();
  if (!raw) return DEFAULT_RECONCILE_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_RECONCILE_MS;
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
async function state(ctx) {
  return catalogPanelState(ctx);
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
function handleEvents(req, res) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const send = (revision) => {
    res.write(`data: ${JSON.stringify({ revision })}\n\n`);
  };
  send(catalogRevision());
  const stop = onCatalogRevision(send);
  req.on("close", stop);
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
    "/events": {
      GET: handleEvents,
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
    "lares-chat-model-routes",
  );
  ctx.effect(() => {
    let closed = false;
    /** @type {{ close: () => void } | null} */
    let watcher = null;
    /** @param {string} reason */
    const reconcile = async (reason) => {
      try {
        await refreshCatalog(ctx);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[lares] router catalog ${reason} failed: ${message}`);
      }
    };
    void watchRouterCatalog(() => {
      // Whether a signal arrives at all is otherwise invisible in the logs.
      console.log("[lares] router catalog signal received");
      void reconcile("refresh");
    }).then((next) => {
      if (closed) {
        next?.close();
        return;
      }
      watcher = next;
      if (next) console.log("[lares] router catalog subscription ready");
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[lares] router catalog events unavailable; reconcile remains: ${message}`);
    });

    const period = reconcileIntervalMs();
    const timer = period > 0 ? setInterval(() => void reconcile("reconcile"), period) : null;
    timer?.unref?.();
    return () => {
      closed = true;
      watcher?.close();
      if (timer) clearInterval(timer);
    };
  }, "lares-catalog-events");
}
