import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { WebSocket } from "ws";
import { createLaresRealtimeGateway } from "@olares/lares-core/voice/lares-realtime-gateway";

const KEY = "lvk_0123456789abcdef_" + "a".repeat(43);
const DEVICE_KEY = "lvk_fedcba9876543210_" + "b".repeat(43);
const keys = { verify: (header: any) => header === `Bearer ${KEY}` ? { id: "0123456789abcdef", name: "Router", models: ["voice-chat", "voice-dictation", "voice-assistant"], sessionId: null, workspaceId: null }
  : header === `Bearer ${DEVICE_KEY}` ? { id: "fedcba9876543210", name: "Reachy", models: ["voice-assistant"], clientTools: true, sessionId: null, workspaceId: null } : null };

async function serve(options: any = {}, overrides: any = {}) {
  const calls: any = { prompts: [], closes: 0, transcribed: [], synthesized: [], truncated: [], instructions: [], withdrawn: [] };
  const service: any = {
    async open(scope: any) { scope.active = true; scope.contextId = scope.contextId || "ctx-1"; scope.session = { snapshot: () => ({ running: false, tasks: [] }) }; },
    async prompt(_scope: any, body: any) { calls.prompts.push(body); return { utterance: { key: body.requestId, text: "actual reply", silent: false } }; },
    async clean(_scope: any, text: string) { return text.trim(); },
    truncate(_scope: any, key: string, text: string) { calls.truncated.push({ key, text }); },
    instructions(_scope: any, text: string) { calls.instructions.push(text); },
    async withdraw(_scope: any, id: string) { calls.withdrawn.push(id); return "withdrawn"; },
    state() { return {}; }, async cancel() {}, async close(scope: any) { scope.active = false; calls.closes++; },
    ...overrides,
  };
  const gateway = createLaresRealtimeGateway({ service, config: () => ({ idleTimeoutMs: 300000 }), keys,
    transcribe: async (pcm: Buffer, scope: any) => { calls.transcribed.push({ bytes: pcm.length, session: scope.routerSessionId }); return " test request "; },
    synthesize: async () => Buffer.alloc(2400), segment: (text: string) => [text], ...options });
  const server = createServer();
  server.on("upgrade", (req, socket, head) => gateway.upgrade(req, socket, head));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  return { calls, port, service, async stop() { gateway.close(); await new Promise<void>((resolve) => server.close(() => resolve())); } };
}
function connect(port: number, model: string, headers: any = {}) {
  return new WebSocket(`ws://127.0.0.1:${port}/api/lares/voice/realtime?model=${model}`, { headers: { authorization: `Bearer ${KEY}`, ...headers } });
}
function until(client: WebSocket, predicate: (event: any, events: any[]) => boolean, onEvent: (event: any) => void = () => {}) {
  const events: any[] = [];
  return new Promise<any[]>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${events.map((e) => e.type).join(",")}`)), 3000);
    client.on("error", reject);
    client.on("message", (raw) => {
      const event = JSON.parse(raw.toString()); events.push(event); onEvent(event);
      if (predicate(event, events)) { clearTimeout(timer); resolve(events); }
    });
  });
}
const handshake = (port: number, model: string, headers: any) => new Promise<number>((resolve) => {
  const client = new WebSocket(`ws://127.0.0.1:${port}/api/lares/voice/realtime?model=${model}`, { headers });
  client.on("unexpected-response", (_req, res) => resolve(res.statusCode || 0));
  client.on("open", () => { client.terminate(); resolve(101); });
  client.on("error", () => {});
});

test("lares-realtime-v1 rejects missing keys and models the key does not grant", async () => {
  const fixture = await serve();
  try {
    assert.equal(await handshake(fixture.port, "voice-chat", {}), 401);
    assert.equal(await handshake(fixture.port, "voice-chat", { authorization: "Bearer lvk_wrong" }), 401);
    assert.equal(await handshake(fixture.port, "voice-direct", { authorization: `Bearer ${KEY}` }), 403);
    assert.equal(await handshake(fixture.port, "voice-chat", { authorization: `Bearer ${KEY}` }), 101);
  } finally { await fixture.stop(); }
});

test("lares-realtime-v1 runs an OpenAI-shaped turn with zero usage and the Router session id", async () => {
  const fixture = await serve();
  const client = connect(fixture.port, "voice-chat", { "x-session-id": "rtc_router", "x-bfl-user": "mallory" });
  try {
    const events = await until(client, (event) => event.type === "response.done", (event) => {
      if (event.type === "session.created") {
        client.send(JSON.stringify({ type: "session.update", event_id: "evt-tools", session: { tools: [{ name: "shell" }] } }));
        client.send(JSON.stringify({ type: "session.update", session: { lares: { busy_turn: "steer" }, audio: { input: { turn_detection: null } } } }));
        client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: Buffer.alloc(4800).toString("base64") }));
        client.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      }
    });
    const created = events.find((event) => event.type === "session.created");
    assert.equal(created.session.lares.capabilities.protocol, "lares-realtime-v1");
    assert.equal(created.session.lares.context_id, "ctx-1");
    const error = events.find((event) => event.type === "error");
    assert.deepEqual([error.error.code, error.error.event_id], ["unsupported_parameter", "evt-tools"]);
    const types = events.map((event) => event.type);
    for (const type of ["input_audio_buffer.committed", "conversation.item.input_audio_transcription.completed", "response.created", "response.output_item.added", "response.output_audio_transcript.delta", "response.output_audio.delta", "response.output_audio.done", "response.output_item.done"]) assert.ok(types.includes(type), type);
    const done = events.find((event) => event.type === "response.done");
    assert.equal(done.response.status, "completed");
    assert.equal(done.response.usage.total_tokens, 0);
    assert.equal(done.response.usage.output_token_details.audio_tokens, 0);
    assert.deepEqual(done.response.metadata.lares.usage, { billing: "child-models", input_audio_ms: 100, output_audio_ms: 50 });
    assert.equal(done.response.metadata.lares.origin, "turn");
    assert.deepEqual(fixture.calls.transcribed, [{ bytes: 4800, session: "rtc_router" }]);
    assert.equal(fixture.calls.prompts.length, 1);
    assert.equal(fixture.calls.prompts[0].mode, undefined);
  } finally { client.terminate(); await fixture.stop(); }
  assert.equal(fixture.calls.closes, 1);
});

test("lares-realtime-v1 dictation is a transcription session without responses", async () => {
  const fixture = await serve();
  const client = connect(fixture.port, "voice-dictation");
  try {
    const events = await until(client, (_event, seen) => seen.some((event) => event.type === "error") && seen.some((event) => event.type === "conversation.item.input_audio_transcription.completed"), (event) => {
      if (event.type === "session.created") {
        assert.equal(event.session.type, "transcription");
        client.send(JSON.stringify({ type: "session.update", session: { output_modalities: ["audio"] } }));
        client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: Buffer.alloc(4800).toString("base64") }));
        client.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      }
    });
    assert.equal(events.find((event) => event.type === "error").error.code, "unsupported_parameter");
    assert.equal(events.find((event) => event.type === "conversation.item.input_audio_transcription.completed").transcript, "test request");
    assert.equal(fixture.calls.prompts.length, 0);
  } finally { client.terminate(); await fixture.stop(); }
});

test("lares-realtime-v1 completes a commit that carried no audio", async () => {
  const fixture = await serve();
  const client = connect(fixture.port, "voice-dictation");
  try {
    const events = await until(client, (event) => event.type === "conversation.item.input_audio_transcription.completed", (event) => {
      if (event.type === "session.created") client.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    });
    const done = events.find((event) => event.type === "conversation.item.input_audio_transcription.completed");
    assert.equal(done.transcript, "");
    assert.equal(fixture.calls.transcribed.length, 0);
    assert.equal(fixture.calls.prompts.length, 0);
  } finally { client.terminate(); await fixture.stop(); }
});

test("lares-realtime-v1 holds input until playback is acknowledged once the client acknowledges", async () => {
  const fixture = await serve();
  const client = connect(fixture.port, "voice-chat");
  const audio = Buffer.alloc(4800).toString("base64");
  try {
    let stage = 0;
    const events = await until(client, (event) => event.type === "input_audio_buffer.committed" && stage === 2, (event) => {
      if (event.type === "session.created") {
        client.send(JSON.stringify({ type: "lares.playback.progress", item_id: null, played_ms: 0 }));
        client.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] } }));
      }
      if (event.type === "response.done" && stage === 0) {
        stage = 1;
        client.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
        client.send(JSON.stringify({ type: "lares.playback.completed", item_id: event.response.id }));
        client.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
        client.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        stage = 2;
      }
    });
    assert.equal(fixture.calls.prompts[0].text, "hello");
    assert.ok(events.some((event) => event.type === "error" && event.error.code === "waiting_for_playback"));
  } finally { client.terminate(); await fixture.stop(); }
});

const pcm = (ms: number, level = 0) => { const buffer = Buffer.alloc(ms * 48); for (let i = 0; i < buffer.length; i += 2) buffer.writeInt16LE(Math.round(level * 32767 * (i % 4 ? 1 : -1)), i); return buffer.toString("base64"); };

test("lares-realtime-v1 truncates a reply at the last fully played sentence", async () => {
  const fixture = await serve({ segment: () => ["First part.", "Second part."] });
  const client = connect(fixture.port, "voice-chat");
  try {
    let item = "";
    const events = await until(client, (event) => event.type === "conversation.item.truncated", (event) => {
      if (event.type === "session.created") client.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] } }));
      if (event.type === "response.output_item.added") item = event.item.id;
      if (event.type === "response.done") client.send(JSON.stringify({ type: "conversation.item.truncate", item_id: item, content_index: 0, audio_end_ms: 60 }));
    });
    assert.deepEqual(events.filter((event) => event.type === "response.output_audio_transcript.delta").map((event) => event.delta), ["First part.", " Second part."]);
    assert.equal(events.find((event) => event.type === "conversation.item.truncated").audio_end_ms, 60);
    assert.deepEqual(fixture.calls.truncated, [{ key: fixture.calls.prompts[0].requestId, text: "First part." }]);
    const done = events.filter((event) => event.type === "conversation.item.done");
    assert.deepEqual(done.map((event) => event.item.role), ["user", "assistant"]);
  } finally { client.terminate(); await fixture.stop(); }
});

test("lares-realtime-v1 applies chat instructions, re-speaks on response.create and rejects instructions elsewhere", async () => {
  const fixture = await serve();
  const client = connect(fixture.port, "voice-chat");
  try {
    let replies = 0;
    const events = await until(client, (event) => event.type === "response.done" && replies === 2, (event) => {
      if (event.type === "session.created") {
        client.send(JSON.stringify({ type: "session.update", session: { instructions: "Answer in French." } }));
        client.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] } }));
      }
      if (event.type === "response.done") { replies++; if (replies === 1) client.send(JSON.stringify({ type: "response.create" })); }
    });
    assert.deepEqual(fixture.calls.instructions, ["Answer in French."]);
    assert.equal(fixture.calls.prompts.length, 1);
    assert.equal(events.filter((event) => event.type === "response.done").length, 2);
  } finally { client.terminate(); await fixture.stop(); }
  const assistant = await serve();
  const other = connect(assistant.port, "voice-assistant");
  try {
    const events = await until(other, (event) => event.type === "error", (event) => {
      if (event.type === "session.created") other.send(JSON.stringify({ type: "session.update", session: { instructions: "x" } }));
    });
    assert.equal(events.at(-1).error.code, "unsupported_parameter");
  } finally { other.terminate(); await assistant.stop(); }
});

test("lares-realtime-v1 streams partial transcripts as deltas and uses the stream's final text", async () => {
  const fixture = await serve({
    openTranscription: async (_scope: any, onPartial: (text: string) => void) => {
      let written = 0;
      return { write(chunk: Buffer) { written += chunk.length; onPartial(written >= 4800 ? "hello world" : "hello"); }, async finish() { return "hello world"; }, cancel() {} };
    },
  });
  const client = connect(fixture.port, "voice-chat");
  try {
    const events = await until(client, (event) => event.type === "response.done", (event) => {
      if (event.type === "session.created") {
        client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm(50) }));
        client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm(50) }));
        setTimeout(() => client.send(JSON.stringify({ type: "input_audio_buffer.commit" })), 20);
      }
    });
    assert.deepEqual(events.filter((event) => event.type === "conversation.item.input_audio_transcription.delta").map((event) => event.delta), ["hello", " world"]);
    assert.equal(events.find((event) => event.type === "conversation.item.input_audio_transcription.completed").transcript, "hello world");
    assert.equal(fixture.calls.transcribed.length, 0);
    assert.equal(fixture.calls.prompts[0].text, "hello world");
  } finally { client.terminate(); await fixture.stop(); }
});

test("lares-realtime-v1 follows the busy-Enter default and withdraws tasks by id", async () => {
  const tasks: any[] = [{ requestId: "item_x:delegate", status: "accepted" }];
  const fixture = await serve({ busyDefault: () => "steer" }, {
    async open(scope: any) { scope.active = true; scope.contextId = "ctx-1"; scope.session = { snapshot: () => ({ running: true, sessionId: "dsh-1", tasks }) }; },
    async prompt(_scope: any, body: any) { fixture.calls.prompts.push(body); return { utterance: null }; },
  });
  const client = connect(fixture.port, "voice-assistant");
  try {
    fixture.service.withdraw = async (_scope: any, id: string) => { fixture.calls.withdrawn.push(id); tasks[0].status = "cancelled"; return "withdrawn"; };
    const events = await until(client, (event) => event.type === "lares.task.updated" && event.status === "cancelled", (event) => {
      if (event.type === "session.created") client.send(JSON.stringify({ type: "conversation.item.create", item: { id: "item_y", type: "message", role: "user", content: [{ type: "input_text", text: "go" }] } }));
      if (event.type === "lares.task.updated" && event.status === "pending" && !fixture.calls.withdrawn.length) client.send(JSON.stringify({ type: "lares.task.cancel", task_id: event.task_id }));
    });
    assert.equal(fixture.calls.prompts[0].mode, "steer");
    assert.equal(events.find((event) => event.type === "lares.task.updated").session_id, "dsh-1");
    assert.deepEqual(fixture.calls.withdrawn, ["item_x:delegate"]);
  } finally { client.terminate(); await fixture.stop(); }
});

test("lares-realtime-v1 serves a Lares ticket on the open scope with host audio", async () => {
  const fixture = await serve();
  const port: any = { events: [] as string[], async resumeInput() { port.events.push("resume"); }, async pauseInput() { port.events.push("pause"); }, async write(bytes: Buffer) { port.events.push(`write:${bytes.length}`); }, async finish() { port.events.push("finish"); }, async interrupt() {}, async stop() { port.events.push("stop"); } };
  const gateway = createLaresRealtimeGateway({ service: { ...fixture.service, async prompt(_scope: any, body: any) { return { utterance: { key: body.requestId, text: "on the speaker", silent: false } }; } }, config: () => ({ idleTimeoutMs: 300000 }), keys,
    transcribe: async () => "hello", synthesize: async () => Buffer.alloc(2400), segment: (text: string) => [text], hostAudio: async () => port });
  const server = createServer();
  server.on("upgrade", (req, socket, head) => gateway.upgrade(req, socket, head));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const scope: any = { id: "voice-1", owner: "owner", device: "headset", active: true, readAloud: true, contextId: "ctx-9", voiceConfig: { preset: "chat" }, session: { snapshot: () => ({ running: false, tasks: [] }) } };
  const { ticket } = gateway.ticket(scope);
  const client = new WebSocket(`ws://127.0.0.1:${(server.address() as any).port}/api/lares/voice/realtime`, ["lares-voice", `lares-ticket.${ticket}`]);
  try {
    const events = await until(client, (event) => event.type === "response.done", (event) => {
      if (event.type === "session.created") {
        assert.equal(event.session.lares.device, "headset");
        assert.equal(event.session.lares.context_id, "ctx-9");
        client.send(JSON.stringify({ type: "lares.device.input.resume" }));
        client.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] } }));
      }
    });
    assert.ok(!events.some((event) => event.type === "response.output_audio.delta"));
    assert.deepEqual(events.filter((event) => event.type === "lares.device.playback").map((event) => event.playing), [true, false]);
    assert.deepEqual(port.events, ["resume", "write:2400", "finish"]);
  } finally {
    client.terminate(); gateway.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fixture.stop();
  }
  assert.ok(port.events.includes("stop"));
  assert.equal(scope.active, true);
});

test("lares-realtime-v1 barge-in only with the flag and echo cancellation; silence resumes, words stop", async () => {
  let release: () => void = () => {};
  const fixture = await serve({ bargeIn: () => true, segment: () => ["One.", "Two.", "Three."],
    synthesize: async (text: string) => { if (text === "Two.") await new Promise<void>((resolve) => { release = resolve; }); return Buffer.alloc(2400); },
    transcribe: async (pcmBytes: Buffer) => pcmBytes.length > 48 * 900 ? "stop please" : "" });
  const client = connect(fixture.port, "voice-chat");
  try {
    let stage = 0;
    const events = await until(client, (event, seen) => event.type === "response.done" && seen.filter((value) => value.type === "response.done").length === 2, (event) => {
      if (event.type === "session.created") {
        assert.equal(event.session.lares.capabilities.barge_in, true);
        client.send(JSON.stringify({ type: "session.update", session: { audio: { input: { turn_detection: { type: "server_vad", silence_duration_ms: 200 } } } } }));
        client.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "talk" }] } }));
      }
      if (event.type === "response.output_audio_transcript.delta" && event.delta === "One." && stage === 0) {
        stage = 1;
        for (let i = 0; i < 12; i++) client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm(100, 0.2) }));
        for (let i = 0; i < 6; i++) client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm(100) }));
        setTimeout(() => { stage = 2; release(); }, 100);
      }
    });
    const done = events.find((event) => event.type === "response.done");
    assert.equal(done.response.status, "cancelled");
    assert.ok(events.some((event) => event.type === "conversation.item.truncated"));
    assert.equal(fixture.calls.prompts.at(-1).text, "stop please");
  } finally { client.terminate(); await fixture.stop(); }
});

test("lares-realtime-v1 speaks the reply that landed during playback once the client finishes it", async () => {
  let utterance: any = null;
  const fixture = await serve({}, {
    async prompt(_scope: any, body: any) {
      utterance = { key: body.requestId, text: "first answer", silent: false };
      return { utterance };
    },
    state() { return { utterance, running: false }; },
  });
  const client = connect(fixture.port, "voice-chat");
  try {
    let stage = 0;
    let acked = false;
    let spokeEarly = false;
    const events = await until(client, (event, seen) => event.type === "response.done" && seen.filter((value) => value.type === "response.done").length === 2, (event) => {
      if (event.type === "session.created") {
        client.send(JSON.stringify({ type: "lares.playback.progress", item_id: null, played_ms: 0 }));
        client.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] } }));
      }
      if (event.type === "response.output_audio_transcript.delta" && event.delta === "second answer" && !acked) spokeEarly = true;
      if (event.type === "response.done" && stage === 0) {
        stage = 1;
        utterance = { key: "task:later", text: "second answer", silent: false };
        setTimeout(() => {
          acked = true;
          client.send(JSON.stringify({ type: "lares.playback.completed", item_id: "item" }));
        }, 400);
      }
    });
    assert.equal(spokeEarly, false);
    assert.deepEqual(events.filter((event) => event.type === "response.output_audio_transcript.delta").map((event) => event.delta), ["first answer", "second answer"]);
  } finally { client.terminate(); await fixture.stop(); }
});

test("the next sentence starts after the current one has been fed, not before its audio exists", async () => {
  const starts: number[] = [];
  let release: () => void = () => {};
  const started = new Promise<void>((resolve) => { release = resolve; });
  const fixture = await serve({
    segment: () => ["第一句。", "第二句。"],
    synthesize: async () => {
      starts.push(Date.now());
      if (starts.length === 2) release();
      await new Promise((resolve) => setTimeout(resolve, 30));
      return Buffer.alloc(24000 * 2 * 4);
    },
  });
  const client = connect(fixture.port, "voice-chat");
  try {
    await until(client, (event) => event.type === "session.created");
    client.send(JSON.stringify({ type: "lares.playback.progress", item_id: null, played_ms: 0 }));
    client.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "两句" }] } }));
    await Promise.race([
      started,
      new Promise((_, reject) => setTimeout(() => reject(new Error("second sentence did not start")), 5000)),
    ]);
    assert.equal(starts.length, 2);
    assert.ok(starts[1] - starts[0] >= 1000, `second sentence started after ${starts[1] - starts[0]}ms`);
  } finally { client.terminate(); await fixture.stop(); }
});

test("lares-realtime-v1 reads a streaming reply once it has finished, not from its first sentence", async () => {
  const partial = "太阳系是一个以太阳为中心的行星系统。";
  const full = `${partial}它还包括八颗行星、卫星和小天体。`;
  let utterance: any = { key: "7:1", text: partial, done: false, silent: false };
  const spoken: string[] = [];
  const fixture = await serve({
    synthesize: async (text: string) => { spoken.push(text); return Buffer.alloc(2400); },
  }, {
    state() { return { utterance }; },
  });
  const client = connect(fixture.port, "voice-chat");
  try {
    await until(client, (event) => event.type === "session.created");
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.deepEqual(spoken, []);
    utterance = { ...utterance, text: full, done: true };
    await until(client, (event) => event.type === "response.output_audio_transcript.done");
    assert.deepEqual(spoken, [full]);
  } finally { client.terminate(); await fixture.stop(); }
});

test("lares-realtime-v1 keeps the call open while a long reply drains", async () => {
  const fixture = await serve({ synthesize: async () => Buffer.alloc(1_200_000) });
  const client = connect(fixture.port, "voice-chat");
  try {
    const events = await until(client, (event) => event.type === "response.done", (event) => {
      if (event.type === "session.created") client.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] } }));
    });
    assert.equal(client.readyState, WebSocket.OPEN);
    assert.equal(events.find((event) => event.type === "response.done").response.status, "completed");
    assert.ok(events.some((event) => event.type === "response.output_audio.delta"));
  } finally { client.terminate(); await fixture.stop(); }
});

test("a take committed while the previous one is transcribing is queued, not rejected", async () => {
  let releaseTranscribe: () => void = () => {};
  const gate = new Promise<void>((resolve) => { releaseTranscribe = resolve; });
  const fixture = await serve({
    transcribe: async () => { await gate; return "queued words"; },
  });
  const client = connect(fixture.port, "voice-chat");
  const errors: string[] = [];
  const completed: string[] = [];
  client.on("message", (raw) => {
    const event = JSON.parse(raw.toString());
    if (event.type === "error") errors.push(event.error?.code);
    if (event.type === "conversation.item.input_audio_transcription.completed") completed.push(event.transcript);
  });
  try {
    await new Promise<void>((resolve) => client.once("open", resolve));
    await new Promise((resolve) => setTimeout(resolve, 60));
    const audio = Buffer.alloc(4800, 1).toString("base64");
    client.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
    client.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    // The microphone is shared: this second take arrives while the first ASR runs.
    client.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
    client.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(errors, []);
    releaseTranscribe();
    for (let i = 0; i < 100 && completed.length < 2; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(errors, []);
    assert.equal(completed.length, 2);
    assert.equal(fixture.calls.prompts.length, 2);
  } finally { client.terminate(); await fixture.stop(); }
});

test("a lost playback acknowledgement cannot wedge the half-duplex gate", async () => {
  const fixture = await serve({ playbackAckGraceMs: 60, synthesize: async () => Buffer.alloc(4800) });
  const client = connect(fixture.port, "voice-chat");
  const seen: string[] = [];
  client.on("message", (raw) => {
    const event = JSON.parse(raw.toString());
    seen.push(event.type + (event.error ? `:${event.error.code}` : ""));
  });
  try {
    await new Promise<void>((resolve) => client.once("open", resolve));
    await new Promise((resolve) => setTimeout(resolve, 60));
    client.send(JSON.stringify({ type: "lares.playback.progress", item_id: null, played_ms: 0 }));
    client.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] } }));
    for (let i = 0; i < 100 && !seen.includes("response.done"); i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(seen.includes("response.done"));
    // No acknowledgement arrives after the audio; the watchdog must release the gate.
    for (let i = 0; i < 100 && !seen.includes("lares.playback.timeout"); i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(seen.includes("lares.playback.timeout"), seen.join(","));
    client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: Buffer.alloc(4800, 1).toString("base64") }));
    client.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    for (let i = 0; i < 100 && !seen.includes("input_audio_buffer.committed"); i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(seen.includes("input_audio_buffer.committed"), seen.join(","));
    assert.equal(seen.some((value) => value === "error:waiting_for_playback"), false);
  } finally { client.terminate(); await fixture.stop(); }
});

test("a long reply is paced by the client's playout progress instead of filling its buffer", async () => {
  const fixture = await serve({ synthesize: async () => Buffer.alloc(240_000) });
  const client = connect(fixture.port, "voice-chat");
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const events: any[] = [];
  let itemId = null;
  let deltas = 0;
  client.on("message", (raw) => {
    const event = JSON.parse(raw.toString());
    events.push(event);
    if (event.type === "response.output_item.added") itemId = event.item?.id || null;
    if (event.type === "response.output_audio.delta") deltas += 1;
  });
  try {
    await new Promise<void>((resolve) => client.once("open", resolve));
    await sleep(60);
    client.send(JSON.stringify({ type: "lares.playback.progress", item_id: null, played_ms: 0 }));
    client.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "long answer" }] } }));
    for (let i = 0; i < 100 && deltas === 0; i += 1) await sleep(20);
    await sleep(250);
    assert.ok(deltas > 0);
    // About two seconds of audio, not the whole answer.
    assert.ok(deltas <= 6, `sent ${deltas} chunks before any playout`);
    assert.equal(events.some((event) => event.type === "response.done"), false);
    for (let played = 500; played <= 5000 && !events.some((event) => event.type === "response.done"); played += 500) {
      client.send(JSON.stringify({ type: "lares.playback.progress", item_id: itemId, played_ms: played }));
      await sleep(80);
    }
    for (let i = 0; i < 100 && !events.some((event) => event.type === "response.done"); i += 1) await sleep(20);
    assert.ok(events.some((event) => event.type === "response.done"));
  } finally { client.terminate(); await fixture.stop(); }
});

test("a device key declares its own tools, gets calls before the speech and continues only when it asks", async () => {
  const seen: any = { tools: [], outputs: [], observed: [], proceeds: [] };
  const fixture = await serve({}, {
    tools(_scope: any, tools: any[]) { seen.tools.push(tools); },
    toolOutput(_scope: any, callId: string, output: string) { if (callId !== "call_1") throw Object.assign(new Error("voice_tool_unknown"), { code: "voice_tool_unknown" }); seen.outputs.push([callId, output]); return true; },
    observe(_scope: any, parts: any[]) { seen.observed.push(parts); },
    async prompt(_scope: any, body: any) { fixture.calls.prompts.push(body); return { utterance: { key: body.requestId, text: "Sure.", calls: [{ call_id: "call_1", name: "move_head", arguments: '{"direction":"down"}' }], silent: false } }; },
    async proceed(_scope: any, body: any) { seen.proceeds.push(body); return { utterance: { key: body.requestId, text: "It is a cup.", calls: [], silent: false } }; },
  });
  const client = new WebSocket(`ws://127.0.0.1:${fixture.port}/api/lares/voice/realtime?model=voice-assistant`, { headers: { authorization: `Bearer ${DEVICE_KEY}` } });
  let dones = 0;
  try {
    const events = await until(client, (event) => event.type === "response.done" && ++dones === 2, (event) => {
      if (event.type === "session.created") {
        client.send(JSON.stringify({ type: "session.update", session: { type: "realtime", instructions: "x".repeat(3000), tools: [{ type: "function", name: "move_head", description: "Move the head", parameters: { type: "object", properties: {} } }], tool_choice: "auto" } }));
        client.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "nod please" }] } }));
        client.send(JSON.stringify({ type: "response.create" }));
      }
      if (event.type === "response.done" && dones === 0) {
        client.send(JSON.stringify({ type: "conversation.item.create", event_id: "evt-stray", item: { type: "function_call_output", call_id: "call_9", output: "{}" } }));
        client.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: "call_1", output: '{"status":"ok"}' } }));
        client.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_image", image_url: "data:image/jpeg;base64,AAAA" }] } }));
        client.send(JSON.stringify({ type: "response.create" }));
      }
    });
    assert.equal(events.find((event) => event.type === "session.created").session.lares.capabilities.client_tools, true);
    assert.deepEqual(seen.tools, [[{ name: "move_head", description: "Move the head", parameters: { type: "object", properties: {} } }]]);
    assert.equal(fixture.calls.instructions[0].length, 3000);
    assert.deepEqual(fixture.calls.prompts.map((body: any) => body.text), ["nod please"]);
    const types = events.map((event) => event.type);
    const call = events.find((event) => event.type === "response.function_call_arguments.done");
    assert.deepEqual([call.call_id, call.name, call.arguments, call.output_index], ["call_1", "move_head", '{"direction":"down"}', 1]);
    assert.ok(types.indexOf("response.function_call_arguments.done") < types.indexOf("response.output_audio.delta"));
    const first = events.find((event) => event.type === "response.done");
    assert.deepEqual(first.response.output.map((item: any) => [item.type, item.call_id]), [["function_call", "call_1"]]);
    assert.equal(events.find((event) => event.type === "error").error.event_id, "evt-stray");
    assert.deepEqual(seen.outputs, [["call_1", '{"status":"ok"}']]);
    assert.deepEqual(seen.observed, [[{ type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } }]]);
    assert.equal(seen.proceeds.length, 1);
    assert.equal(events.filter((event) => event.type === "response.output_audio_transcript.done").at(-1).transcript, "It is a cup.");
  } finally { client.close(); await fixture.stop(); }
});

test("a key without the device grant still cannot declare tools on the assistant", async () => {
  const fixture = await serve();
  const client = connect(fixture.port, "voice-assistant");
  try {
    const events = await until(client, (event) => event.type === "error", (event) => {
      if (event.type === "session.created") client.send(JSON.stringify({ type: "session.update", session: { tools: [{ type: "function", name: "move_head" }] } }));
    });
    assert.equal(events.find((event) => event.type === "session.created").session.lares.capabilities.client_tools, false);
    assert.equal(events.at(-1).error.code, "unsupported_parameter");
  } finally { client.close(); await fixture.stop(); }
});

test("without playback acknowledgements the microphone stays closed while the reply plays", async () => {
  // 24,000 bytes at 24 kHz PCM16 is 500 ms of reply audio.
  const fixture = await serve({ synthesize: async () => Buffer.alloc(24000) });
  const client = connect(fixture.port, "voice-chat");
  const voice = Buffer.alloc(4800, 1).toString("base64");
  let phase = 0;
  try {
    await until(client, (event) => event.type === "conversation.item.input_audio_transcription.completed" && ++phase === 2, (event) => {
      if (event.type === "session.created") client.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] } }));
      if (event.type === "response.done") {
        // Still inside the reply's playback: this take is dropped and commits empty.
        client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: voice }));
        client.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        setTimeout(() => {
          client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: voice }));
          client.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        }, 1000);
      }
    });
    assert.equal(fixture.calls.transcribed.length, 1);
  } finally { client.close(); await fixture.stop(); }
});

test("server_vad in a steady noisy room keeps no take open and still ends one when someone speaks", async () => {
  const fixture = await serve();
  const client = connect(fixture.port, "voice-chat");
  // One second of PCM16 at 24 kHz with a square wave of the given amplitude.
  const second = (amplitude: number) => { const pcm = Buffer.alloc(48000); for (let i = 0; i < 24000; i++) pcm.writeInt16LE(i % 2 ? amplitude : -amplitude, i * 2); return pcm.toString("base64"); };
  const fan = second(300), voice = second(3000);
  try {
    const events = await until(client, (event) => event.type === "conversation.item.input_audio_transcription.completed", (event) => {
      if (event.type === "session.created") client.send(JSON.stringify({ type: "session.update", session: { audio: { input: { turn_detection: { type: "server_vad" } } } } }));
      if (event.type === "session.updated") {
        // Longer than a whole take of steady noise: nothing may be refused or committed.
        for (let i = 0; i < 65; i++) client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: fan }));
        client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: voice }));
        for (let i = 0; i < 2; i++) client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: fan }));
      }
    });
    assert.equal(events.filter((event) => event.type === "error").length, 0);
    assert.equal(events.filter((event) => event.type === "input_audio_buffer.speech_started").length, 1);
    assert.equal(fixture.calls.transcribed.length, 1);
    // The take holds the speech plus one pre-roll chunk and the quiet after it, not a minute of fan.
    assert.ok(fixture.calls.transcribed[0].bytes <= 3 * 48000, String(fixture.calls.transcribed[0].bytes));
  } finally { client.close(); await fixture.stop(); }
});

test("Router VAD drops server_vad takes without speech from clients that send no playback reports", async () => {
  const second = (amplitude: number) => { const pcm = Buffer.alloc(48000); for (let i = 0; i < 24000; i++) pcm.writeInt16LE(i % 2 ? amplitude : -amplitude, i * 2); return pcm.toString("base64"); };
  const run = async (answer: number | null, acknowledging = false) => {
    const checks: number[] = [];
    const fixture = await serve({ detectSpeech: async (pcm: Buffer) => { checks.push(pcm.length); return answer; } });
    const client = connect(fixture.port, "voice-chat");
    try {
      const events = await until(client, (event) => event.type === "conversation.item.input_audio_transcription.completed", (event) => {
        if (event.type === "session.created") {
          if (acknowledging) client.send(JSON.stringify({ type: "lares.playback.progress", item_id: null, played_ms: 0 }));
          client.send(JSON.stringify({ type: "session.update", session: { audio: { input: { turn_detection: { type: "server_vad" } } } } }));
        }
        if (event.type === "session.updated") for (const amplitude of [300, 3000, 300]) client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: second(amplitude) }));
      });
      return { checks, transcribed: fixture.calls.transcribed.length, transcript: events.at(-1).transcript, prompts: fixture.calls.prompts.length };
    } finally { client.close(); await fixture.stop(); }
  };
  const silent = await run(0);
  assert.deepEqual([silent.checks.length, silent.transcribed, silent.transcript, silent.prompts], [1, 0, "", 0]);
  const spoken = await run(0.8);
  assert.deepEqual([spoken.checks.length, spoken.transcribed], [1, 1]);
  // VAD unavailable: the take is not lost.
  const unknown = await run(null);
  assert.equal(unknown.transcribed, 1);
  // Lares's own clients report playback and keep their path untouched.
  const lares = await run(0, true);
  assert.deepEqual([lares.checks.length, lares.transcribed], [0, 1]);
});

test("a device take that never falls quiet is closed at ten seconds and left to VAD", async () => {
  const fixture = await serve({ detectSpeech: async () => 1 });
  const client = connect(fixture.port, "voice-chat");
  const second = (amplitude: number) => { const pcm = Buffer.alloc(48000); for (let i = 0; i < 24000; i++) pcm.writeInt16LE(i % 2 ? amplitude : -amplitude, i * 2); return pcm.toString("base64"); };
  try {
    await until(client, (event) => event.type === "conversation.item.input_audio_transcription.completed", (event) => {
      if (event.type === "session.created") client.send(JSON.stringify({ type: "session.update", session: { audio: { input: { turn_detection: { type: "server_vad" } } } } }));
      // Speech-level audio that never pauses: the energy endpoint alone would wait for the 60 s limit.
      if (event.type === "session.updated") for (let i = 0; i < 14; i++) client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: second(i === 0 ? 300 : 3000) }));
    });
    const seconds = fixture.calls.transcribed[0].bytes / 48000;
    assert.ok(seconds >= 10 && seconds <= 11.5, String(seconds));
  } finally { client.close(); await fixture.stop(); }
});

test("a device is interrupted only once Router's VAD confirms a person spoke over its reply", async () => {
  const second = (amplitude: number) => { const pcm = Buffer.alloc(48000); for (let i = 0; i < 24000; i++) pcm.writeInt16LE(i % 2 ? amplitude : -amplitude, i * 2); return pcm.toString("base64"); };
  const run = async (person: boolean) => {
    // Five seconds of reply: the device is still playing it after the server has sent it all.
    const fixture = await serve({ synthesize: async () => Buffer.alloc(5 * 48000), detectSpeech: async () => (person ? 1 : 0) });
    const client = connect(fixture.port, "voice-chat");
    const events: any[] = [];
    let sent = false;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 2500);
        client.on("error", reject);
        client.on("message", (raw) => {
          const event = JSON.parse(raw.toString()); events.push(event);
          if (event.type === "session.created") client.send(JSON.stringify({ type: "session.update", session: { audio: { input: { turn_detection: { type: "server_vad" } } } } }));
          if (event.type === "session.updated") {
            // The room before the reply, so the gate knows its level when the reply ends.
            client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: second(300) }));
            client.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "tell me a story" }] } }));
          }
          if (event.type === "response.done" && !sent) {
            sent = true;
            // The reply's echo first, then someone speaking clearly over it, then quiet.
            for (const amplitude of [300, 3000, 3000, 300]) client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: second(amplitude) }));
          }
          if (event.type === "conversation.item.input_audio_transcription.completed") { clearTimeout(timer); resolve(); }
        });
      });
      return { events, calls: fixture.calls };
    } finally { client.close(); await fixture.stop(); }
  };
  const spoken = await run(true);
  const started = spoken.events.filter((event) => event.type === "input_audio_buffer.speech_started");
  assert.equal(started.length, 1);
  assert.ok(spoken.events.some((event) => event.type === "conversation.item.truncated"));
  assert.ok(spoken.calls.truncated.length >= 1);
  assert.equal(spoken.calls.transcribed.length, 1);
  const echo = await run(false);
  assert.equal(echo.events.filter((event) => event.type === "input_audio_buffer.speech_started").length, 0);
  assert.ok(!echo.events.some((event) => event.type === "conversation.item.truncated"));
  assert.equal(echo.calls.transcribed.length, 0);
});

test("a session holds one ASR stream at a time: the next take streams once the previous one is read", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const streams: { bytes: number }[] = [];
  let open = 0, widest = 0;
  const fixture = await serve({
    openTranscription: async () => {
      const stream = { bytes: 0 };
      streams.push(stream); open += 1; widest = Math.max(widest, open);
      const first = streams.length === 1;
      return { write(pcm: Buffer) { stream.bytes += pcm.length; }, async finish() { if (first) await gate; open -= 1; return first ? "first" : "second"; }, cancel() { open -= 1; } };
    },
  });
  const client = connect(fixture.port, "voice-chat");
  const completed: string[] = [];
  client.on("message", (raw) => { const event = JSON.parse(raw.toString()); if (event.type === "conversation.item.input_audio_transcription.completed") completed.push(event.transcript); });
  try {
    await new Promise<void>((resolve) => client.once("open", resolve));
    await new Promise((resolve) => setTimeout(resolve, 60));
    const audio = Buffer.alloc(4800, 1).toString("base64");
    client.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
    client.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    // The next take starts while the first is still being read: it is kept, not streamed yet.
    client.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(streams.length, 1);
    release();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(streams.length, 2);
    assert.equal(streams[1].bytes, 4800);
    client.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    for (let i = 0; i < 100 && completed.length < 2; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(completed, ["first", "second"]);
    assert.equal(widest, 1);
  } finally { client.terminate(); await fixture.stop(); }
});

test("a device take ASR cannot read is dropped without an error, other clients still see one", async () => {
  const second = (amplitude: number) => { const pcm = Buffer.alloc(48000); for (let i = 0; i < 24000; i++) pcm.writeInt16LE(i % 2 ? amplitude : -amplitude, i * 2); return pcm.toString("base64"); };
  const busy = Object.assign(new Error("busy"), { status: 503 });
  const run = async (acknowledging: boolean) => {
    const fixture = await serve({ detectSpeech: async () => 1, transcribe: async () => { throw busy; } });
    const client = connect(fixture.port, "voice-chat");
    try {
      const events = await until(client, (event) => event.type === "error" || event.type === "conversation.item.input_audio_transcription.failed", (event) => {
        if (event.type === "session.created") {
          if (acknowledging) client.send(JSON.stringify({ type: "lares.playback.progress", item_id: null, played_ms: 0 }));
          client.send(JSON.stringify({ type: "session.update", session: { audio: { input: { turn_detection: { type: "server_vad" } } } } }));
        }
        if (event.type === "session.updated") for (const amplitude of [300, 3000, 300]) client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: second(amplitude) }));
      });
      return events.at(-1).type;
    } finally { client.close(); await fixture.stop(); }
  };
  assert.equal(await run(false), "conversation.item.input_audio_transcription.failed");
  assert.equal(await run(true), "error");
});

test("a room louder than the widest floor is learned once Router's VAD says a take was only noise", async () => {
  const second = (amplitude: number) => { const pcm = Buffer.alloc(48000); for (let i = 0; i < 24000; i++) pcm.writeInt16LE(i % 2 ? amplitude : -amplitude, i * 2); return pcm.toString("base64"); };
  // Router's VAD hears the person only in takes that carry their louder second.
  const fixture = await serve({ detectSpeech: async (pcm: Buffer) => { for (let i = 0; i < pcm.length; i += 2) if (pcm.readInt16LE(i) > 3000) return 1; return 0; } });
  const client = connect(fixture.port, "voice-chat");
  try {
    // A fan through the device's gain: louder than any floor the gate allows on its own, so the
    // first take never falls quiet and is closed at the take limit; the next room seconds are not a take.
    const completed = await until(client, (event) => event.type === "conversation.item.input_audio_transcription.completed" && event.transcript.trim() !== "", (event) => {
      if (event.type === "session.created") client.send(JSON.stringify({ type: "session.update", session: { audio: { input: { turn_detection: { type: "server_vad" } } } } }));
      if (event.type === "session.updated") {
        for (let i = 0; i < 11; i++) client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: second(1500) }));
        setTimeout(() => { for (const amplitude of [1500, 1500, 6000, 1500, 1500]) client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: second(amplitude) })); }, 200);
      }
    });
    const transcripts = completed.filter((e) => e.type === "conversation.item.input_audio_transcription.completed").map((e) => e.transcript.trim());
    assert.equal(transcripts.at(-1), "test request");
    assert.equal(fixture.calls.transcribed.length, 1);
    // The person's take is that one second of speech and its edges, not the room since the veto.
    const seconds = fixture.calls.transcribed[0].bytes / 48000;
    assert.ok(seconds < 3.5, String(seconds));
  } finally { client.close(); await fixture.stop(); }
});

test("a bursty room is learned from its loud moments, so its bursts stop opening takes", async () => {
  // 40 ms chunks like a device's microphone: a steady hum with a louder burst every fifth chunk.
  const chunk = (amplitude: number) => { const pcm = Buffer.alloc(1920); for (let i = 0; i < 960; i++) pcm.writeInt16LE(i % 2 ? amplitude : -amplitude, i * 2); return pcm.toString("base64"); };
  const room = (seconds: number) => Array.from({ length: seconds * 25 }, (_, i) => chunk(i % 5 === 4 ? 2600 : 1500));
  const fixture = await serve({ detectSpeech: async (pcm: Buffer) => { for (let i = 0; i < pcm.length; i += 2) if (pcm.readInt16LE(i) > 4000) return 1; return 0; } });
  const client = connect(fixture.port, "voice-chat");
  try {
    await until(client, (event) => event.type === "conversation.item.input_audio_transcription.completed" && event.transcript.trim() !== "", (event) => {
      if (event.type === "session.created") client.send(JSON.stringify({ type: "session.update", session: { audio: { input: { turn_detection: { type: "server_vad" } } } } }));
      if (event.type === "session.updated") {
        for (const audio of room(11)) client.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
        setTimeout(() => { for (const audio of [...room(2), ...Array.from({ length: 25 }, () => chunk(6000)), ...room(2)]) client.send(JSON.stringify({ type: "input_audio_buffer.append", audio })); }, 200);
      }
    });
    // The person's take is that second of speech and its edges, not the room since the first veto.
    assert.equal(fixture.calls.transcribed.length, 1);
    const seconds = fixture.calls.transcribed[0].bytes / 48000;
    assert.ok(seconds < 3.5, String(seconds));
  } finally { client.close(); await fixture.stop(); }
});

test("each device take reports its length, how it ended, the VAD answer and the room's levels", async () => {
  const second = (amplitude: number) => { const pcm = Buffer.alloc(48000); for (let i = 0; i < 24000; i++) pcm.writeInt16LE(i % 2 ? amplitude : -amplitude, i * 2); return pcm.toString("base64"); };
  const metrics: any[] = [];
  const fixture = await serve({ detectSpeech: async () => 0, metric: (fields: any) => metrics.push(fields) });
  const client = connect(fixture.port, "voice-chat");
  try {
    await until(client, (event) => event.type === "conversation.item.input_audio_transcription.completed", (event) => {
      if (event.type === "session.created") client.send(JSON.stringify({ type: "session.update", session: { audio: { input: { turn_detection: { type: "server_vad" } } } } }));
      if (event.type === "session.updated") for (const amplitude of [300, 3000, 300]) client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: second(amplitude) }));
    });
    const take = metrics.find((fields) => fields.event === "device-take");
    assert.equal(take.ended, "silence");
    assert.equal(take.speech, 0);
    assert.ok(Math.abs(take.max - 3000 / 32768) < 0.001, String(take.max));
  } finally { client.close(); await fixture.stop(); }
});

// A stand-in for Silero: a chunk with a sample past 4000 is a voice, anything else the room.
const fakeSpeechGate = () => {
  let probability = 0;
  return { kind: "silero", hear(chunk: Buffer) { probability = 0; for (let i = 0; i < chunk.length; i += 2) if (Math.abs(chunk.readInt16LE(i)) > 4000) { probability = 1; break; } }, voiced(_rms: number, speaking: boolean) { return probability >= (speaking ? 0.35 : 0.5); } };
};

test("with a speech model a device's loud room opens no take, a voice opens one, and Router's VAD is not asked", async () => {
  const chunk = (amplitude: number) => { const pcm = Buffer.alloc(480); for (let i = 0; i < 240; i++) pcm.writeInt16LE(i % 2 ? amplitude : -amplitude, i * 2); return pcm.toString("base64"); };
  // 10 ms chunks: a room with bursts far louder than any floor, then one second of a voice.
  const room = (seconds: number) => Array.from({ length: seconds * 100 }, (_, i) => chunk(i % 20 === 19 ? 3500 : 1500));
  const checks: number[] = [], metrics: any[] = [];
  const fixture = await serve({ speechGate: async () => fakeSpeechGate(), detectSpeech: async () => { checks.push(1); return 1; }, metric: (fields: any) => metrics.push(fields) });
  const client = connect(fixture.port, "voice-chat");
  try {
    const events = await until(client, (event) => event.type === "conversation.item.input_audio_transcription.completed", (event) => {
      if (event.type === "session.created") client.send(JSON.stringify({ type: "session.update", session: { audio: { input: { turn_detection: { type: "server_vad" } } } } }));
      if (event.type === "session.updated") for (const audio of [...room(12), ...Array.from({ length: 100 }, () => chunk(6000)), ...room(2)]) client.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
    });
    assert.equal(events.filter((event) => event.type === "input_audio_buffer.speech_started").length, 1);
    assert.equal(fixture.calls.transcribed.length, 1);
    const seconds = fixture.calls.transcribed[0].bytes / 48000;
    assert.ok(seconds > 1 && seconds < 2, String(seconds));
    assert.deepEqual(checks, []);
    assert.equal(metrics.find((fields) => fields.event === "device-take").gate, "silero");
  } finally { client.close(); await fixture.stop(); }
});

test("a speech model that cannot load leaves a device on loudness and Router's VAD", async () => {
  const second = (amplitude: number) => { const pcm = Buffer.alloc(48000); for (let i = 0; i < 24000; i++) pcm.writeInt16LE(i % 2 ? amplitude : -amplitude, i * 2); return pcm.toString("base64"); };
  const checks: number[] = [], errors: any[] = [];
  const fixture = await serve({ speechGate: async () => { throw new Error("onnx_unavailable"); }, onError: (cause: any) => errors.push(cause.message), detectSpeech: async () => { checks.push(1); return 1; } });
  const client = connect(fixture.port, "voice-chat");
  try {
    await until(client, (event) => event.type === "conversation.item.input_audio_transcription.completed", (event) => {
      if (event.type === "session.created") client.send(JSON.stringify({ type: "session.update", session: { audio: { input: { turn_detection: { type: "server_vad" } } } } }));
      if (event.type === "session.updated") for (const amplitude of [300, 3000, 300]) client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: second(amplitude) }));
    });
    assert.deepEqual(errors, ["onnx_unavailable"]);
    assert.equal(checks.length, 1);
    assert.equal(fixture.calls.transcribed.length, 1);
  } finally { client.close(); await fixture.stop(); }
});

test("a device's own reply heard back is told from a person by its words before anything is interrupted", async () => {
  const second = (amplitude: number) => { const pcm = Buffer.alloc(48000); for (let i = 0; i < 24000; i++) pcm.writeInt16LE(i % 2 ? amplitude : -amplitude, i * 2); return pcm.toString("base64"); };
  const run = async (heard: string) => {
    const metrics: any[] = [];
    // Streaming ASR that has words once 0.6 s of the take has reached it.
    const openTranscription = async (_scope: any, onPartial: (text: string) => void) => {
      let bytes = 0;
      return { write(pcm: Buffer) { bytes += pcm.length; if (bytes >= 0.6 * 48000) onPartial(heard); }, async finish() { return heard; }, cancel() {} };
    };
    const fixture = await serve({ synthesize: async () => Buffer.alloc(5 * 48000), detectSpeech: async () => 1, openTranscription, metric: (fields: any) => metrics.push(fields) });
    const client = connect(fixture.port, "voice-chat");
    const events: any[] = [];
    let sent = false;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 3000);
        client.on("error", reject);
        client.on("message", (raw) => {
          const event = JSON.parse(raw.toString()); events.push(event);
          if (event.type === "session.created") client.send(JSON.stringify({ type: "session.update", session: { audio: { input: { turn_detection: { type: "server_vad" } } } } }));
          if (event.type === "session.updated") {
            client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: second(300) }));
            client.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "tell me a story" }] } }));
          }
          if (event.type === "response.done" && !sent) {
            sent = true;
            for (const amplitude of [300, 3000, 3000]) client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: second(amplitude) }));
          }
          if (event.type === "input_audio_buffer.speech_started") { clearTimeout(timer); resolve(); }
        });
      });
      return { started: events.filter((event) => event.type === "input_audio_buffer.speech_started").length, echoes: metrics.filter((fields) => fields.event === "device-echo"), truncated: fixture.calls.truncated.length };
    } finally { client.close(); await fixture.stop(); }
  };
  // The service's reply is "actual reply": hearing those words back is the device's own voice.
  const echo = await run("actual reply actual");
  assert.deepEqual([echo.started, echo.echoes.length, echo.truncated], [0, 1, 0]);
  const person = await run("what time is it");
  assert.deepEqual([person.started, person.echoes.length], [1, 0]);
});

test("a device take ends once ASR stops finding new words, though voices go on across the room", async () => {
  const chunk = (amplitude: number) => { const pcm = Buffer.alloc(2400); for (let i = 0; i < 1200; i++) pcm.writeInt16LE(i % 2 ? amplitude : -amplitude, i * 2); return pcm.toString("base64"); };
  const metrics: any[] = [];
  // Streaming ASR reports after every half second of audio; the speaker's words end after one second.
  const openTranscription = async (_scope: any, onPartial: (text: string) => void) => {
    let bytes = 0, steps = 0;
    return { write(pcm: Buffer) { bytes += pcm.length; while (bytes >= (steps + 1) * 24000) { steps += 1; onPartial(steps < 2 ? "帮我" : "帮我开灯"); } }, async finish() { return "帮我开灯"; }, cancel() {} };
  };
  const fixture = await serve({ speechGate: async () => fakeSpeechGate(), openTranscription, metric: (fields: any) => metrics.push(fields) });
  const client = connect(fixture.port, "voice-chat");
  let pump: NodeJS.Timeout | undefined;
  try {
    const started = Date.now();
    const events = await until(client, (event) => event.type === "conversation.item.input_audio_transcription.completed", (event) => {
      if (event.type === "session.created") client.send(JSON.stringify({ type: "session.update", session: { audio: { input: { turn_detection: { type: "server_vad" } } } } }));
      // 50 ms of "voice" every 50 ms, for as long as the take stays open.
      if (event.type === "session.updated") pump = setInterval(() => client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: chunk(6000) })), 50);
    });
    assert.equal(events.find((event) => event.type === "conversation.item.input_audio_transcription.completed").transcript, "帮我开灯");
    const take = metrics.find((fields) => fields.event === "device-take");
    assert.equal(take.ended, "words");
    assert.ok(take.ms < 3500 && Date.now() - started < 4000, `${take.ms} ms`);
  } finally { clearInterval(pump); client.close(); await fixture.stop(); }
});

test("a knock that opens a device take is dropped after half a second of quiet, and the next phrase is heard", async () => {
  const chunk = (amplitude: number) => { const pcm = Buffer.alloc(2400); for (let i = 0; i < 1200; i++) pcm.writeInt16LE(i % 2 ? amplitude : -amplitude, i * 2); return pcm.toString("base64"); };
  const metrics: any[] = [];
  const fixture = await serve({ speechGate: async () => fakeSpeechGate(), metric: (fields: any) => metrics.push(fields) });
  const client = connect(fixture.port, "voice-chat");
  try {
    const started = Date.now();
    const events = await until(client, (event) => event.type === "conversation.item.input_audio_transcription.completed", (event) => {
      if (event.type === "session.created") client.send(JSON.stringify({ type: "session.update", session: { audio: { input: { turn_detection: { type: "server_vad" } } } } }));
      // 100 ms knock, a second of quiet, then one second of a voice and quiet: 50 ms chunks.
      if (event.type === "session.updated") for (const amplitude of [...Array(20).fill(300), 6000, 6000, ...Array(20).fill(300), ...Array(20).fill(6000), ...Array(20).fill(300)]) client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: chunk(amplitude) }));
    });
    assert.ok(events.some((event) => event.type === "input_audio_buffer.cleared"));
    assert.deepEqual(metrics.filter((fields) => fields.event === "device-take").map((fields) => fields.ended), ["short", "silence"]);
    assert.equal(fixture.calls.transcribed.length, 1);
    const seconds = fixture.calls.transcribed[0].bytes / 48000;
    assert.ok(seconds > 1 && seconds < 2, String(seconds));
    assert.ok(Date.now() - started < 3000);
  } finally { client.close(); await fixture.stop(); }
});

test("a hands-free take opened by a knock is dropped too, and the client is told it is gone", async () => {
  const chunk = (amplitude: number) => { const pcm = Buffer.alloc(2400); for (let i = 0; i < 1200; i++) pcm.writeInt16LE(i % 2 ? amplitude : -amplitude, i * 2); return pcm.toString("base64"); };
  const fixture = await serve();
  const client = connect(fixture.port, "voice-chat");
  try {
    const events = await until(client, (event) => event.type === "conversation.item.input_audio_transcription.completed", (event) => {
      // A Lares headset: server_vad with playback reports, on the loudness gate.
      if (event.type === "session.created") { client.send(JSON.stringify({ type: "lares.playback.progress", item_id: null, played_ms: 0 })); client.send(JSON.stringify({ type: "session.update", session: { audio: { input: { turn_detection: { type: "server_vad" } } } } })); }
      if (event.type === "session.updated") for (const amplitude of [...Array(20).fill(300), 3000, 3000, ...Array(20).fill(300), ...Array(20).fill(3000), ...Array(20).fill(300)]) client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: chunk(amplitude) }));
    });
    const kinds = events.map((event) => event.type);
    assert.ok(kinds.indexOf("input_audio_buffer.cleared") > kinds.indexOf("input_audio_buffer.speech_started"));
    assert.equal(fixture.calls.transcribed.length, 1);
    const seconds = fixture.calls.transcribed[0].bytes / 48000;
    assert.ok(seconds > 1 && seconds < 2, String(seconds));
  } finally { client.close(); await fixture.stop(); }
});

test("with a speech model a phrase quieter than its first syllable is still a phrase, not a dropped knock", async () => {
  const chunk = (amplitude: number) => { const pcm = Buffer.alloc(480); for (let i = 0; i < 240; i++) pcm.writeInt16LE(i % 2 ? amplitude : -amplitude, i * 2); return pcm.toString("base64"); };
  // The model hears a voice in anything past 1000; loudness says the phrase is under a third of its peak.
  const quietSpeechGate = () => { let probability = 0; return { kind: "silero", hear(c: Buffer) { probability = 0; for (let i = 0; i < c.length; i += 2) if (Math.abs(c.readInt16LE(i)) > 1000) { probability = 1; break; } }, voiced(_rms: number, speaking: boolean) { return probability >= (speaking ? 0.35 : 0.5); } }; };
  const metrics: any[] = [];
  const fixture = await serve({ speechGate: async () => quietSpeechGate(), metric: (fields: any) => metrics.push(fields) });
  const client = connect(fixture.port, "voice-chat");
  try {
    await until(client, (event) => event.type === "conversation.item.input_audio_transcription.completed", (event) => {
      if (event.type === "session.created") client.send(JSON.stringify({ type: "session.update", session: { audio: { input: { turn_detection: { type: "server_vad" } } } } }));
      // 10 ms chunks: room, one loud syllable, a second of ordinary speech, room.
      if (event.type === "session.updated") for (const amplitude of [...Array(50).fill(300), ...Array(5).fill(9000), ...Array(100).fill(2000), ...Array(80).fill(300)]) client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: chunk(amplitude) }));
    });
    assert.deepEqual(metrics.filter((fields) => fields.event === "device-take").map((fields) => fields.ended), ["silence"]);
    assert.equal(fixture.calls.transcribed.length, 1);
  } finally { client.close(); await fixture.stop(); }
});

test("a device's reply is synthesized as a stream, a Lares client's still sentence by sentence", async () => {
  const run = async (acknowledging: boolean) => {
    const asked: any[] = [];
    const fixture = await serve({ synthesize: async (_text: string, _scope: any, _onChunk: any, options: any) => { asked.push(options?.stream === true); return Buffer.alloc(2400); } });
    const client = connect(fixture.port, "voice-chat");
    try {
      await until(client, (event) => event.type === "response.done", (event) => {
        if (event.type === "session.created") {
          if (acknowledging) client.send(JSON.stringify({ type: "lares.playback.progress", item_id: null, played_ms: 0 }));
          client.send(JSON.stringify({ type: "session.update", session: { audio: { input: { turn_detection: { type: "server_vad" } } } } }));
        }
        if (event.type === "session.updated") client.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] } }));
        if (event.type === "response.output_audio.delta" && acknowledging) client.send(JSON.stringify({ type: "lares.playback.completed", item_id: event.item_id }));
      });
      return asked;
    } finally { client.close(); await fixture.stop(); }
  };
  assert.deepEqual(await run(false), [true]);
  assert.deepEqual(await run(true), [false]);
});
