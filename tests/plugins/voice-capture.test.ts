import assert from "node:assert/strict";
import test from "node:test";
import { createCaptureSession, pcm16Level } from "@olares/lares-core/voice/capture";

function pcm(frames: number, amplitude: number) {
  const bytes = Buffer.alloc(frames * 1024);
  const sample = Math.round(amplitude * 32767);
  for (let i = 0; i < bytes.length; i += 2) bytes.writeInt16LE(sample, i);
  return bytes;
}

function session(bytes: Buffer, hooks: { transcribed: Buffer[]; closed: number }) {
  let opened = 0;
  return createCaptureSession({
    async open() {
      opened += 1;
      return { ready: true };
    },
    async read(from = 0) {
      return bytes.subarray(Math.min(from, bytes.length));
    },
    async close() {
      hooks.closed += 1;
    },
    async transcribe(wav: Buffer) {
      hooks.transcribed.push(wav);
      return "How are you?";
    },
    sleep: async () => {},
    now: () => 0,
  });
}

async function settle(capture: ReturnType<typeof createCaptureSession>, phase: string) {
  for (let i = 0; i < 30; i += 1) {
    const status = capture.status();
    if (status.phase === phase) return status;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return capture.status();
}

test("a silent frame is not audible and a tone is", () => {
  assert.equal(pcm16Level(pcm(1, 0)).audible, false);
  const tone = pcm16Level(pcm(1, 0.2));
  assert.equal(tone.audible, true);
  assert.ok(tone.rms > 0.1);
});

test("the opening burst inside digital silence does not set the speech level", async () => {
  const burst = pcm(1, 0);
  for (let i = 0; i < 40; i += 2) burst.writeInt16LE(32000, i);
  const bytes = Buffer.concat([burst, pcm(80, 0), pcm(16, 0.01), pcm(40, 0.001)]);
  assert.equal(pcm16Level(burst).audible, false);
  const hooks = { transcribed: [] as Buffer[], closed: 0 };
  const capture = session(bytes, hooks);
  await capture.start();
  const done = await settle(capture, "done");
  assert.equal(done.phase, "done");
  assert.equal(hooks.transcribed.length, 1);
});

test("the machine ends the take after speech and returns the transcript", async () => {
  const bytes = Buffer.concat([pcm(8, 0.2), pcm(80, 0)]);
  const hooks = { transcribed: [] as Buffer[], closed: 0 };
  const capture = session(bytes, hooks);
  const opened = await capture.start();
  assert.equal(opened.recording, true);
  const done = await settle(capture, "done");
  assert.equal(done.phase, "done");
  assert.equal(done.text, "How are you?");
  assert.equal(hooks.closed, 1);
  assert.equal(hooks.transcribed.length, 1);
  assert.equal(hooks.transcribed[0].subarray(0, 4).toString(), "RIFF");
});

test("the playback tail does not close the take before the speaker", async () => {
  const tail = pcm(20, 0.4);
  const gap = pcm(12, 0);
  const speech = pcm(16, 0.08);
  const trailing = pcm(20, 0);
  const parts = [tail, gap, speech, trailing];
  let shown = 0;
  const hooks = { transcribed: [] as Buffer[], closed: 0 };
  const capture = createCaptureSession({
    async open() {
      return { ready: true, settle: true };
    },
    async read(from = 0) {
      if (shown < parts.length) shown += 1;
      const file = Buffer.concat(parts.slice(0, shown));
      return file.subarray(Math.min(from, file.length));
    },
    async close() {
      hooks.closed += 1;
    },
    async transcribe(wav: Buffer) {
      hooks.transcribed.push(wav);
      return "next";
    },
    sleep: async () => {},
    now: () => 0,
  });
  const opened = await capture.start();
  assert.equal(opened.recording, true);
  const done = await settle(capture, "done");
  assert.equal(done.phase, "done");
  assert.equal(done.text, "next");
  assert.equal(shown, parts.length);
  assert.equal(hooks.closed, 1);
  // Ten quiet frames settle the tail. The rest of the gap stays with the utterance.
  assert.equal(hooks.transcribed[0].length, 44 + 2 * 1024 + speech.length + trailing.length);
});

test("a later take reads only the bytes recorded after it opened", async () => {
  const prior = pcm(8, 0.2);
  const take = Buffer.concat([pcm(8, 0.2), pcm(80, 0)]);
  const bytes = Buffer.concat([prior, take]);
  const hooks = { transcribed: [] as Buffer[], closed: 0 };
  const capture = createCaptureSession({
    async open() {
      return { ready: true, offset: prior.length };
    },
    async read(from = 0) {
      return bytes.subarray(Math.min(from, bytes.length));
    },
    async close() {
      hooks.closed += 1;
    },
    async transcribe(wav: Buffer) {
      hooks.transcribed.push(wav);
      return "next";
    },
    sleep: async () => {},
    now: () => 0,
  });
  await capture.start();
  const done = await settle(capture, "done");
  assert.equal(done.phase, "done");
  assert.equal(done.text, "next");
  assert.equal(hooks.transcribed[0].length, 44 + take.length);
});

test("no headset microphone reports that the take was skipped", async () => {
  let closed = 0;
  const capture = createCaptureSession({
    async open() {
      return { skipped: true };
    },
    async read() {
      return Buffer.alloc(0);
    },
    async close() {
      closed += 1;
    },
    async transcribe() {
      return "";
    },
    sleep: async () => {},
    now: () => 0,
  });
  assert.deepEqual(await capture.start(), { skipped: true });
  assert.equal(closed, 0);
  assert.equal(capture.status().phase, "idle");
});

test("a new page replaces the take left by the page before reload", async () => {
  let clock = 0;
  let opened = 0;
  const capture = createCaptureSession({
    async open() {
      opened += 1;
      return { ready: true };
    },
    async read(from = 0) {
      return from === 0 ? pcm(1, 0.2) : Buffer.alloc(0);
    },
    async close() {},
    async transcribe() {
      return "";
    },
    async sleep(ms: number) {
      clock += ms;
      await new Promise((resolve) => setImmediate(resolve));
    },
    now: () => clock,
  });
  assert.equal((await capture.start()).recording, true);
  assert.equal((await capture.start()).recording, true);
  assert.equal(opened, 2);
  capture.stop(true);
});

test("a slow headset open does not count as the page going away", async () => {
  let clock = 0;
  const capture = createCaptureSession({
    async open() {
      clock += 6000;
      return { ready: true };
    },
    async read() {
      return Buffer.alloc(0);
    },
    async close() {},
    async transcribe() {
      return "";
    },
    async sleep(ms: number) {
      clock += ms;
      await new Promise((resolve) => setImmediate(resolve));
    },
    now: () => clock,
  });
  assert.equal((await capture.start()).recording, true);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(capture.status().phase, "recording");
  capture.stop(true);
});

test("cancelling during transcription aborts the router request", async () => {
  let clock = 0;
  let aborted = false;
  const bytes = pcm(24, 0.2);
  const capture = createCaptureSession({
    async open() {
      return { ready: true };
    },
    async read(from = 0) {
      return bytes.subarray(Math.min(from, bytes.length));
    },
    async close() {},
    async transcribe(_wav: Buffer, signal: AbortSignal) {
      await new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        }, { once: true });
      });
      return "";
    },
    async sleep(ms: number) {
      clock += ms;
      await new Promise((resolve) => setImmediate(resolve));
    },
    now: () => clock,
  });
  await capture.start();
  capture.stop(false);
  assert.equal((await settle(capture, "transcribing")).phase, "transcribing");
  capture.stop(true);
  assert.equal((await settle(capture, "idle")).phase, "idle");
  assert.equal(aborted, true);
});

test("stopping before any speech does not transcribe", async () => {
  let transcribed = 0;
  const capture = createCaptureSession({
    async open() {
      return { ready: true };
    },
    async read() {
      return Buffer.alloc(0);
    },
    async close() {},
    async transcribe() {
      transcribed += 1;
      return "nope";
    },
    sleep: async () => {},
    now: () => 0,
  });
  const pending = capture.start();
  capture.stop(false);
  assert.deepEqual(await pending, { recording: true, at: 0 });
  await settle(capture, "error");
  assert.equal(capture.status().phase, "error");
  assert.equal(capture.status().error, "voice_too_short");
  assert.equal(transcribed, 0);
});

test("capture becomes recording when the device is ready and times out silent input", async () => {
  let clock = 0;
  let reset = 0;
  let transcribed = 0;
  const capture = createCaptureSession({
    async open() {
      return { ready: true };
    },
    async read() {
      return Buffer.alloc(0);
    },
    async close() {},
    async reset() {
      reset += 1;
    },
    async transcribe() {
      transcribed += 1;
      return "nope";
    },
    async sleep(ms: number) {
      clock += Math.max(ms, 1000);
      await new Promise((resolve) => setImmediate(resolve));
    },
    now: () => clock,
  });

  assert.deepEqual(await capture.start(), { recording: true, at: 0 });
  assert.equal(capture.status().phase, "recording");
  const failed = await settle(capture, "error");
  assert.equal(failed.error, "voice_no_input");
  assert.equal(reset, 1);
  assert.equal(transcribed, 0);
});

test("a live microphone with only room noise times out without rebuilding the link", async () => {
  let clock = 0;
  let reset = 0;
  let transcribed = 0;
  const capture = createCaptureSession({
    async open() {
      return { ready: true };
    },
    async read(from = 0) {
      const noise = pcm(Math.floor(clock / 32), 0.001);
      return noise.subarray(Math.min(from, noise.length));
    },
    async close() {},
    async reset() {
      reset += 1;
    },
    async transcribe() {
      transcribed += 1;
      return "";
    },
    async sleep(ms: number) {
      clock += Math.max(ms, 1000);
      await new Promise((resolve) => setImmediate(resolve));
    },
    now: () => clock,
  });
  await capture.start();
  const failed = await settle(capture, "error");
  assert.equal(failed.phase, "error");
  assert.equal(failed.error, "voice_no_input");
  assert.equal(reset, 0);
  assert.equal(transcribed, 0);
});
