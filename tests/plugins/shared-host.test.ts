import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import {
  createRouteHandler,
  readJsonObject,
  sendJson,
} from "../../packages/plugins/shared/host/http.js";

function request(method: string, url: string, body = "") {
  const req = Object.assign(new EventEmitter(), { method, url });
  queueMicrotask(() => {
    if (body) req.emit("data", Buffer.from(body));
    req.emit("end");
  });
  return req;
}

function response() {
  let status = 0;
  let body = "";
  return {
    headersSent: false,
    writeHead(next: number) {
      status = next;
      this.headersSent = true;
    },
    end(chunk = "") {
      body += String(chunk);
    },
    destroy() {},
    result() {
      return { status, body: body ? JSON.parse(body) : null };
    },
  };
}

test("shared HTTP reader accepts only bounded JSON objects", async () => {
  assert.deepEqual(await readJsonObject(request("POST", "/", '{"ok":true}') as never), { ok: true });
  await assert.rejects(
    () => readJsonObject(request("POST", "/", "[]") as never),
    (err: { code?: string; status?: number }) => err.code === "bad_request" && err.status === 400,
  );
  await assert.rejects(
    () => readJsonObject(request("POST", "/", '{"value":"too long"}') as never, { maxBytes: 4 }),
    (err: { code?: string; status?: number }) => err.code === "body_too_large" && err.status === 413,
  );
});

test("shared route handler owns 404, 405 and structured failures", async () => {
  const handler = createRouteHandler({
    prefix: "/api/example",
    routes: {
      "/": {
        GET: (_req, res) => sendJson(res, 200, { ok: true }),
      },
      "/failure": {
        POST: () => {
          throw Object.assign(new Error("unavailable"), { code: "upstream_unavailable", status: 503 });
        },
      },
    },
    fallbackCode: "example_failed",
  });

  for (const [method, url, expected] of [
    ["GET", "/api/example", 200],
    ["POST", "/api/example", 405],
    ["GET", "/api/example/missing", 404],
    ["POST", "/api/example/failure", 503],
  ] as const) {
    const res = response();
    handler(request(method, url) as never, res as never);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(res.result().status, expected);
  }
});
