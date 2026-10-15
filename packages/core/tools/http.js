import { LAREPASS_PAGE_ORIGINS } from "../larepass/host.js";
import { pageOrigin } from "../olares/trusted-host.js";

const CORS_HEADERS = "content-type, x-authorization, x-unauth-error, x-lares-session-id, x-lares-file-name, x-lares-upload-request-id";

/** @returns {boolean} true when the request came from a LarePass page. */
function allowLarepassOrigin(req, res) {
  const origin = pageOrigin(req.headers);
  if (!origin || !LAREPASS_PAGE_ORIGINS.includes(origin)) return false;
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("access-control-allow-credentials", "true");
  res.setHeader("vary", "Origin");
  return true;
}

export class HttpError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {{ maxBytes?: number, code?: string, message?: string }} [options]
 */
export function readBody(req, options = {}) {
  const maxBytes = options.maxBytes ?? 64 * 1024;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let rejected = false;
    req.on("data", (chunk) => {
      if (rejected) return;
      total += chunk.length;
      if (total > maxBytes) {
        rejected = true;
        reject(new HttpError(
          options.code ?? "body_too_large",
          413,
          options.message ?? `body exceeds ${maxBytes} bytes`,
        ));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {{ maxBytes?: number }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readJsonObject(req, options) {
  const raw = await readBody(req, options);
  if (raw.length === 0) return {};
  try {
    const body = JSON.parse(raw.toString("utf8"));
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch {
    // The common error below is the public contract for every malformed body.
  }
  throw new HttpError("bad_request", 400, "invalid JSON body");
}

function errorResponse(err, fallbackCode) {
  if (
    err
    && typeof err === "object"
    && typeof err.code === "string"
    && typeof err.status === "number"
  ) {
    return {
      status: err.status >= 400 ? err.status : 500,
      code: err.code,
      message: err instanceof Error ? err.message : String(err),
      params: err.params && typeof err.params === "object" ? err.params : undefined,
    };
  }
  return {
    status: 500,
    code: fallbackCode,
    message: err instanceof Error ? err.message : String(err),
  };
}

export function sendError(res, err, fallbackCode) {
  const failure = errorResponse(err, fallbackCode);
  sendJson(res, failure.status, {
    error: { code: failure.code, message: failure.message, params: failure.params },
  });
}

/**
 * @param {{
 *   prefix: string,
 *   routes: Record<string, Record<string, (req: any, res: any) => Promise<void> | void>>,
 *   fallbackCode: string
 * }} options
 */
export function createRouteHandler(options) {
  return (req, res) => {
    const method = (req.method ?? "GET").toUpperCase();
    const suffix = new URL(req.url ?? "/", "http://x").pathname.slice(options.prefix.length) || "/";
    const path = suffix.replace(/\/+$/, "") || "/";
    const handlers = options.routes[path];
    const cors = allowLarepassOrigin(req, res);
    if (!handlers) {
      sendJson(res, 404, {
        error: { code: "not_found", message: `no route ${path}` },
      });
      return;
    }
    if (cors && method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-methods": Object.keys(handlers).join(", "),
        "access-control-allow-headers": CORS_HEADERS,
        "access-control-max-age": "600",
      });
      res.end();
      return;
    }
    const route = handlers[method];
    if (!route) {
      sendJson(res, 405, {
        error: { code: "method_not_allowed", message: `${method} not allowed` },
      });
      return;
    }
    Promise.resolve().then(() => route(req, res)).catch((err) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendError(res, err, options.fallbackCode);
    });
  };
}
