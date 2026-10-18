import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createSentencePlayer, reduceUtterance } from "@olares/lares-core/voice/speech";
import { speechSegments } from "@olares/lares-core/voice/script";
import { PCM_PLAYER_WORKLET } from "@olares/lares-core/voice/pcm-worklet";
const tick = () => new Promise(r => setImmediate(r));

test("old completed outputs and old steps of an explicitly stopped turn cannot replay", async () => {
  const seen: string[] = [];
  const reader = createSentencePlayer({ send: async () => ({}), play() {}, halt() {}, silence() {}, stream: async ({ key }: any) => { seen.push(key); } });
  const one = { key: "session:1:0", turn: 1, sessionId: "session", text: "One.", done: true };
  reader.follow(one); await tick();
  reader.follow({ ...one, key: "session:2:0", turn: 2 }); await tick();
  reader.follow(one); await tick();
  assert.equal(seen.length, 2);
  reader.stop();
  reader.follow({ ...one, key: "session:2:1", turn: 2 }); await tick();
  assert.equal(seen.length, 2);
});
test("an errored or cancelled turn cannot turn partial text into an answer", () => {
  const state = reduceUtterance(null, { type: "assistant/chunk", data: { turn: 1, step: 0, chunk: { type: "text-delta", text: "Unconfirmed" } } });
  const next = reduceUtterance(Object.freeze(state), { type: "assistant/chunk", data: { turn: 1, step: 0, chunkIndex: 1, chunk: { type: "text-delta", text: " tail" } } });
  assert.equal(next.text, "Unconfirmed tail");
  assert.equal(state.text, "Unconfirmed");
  for (const kind of ["error", "cancelled"]) assert.equal(reduceUtterance(state, { type: "turn/end", data: { turn: 1, reason: { kind } } }).silent, true);
});
test("long speech is not silently truncated at 2000 characters", () => {
  const text = "这是一个完整句子。\n".repeat(230) + "最后一行。";
  assert.equal(speechSegments(text).at(-1), "最后一行。");
});
test("paused PCM consumes no frames and resumes from the exact unread sample", () => {
  let Processor: any;
  const events: any[] = [];
  class Base { port: any = { onmessage: null, postMessage: (event: any) => events.push(event) }; }
  runInNewContext(PCM_PLAYER_WORKLET, { AudioWorkletProcessor: Base, sampleRate: 16000, registerProcessor: (_: string, ctor: any) => Processor = ctor });
  const worker = new Processor({ processorOptions: { inputRate: 16000 } });
  worker.port.onmessage({ data: { type: "audio", samples: Float32Array.from([.1, .2, .3, .4]) } });
  const first = new Float32Array(2); worker.process([], [[first]]);
  worker.port.onmessage({ data: { type: "pause" } });
  const paused = new Float32Array(2); worker.process([], [[paused]]);
  assert.deepEqual([...paused], [0, 0]);
  worker.port.onmessage({ data: { type: "resume" } });
  const rest = new Float32Array(2); worker.process([], [[rest]]);
  assert.deepEqual([...rest], [...Float32Array.from([.3, .4])]);
});

test("false interruption resumes only after successful empty ASR and silence; explicit stop invalidates it", async () => {
  const { createInterruptionGuard } = await import("../../packages/core/voice/interruption.js");
  let now = 0, seq = 0, pauses = 0, resumes = 0, stops = 0, key = "one";
  const timers = new Map<number, { at: number, fn: () => void }>();
  const advance = (ms: number) => { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } };
  const guard = createInterruptionGuard({ output: { canPause: true, key: () => key, pause: () => { pauses++; }, resume: () => { resumes++; }, stop: () => { stops++; } }, now: () => now,
    schedule: (fn: () => void, ms: number) => { timers.set(++seq, { at: now + ms, fn }); return seq; }, unschedule: (id: number) => { timers.delete(id); } });
  guard.suspect(); guard.speechEnded(); guard.final(""); advance(1999); assert.equal(resumes, 0); advance(1); assert.equal(resumes, 1);
  guard.suspect(); guard.speechEnded(); guard.final("嗯"); advance(3000); assert.equal(stops, 1); assert.equal(resumes, 1);
  guard.suspect(); guard.speechEnded(); guard.final(""); guard.cancel(); advance(3000); assert.equal(resumes, 1);
  guard.suspect(); guard.speechEnded(); guard.final(""); key = "two"; advance(3000); assert.equal(resumes, 1);
  guard.suspect(); advance(10000); assert.equal(stops, 2);
  assert.equal(pauses, 5);
});

test("ASR failures never count as noise and never resume", async () => {
  const { createInterruptionGuard } = await import("../../packages/core/voice/interruption.js");
  let resumed = false, stopped = false, error = "";
  const guard = createInterruptionGuard({ output: { canPause: true, key: () => "one", pause() {}, resume() { resumed = true; }, stop() { stopped = true; } }, onError: value => error = value });
  guard.suspect(); guard.fail("voice_transcribe_failed");
  assert.equal(resumed, false); assert.equal(stopped, true); assert.equal(error, "voice_transcribe_failed");
});

test("trusted Host source emits stable zodiac segments before finalization, once, without client text", async () => {
  const { createReplyStreamRegistry } = await import("@olares/lares-core/voice/reply-stream");
  const { createAudioStreamGateway } = await import("@olares/lares-core/voice/stream-gateway");
  const { createDuplexCoordinator } = await import("@olares/lares-core/voice/duplex");
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const { WebSocket } = await import("ws");
  const source = { sessionId: "s", turn: 1, step: 0 };
  const registry = createReplyStreamRegistry({ inspect: async () => ({}), owner: () => "alice" });
  registry.frame("s", { type: "start", ...source, attemptId: "s:attempt", speechEligible: true });
  let index = 0;
  const push = (text: string) => registry.frame("s", { type: "chunk", attemptId: "s:attempt", index: index++, chunk: { type: "text-delta", index: 0, text } });
  const requests: string[] = [], segments: number[] = [];
  const gateway = createAudioStreamGateway({ replies: registry, config: () => ({ speak: true, ttsModel: "tts" }), models: async () => [{ id: "tts", supportsTts: true }],
    synthesize: async (value: any, write: any) => { requests.push(value.text); value.onFormat({ sampleRate: 16000, channels: 1, encoding: "pcm_s16le" }); await write(Buffer.alloc(32)); return { streamed: true }; } });
  const server = createServer(); server.on("upgrade", (req, socket, head) => gateway.upgrade(req, socket, head)); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const scope: any = { id: "voice", owner: "alice", device: "device", active: true, readAloud: true, duplex: createDuplexCoordinator() };
  try {
    await assert.rejects(registry.bind({ owner: "bob" }, source), /voice_reply_forbidden/);
    const grant = await gateway.ticket(scope, { operation: "tts", source, text: "Client spoofed text" });
    const socket = new WebSocket(`ws://127.0.0.1:${(server.address() as any).port}`, ["lares-voice", `lares-ticket.${grant.ticket}`]);
    const done = new Promise<void>((resolve, reject) => { socket.on("error", reject); socket.on("message", (data, binary) => { if (binary) return; const event = JSON.parse(String(data)); if (event.type === "segment") segments.push(event.index); if (event.type === "error") reject(new Error(event.code)); if (event.type === "done") { socket.close(); resolve(); } }); });
    await once(socket, "open"); push("中国的十二生肖是：\n1. **鼠 🐭**\n2. ");
    for (let tries = 0; requests.length < 2 && tries < 100; tries++) await new Promise(r => setTimeout(r, 5));
    assert.deepEqual(requests, ["中国的十二生肖是：", "鼠；"]);
    const animals = ["牛 🐮", "虎 🐯", "兔 🐰", "龙 🐉", "蛇 🐍", "马 🐴", "羊 🐑", "猴 🐵", "鸡 🐔", "狗 🐕", "猪 🐖"];
    push(animals.map((value, index) => `${index ? `${index + 2}. ` : ""}**${value}**`).join("\n"));
    const text = "中国的十二生肖是：\n1. **鼠 🐭**\n" + animals.map((value, index) => `${index + 2}. **${value}**`).join("\n");
    registry.event("s", { type: "assistant/message", data: { turn: 1, step: 0, message: { content: [{ type: "text", text }] } } });
    await done;
    assert.deepEqual(requests, ["中国的十二生肖是：", "鼠；", "牛；虎；兔；", "龙；蛇；马；", "羊；猴；鸡；", "狗；猪；"]);
    assert.deepEqual(segments, requests.map((_, index) => index));
  } finally { registry.close(); gateway.close(); await new Promise<void>(r => server.close(() => r())); }
});

test("tool-capable attempts wait for successful text settlement; failed attempts release consumers", async () => {
  const { createReplyStreamRegistry } = await import("@olares/lares-core/voice/reply-stream");
  const registry = createReplyStreamRegistry({ inspect: async () => ({}) });
  const source = { sessionId: "s", turn: 1, step: 0 };
  registry.frame("s", { ...source, type: "start", attemptId: "a", speechEligible: false });
  registry.frame("s", { type: "chunk", attemptId: "a", index: 0, chunk: { type: "text-delta", text: "Result. Next" } });
  const stream = (await registry.bind({}, source))(new AbortController().signal);
  let arrived = false; const first = stream.next().then(value => { arrived = true; return value; });
  await tick(); assert.equal(arrived, false);
  registry.event("s", { type: "assistant/message", data: { turn: 1, step: 0, message: { content: [{ type: "text", text: "Result. Next" }] } } });
  assert.equal((await first).value.text, "Result."); await stream.return();
  registry.frame("s", { ...source, type: "start", attemptId: "b", speechEligible: true });
  const failed = (await registry.bind({}, source))(new AbortController().signal).next();
  registry.frame("s", { type: "end", attemptId: "b", outcome: { kind: "abandoned" } });
  await assert.rejects(failed, /voice_reply_unsettled/); registry.close();
});

test("PC and Vue observing the same reply cannot claim two simultaneous TTS outputs", async () => {
  const { createReplyStreamRegistry } = await import("@olares/lares-core/voice/reply-stream");
  const registry = createReplyStreamRegistry({ inspect: async () => ({}), owner: () => "alice" });
  const source = { sessionId: "same-session", turn: 1, step: 0 };
  registry.frame(source.sessionId, { ...source, type: "start", attemptId: "a", speechEligible: true });
  await registry.bind({ owner: "alice", id: "PC" }, source);
  await assert.rejects(registry.bind({ owner: "alice", id: "Vue" }, source), /voice_output_owned/);
  registry.close();
});

test("file playback retains its position through pause and releases the object URL on stop", async (t) => {
  const { createBrowserPlayer } = await import("@olares/lares-core/voice/browser-playback");
  const original = globalThis.Audio;
  let audio: any;
  class FakeAudio extends EventTarget {
    currentTime = 0; plays = 0; pauses = 0;
    constructor(_url: string) { super(); audio = this; }
    play() { this.plays++; return Promise.resolve(); }
    pause() { this.pauses++; }
  }
  (globalThis as any).Audio = FakeAudio;
  t.after(() => { (globalThis as any).Audio = original; });
  const player = createBrowserPlayer();
  const ended = player.play(new Blob(["fixed-test-audio"]));
  audio.currentTime = 1.25; player.pause(); await player.resume();
  assert.equal(audio.currentTime, 1.25); assert.equal(audio.plays, 2); assert.equal(audio.pauses, 1);
  player.stop(); await ended; player.stop();
});

test("already queued recovery callbacks cannot cancel a newer suspected interruption", async () => {
  const { createInterruptionGuard } = await import("../../packages/core/voice/interruption.js");
  let key = "old", resumes = 0, stops = 0;
  const callbacks: Array<() => void> = [];
  const guard = createInterruptionGuard({ output: { canPause: true, key: () => key, pause() {}, resume() { resumes++; }, stop() { stops++; } },
    schedule: (fn: () => void) => { callbacks.push(fn); return callbacks.length; }, unschedule() {} });
  guard.suspect(); guard.speechEnded(); guard.final(""); guard.cancel();
  key = "new"; guard.suspect();
  callbacks[1](); callbacks[0]();
  assert.equal(guard.pending, true); assert.equal(resumes, 0); assert.equal(stops, 0);
  guard.cancel();
});
