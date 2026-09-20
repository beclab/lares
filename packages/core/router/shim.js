import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readBody, sendError, sendJson } from "../tools/http.js";
import { attachFlowstudioFilesPaths } from "../drive/flowstudio-files.js";
import { catalogCache } from "./catalog-cache.js";
import { carriesWebpImage, transcodeWebpImages } from "../media/router-images.js";
import { routerAuthHeaders, routerEndUser, routerGatewayUrl } from "./gateway.js";
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

/** GET /generations/:id — not /content, not create. */
export function isGenerationPoll(suffix) {
  return /^generations\/[^/]+$/.test(String(suffix ?? "").replace(/\/+$/, ""));
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

/** @returns {Record<string, string>} */
export function shimRequestHeaders(incoming, env = process.env) {
  /** @type {Record<string, string>} */
  const headers = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value == null || DROPPED_REQ.has(key.toLowerCase())) continue;
    headers[key] = Array.isArray(value) ? value.join(",") : value;
  }
  Object.assign(
    headers,
    routerAuthHeaders(
      env.LARES_ROUTER_API_KEY?.trim() || null,
      env.OLARES_APP_ID?.trim() || "lares",
      routerEndUser(env, incoming),
    ),
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

function isModelsGet(req) {
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  const u = new URL(req.url ?? "/", "http://x");
  return llmShimSuffix(u.pathname).replace(/\/+$/, "") === "models";
}

function serveCachedModels(req, res) {
  void catalogCache.get().then(
    ({ payload }) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if ((req.method ?? "GET").toUpperCase() === "HEAD") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end();
        return;
      }
      sendJson(res, 200, payload);
    },
    (err) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendError(res, err, "llm_proxy_failed");
    },
  );
}

function downstreamCancellation(req, res) {
  const controller = new AbortController();
  let finished = false;

  const cleanup = () => {
    req.off("aborted", cancel);
    res.off("finish", finish);
    res.off("close", close);
  };
  const cancel = () => {
    if (!controller.signal.aborted) {
      controller.abort(new Error("LLM downstream disconnected"));
    }
    cleanup();
  };
  const finish = () => {
    finished = true;
    cleanup();
  };
  const close = () => {
    if (!finished) cancel();
    else cleanup();
  };

  req.once("aborted", cancel);
  res.once("finish", finish);
  res.once("close", close);
  return controller;
}

function isJsonContentType(value) {
  return String(value ?? "").toLowerCase().includes("application/json");
}

function collectStream(stream, maxBytes, signal) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const onAbort = () => {
      stream.destroy();
      reject(signal?.reason instanceof Error ? signal.reason : new Error("aborted"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    stream.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        stream.destroy();
        reject(new Error("generation poll body exceeded the read limit"));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("end", () => {
      signal?.removeEventListener("abort", onAbort);
      resolve(Buffer.concat(chunks));
    });
    stream.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
  });
}

async function enrichGenerationPoll(up, res, req, env, cancellation, deps) {
  const status = up.statusCode ?? 502;
  const headers = shimResponseHeaders(up.headers);
  let raw;
  try {
    raw = await collectStream(up, SHIM_CHAT_MAX_BYTES, cancellation.signal);
  } catch (err) {
    if (cancellation.signal.aborted || res.headersSent) return;
    sendError(res, err, "llm_proxy_failed");
    return;
  }
  if (cancellation.signal.aborted || res.headersSent) return;
  const json = status === 200 && isJsonContentType(headers["content-type"] ?? up.headers["content-type"]);
  if (!json) {
    res.writeHead(status, headers);
    res.end(raw);
    return;
  }
  let payload;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    res.writeHead(status, headers);
    res.end(raw);
    return;
  }
  const enriched = await attachFlowstudioFilesPaths(payload, routerEndUser(env, req.headers), {
    signal: cancellation.signal,
    cat: deps.catFiles,
  });
  if (cancellation.signal.aborted || res.headersSent) return;
  sendJson(res, status, enriched);
}

export function proxyToRouter(req, res, env = process.env, deps = {}) {
  if (isModelsGet(req)) {
    serveCachedModels(req, res);
    return;
  }
  const routerUrl = routerGatewayUrl(env);
  const rawUrl = req.url ?? "/";
  const u = new URL(rawUrl, "http://x");
  const suffix = llmShimSuffix(u.pathname);
  const target = new URL(`${routerUrl}/${suffix}${u.search}`);
  const budget = shimBudget(suffix);
  const headers = shimRequestHeaders(req.headers, env);
  const transport = target.protocol === "https:" ? httpsRequest : httpRequest;
  const method = (req.method ?? "GET").toUpperCase();
  const cancellation = downstreamCancellation(req, res);
  const enrichPoll = method === "GET" && isGenerationPoll(suffix);

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
    if (cancellation.signal.aborted) return;

    const upstream = transport(
      target,
      { method, headers, timeout: budget.timeoutMs, signal: cancellation.signal },
      (up) => {
        if (cancellation.signal.aborted) {
          up.destroy();
          return;
        }
        if (enrichPoll) {
          void enrichGenerationPoll(up, res, req, env, cancellation, deps).catch((err) => {
            if (cancellation.signal.aborted) return;
            if (res.headersSent) {
              res.destroy();
              return;
            }
            sendError(res, err, "llm_proxy_failed");
          });
          return;
        }
        res.writeHead(up.statusCode ?? 502, shimResponseHeaders(up.headers));
        up.pipe(res);
      },
    );
    upstream.on("error", (err) => {
      if (cancellation.signal.aborted) return;
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
    if (cancellation.signal.aborted) return;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    sendError(res, err, "llm_proxy_failed");
  });
}
