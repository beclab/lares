import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { runInNewContext } from "node:vm";
import { WebSocket } from "ws";
import { createAudioStreamGateway } from "@olares/lares-core/voice/stream-gateway";
import { createDuplexCoordinator } from "@olares/lares-core/voice/duplex";
import { createSentencePlayer } from "@olares/lares-core/voice/speech";
import { PCM_PLAYER_WORKLET } from "@olares/lares-core/voice/pcm-worklet";

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
async function fixture(synthesize: any, options: Record<string, unknown> = {}) {
  const scope = { id: "test-stream-client", owner: "alice", device: "device", active: true, readAloud: true, duplex: createDuplexCoordinator() };
  const gateway = createAudioStreamGateway({ config: () => ({ speak: false, ttsModel: "tts" }), models: async () => [{ id: "tts", supportsTts: true }], synthesize, ...options });
  const server = createServer(); server.on("upgrade", (req, socket, head) => gateway.upgrade(req, socket, head)); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const open = async (ticket: string) => { const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as any).port}`, ["lares-voice", `lares-ticket.${ticket}`]); return ws; };
  return { scope, gateway, open, close: async () => { gateway.close(); await new Promise<void>((resolve) => server.close(() => resolve())); } };
}

test("a reply keeps going when playout acks stop", async () => {
  const total = 24000 * 2 * 4;
  const h = await fixture(async (request: any, chunk: any) => {
    request.onFormat({ sampleRate: 24000, channels: 1, encoding: "pcm_s16le" });
    await chunk(Buffer.alloc(total));
    return { streamed: true };
  });
  const started = Date.now();
  try {
    const grant = await h.gateway.ticket(h.scope, { operation: "tts", text: "一段比较长的回复。" });
    const ws = await h.open(grant.ticket);
    let bytes = 0, done = false, code = "";
    ws.on("message", (data, binary) => {
      if (binary) { bytes += data.length; return; }
      const frame = JSON.parse(String(data));
      if (frame.type === "error") code = frame.code;
      if (frame.type === "done") done = true;
    });
    await once(ws, "open");
    const opened = Date.now();
    while (bytes === 0 && Date.now() - opened < 2000) await new Promise((resolve) => setTimeout(resolve, 20));
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(code, "");
    assert.ok(bytes > 0 && bytes < total, `unpaced dump of ${bytes}`);
    while (!done && !code && Date.now() - started < 7000) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(code, "");
    assert.equal(done, true);
    assert.equal(bytes, total);
  } finally { await h.close(); }
});

test("acking rendered frames releases the rest of a long answer", async () => {
  const total = 24000 * 2 * 6;
  const h = await fixture(async (request: any, chunk: any) => {
    request.onFormat({ sampleRate: 24000, channels: 1, encoding: "pcm_s16le" });
    await chunk(Buffer.alloc(total));
    return { streamed: true };
  });
  try {
    const grant = await h.gateway.ticket(h.scope, { operation: "tts", text: "一段比较长的回复。" });
    const ws = await h.open(grant.ticket);
    let bytes = 0; let done = false;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("long answer did not finish")), 4000);
      ws.on("message", (data, binary) => {
        if (binary) {
          bytes += data.length;
          ws.send(JSON.stringify({ type: "progress", frames: bytes / 2 }));
          return;
        }
        const frame = JSON.parse(String(data));
        if (frame.type === "error") { clearTimeout(timer); reject(new Error(frame.code)); }
        if (frame.type === "done") { done = true; clearTimeout(timer); resolve(); }
      });
    });
    assert.equal(done, true);
    assert.equal(bytes, total);
  } finally { await h.close(); }
});

test("the playback socket stays open after done until the client closes it", async () => {
  const h = await fixture(async (request: any, chunk: any) => {
    request.onFormat({ sampleRate: 24000, channels: 1, encoding: "pcm_s16le" });
    await chunk(Buffer.alloc(48000));
    return { streamed: true };
  });
  try {
    const grant = await h.gateway.ticket(h.scope, { operation: "tts", text: "我是一个可爱的小猫咪" });
    const ws = await h.open(grant.ticket);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("done timeout")), 2000);
      ws.on("error", reject);
      ws.on("message", (data, binary) => {
        if (!binary && JSON.parse(String(data)).type === "done") { clearTimeout(timer); resolve(); }
      });
    });
    await tick();
    assert.equal(ws.readyState, WebSocket.OPEN);
    ws.close();
    await once(ws, "close");
  } finally { await h.close(); }
});

test("Host delivers PCM before synthesis finishes, and a listener leaving does not cut the response body", async () => {
  let finished = false;
  let release = () => {};
  const h = await fixture(async (request: any, chunk: any) => {
    assert.equal(request.signal, undefined);
    request.onFormat({ sampleRate: 48000, channels: 1, encoding: "pcm_s16le" });
    await chunk(Buffer.alloc(128));
    await new Promise<void>((resolve) => { release = resolve; });
    finished = true;
    return { streamed: true };
  });
  try {
    const grant = await h.gateway.ticket(h.scope, { operation: "tts", text: "Hello." });
    const ws = await h.open(grant.ticket); const seen: any[] = [];
    ws.on("message", (data, binary) => seen.push(binary ? data : JSON.parse(String(data))));
    while (!seen.some(Buffer.isBuffer)) await tick();
    assert.equal(finished, false); assert.equal(seen.find(event => event.type === "format").sampleRate, 48000);
    ws.close(); await once(ws, "close"); await tick();
    assert.equal(finished, false);
    release();
    for (let i = 0; !finished && i < 20; i += 1) await tick();
    assert.equal(finished, true);
  } finally { await h.close(); }
});

test("single-use grants and read-aloud off cannot authorize another output", async () => {
  const h = await fixture(async () => ({ streamed: true }));
  try {
    await assert.rejects(h.gateway.ticket({ ...h.scope, readAloud: false }, { operation: "tts", text: "Hello" }), /voice_speak_disabled/);
    const grant = await h.gateway.ticket(h.scope, { operation: "tts", text: "Hello" });
    const one = await h.open(grant.ticket); await once(one, "open"); one.close(); await once(one, "close");
    const reused = await h.open(grant.ticket); const [error] = await once(reused, "error"); assert.match(error.message, /403/);
  } finally { await h.close(); }
});

test("stream reader waits for committed text, stops one generation and never replays", async () => {
  const started: any[] = [];
  const player = createSentencePlayer({ send: async () => { throw new Error("buffered endpoint used"); }, play() {}, halt() {}, silence() {},
    stream: async (value: any) => { started.push(value); await new Promise<void>((resolve) => value.signal.addEventListener("abort", () => resolve(), { once: true })); } });
  player.follow({ key: "one", text: "Maybe running a tool", done: false }); await tick(); assert.equal(started.length, 0);
  player.follow({ key: "one", text: "Actual result.", done: true }); await tick(); assert.equal(started.length, 1);
  player.stop(); assert.equal(started[0].signal.aborted, true);
  player.follow({ key: "one", text: "Actual result.", done: true }); await tick(); assert.equal(started.length, 1);
});

test("AudioWorklet reports consumed source frames and keeps a long buffer", () => {
  let Processor: any; const events: any[] = [];
  class Base { port = { onmessage: null, postMessage: (data: any) => events.push(data) }; }
  runInNewContext(PCM_PLAYER_WORKLET, { AudioWorkletProcessor: Base, sampleRate: 48000, registerProcessor: (_: string, value: any) => { Processor = value; } });
  const worker = new Processor({ processorOptions: { inputRate: 16000 } });
  worker.port.onmessage({ data: { type: "audio", samples: new Float32Array(160).fill(.5) } });
  worker.port.onmessage({ data: { type: "finish" } });
  let processing = true; for (let i = 0; i < 10 && processing; i++) processing = worker.process([], [[new Float32Array(128)]]);
  assert.equal(processing, false); assert.equal(events.findLast((e) => e.type === "progress").frames, 160);
  worker.port.onmessage({ data: { type: "audio", samples: new Float32Array(16000 * 5) } });
  assert.equal(events.some((event) => event.type === "error"), false);
  assert.equal(worker.queued, 16000 * 5);
});

test("streaming ASR forwards partials but only completes after final and preserves caller identity", async () => {
  const { WebSocketServer } = await import("ws");
  const upstreamServer = createServer(); const upstream = new WebSocketServer({ server: upstreamServer });
  upstreamServer.listen(0, "127.0.0.1"); await once(upstreamServer, "listening");
  let authorized = false;
  upstream.on("connection", (ws, req) => {
    authorized = req.headers.authorization === "Bearer scoped-key";
    ws.on("message", (data, binary) => {
      if (binary) { ws.send(JSON.stringify({ type: "partial", text: "Temporary" })); return; }
      if (JSON.parse(String(data)).type === "finish") {
        ws.send(JSON.stringify({ type: "final", text: "Confirmed" }));
        ws.send(JSON.stringify({ type: "closed", audio_seconds: .1 })); ws.close();
      }
    });
  });
  const gateway = createAudioStreamGateway({ config: () => ({ model: "asr" }), models: async () => [{ id: "asr", supportsStt: true, supportsSttStream: true }],
    env: { LLM_GATEWAY_URL: `http://127.0.0.1:${(upstreamServer.address() as any).port}/v1`, LARES_ROUTER_API_KEY: "scoped-key" } });
  const host = createServer(); host.on("upgrade", (req, socket, head) => gateway.upgrade(req, socket, head)); host.listen(0, "127.0.0.1"); await once(host, "listening");
  try {
    const grant = await gateway.ticket({ device: "device", owner: "alice" }, { operation: "stt" });
    const ws = new WebSocket(`ws://127.0.0.1:${(host.address() as any).port}`, ["lares-voice", `lares-ticket.${grant.ticket}`]);
    const events: any[] = [];
    ws.on("message", (data) => { const frame = JSON.parse(String(data)); events.push(frame); if (frame.type === "ready") ws.send(Buffer.alloc(3200)); });
    while (!events.some((event) => event.type === "partial")) await tick();
    assert.equal(events.some((event) => event.type === "final"), false);
    ws.send(JSON.stringify({ type: "finish" })); await once(ws, "close");
    assert.equal(events.find((event) => event.type === "final").text, "Confirmed"); assert.equal(authorized, true);
  } finally { gateway.close(); upstream.close(); await Promise.all([new Promise<void>((r) => host.close(() => r())), new Promise<void>((r) => upstreamServer.close(() => r()))]); }
});

test("browser capture disconnects and flushes before ASR finish; repeated cleanup is harmless", async (t) => {
  const { createStreamingCapture } = await import("@olares/lares-core/voice/stream-client");
  let disconnected = false, closes = 0, audioWrites = 0, socket: any;
  class Socket extends EventTarget {
    readyState = 1; bufferedAmount = 0;
    constructor() { super(); setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "ready" }) })), 0); }
    send(data: any) {
      if (typeof data !== "string") { audioWrites++; return; }
      assert.equal(disconnected, true, "ASR finish must follow capture disconnect");
      setTimeout(() => { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "final", text: "final" }) })); this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "done" }) })); }, 10);
    }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new Event("close")); }
  }
  class Context {
    state = "running"; sampleRate = 48000; destination = {};
    audioWorklet = { addModule: async () => {} };
    resume = async () => {};
    close = async () => { closes++; assert.notEqual(this.state, "closed"); this.state = "closed"; };
    createMediaStreamSource = () => ({ connect() {}, disconnect() { disconnected = true; } });
  }
  class Node {
    port: any = { onmessage: null, postMessage: () => { this.port.onmessage({ data: { type: "samples", samples: new Float32Array(480) } }); this.port.onmessage({ data: { type: "flushed" } }); } };
    connect() {} disconnect() { disconnected = true; }
  }
  const previous = { context: globalThis.AudioContext, node: globalThis.AudioWorkletNode };
  (globalThis as any).AudioContext = Context; (globalThis as any).AudioWorkletNode = Node;
  t.after(() => { (globalThis as any).AudioContext = previous.context; (globalThis as any).AudioWorkletNode = previous.node; });
  const capture = await createStreamingCapture({} as any, { request: async () => ({ ok: true, body: { supported: true, ticket: "ticket" } }), socket: () => socket = new Socket() });
  assert.equal(await capture.finish(), "final"); capture.cancel();
  assert.equal(audioWrites, 1); assert.equal(closes, 1);
});


test("speech segmentation never reads leaked model thinking delimiters", async () => {
  const { speechSegments } = await import("@olares/lares-core/voice/script");
  assert.deepEqual(speechSegments("<think>private reasoning</think>Actual answer."), ["Actual answer."]);
  assert.deepEqual(speechSegments("orphaned reasoning</think>Actual answer."), ["Actual answer."]);
  assert.deepEqual(speechSegments("<think>unfinished reasoning"), []);
});

test("Lares TTS grants bind latest settings once and keep model/voice stable until done", async () => {
  let current: any = { speak: true, ttsModel: "tts", ttsVoiceByModel: { tts: "new" } };
  const requests: any[] = [];
  const gateway = createAudioStreamGateway({ config: () => current, models: async () => [{ id: "tts", supportsTts: true }],
    synthesize: async (request: any, chunk: any) => { requests.push({ model: request.model, voice: request.voice }); request.onFormat({ sampleRate: 24000, channels: 1, encoding: "pcm_s16le" }); await chunk(Buffer.alloc(2)); return { streamed: true }; } });
  const server = createServer(); server.on("upgrade", (req, socket, head) => gateway.upgrade(req, socket, head)); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const scope: any = { id: "tts-snapshot", device: "device", active: true, presentationSession: true, readAloud: true, voiceConfig: { ttsModel: "old", voice: "old" }, duplex: createDuplexCoordinator() };
  async function consume(ticket: string) {
    const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as any).port}`, ["lares-voice", `lares-ticket.${ticket}`]);
    await new Promise<void>((resolve, reject) => { ws.on("error", reject); ws.on("message", (data, binary) => { if (!binary && JSON.parse(String(data)).type === "done") { ws.close(); resolve(); } }); });
  }
  try {
    const first = await gateway.ticket(scope, { operation: "tts", text: "First. Second." });
    current.ttsVoiceByModel.tts = "later"; await consume(first.ticket);
    assert.ok(requests.every(row => row.model === "tts" && row.voice === "new"));
    const second = await gateway.ticket(scope, { operation: "tts", text: "Next reply." }); await consume(second.ticket);
    assert.equal(requests.at(-1).voice, "later");
    current.ttsVoiceByModel.tts = "";
    const third = await gateway.ticket(scope, { operation: "tts", text: "Default voice." }); await consume(third.ticket);
    assert.equal(requests.at(-1).voice, undefined);
  } finally { gateway.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("a removed selected TTS model never falls back to another model", async () => {
  const gateway = createAudioStreamGateway({ config: () => ({ speak: true, ttsModel: "removed" }), models: async () => [{ id: "other", supportsTts: true }] });
  try { await assert.rejects(gateway.ticket({ device: "device", active: false }, { operation: "tts", text: "Preview" }), /voice_model_unavailable/); }
  finally { gateway.close(); }
});


test("a missing capture flush closes the ASR stream before reporting timeout", async (t) => {
  const { createStreamingCapture } = await import("@olares/lares-core/voice/stream-client");
  let socket: any, closes = 0, disconnects = 0, commits = 0;
  class Socket extends EventTarget {
    readyState = 1; bufferedAmount = 0;
    constructor() {
      super();
      setImmediate(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "ready" }) })));
    }
    send() { commits++; }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3; this.dispatchEvent(new Event("close"));
    }
  }
  class Context {
    state = "running"; sampleRate = 48000; destination = {};
    audioWorklet = { addModule: async () => {} };
    resume = async () => {};
    close = async () => { closes++; this.state = "closed"; };
    createMediaStreamSource = () => ({ connect() {}, disconnect() { disconnects++; } });
  }
  class Node {
    port = { onmessage: null, postMessage() {} };
    connect() {} disconnect() { disconnects++; }
  }
  const previous = { context: globalThis.AudioContext, node: globalThis.AudioWorkletNode };
  (globalThis as any).AudioContext = Context; (globalThis as any).AudioWorkletNode = Node;
  t.after(() => { (globalThis as any).AudioContext = previous.context; (globalThis as any).AudioWorkletNode = previous.node; });
  const capture = await createStreamingCapture({} as any, {
    request: async () => ({ ok: true, body: { supported: true, ticket: "ticket" } }),
    socket: () => socket = new Socket(),
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const result = assert.rejects(capture.finish(), /voice_timeout/);
    t.mock.timers.tick(2000);
    await result;
    assert.equal(socket.readyState, 3, "failed finalization must release upstream ASR");
    assert.equal(commits, 0, "unflushed audio must not be committed");
    assert.equal(closes, 1); assert.equal(disconnects, 2);
    capture.cancel(); assert.equal(closes, 1);
  } finally { capture.cancel(); }
});

test("a dropped consumer stops synthesizing the rest of the answer", async () => {
  const started: string[] = [];
  let releaseFirst: () => void = () => {};
  const h = await fixture(async (request: any, chunk: any) => {
    started.push(request.text);
    request.onFormat({ sampleRate: 24000, channels: 1, encoding: "pcm_s16le" });
    if (started.length === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
    await chunk(Buffer.alloc(480));
    return { streamed: true };
  });
  try {
    const grant = await h.gateway.ticket(h.scope, { operation: "tts", text: "First one. Second one." });
    const ws = await h.open(grant.ticket);
    for (let i = 0; started.length < 1 && i < 100; i += 1) await tick();
    assert.deepEqual(started, ["First one."]);
    ws.close(); await once(ws, "close");
    releaseFirst();
    await tick(); await tick();
    assert.deepEqual(started, ["First one."]);
  } finally { await h.close(); }
});

test("a playout stall shorter than the limit resumes the same answer", async () => {
  const h = await fixture(async (request: any, chunk: any) => {
    request.onFormat({ sampleRate: 24000, channels: 1, encoding: "pcm_s16le" });
    await chunk(Buffer.alloc(24000 * 2 * 6));
    return { streamed: true };
  });
  const grant = await h.gateway.ticket(h.scope, { operation: "tts", text: "One long answer." });
  const ws = await h.open(grant.ticket);
  const seen: any[] = [];
  let received = 0;
  ws.on("message", (data, binary) => {
    if (binary) { received += data.length / 2; return; }
    seen.push(JSON.parse(String(data)));
  });
  let reported = 0;
  let paused = false;
  let timer: any = null;
  try {
    await new Promise<void>((resolve) => ws.once("open", resolve));
    const report = () => {
      // Stay half a second behind what arrived, like real playback.
      const frames = Math.max(0, Math.floor(received - 12000));
      if (!paused && frames > reported) { reported = frames; ws.send(JSON.stringify({ type: "progress", frames })); }
    };
    timer = setInterval(report, 100);
    // A device switch stops playout for a moment; the answer must survive it.
    setTimeout(() => { paused = true; setTimeout(() => { paused = false; }, 300); }, 400);
    for (let i = 0; i < 200 && !seen.some((event) => event.type === "done"); i += 1) await tick();
    assert.ok(seen.some((event) => event.type === "done"), JSON.stringify(seen.slice(-4)));
    assert.equal(seen.some((event) => event.type === "error"), false);
  } finally { clearInterval(timer); ws.close(); await h.close(); }
});

test("a paused page resumes the same answer instead of ending it", async () => {
  const h = await fixture(async (request: any, chunk: any) => {
    request.onFormat({ sampleRate: 24000, channels: 1, encoding: "pcm_s16le" });
    await chunk(Buffer.alloc(24000 * 2 * 4));
    return { streamed: true };
  }, { pauseHoldMs: 2_000 });
  const grant = await h.gateway.ticket(h.scope, { operation: "tts", text: "One long answer." });
  const ws = await h.open(grant.ticket);
  const seen: any[] = [];
  let received = 0, reported = 0, paused = false, timer: any = null;
  ws.on("message", (data, binary) => { if (binary) { received += data.length / 2; return; } seen.push(JSON.parse(String(data))); });
  try {
    await new Promise<void>((resolve) => ws.once("open", resolve));
    timer = setInterval(() => {
      const frames = Math.max(0, Math.floor(received - 12000));
      if (!paused && frames > reported) { reported = frames; ws.send(JSON.stringify({ type: "progress", frames })); }
    }, 50);
    // The page goes away and comes back: the client pauses the stream, so the
    // host holds the rest instead of treating the silence as a dead consumer.
    await tick();
    paused = true;
    ws.send(JSON.stringify({ type: "pause" }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    paused = false;
    ws.send(JSON.stringify({ type: "resume" }));
    for (let i = 0; i < 300 && !seen.some((event) => event.type === "done"); i += 1) await tick();
    assert.ok(seen.some((event) => event.type === "done"), JSON.stringify(seen.slice(-4)));
    assert.equal(seen.some((event) => event.type === "error"), false);
  } finally { clearInterval(timer); ws.close(); await h.close(); }
});

test("a page that stays paused past the hold fails that reply instead of hanging", async () => {
  const h = await fixture(async (request: any, chunk: any) => {
    request.onFormat({ sampleRate: 24000, channels: 1, encoding: "pcm_s16le" });
    await chunk(Buffer.alloc(24000 * 2 * 4));
    return { streamed: true };
  }, { pauseHoldMs: 250 });
  const grant = await h.gateway.ticket(h.scope, { operation: "tts", text: "One long answer." });
  const ws = await h.open(grant.ticket);
  const seen: any[] = [];
  ws.on("message", (data, binary) => { if (!binary) seen.push(JSON.parse(String(data))); });
  try {
    await new Promise<void>((resolve) => ws.once("open", resolve));
    ws.send(JSON.stringify({ type: "pause" }));
    for (let i = 0; i < 200 && !seen.some((event) => event.type === "error"); i += 1) await tick();
    const error = seen.find((event) => event.type === "error");
    assert.equal(error?.code, "voice_interruption_timeout");
  } finally { ws.close(); await h.close(); }
});
