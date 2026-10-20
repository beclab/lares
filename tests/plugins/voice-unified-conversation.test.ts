import assert from "node:assert/strict";
import test from "node:test";
import { createUnifiedConversation } from "@olares/lares-core/voice/unified-conversation";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
function fakeSocket() {
  const listeners: Record<string, Function[]> = { message: [], close: [] };
  const sent: any[] = [];
  const socket: any = {
    readyState: 1, bufferedAmount: 0, sent,
    addEventListener(type: string, fn: Function) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type: string, fn: Function) { listeners[type] = (listeners[type] || []).filter((value) => value !== fn); },
    send(raw: string) { sent.push(JSON.parse(raw)); },
    close() { socket.readyState = 3; for (const fn of listeners.close) fn(); },
    emit(event: any) { for (const fn of listeners.message) fn({ data: JSON.stringify(event) }); },
  };
  return socket;
}
function fixture(options: any = {}) {
  const calls: any[] = [];
  const socket = fakeSocket();
  const player: any = { events: [] as string[], start: async () => { player.events.push("start"); }, write: (bytes: Uint8Array) => { player.events.push(`write:${bytes.length}`); }, finish: async () => { player.events.push("finish"); }, stop: () => { player.events.push("stop"); }, pause() {}, resume() {} };
  let progress: (frames: number) => void = () => {};
  const conversation = createUnifiedConversation({
    request: async (path: string, init: any) => {
      calls.push([path, init.method, init.body]);
      if (path.endsWith("/realtime/ticket")) return { ok: true, body: { ticket: "t1" } };
      if (path.endsWith("/session") && init.method === "GET") return { ok: true, body: { running: false, active: true, sessionId: "dsh-1" } };
      return { ok: true, body: { running: false } };
    },
    socket: (ticket: string) => { assert.equal(ticket, "t1"); queueMicrotask(() => socket.emit({ type: "session.created", session: {} })); return socket; },
    player: ({ onProgress }: any) => { progress = onProgress; return player; },
    ...options,
  });
  return { conversation, socket, player, calls, progress: (frames: number) => progress(frames) };
}

test("unified conversation opens the scope, takes a ticket and configures lares-realtime-v1", async () => {
  const f = fixture({ device: "headset", readAloud: true, preset: "direct", mode: () => "steer" });
  await f.conversation.start({ continuous: true });
  assert.deepEqual(f.calls[0], ["/api/lares/voice/session", "POST", { sessionId: null, readAloud: true, presentationSession: false, preset: "direct", backend: "pipeline" }]);
  assert.equal(f.calls[1][0], "/api/lares/voice/realtime/ticket");
  const update = f.socket.sent.find((event: any) => event.type === "session.update");
  assert.equal(update.session.type, "realtime");
  assert.deepEqual(update.session.audio.input.turn_detection, { type: "server_vad" });
  await tick();
  assert.ok(f.socket.sent.some((event: any) => event.type === "lares.device.input.resume"));
  assert.equal(f.socket.sent.findLast((event: any) => event.type === "session.update").session.lares.busy_turn, "steer");
  f.socket.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "i1", transcript: "hello" });
  await tick();
  assert.ok(f.socket.sent.some((event: any) => event.type === "lares.device.input.pause"));
  assert.equal(f.calls.some(([path]: any) => path.endsWith("/session/prompt")), false);
  await f.conversation.stop();
  assert.equal(f.calls.at(-1)[0], "/api/lares/voice/session/close");
});

test("unified conversation plays reply audio, acknowledges it and truncates on stop", async () => {
  const f = fixture({ device: "device", readAloud: true, input: { capabilities: {}, capture: () => new Promise(() => {}), stop() {}, cancel() {} } });
  await f.conversation.start({ continuous: false });
  try {
  const audio = Buffer.alloc(4800).toString("base64");
  f.socket.emit({ type: "response.created", response: { id: "r1" } });
  f.socket.emit({ type: "response.output_item.added", item: { id: "item-1" } });
  f.socket.emit({ type: "response.output_audio.delta", delta: audio });
  f.socket.emit({ type: "response.done", response: { id: "r1", status: "completed" } });
  await tick();
  assert.deepEqual(f.player.events.slice(f.player.events.indexOf("start")), ["start", "write:4800", "finish"]);
  assert.deepEqual(f.socket.sent.find((event: any) => event.type === "lares.playback.completed"), { type: "lares.playback.completed", item_id: "item-1" });
  f.socket.emit({ type: "response.created", response: { id: "r2" } });
  f.socket.emit({ type: "response.output_item.added", item: { id: "item-2" } });
  f.socket.emit({ type: "response.output_audio.delta", delta: audio });
  await tick();
  f.progress(24 * 120);
  await f.conversation.controller.stopPlayback();
  assert.ok(f.socket.sent.some((event: any) => event.type === "response.cancel"));
  assert.deepEqual(f.socket.sent.find((event: any) => event.type === "conversation.item.truncate"), { type: "conversation.item.truncate", item_id: "item-2", content_index: 0, audio_end_ms: 120 });
  await f.conversation.setReadAloud(false);
  assert.deepEqual(f.socket.sent.findLast((event: any) => event.type === "session.update").session, { output_modalities: ["text"] });
  } finally { await f.conversation.stop(); }
});

test("unified dictation uses a transcription session and hands the transcript to the panel", async () => {
  const transcripts: string[] = [];
  const f = fixture({ device: "headset", onTranscript: async ({ text }: any) => { transcripts.push(text); } });
  await f.conversation.start({ continuous: false });
  assert.equal(f.calls[0][2].preset, "dictation");
  assert.equal(f.socket.sent.find((event: any) => event.type === "session.update").session.type, "transcription");
  await tick();
  f.socket.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "i1", transcript: "take note" });
  await tick(); await tick();
  assert.deepEqual(transcripts, ["take note"]);
});
