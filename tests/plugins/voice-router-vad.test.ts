import assert from "node:assert/strict";
import test from "node:test";
import { speechSeconds } from "@olares/lares-core/router/stt";
import { createRouterAudio } from "@olares/lares-core/voice/router-audio";

test("Router VAD answers seconds of speech and null whenever it cannot tell", async () => {
  const original = globalThis.fetch;
  const seen: any[] = [];
  try {
    globalThis.fetch = (async (url: string, init: any) => { seen.push({ url, init }); return Response.json({ speech_seconds: 1.25, num_segments: 1 }); }) as any;
    assert.equal(await speechSeconds({ bytes: Buffer.from("RIFF"), headers: { "x-session-id": "rtc_1" } }), 1.25);
    assert.match(seen[0].url, /\/audio\/vad$/);
    assert.equal(seen[0].init.headers["x-session-id"], "rtc_1");
    assert.match(Buffer.from(seen[0].init.body).toString("latin1"), /name="model"\r\n\r\ndefault-vad/);
    globalThis.fetch = (async () => new Response("busy", { status: 503 })) as any;
    assert.equal(await speechSeconds({ bytes: Buffer.from("RIFF") }), null);
    globalThis.fetch = (async () => { throw new Error("down"); }) as any;
    assert.equal(await speechSeconds({ bytes: Buffer.from("RIFF") }), null);
    globalThis.fetch = (async () => Response.json({ duration: 1 })) as any;
    assert.equal(await speechSeconds({ bytes: Buffer.from("RIFF") }), null);
  } finally { globalThis.fetch = original; }
});

test("the Router audio adapter sends a take to VAD as 16 kHz WAV", async () => {
  const original = globalThis.fetch;
  let body: Buffer = Buffer.alloc(0);
  try {
    globalThis.fetch = (async (_url: string, init: any) => { body = Buffer.from(init.body); return Response.json({ speech_seconds: 0 }); }) as any;
    const audio = createRouterAudio(() => ({}));
    // One second at 24 kHz PCM16.
    assert.equal(await audio.detectSpeech(Buffer.alloc(48000), { routerSessionId: "rtc_2" }), 0);
    const wav = body.subarray(body.indexOf("RIFF"));
    assert.equal(wav.readUInt32LE(24), 16000);
    assert.equal(wav.readUInt32LE(40), 32000);
  } finally { globalThis.fetch = original; }
});

test("a streaming take waits out a busy ASR model instead of failing over at once", async () => {
  const { createServer } = await import("node:http");
  const { WebSocketServer } = await import("ws");
  const { catalogCache } = await import("../../packages/core/router/catalog-cache.js");
  const originalFetch = globalThis.fetch;
  const server = createServer();
  const sockets = new WebSocketServer({ noServer: true });
  let dials = 0;
  const received: Buffer[] = [];
  // Router refuses the first handshake as its slot is still held, then takes the next one.
  server.on("upgrade", (req, socket, head) => {
    dials += 1;
    if (dials === 1) { socket.end("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n"); return; }
    sockets.handleUpgrade(req, socket, head, (ws) => ws.on("message", (raw, binary) => {
      if (binary) { received.push(Buffer.from(raw as Buffer)); return; }
      if (JSON.parse(String(raw)).type === "finish") ws.send(JSON.stringify({ type: "final", text: "你好" }));
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  catalogCache.reset();
  globalThis.fetch = (async () => Response.json({ data: [{ id: "asr", mode: "audio", supports: ["stt", "stt_stream"] }] })) as any;
  try {
    const audio = createRouterAudio(() => ({ model: "asr" }));
    const env = { LLM_GATEWAY_URL: `http://127.0.0.1:${(server.address() as any).port}/v1` };
    const live = await audio.openTranscription({}, () => {}, { env, retryMs: [10] });
    live.write(Buffer.alloc(4800));
    assert.equal(await live.finish(), "你好");
    assert.equal(dials, 2);
    assert.equal(received.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    catalogCache.reset();
    sockets.close();
    server.close();
  }
});
