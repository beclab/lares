import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { stream } from "../../node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js";

function model(provider: string, baseUrl: string) {
  return {
    id: "fixture",
    name: "Fixture",
    api: "openai-completions",
    provider,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 512,
    compat: { supportsStore: false },
  };
}

test("olares-router sends x-session-id without a settings compat switch", async () => {
  const seen: Array<string | undefined> = [];
  const server = createServer((req, res) => {
    seen.push(req.headers["x-session-id"] as string | undefined);
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end("data: [DONE]\n\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  try {
    for (const provider of ["olares-router", "openai"]) {
      for await (const _event of stream(model(provider, baseUrl), { messages: [] }, { apiKey: "fixture", sessionId: "sess-1" })) {
        void _event;
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  assert.deepEqual(seen, ["sess-1", undefined]);
});
