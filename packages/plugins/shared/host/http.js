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
    error: { code: failure.code, message: failure.message },
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
    if (!handlers) {
      sendJson(res, 404, {
        error: { code: "not_found", message: `no route ${path}` },
      });
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
