import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRouteHandler,
  readJsonObject,
  sendJson,
} from "@olares/lares-core/tools/http";
import { resolveSessionWorkspace } from "@olares/lares-core/workspace/session";

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

type Header = { id: string; cwd?: string };

/** Stands in for the Host context: a live session table, session logs, and the registry. */
function context(root: string, live: Header[], persisted: Header[]) {
  const workspace = { path: root, status: async () => "ok" };
  let listed = 0;
  return {
    get: (name: string) =>
      name !== "sessions" ? undefined : {
        get: (id: string) => {
          const header = live.find((entry) => entry.id === id);
          return header === undefined ? undefined : { header };
        },
      },
    sessionPersistence: {
      list: async () => {
        listed += 1;
        return persisted;
      },
    },
    workspaceRegistry: {
      resolveByPath: async (path: string) => (path === root ? workspace : undefined),
    },
    workspace,
    reads: () => listed,
  };
}

test("a session's workspace follows its cwd, not workspace grouping", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lares-session-workspace-")));
  try {
    // dsh attaches a session to a workspace only when the client names one at
    // create time, so an ungrouped session must still resolve by its own cwd.
    const ungrouped = context(root, [], [{ id: "persisted", cwd: root }]);
    assert.equal(await resolveSessionWorkspace(ungrouped, "persisted"), ungrouped.workspace);

    const running = context(root, [{ id: "live", cwd: root }], []);
    assert.equal(await resolveSessionWorkspace(running, "live"), running.workspace);
    assert.equal(running.reads(), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a session outside the served workspaces cannot reach files through it", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lares-session-workspace-")));
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "lares-session-outside-")));
  try {
    const ctx = context(root, [], [
      { id: "elsewhere", cwd: outside },
      { id: "gone", cwd: join(root, "removed") },
      { id: "headless" },
    ]);
    for (const [sessionId, code, status] of [
      ["elsewhere", "workspace_not_found", 404],
      ["gone", "workspace_unavailable", 409],
      ["headless", "workspace_not_found", 404],
      ["unknown", "workspace_not_found", 404],
      ["", "session_required", 400],
    ] as const) {
      await assert.rejects(
        () => resolveSessionWorkspace(ctx, sessionId),
        (error: { code?: string; status?: number }) =>
          error.code === code && error.status === status,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

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
