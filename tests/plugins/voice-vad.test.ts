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
