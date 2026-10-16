import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import test from "node:test";
import { WebSocket } from "ws";
import { verifyVoicePrincipal, authorizeVoicePreset } from "@olares/lares-core/voice/external";
import { createCompositeGateway } from "@olares/lares-core/voice/composite-gateway";

const secret = "fixture-signing-credential-32-bytes-minimum";
function headers(value: any = {}) {
  const claim = Buffer.from(JSON.stringify({ user: "alice", app: "", model: "voice-chat", at: Math.floor(Date.now() / 1000), nonce: "a".repeat(32), ...value })).toString("base64url");
  return { "x-olares-voice-principal": claim, "x-olares-voice-signature": createHmac("sha256", secret).update(claim).digest("hex") };
}
test("external voice rejects forged, expired and app-only business grants", () => {
  assert.equal(verifyVoicePrincipal(headers(), secret).user, "alice");
  assert.throws(() => verifyVoicePrincipal({ ...headers(), "x-olares-voice-signature": "0".repeat(64) }, secret));
  assert.throws(() => verifyVoicePrincipal(headers({ at: 1 }), secret));
  assert.throws(() => authorizeVoicePreset({ user: "", app: "app", model: "voice-assistant" }, { "app:app": { presets: ["assistant"], lares: true } }, "voice-assistant"));
  assert.throws(() => authorizeVoicePreset({ user: "alice", model: "voice-chat" }, { alice: { presets: ["chat"] } }, "voice-assistant"));
});
test("composite socket runs a real PCM/transcript/text/audio exchange and rejects tool injection", async () => {
  let prompts = 0, closes = 0;
  const service: any = {
    async open(scope: any) { scope.active = true; },
    async prompt(_scope: any, body: any) { prompts++; return { utterance: { key: body.requestId, text: "actual reply", silent: false } }; },
    state() { return {}; }, async close(scope: any) { scope.active = false; closes++; },
  };
  const gateway = createCompositeGateway({ service, config: () => ({ idleTimeoutMs: 300000 }), secret, grants: { alice: { presets: ["chat"] } }, enabled: true,
    transcribe: async (pcm: Buffer) => { assert.equal(pcm.length, 4800); return "test request"; }, synthesize: async () => Buffer.alloc(2400),
  });
  const server = createServer();
  server.on("upgrade", (req, socket, head) => gateway.upgrade(req, socket, head));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as any;
  const client = new WebSocket(`ws://127.0.0.1:${address.port}/realtime?model=voice-chat`, { headers: headers() });
  const events: any[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("test timeout")), 3000);
      client.on("error", reject);
      client.on("message", (raw) => {
        const event = JSON.parse(raw.toString()); events.push(event);
        if (event.type === "session.created") {
          client.send(JSON.stringify({ type: "session.update", session: { tools: [{ name: "shell" }] } }));
          client.send(JSON.stringify({ type: "input_audio_buffer.append", audio: Buffer.alloc(4800).toString("base64") }));
          client.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        }
        if (event.type === "response.done") { clearTimeout(timer); resolve(); }
      });
    });
    assert.equal(prompts, 1);
    assert.equal(events.find((event) => event.type === "error").error.code, "voice_session_forbidden");
    assert.equal(events.find((event) => event.type === "conversation.item.input_audio_transcription.completed").transcript, "test request");
    assert.equal(events.find((event) => event.type === "response.output_audio_transcript.delta").delta, "actual reply");
    assert.ok(events.some((event) => event.type === "response.output_audio.delta"));
  } finally {
    client.terminate(); gateway.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  assert.equal(closes, 1);
});
