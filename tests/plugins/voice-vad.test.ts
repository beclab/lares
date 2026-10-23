import assert from "node:assert/strict";
import test from "node:test";
import { createVadSession } from "../../packages/web/composer-voice/src/client/vad.js";

test("Silero stays loaded across recordings", async () => {
  let created = 0;
  const calls = [];
  const session = createVadSession(async (hooks) => {
    created += 1;
    return {
      async start() {
        calls.push(["start", await hooks.getStream()]);
      },
      async pause() {
        calls.push(["pause"]);
      },
      async destroy() {
        calls.push(["destroy"]);
      },
    };
  });

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  await session.preload();
  const first = await session.open("mic-a", () => {});
  first.stop();
  const second = await session.open("mic-b", () => {});
  second.stop();
  await flush();
  await session.preload();

  assert.equal(created, 1);
  assert.deepEqual(calls.map((call) => call[0]), ["start", "pause", "start", "pause"]);
  assert.deepEqual(calls.filter((call) => call[0] === "start").map((call) => call[1]), ["mic-a", "mic-b"]);
});

test("a loaded Silero session reports speech start and level once", async () => {
  const { createVadSession } = await import("@olares/lares-core/voice/vad");
  let hooks: any = null;
  const session = createVadSession(async (value: any) => { hooks = value; return { async start() {}, async pause() {} }; });
  await session.preload();
  let speech = 0;
  const levels: number[] = [];
  const handle = await session.open("mic", () => {}, { onSpeech: () => { speech += 1; }, onLevel: (value: number) => { levels.push(value); } });
  const frame = Float32Array.from([0.2, -0.2, 0.2, -0.2]);
  hooks.onFrame(0.9, frame);
  hooks.onFrame(0.9, frame);
  hooks.onFrame(0.01, new Float32Array(4));
  assert.equal(speech, 1);
  assert.deepEqual(levels.map((value) => Math.round(value * 1000) / 1000), [0.2, 0.2, 0]);
  handle.stop();
});

test("the Silero endpoint is skipped until its model is loaded", async () => {
  const { createVoiceVadEndpoint, preloadVoiceVad, voiceVadReady } = await import("@olares/lares-core/voice/vad");
  assert.equal(voiceVadReady(), false);
  assert.equal(createVoiceVadEndpoint({} as any, () => {}), null);
  assert.equal(await preloadVoiceVad(), false);
});
