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
