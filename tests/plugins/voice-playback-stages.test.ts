import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { WebSocket } from "ws";
import { createAudioStreamGateway } from "@olares/lares-core/voice/stream-gateway";
import { createDuplexCoordinator } from "@olares/lares-core/voice/duplex";
import { createLaresRealtimeGateway } from "@olares/lares-core/voice/lares-realtime-gateway";
import { createVoiceProtocolClient } from "@olares/lares-core/voice/protocol-client";
import { PCM_PLAYER_WORKLET } from "@olares/lares-core/voice/pcm-worklet";
import { speechSegments } from "@olares/lares-core/voice/script";
import { createPlayoutClock } from "../../packages/core/voice/playout-clock.js";

const RATE = 24000;
const OUTPUT_RATE = 48000;
const SECONDS = 6;
const PCM_BYTES = RATE * 2 * SECONDS;

function worker(inputRate = RATE, outputRate = OUTPUT_RATE) {
  let Processor: any;
  const events: any[] = [];
  class Base { port = { onmessage: null as any, postMessage: (data: any) => events.push(data) }; }
  runInNewContext(PCM_PLAYER_WORKLET, { AudioWorkletProcessor: Base, sampleRate: outputRate, registerProcessor: (_: string, value: any) => { Processor = value; } });
  const node = new Processor({ processorOptions: { inputRate, outputRate, preroll: Math.round(inputRate * 0.2) } });
  return {
    events,
    push(bytes: Buffer) {
      const samples = new Float32Array(bytes.length / 2);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = 0; i < samples.length; i += 1) samples[i] = view.getInt16(i * 2, true) / 32768;
      node.port.onmessage({ data: { type: "audio", samples } });
    },
    finish() { node.port.onmessage({ data: { type: "finish" } }); },
    /** One device quantum. Returns false when the reply has been rendered. */
    pull() { return node.process([], [[new Float32Array(128)]]); },
  };
}

function renderedFrames(events: any[]) {
  return events.filter((event) => event.type === "progress").at(-1)?.frames ?? 0;
}

test("stage text: a finished reply is spoken in full, not as its first few characters", () => {
  const text = "我是 Lares。我可以查资料、改文件，也可以把结果读出来。你刚才问的那件事，答案比一句话长得多。";
  const parts = speechSegments(text, { done: true });
  assert.ok(parts.length > 1, parts.join("|"));
  assert.equal(parts.join(""), text);
  assert.ok(parts.every((part) => part.length > 1));
});

test("stage stream: the worklet clock pulls the whole answer through the send gate", async () => {
  const scope = { id: "stage-stream", owner: "alice", device: "device", active: true, readAloud: true, duplex: createDuplexCoordinator() };
  const gateway = createAudioStreamGateway({
    config: () => ({ speak: true, ttsModel: "tts" }),
    models: async () => [{ id: "tts", supportsTts: true }],
    synthesize: async (request: any, chunk: any) => {
      request.onFormat({ sampleRate: RATE, channels: 1, encoding: "pcm_s16le" });
      await chunk(Buffer.alloc(PCM_BYTES));
      return { streamed: true };
    },
  });
  const server = createServer();
  server.on("upgrade", (req, socket, head) => gateway.upgrade(req, socket, head));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const play = worker();
  let bytes = 0;
  let acked = 0;
  let done = false;
  let code = "";
  try {
    const grant = await gateway.ticket(scope, { operation: "tts", text: "一段比较长的回复，不应该只读几个字。" });
    const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as any).port}`, ["lares-voice", `lares-ticket.${grant.ticket}`]);
    ws.on("message", (data, binary) => {
      if (binary) { bytes += data.length; play.push(data as Buffer); return; }
      const frame = JSON.parse(String(data));
      if (frame.type === "error") code = frame.code;
      if (frame.type === "done") done = true;
    });
    await once(ws, "open");
    const started = Date.now();
    const timer = setInterval(() => {
      for (let i = 0; i < 30; i += 1) play.pull();
      const heard = renderedFrames(play.events);
      if (heard > acked && ws.readyState === 1) { acked = heard; ws.send(JSON.stringify({ type: "progress", frames: heard })); }
    }, 20);
    while (!done && !code && Date.now() - started < 8000) await new Promise((resolve) => setTimeout(resolve, 20));
    clearInterval(timer);
    play.finish();
    for (let i = 0; i < 4000 && play.pull(); i += 1);
    assert.equal(code, "", code);
    assert.equal(done, true);
    assert.equal(bytes, PCM_BYTES, `host sent ${bytes} of ${PCM_BYTES}`);
    assert.ok(renderedFrames(play.events) >= PCM_BYTES / 2 - RATE, `rendered ${renderedFrames(play.events)} frames`);
    assert.equal(play.events.some((event) => event.type === "error"), false);
    ws.close();
  } finally {
    gateway.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

const KEY = "lvk_0123456789abcdef_" + "a".repeat(43);

test("stage realtime: rendered progress releases every sentence of a long reply", async () => {
  const spoken: string[] = [];
  const service: any = {
    async open(scope: any) { scope.active = true; scope.contextId = "ctx"; scope.session = { snapshot: () => ({ running: false, tasks: [] }) }; },
    async prompt() { return { utterance: { key: "turn-1", text: "第一句就这么几个字。后面还有整整一段，播放器必须把它读完，不能停在开头。", silent: false } }; },
    state() { return {}; }, async cancel() {}, async close(scope: any) { scope.active = false; },
  };
  const gateway = createLaresRealtimeGateway({
    service, config: () => ({ idleTimeoutMs: 300000 }),
    keys: { verify: (header: any) => header === `Bearer ${KEY}` ? { id: "0123456789abcdef", name: "Router", models: ["voice-chat"], sessionId: null, workspaceId: null } : null },
    transcribe: async () => "",
    synthesize: async (text: string) => { spoken.push(text); return Buffer.alloc(Math.max(2, text.length) * 2400); },
  });
  const server = createServer();
  server.on("upgrade", (req, socket, head) => gateway.upgrade(req, socket, head));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const play = worker();
  const events: any[] = [];
  let itemId: string | null = null;
  let bytes = 0;
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as any).port}/api/lares/voice/realtime?model=voice-chat`, { headers: { authorization: `Bearer ${KEY}` } });
    await once(ws, "open");
    const browser = {
      get readyState() { return ws.readyState; },
      get bufferedAmount() { return ws.bufferedAmount; },
      send: (data: string) => ws.send(data),
      close: () => ws.close(),
      addEventListener(type: string, fn: any) {
        if (type === "message") ws.on("message", (data) => fn({ data: data.toString() }));
        if (type === "close") ws.on("close", () => fn());
      },
      removeEventListener() {},
    };
    const protocol = createVoiceProtocolClient(browser, { onEvent: (event: any) => {
      events.push(event);
      if (event.type === "response.output_item.added") itemId = event.item?.id || null;
      if (event.type === "response.output_audio.delta") {
        const pcm = Buffer.from(event.delta, "base64");
        bytes += pcm.length;
        play.push(pcm);
      }
    } });
    protocol.configure({ type: "realtime", audio: true });
    protocol.say("你好");
    let acked = 0;
    let lastAt = 0;
    const started = Date.now();
    const timer = setInterval(() => {
      for (let i = 0; i < 30; i += 1) play.pull();
      const heard = renderedFrames(play.events);
      if (heard > acked && itemId && Date.now() - lastAt >= 250) {
        acked = heard; lastAt = Date.now();
        protocol.playbackProgress(itemId, Math.round(heard / (RATE / 1000)));
      }
    }, 20);
    while (!events.some((event) => event.type === "response.done") && !events.some((event) => event.type === "error") && Date.now() - started < 8000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    clearInterval(timer);
    const error = events.find((event) => event.type === "error");
    assert.equal(error?.error?.code || "", "");
    assert.ok(events.some((event) => event.type === "response.done"), `stopped after ${bytes} bytes, spoke ${spoken.join("|")}`);
    assert.ok(spoken.length > 1, spoken.join("|"));
    assert.ok(bytes > 20_000, `only ${bytes} bytes arrived`);
    assert.equal(play.events.some((event) => event.type === "error"), false);
    protocol.close();
  } finally {
    gateway.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

const STREAMED_SECONDS = 4;
const STREAMED_BYTES = RATE * 2 * STREAMED_SECONDS;

function streamingSynthesize(spoken: string[]) {
  return async (text: string, _scope: unknown, onChunk: (pcm: Buffer) => Promise<void> | void) => {
    spoken.push(text);
    const slice = RATE * 2 / 2;
    for (let offset = 0; offset < STREAMED_BYTES; offset += slice) {
      await onChunk(Buffer.alloc(Math.min(slice, STREAMED_BYTES - offset)));
    }
    return null;
  };
}

async function playRealtime(synthesize: ReturnType<typeof streamingSynthesize>, ack: "steady" | "once" | "none") {
  const spoken: string[] = [];
  const service: any = {
    async open(scope: any) { scope.active = true; scope.contextId = "ctx"; scope.session = { snapshot: () => ({ running: false, tasks: [] }) }; },
    async prompt() { return { utterance: { key: "turn-1", text: "后面还有一整段必须读完。", silent: false } }; },
    state() { return {}; }, async cancel() {}, async close(scope: any) { scope.active = false; },
  };
  const gateway = createLaresRealtimeGateway({
    service, config: () => ({ idleTimeoutMs: 300000 }),
    keys: { verify: (header: any) => header === `Bearer ${KEY}` ? { id: "0123456789abcdef", name: "Router", models: ["voice-chat"], sessionId: null, workspaceId: null } : null },
    transcribe: async () => "",
    synthesize: synthesize(spoken),
  });
  const server = createServer();
  server.on("upgrade", (req, socket, head) => gateway.upgrade(req, socket, head));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const play = worker();
  const events: any[] = [];
  let bytes = 0;
  let firstDeltaAt = 0;
  let bytesAt300 = 0;
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as any).port}/api/lares/voice/realtime?model=voice-chat`, { headers: { authorization: `Bearer ${KEY}` } });
    await once(ws, "open");
    const browser = {
      get readyState() { return ws.readyState; },
      get bufferedAmount() { return ws.bufferedAmount; },
      send: (data: string) => ws.send(data),
      close: () => ws.close(),
      addEventListener(type: string, fn: any) {
        if (type === "message") ws.on("message", (data) => fn({ data: data.toString() }));
        if (type === "close") ws.on("close", () => fn());
      },
      removeEventListener() {},
    };
    const protocol = createVoiceProtocolClient(browser, { onEvent: (event: any) => {
      events.push(event);
      if (event.type === "response.output_audio.delta") {
        const pcm = Buffer.from(event.delta, "base64");
        if (!firstDeltaAt) firstDeltaAt = Date.now();
        bytes += pcm.length;
        play.push(pcm);
      }
    } });
    protocol.configure({ type: "realtime", audio: true });
    protocol.say("你好");
    let acked = 0;
    let lastAckAt = 0;
    const started = Date.now();
    const timer = setInterval(() => {
      for (let i = 0; i < 40; i += 1) play.pull();
      const heard = renderedFrames(play.events);
      const itemId = events.find((event) => event.type === "response.output_item.added")?.item?.id;
      const due = ack === "steady" ? heard > acked && Date.now() - lastAckAt >= 250 : ack === "once" && acked === 0 && heard > 0;
      if (due && itemId) {
        acked = heard; lastAckAt = Date.now();
        protocol.playbackProgress(itemId, Math.round(heard / (RATE / 1000)));
      }
      if (firstDeltaAt && !bytesAt300 && Date.now() - firstDeltaAt >= 300) bytesAt300 = bytes;
    }, 20);
    while (!events.some((event) => event.type === "response.done") && !events.some((event) => event.type === "error") && Date.now() - started < 8000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    clearInterval(timer);
    if (!bytesAt300) bytesAt300 = bytes;
    const error = events.find((event) => event.type === "error");
    protocol.close();
    return { spoken, bytes, bytesAt300, done: events.some((event) => event.type === "response.done"), code: error?.error?.code || "", workletError: play.events.some((event) => event.type === "error") };
  } finally {
    gateway.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("playout credit stops at audio already sent, so a synthesis gap cannot pre-pay the next burst", () => {
  let now = 1_000;
  const clock = createPlayoutClock({ now: () => now });
  clock.start();
  assert.equal(clock.blocked(2_000), false);
  assert.equal(clock.blocked(2_500), true);
  now += 3_000;
  assert.equal(clock.blocked(2_500), false);
  // Only the lead may leave with the next sentence. The whole sentence may not.
  assert.equal(clock.blocked(4_500), false);
  assert.equal(clock.blocked(5_000), true);
  clock.pause();
  const held = clock.credit(5_000);
  now += 5_000;
  assert.equal(clock.credit(5_000), held);
  clock.resume();
  now += 400;
  assert.equal(clock.credit(5_000), held + 400);
});

test("a speaker that keeps reporting holds a long reply to the playback queue", () => {
  let now = 1_000;
  const clock = createPlayoutClock({ now: () => now });
  clock.start();
  now = 1_500;
  clock.heard(500);
  now = 11_500;
  clock.heard(1_000);
  // Ten seconds of wall time, one second heard. Credit stays one lead ahead of the speaker.
  assert.equal(clock.credit(20_000), 3_000);
  assert.equal(clock.blocked(5_000), false);
  assert.equal(clock.blocked(5_001), true);
  // Reports that stop arriving fall back to the wall clock, so the rest is not stuck.
  now += 2_001;
  assert.ok(clock.credit(20_000) > 3_000);
});

test("stage realtime stream: TTS that awaits each slice still finishes while the worklet acks", async () => {
  const result = await playRealtime(streamingSynthesize, "steady");
  assert.equal(result.code, "", JSON.stringify(result));
  assert.equal(result.done, true, JSON.stringify(result));
  assert.equal(result.bytes, STREAMED_BYTES, JSON.stringify(result));
  assert.equal(result.workletError, false);
  assert.ok(result.bytesAt300 < STREAMED_BYTES, `dumped ${result.bytesAt300} before playout`);
});

test("stage realtime stream: one progress frame must not freeze the rest of the reply", async () => {
  const result = await playRealtime(streamingSynthesize, "once");
  assert.equal(result.code, "", JSON.stringify(result));
  assert.equal(result.done, true, JSON.stringify(result));
  assert.equal(result.bytes, STREAMED_BYTES, `host stopped at ${result.bytes} of ${STREAMED_BYTES}`);
  assert.equal(result.workletError, false);
});

test("stage realtime stream: the opening null progress must not freeze the reply either", async () => {
  const result = await playRealtime(streamingSynthesize, "none");
  assert.equal(result.code, "", JSON.stringify(result));
  assert.equal(result.done, true, JSON.stringify(result));
  assert.equal(result.bytes, STREAMED_BYTES, `host stopped at ${result.bytes} of ${STREAMED_BYTES}`);
  assert.equal(result.workletError, false);
});
