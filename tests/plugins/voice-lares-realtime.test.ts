import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { WebSocket } from "ws";
import { createLaresRealtimeGateway } from "@olares/lares-core/voice/lares-realtime-gateway";

const KEY = "lvk_0123456789abcdef_" + "a".repeat(43);
const keys = { verify: (header: any) => header === `Bearer ${KEY}` ? { id: "0123456789abcdef", name: "Router", models: ["voice-chat", "voice-dictation"], sessionId: null, workspaceId: null } : null };

async function serve(options: any = {}) {
  const calls: any = { prompts: [], closes: 0, transcribed: [], synthesized: [] };
  const service: any = {
    async open(scope: any) { scope.active = true; scope.contextId = scope.contextId || "ctx-1"; scope.session = { snapshot: () => ({ running: false, tasks: [] }) }; },
    async prompt(_scope: any, body: any) { calls.prompts.push(body); return { utterance: { key: body.requestId, text: "actual reply", silent: false } }; },
    async clean(_scope: any, text: string) { return text.trim(); },
    state() { return {}; }, async cancel() {}, async close(scope: any) { scope.active = false; calls.closes++; },
  };
  const gateway = createLaresRealtimeGateway({ service, config: () => ({ idleTimeoutMs: 300000 }), keys,
    transcribe: async (pcm: Buffer, scope: any) => { calls.transcribed.push({ bytes: pcm.length, session: scope.routerSessionId }); return " test request "; },
    synthesize: async () => Buffer.alloc(2400), ...options });
  const server = createServer();
  server.on("upgrade", (req, socket, head) => gateway.upgrade(req, socket, head));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  return { calls, port, async stop() { gateway.close(); await new Promise<void>((resolve) => server.close(() => resolve())); } };
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
    assert.equal(await handshake(fixture.port, "voice-assistant", { authorization: `Bearer ${KEY}` }), 403);
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
    const events = await until(client, (event) => event.type === "conversation.item.input_audio_transcription.completed", (event) => {
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
