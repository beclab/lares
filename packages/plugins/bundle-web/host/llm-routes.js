/**
 * Readiness probe + LLM gateway shim at /llm/v1 (chat + voice STT).
 */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
import { readBody, sendError } from "../../shared/host/http.js";
import { carriesWebpImage, transcodeWebpImages } from "./router-images.js";

export const name = "lares-llm-routes";
export const inject = ["webServer"];

const DROPPED_REQ = new Set([
  "authorization",
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "x-olares-app-id",
  "x-caller-appid",
]);

const DROPPED_RES = new Set(["connection", "content-encoding", "content-length", "transfer-encoding"]);

function routerAuthHeaders(apiKey, olaresAppId) {
  if (apiKey) return { authorization: `Bearer ${apiKey}` };
  return { "x-caller-appid": olaresAppId };
}

function proxyToRouter(req, res) {
  const routerUrl = (process.env.LLM_GATEWAY_URL ?? "http://router-svc.router-shared/v1").replace(/\/+$/, "");
  const apiKey = process.env.LARES_ROUTER_API_KEY?.trim() || null;
  const olaresAppId = process.env.OLARES_APP_ID?.trim() || "lares";

  const rawUrl = req.url ?? "/";
  const u = new URL(rawUrl, "http://x");
  const suffix = u.pathname.replace(/^\/llm\/v1\/?/, "").replace(/^\/+/, "");
  const target = new URL(`${routerUrl}/${suffix}${u.search}`);

  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null || DROPPED_REQ.has(key.toLowerCase())) continue;
    headers[key] = Array.isArray(value) ? value.join(",") : value;
  }
  Object.assign(headers, routerAuthHeaders(apiKey, olaresAppId));

  const transport = target.protocol === "https:" ? httpsRequest : httpRequest;
  const method = (req.method ?? "GET").toUpperCase();
  // Audio (Whisper cold-start) needs a wider budget than chat.
  const isAudio = /(^|\/)audio(\/|$)/.test(suffix);
  const timeoutMs = isAudio ? 180_000 : 120_000;

  const run = async () => {
    let body;
    if (method !== "GET" && method !== "HEAD") {
      body = await readBody(req, {
        maxBytes: isAudio ? 25 * 1024 * 1024 : 16 * 1024 * 1024,
        message: isAudio ? "audio exceeds 25MB" : "LLM request exceeds 16MB",
      });
      if (!isAudio && carriesWebpImage(body)) body = await transcodeWebpImages(body);
      headers["content-length"] = String(body.length);
    }

    const upstream = transport(
      target,
      { method, headers, timeout: timeoutMs },
      (up) => {
        const outHeaders = {};
        for (const [key, value] of Object.entries(up.headers)) {
          if (value == null || DROPPED_RES.has(key.toLowerCase())) continue;
          outHeaders[key] = value;
        }
        res.writeHead(up.statusCode ?? 502, outHeaders);
        up.pipe(res);
      },
    );
    upstream.on("error", (err) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(502, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            type: "upstream_unreachable",
            message: `Cannot reach Router at ${routerUrl}: ${err.message}`,
          },
        }),
      );
    });
    if (body) upstream.end(body);
    else upstream.end();
  };

  void run().catch((err) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    sendError(res, err, "llm_proxy_failed");
  });
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const routerUrl = (process.env.LLM_GATEWAY_URL ?? "http://router-svc.router-shared/v1").replace(/\/+$/, "");

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: "/api/health",
        handler: (_req, res) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              app: "lares",
              kernel: "dsh-web",
              routerUrl,
              olaresAppId: process.env.OLARES_APP_ID ?? "lares",
              hasRouterKey: Boolean(process.env.LARES_ROUTER_API_KEY?.trim()),
            }),
          );
        },
      }),
    "lares-health",
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: "/llm/v1",
        handler: proxyToRouter,
      }),
    "lares-llm-proxy",
  );
}
