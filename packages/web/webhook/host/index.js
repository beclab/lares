/**
 * Demo entrance for other apps. No caller check: the settings switch is the
 * only gate. POST admits a prompt and returns the new session id; GET reads
 * that session once the agent is idle.
 *
 * Settings stay on the Lares web server (private entrance). Calls also listen
 * on LARES_WEBHOOK_PORT, the public `webhook` entrance. That host is the API:
 * POST / submits, GET /?id= reads the reply. It does not serve the UI.
 */
import { createServer } from "node:http";
import { createRouteHandler, HttpError, readJsonObject, sendJson } from "@olares/lares-core/tools/http";
import {
  loadWebhookConfig,
  saveWebhookConfig,
  webhookPrompt,
  webhookView,
  WEBHOOK_ROUTE,
} from "@olares/lares-core/webhook/config";
import { createJobBook, submitPrompt } from "./session.js";

export const name = "lares-webhook";
export const inject = [
  "webServer",
  "agents",
  "agentDefaultModel",
  "agentPresets",
  "permissionPresets",
  "workspaceRegistry",
  "sessionTitle",
];

function dataDir() {
  return process.env.LARES_DATA_DIR?.trim() || "/data/lares";
}

function webhookPort() {
  const raw = process.env.LARES_WEBHOOK_PORT?.trim();
  const port = raw ? Number(raw) : 8081;
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 8081;
}

function readConfig() {
  return webhookView(loadWebhookConfig(dataDir()));
}

/** @param {import("@deepseek-ai/cordis").Context} ctx */
function submit(ctx, book) {
  return async (req, res) => {
    const config = loadWebhookConfig(dataDir());
    if (!config.enabled) throw new HttpError("webhook_disabled", 403, "webhook is disabled");
    const prompt = webhookPrompt(await readJsonObject(req));
    sendJson(res, 202, await submitPrompt(ctx, book, config, prompt));
  };
}

function jobs(book) {
  return (req, res) => {
    const id = new URL(req.url ?? "/", "http://lares").searchParams.get("id") ?? "";
    if (!/^webhook-[0-9a-f-]{36}$/i.test(id)) {
      throw new HttpError("bad_request", 400, "id is required");
    }
    const job = book.view(id);
    if (!job) throw new HttpError("not_found", 404, "unknown webhook session");
    sendJson(res, 200, job);
  };
}

/** @param {import("@deepseek-ai/cordis").Context} ctx */
function callRoutes(ctx, book) {
  return {
    "/": { POST: submit(ctx, book) },
    "/jobs": { GET: jobs(book) },
  };
}

/** @param {import("@deepseek-ai/cordis").Context} ctx */
function appRoutes(ctx, book) {
  const calls = callRoutes(ctx, book);
  return {
    "/": {
      GET: (_req, res) => sendJson(res, 200, readConfig()),
      POST: calls["/"].POST,
    },
    "/config": {
      POST: async (req, res) => {
        sendJson(res, 200, webhookView(saveWebhookConfig(dataDir(), await readJsonObject(req))));
      },
    },
    "/jobs": calls["/jobs"],
  };
}

function publicCallPath(url) {
  const path = new URL(url ?? "/", "http://lares").pathname.replace(/\/+$/, "") || "/";
  return path === "/";
}

/**
 * Public call listener. Only the host root is a call. Every other path is
 * 404, so the webhook hostname cannot open the Lares UI.
 *
 * @param {import("@deepseek-ai/cordis").Context} ctx
 */
function listenWebhookEntrance(ctx, book) {
  const port = webhookPort();
  const calls = callRoutes(ctx, book);
  const handler = createRouteHandler({
    prefix: "",
    routes: {
      "/": { POST: calls["/"].POST, GET: calls["/jobs"].GET },
    },
    fallbackCode: "webhook_failed",
  });
  const server = createServer((req, res) => {
    if (!publicCallPath(req.url)) {
      sendJson(res, 404, { error: { code: "not_found", message: "not found" } });
      return;
    }
    handler(req, res);
  });
  server.on("error", (err) => {
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger?.error?.(`webhook entrance :${port} failed: ${message}`);
  });
  server.listen(port, "0.0.0.0");
  return () => {
    server.close();
  };
}

/** @param {import("@deepseek-ai/cordis").Context} ctx */
export function apply(ctx) {
  const book = createJobBook();
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: WEBHOOK_ROUTE,
        handler: createRouteHandler({
          prefix: WEBHOOK_ROUTE,
          routes: appRoutes(ctx, book),
          fallbackCode: "webhook_failed",
        }),
      }),
    "lares-webhook-routes",
  );
  ctx.effect(() => listenWebhookEntrance(ctx, book), "lares-webhook-entrance");
}
