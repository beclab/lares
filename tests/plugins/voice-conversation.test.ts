import assert from "node:assert/strict";
import test from "node:test";
import { createVoiceConversation } from "@olares/lares-core/voice/conversation";
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("continuous voice waits for both task completion and playback before the next take", async () => {
  let takes = 0;
  let say: (text: string) => void = () => {};
  let state: any = { version: 0, running: false, active: true, sessionId: null, utterance: null };
  let submitted = 0;
  let closed = 0;
  const input = { capabilities: { bargeIn: false }, capture: () => { takes++; return new Promise<string>((resolve) => { say = resolve; }); }, cancel() { say(""); } };
  let call: any;
  call = createVoiceConversation({ input, device: "device", playback: { stop() {} },
    request: async (path: string, options: any) => {
      if (path.endsWith("/session/prompt")) { submitted++; state = { ...state, version: 1, sessionId: "bound", running: true }; }
      if (path.endsWith("/session/close")) closed++;
      return { ok: true, body: state };
    },
    onReply: () => call.playbackState(true),
  });
  try {
    await call.start({ continuous: true });
    say("task"); await tick(); await tick();
    assert.equal(submitted, 1); assert.equal(takes, 1);
    state = { ...state, version: 2, running: false, utterance: { key: "1:0", turn: 1, text: "result", done: true, silent: false } };
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(takes, 1);
    call.playbackState(false); await tick();
    assert.equal(takes, 2);
    assert.equal(call.controller.getSnapshot().sessionId, "bound");
  } finally { await call.stop(); }
  assert.equal(closed, 1);
});
test("cancelling a capture discards a recognizer that ignores AbortSignal", async () => {
  let say: (text: string) => void = () => {};
  let submitted = 0;
  const call = createVoiceConversation({ input: { capture: () => new Promise<string>((r) => { say = r; }), cancel() {} }, playback: { stop() {} }, readAloud: false,
    request: async (path: string) => { if (path.endsWith("/session/prompt")) submitted++; return { ok: true, body: { active: true, version: 0 } }; },
  });
  await call.start(); await call.stop(); say("late"); await tick();
  assert.equal(submitted, 0);
});


test("dictation returns editable text without opening or submitting any dsh session", async () => {
  let resolve: (text: string) => void = () => {};
  const paths: string[] = [];
  const texts: string[] = [];
  const call = createVoiceConversation({
    input: { capture: () => new Promise<string>((done) => { resolve = done; }), cancel() {} },
    playback: { stop() {} }, readAloud: false,
    onTranscript: ({ text }: any) => { texts.push(text); },
    request: async (path: string, options: any) => { paths.push(path); return { ok: true, body: { text: options.body?.text } }; },
  });
  await call.start({ sessionId: "draft-owner" });
  resolve("dictated text"); await tick();
  assert.deepEqual(texts, ["dictated text"]);
  assert.equal(paths.some((path) => path.endsWith("/session") || path.endsWith("/session/prompt")), false);
  assert.equal(call.controller.getSnapshot().connection, "closed");
});

test("paused input discards late results and resumes without submitting them", async () => {
  const resolvers: ((text: string) => void)[] = [];
  const texts: string[] = [];
  const call = createVoiceConversation({
    input: { capture: () => new Promise<string>((done) => resolvers.push(done)), cancel() {} },
    playback: { stop() {} }, onTranscript: ({ text }: any) => { texts.push(text); },
    request: async (_path: string, options: any) => ({ ok: true, body: { text: options?.body?.text } }),
  });
  await call.start({ continuous: true });
  await call.controller.pauseInput();
  resolvers[0]("late"); await tick();
  assert.deepEqual(texts, []);
  call.controller.resumeInput();
  resolvers[1]("current"); await tick();
  assert.deepEqual(texts, ["current"]);
  await call.stop();
});

test("dictation hands raw text to preview without making any cleanup model call", async () => {
  let transcript: (text: string) => void = () => {};
  const texts: string[] = [];
  const call = createVoiceConversation({
    input: { capture: () => new Promise<string>((resolve) => { transcript = resolve; }), cancel() {} },
    playback: { stop() {} }, onTranscript: ({ text }: any) => { texts.push(text); },
    request: async (path: string) => { assert.equal(path.endsWith("/dictation/clean"), false); return { ok: true, body: {} }; },
  });
  await call.start(); transcript("raw text"); await tick(); assert.deepEqual(texts, ["raw text"]); await call.stop();
});

test("opening a conversation leaves the answer already on screen silent, then reads the next one", async () => {
  const played: string[] = [];
  const stops: unknown[] = [];
  let state: any = { active: true, version: 1, sessionId: "s", running: false, utterance: { key: "1:0", turn: 1, step: 0, attemptId: "a", text: "already spoken", done: true, silent: false } };
  const call = createVoiceConversation({
    input: { capabilities: { bargeIn: false, echoTested: true }, capture: () => new Promise(() => {}), cancel() {} },
    playback: { stop() {} },
    readAloud: true,
    onReply: (reply: any) => { played.push(reply.text); },
    request: async (path: string, options: any) => {
      if (path.endsWith("/playback/stop")) stops.push(options.body ?? null);
      return { ok: true, body: state };
    },
  });
  try {
    await call.start({ sessionId: "s", continuous: true });
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.deepEqual(played, []);
    assert.deepEqual(stops, []);
    state = { ...state, version: 2, utterance: { key: "2:0", turn: 2, step: 0, attemptId: "b", text: "next answer", done: true, silent: false } };
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.deepEqual(played, ["next answer"]);
  } finally { await call.stop(); }
});

test("a state poll returning after stop cannot rebind or restart speech", async () => {
  let finish: (value: any) => void = () => {};
  let played = 0;
  const call = createVoiceConversation({
    input: { capture: () => new Promise(() => {}), cancel() {} }, playback: { stop() {} }, onReply: () => { played++; },
    request: async (path: string, options: any) => path.endsWith("/session") && options.method === "GET" ? new Promise((resolve) => { finish = resolve; }) : ({ ok: true, body: {} }),
  });
  await call.start({ sessionId: "original", continuous: true });
  await call.stop();
  finish({ ok: true, body: { sessionId: "late", version: 1, running: false, utterance: { key: "late", text: "must stay silent" } } });
  await tick();
  assert.equal(played, 0);
  assert.equal(call.controller.getSnapshot().sessionId, "original");
});
