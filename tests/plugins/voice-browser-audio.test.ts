import assert from "node:assert/strict";
import test from "node:test";
import { createPcmStreamPlayer, primePlaybackContext } from "@olares/lares-core/voice/pcm-player";
import { createStreamingCapture } from "@olares/lares-core/voice/stream-client";
import { prepareBrowserCapture } from "@olares/lares-core/voice/browser-capture";
import { ZH, EN } from "@olares/lares-core/i18n/voice";

const format = { sampleRate: 24000, channels: 1, encoding: "pcm_s16le" };
const flush = () => new Promise(resolve => setImmediate(resolve));

function browser(t: any, secure: boolean, Context: any, Node: any = class {}) {
  for (const [key, value] of Object.entries({ isSecureContext: secure, AudioContext: Context, AudioWorkletNode: Node })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete (globalThis as any)[key]; });
  }
}

test("HTTP audio prewarming is optional and does not allocate a context", async t => {
  let created = 0;
  class Context { constructor() { created++; } }
  browser(t, false, Context);
  assert.equal(primePlaybackContext(), null);
  assert.equal(created, 0);
  await assert.rejects(createPcmStreamPlayer().start(format), /voice_secure_context_required/);
});

test("a browser without worklets releases optional prewarming and reports explicit playback failure", async t => {
  let closed = 0;
  class Context {
    state = "running";
    async resume() {}
    async close() { this.state = "closed"; closed++; }
  }
  browser(t, true, Context);
  assert.equal(primePlaybackContext(), null);
  await flush();
  assert.equal(closed, 1);
  await assert.rejects(createPcmStreamPlayer().start(format), /voice_audio_unsupported/);
  assert.equal(closed, 2);
});

test("context creation and synchronous resume failures cannot reject optional prewarming", async t => {
  class Context { constructor() { throw new Error("device unavailable"); } }
  browser(t, true, Context);
  assert.equal(primePlaybackContext(), null);
  let closed = 0;
  (globalThis as any).AudioContext = class {
    state = "running";
    audioWorklet = { addModule: async () => {} };
    resume() { throw new Error("device busy"); }
    async close() { this.state = "closed"; closed++; }
  };
  assert.equal(primePlaybackContext(), null);
  await flush();
  assert.equal(closed, 1);
});

test("synchronous module failure revokes its URL and remains retryable for real playback", async t => {
  let calls = 0, revoked = 0, closed = 0;
  class Context {
    state = "running";
    destination = {};
    audioWorklet = { addModule() { calls++; if (calls === 1) throw new Error("worklet blocked"); } };
    async resume() {}
    async close() { this.state = "closed"; closed++; }
  }
  browser(t, true, Context, class { port = { onmessage: null }; connect() {} disconnect() {} });
  const original = URL.revokeObjectURL;
  t.mock.method(URL, "revokeObjectURL", (url: string) => { revoked++; original(url); });
  const primed = primePlaybackContext();
  assert.ok(primed);
  await flush();
  assert.equal(revoked, 1);
  const player = createPcmStreamPlayer();
  try {
    await player.start(format);
    assert.equal(calls, 2);
    assert.equal(revoked, 2);
  } finally { player.stop(); await primed.close(); }
  assert.equal(closed, 1);
});

test("capture without worklets cancels the upstream port and closes the context", async t => {
  let cancelled = 0, closed = 0, resumed = 0;
  class Context {
    state = "running";
    async resume() { resumed++; }
    async close() { this.state = "closed"; closed++; }
  }
  browser(t, true, Context);
  await assert.rejects(createStreamingCapture({}, { port: async () => ({ cancel() { cancelled++; } }) }), /voice_audio_unsupported/);
  assert.equal(cancelled, 1);
  assert.equal(closed, 1);
  assert.equal(resumed, 0);
});

test("HTTP microphone startup reports a secure connection requirement", async t => {
  browser(t, false, undefined);
  const preparation = prepareBrowserCapture({ media: { mediaDevices: {} } });
  await assert.rejects(preparation.opened(), /voice_secure_context_required/);
  preparation.cancel();
  for (const table of [ZH, EN]) {
    assert.ok(table["error.voice_secure_context_required"]);
    assert.ok(table["error.voice_audio_unsupported"]);
  }
});
