import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { apply } from "../../packages/web/composer-voice/host/index.js";
import { defaultDictationProfiles } from "@olares/lares-core/voice/dictation";

async function listen(server: Server) {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as any).port}`;
}
async function close(server: Server) {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
}

test("HTTP capabilities use the catalog cache; cleanup uses authenticated identity without an audio connection ID", async () => {
  const calls: any[] = [], disposers: (() => void)[] = [];
  let catalogReads = 0;
  const previous = process.env.LLM_GATEWAY_URL;
  const upstream = createServer(async (req, res) => {
    if (req.method === "GET") {
      catalogReads++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "whisper-a", mode: "audio" }] }));
      return;
    }
    let text = ""; for await (const chunk of req) text += chunk;
    calls.push({ user: req.headers["x-bfl-user"], body: JSON.parse(text) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "周四下午三点开会，先不要删除文件。" } }] }));
  });
  let handler: any;
  const host = createServer((req, res) => handler(req, res));
  try {
    process.env.LLM_GATEWAY_URL = `${await listen(upstream)}/v1`;
    apply({ sessionController: {}, effect(fn: any) { const dispose = fn(); if (typeof dispose === "function") disposers.push(dispose); }, on() {}, inject() {},
      webServer: { register({ handler: value }: any) { handler = value; return () => {}; }, registerUpgrade() { return () => {}; } },
    } as any);
    const base = await listen(host);
    const capabilities = await fetch(`${base}/api/lares/voice/capabilities`);
    assert.equal(capabilities.status, 200);
    const available = await capabilities.json();
    assert.deepEqual(available.stt, ["whisper-a"]); assert.equal(available.charts, undefined);
    await fetch(`${base}/api/lares/voice/capabilities`);
    assert.equal(catalogReads, 1);
    const post = (path: string, body: any) => fetch(`${base}/api/lares/voice${path}`, { method: "POST", headers: { "content-type": "application/json", "x-bfl-user": "alice" }, body: JSON.stringify(body) });
    const response = await post("/dictation/clean", { text: "周四下午三点开会，先不要删除文件", preset: "clean", config: { dictationProfiles: defaultDictationProfiles() } });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { text: "周四下午三点开会，先不要删除文件。" });
    assert.equal(calls.length, 1); assert.equal(calls[0].user, "alice");
    assert.equal(calls[0].body.model, "default-chat"); assert.equal(calls[0].body.tools, undefined);
    const raw = await post("/dictation/clean", { text: "原文", preset: "raw" });
    assert.deepEqual(await raw.json(), { text: "原文" }); assert.equal(calls.length, 1);
    const session = await fetch(`${base}/api/lares/voice/session`);
    assert.equal(session.status, 400); assert.equal((await session.json()).error.code, "voice_session_invalid");
  } finally {
    if (previous === undefined) delete process.env.LLM_GATEWAY_URL; else process.env.LLM_GATEWAY_URL = previous;
    for (const dispose of disposers.reverse()) dispose();
    await close(host); await close(upstream);
  }
});
