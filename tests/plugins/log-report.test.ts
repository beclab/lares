import assert from "node:assert/strict";
import test from "node:test";
import { postReport, reportRecord } from "@olares/lares-core/log/report";
import { apply as applyClientLog } from "../../packages/web/dsh-overlay/host/client-log.js";

test("a report keeps scope, event, and scalar fields only", () => {
  assert.deepEqual(reportRecord({
    scope: "voice",
    event: "hold-start",
    via: "touch",
    bytes: 4096,
    canSend: false,
    phase: "x".repeat(400),
    blob: { size: 1 },
    "bad key": "no",
  }), {
    scope: "voice",
    event: "hold-start",
    via: "touch",
    bytes: 4096,
    canSend: false,
    phase: "x".repeat(180),
  });
});

test("a report without a scope still has a record the server can print", () => {
  assert.equal(reportRecord({ event: "nope!", note: "hi" }).scope, "client");
  assert.equal(reportRecord({ event: "nope!" }).event, "event");
  assert.equal(reportRecord(null).event, "event");
});

test("postReport uses the host request port and ignores a failed post", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const ok = await postReport({ scope: "voice", event: "upload", bytes: 12 }, {
    url: "https://lares.example/api/lares/log",
    request: async (url: string, init: { body: unknown }) => {
      calls.push({ url, body: init.body });
      return { ok: true };
    },
  });
  assert.equal(ok, true);
  assert.equal(calls[0].url, "https://lares.example/api/lares/log");
  assert.equal((calls[0].body as { event: string }).event, "upload");

  const failed = await postReport({ scope: "voice", event: "upload" }, {
    request: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(failed, false);
});

test("POST /api/lares/log prints the report", async () => {
  let handler: (req: unknown, res: unknown) => void = () => {};
  applyClientLog({
    effect(run: () => void) {
      run();
    },
    webServer: {
      register(route: { handler: (req: unknown, res: unknown) => void }) {
        handler = route.handler;
        return () => {};
      },
    },
  } as never);
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  const req = {
    method: "POST",
    url: "/api/lares/log",
    headers: {},
    on(event: string, cb: (chunk?: Buffer) => void) {
      if (event === "data") cb(Buffer.from(JSON.stringify({ scope: "voice", event: "hold-start", via: "touch" })));
      if (event === "end") cb();
    },
  };
  const res = { headersSent: false, writeHead() {}, end() {} };
  try {
    handler(req, res);
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    console.log = original;
  }
  assert.match(lines.join("\n"), /\[lares:voice\].*"event":"hold-start".*"via":"touch"/);
});
