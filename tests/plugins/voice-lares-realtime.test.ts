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
