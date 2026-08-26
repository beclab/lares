import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readBody, sendError } from "../tools/http.js";
import { carriesWebpImage, transcodeWebpImages } from "../media/router-images.js";
import { routerAuthHeaders, routerGatewayUrl } from "./gateway.js";
import { STT_MAX_AUDIO_BYTES } from "./stt.js";

export const SHIM_PATH = "/llm/v1";
export const SHIM_CHAT_TIMEOUT_MS = 120_000;
export const SHIM_AUDIO_TIMEOUT_MS = 180_000;
export const SHIM_CHAT_MAX_BYTES = 16 * 1024 * 1024;

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

export function llmShimSuffix(pathname) {
  return pathname.replace(/^\/llm\/v1\/?/, "").replace(/^\/+/, "");
}

export function isAudioShimPath(suffix) {
  return /(^|\/)audio(\/|$)/.test(suffix);
}

export function shimBudget(suffix) {
  const audio = isAudioShimPath(suffix);
  return {
    audio,
    timeoutMs: audio ? SHIM_AUDIO_TIMEOUT_MS : SHIM_CHAT_TIMEOUT_MS,
    maxBytes: audio ? STT_MAX_AUDIO_BYTES : SHIM_CHAT_MAX_BYTES,
    tooLargeMessage: audio ? "audio exceeds 25MB" : "LLM request exceeds 16MB",
  };
}

export function shimRequestHeaders(incoming, env = process.env) {
  const headers = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value == null || DROPPED_REQ.has(key.toLowerCase())) continue;
    headers[key] = Array.isArray(value) ? value.join(",") : value;
  }
  Object.assign(
    headers,
    routerAuthHeaders(env.LARES_ROUTER_API_KEY?.trim() || null, env.OLARES_APP_ID?.trim() || "lares"),
  );
  return headers;
}

export function shimResponseHeaders(incoming) {
  const headers = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value == null || DROPPED_RES.has(key.toLowerCase())) continue;
    headers[key] = value;
  }
  return headers;
}

export function healthPayload(env = process.env) {
  return {
    ok: true,
    app: "lares",
    kernel: "dsh-web",
    routerUrl: routerGatewayUrl(env),
    olaresAppId: env.OLARES_APP_ID ?? "lares",
    hasRouterKey: Boolean(env.LARES_ROUTER_API_KEY?.trim()),
  };
}

export function proxyToRouter(req, res, env = process.env) {
  const routerUrl = routerGatewayUrl(env);
  const rawUrl = req.url ?? "/";
  const u = new URL(rawUrl, "http://x");
  const suffix = llmShimSuffix(u.pathname);
  const target = new URL(`${routerUrl}/${suffix}${u.search}`);
  const budget = shimBudget(suffix);
  const headers = shimRequestHeaders(req.headers, env);
  const transport = target.protocol === "https:" ? httpsRequest : httpRequest;
  const method = (req.method ?? "GET").toUpperCase();

  const run = async () => {
    let body;
    if (method !== "GET" && method !== "HEAD") {
      body = await readBody(req, {
        maxBytes: budget.maxBytes,
        message: budget.tooLargeMessage,
      });
      if (!budget.audio && carriesWebpImage(body)) body = await transcodeWebpImages(body);
      headers["content-length"] = String(body.length);
    }

    const upstream = transport(
      target,
      { method, headers, timeout: budget.timeoutMs },
      (up) => {
        res.writeHead(up.statusCode ?? 502, shimResponseHeaders(up.headers));
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
