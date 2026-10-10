import assert from "node:assert/strict";
import test from "node:test";
import { speakFromConfig } from "@olares/lares-core/voice/service";
import { captureSource } from "@olares/lares-core/voice/input";
import { browserPlays } from "@olares/lares-core/voice/playback";
import {
  concludingReply,
  createReplySpeaker,
  emptySpeechState,
  reduceSpeechEvent,
} from "@olares/lares-core/voice/speech";
import { foldTranscript } from "@olares/lares-core/larepass/transcript";
import { createDuplexCoordinator } from "@olares/lares-core/voice/duplex";

const config = { speak: true, ttsModel: "kokoro", model: "", language: "" };

test("the desktop page records on the headset and the phone page records on the phone", () => {
  assert.equal(captureSource("pc"), "headset");
  assert.equal(captureSource("mobile"), "device");
});

test("the phone plays an answer the headset already played; the desktop page does not", () => {
  assert.equal(browserPlays("mobile", "played"), true);
  assert.equal(browserPlays("mobile", "skipped"), true);
  assert.equal(browserPlays("pc", "played"), false);
  assert.equal(browserPlays("pc", "skipped"), true);
});

function assistantMessage(seq: number, content: unknown[], extra: Record<string, unknown> = {}) {
  return { seq, type: "assistant/message", data: { turn: 1, step: seq, message: { content }, ...extra } };
}

test("only the message that concludes a turn is spoken", () => {
  const text = (value: string) => ({ type: "text", text: value });
  const call = { type: "tool-call", callId: "c1", name: "search", arguments: "{}" };
  assert.equal(concludingReply(assistantMessage(1, [text("checking"), call])), "");
  assert.equal(concludingReply(assistantMessage(1, [text("partial")], { interrupted: true })), "");
  assert.equal(concludingReply(assistantMessage(1, [{ type: "reasoning", text: "hmm" }])), "");
  assert.equal(concludingReply(assistantMessage(1, [text("done")])), "done");
});

test("the answer is ready to speak before turn-stopping work ends the turn", () => {
  const events = [
    { seq: 0, type: "turn/start", data: { turn: 1 } },
    assistantMessage(1, [{ type: "text", text: "checking" }, { type: "tool-call", callId: "c1", name: "search", arguments: "{}" }]),
    { seq: 2, type: "tool/call", data: { turn: 1, callId: "c1", name: "search", arguments: "{}" } },
    { seq: 3, type: "tool/result", data: { turn: 1, callId: "c1" } },
  ];
  assert.equal(foldTranscript(events).reply, null);
  const concluded = foldTranscript([...events, assistantMessage(4, [{ type: "text", text: "done" }])]);
  assert.equal(concluded.running, true);
  assert.deepEqual(concluded.reply, { seq: 4, text: "done" });
  const next = foldTranscript([
    ...events,
    assistantMessage(4, [{ type: "text", text: "done" }]),
    { seq: 5, type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } },
    { seq: 6, type: "turn/start", data: { turn: 2 } },
  ]);
  assert.equal(next.reply, null);

  let state = emptySpeechState();
  for (const event of [...events, assistantMessage(4, [{ type: "text", text: "done" }])]) {
    state = reduceSpeechEvent(state, event);
  }
  assert.deepEqual(state, { text: "done", seq: 4 });
});

test("a steer answered in the same turn is a second answer", () => {
  const events = [
    { seq: 0, type: "turn/start", data: { turn: 1 } },
    assistantMessage(1, [{ type: "text", text: "first" }]),
    { seq: 2, type: "user/message", data: { turn: 1, content: [{ type: "text", text: "also this" }] } },
    assistantMessage(3, [{ type: "text", text: "second" }]),
  ];
  assert.deepEqual(foldTranscript(events.slice(0, 2)).reply, { seq: 1, text: "first" });
  assert.deepEqual(foldTranscript(events).reply, { seq: 3, text: "second" });
  let state = emptySpeechState();
  for (const event of events) state = reduceSpeechEvent(state, event);
  assert.deepEqual(state, { text: "second", seq: 3 });
});

function speakerRun(snaps: Array<{ sessionChanged?: boolean; running: boolean; reply: null | { seq: number; text: string } }>) {
  const speaker = createReplySpeaker();
  let running = false;
  return snaps.map((snap) => {
    const text = speaker.observe({ sessionChanged: Boolean(snap.sessionChanged), wasRunning: running, ...snap });
    running = snap.running;
    return text;
  });
}

test("a live turn speaks its answer once, as soon as it concludes", () => {
  const done = { seq: 4, text: "done" };
  assert.deepEqual(speakerRun([
    { sessionChanged: true, running: false, reply: null },
    { running: true, reply: null },
    { running: true, reply: done },
    { running: true, reply: done },
    { running: false, reply: done },
  ]), ["", "", "done", "", ""]);
});

test("an answer and the turn end landing in one update are still spoken", () => {
  assert.deepEqual(speakerRun([
    { sessionChanged: true, running: false, reply: null },
    { running: true, reply: null },
    { running: false, reply: { seq: 4, text: "done" } },
  ]), ["", "", "done"]);
});

test("a steer answered after the first answer is spoken too", () => {
  assert.deepEqual(speakerRun([
    { sessionChanged: true, running: false, reply: null },
    { running: true, reply: null },
    { running: true, reply: { seq: 4, text: "first" } },
    { running: true, reply: { seq: 9, text: "second" } },
    { running: false, reply: { seq: 9, text: "second" } },
  ]), ["", "", "first", "second", ""]);
});

test("opening a session never reads out an answer it did not watch arrive", () => {
  assert.deepEqual(speakerRun([
    { sessionChanged: true, running: false, reply: { seq: 4, text: "old" } },
    { running: false, reply: { seq: 4, text: "old" } },
    { running: true, reply: null },
    { running: true, reply: { seq: 8, text: "new" } },
  ]), ["", "", "", "new"]);
  assert.deepEqual(speakerRun([
    { sessionChanged: true, running: true, reply: { seq: 4, text: "concluded before I came" } },
    { running: false, reply: { seq: 4, text: "concluded before I came" } },
  ]), ["", ""]);
  assert.deepEqual(speakerRun([
    { sessionChanged: true, running: true, reply: null },
    { running: true, reply: { seq: 4, text: "watched" } },
  ]), ["", "watched"]);
  assert.deepEqual(speakerRun([
    { sessionChanged: true, running: false, reply: null },
    { running: false, reply: { seq: 4, text: "history page arrived" } },
  ]), ["", ""]);
  assert.deepEqual(speakerRun([
    { sessionChanged: true, running: false, reply: null },
    { running: true, reply: { seq: 4, text: "loaded mid-turn, already concluded" } },
    { running: true, reply: { seq: 9, text: "steer answered while watching" } },
  ]), ["", "", "steer answered while watching"]);
});

test("a turn stopped before it concludes says nothing", () => {
  assert.deepEqual(speakerRun([
    { sessionChanged: true, running: false, reply: null },
    { running: true, reply: null },
    { running: false, reply: null },
  ]), ["", "", ""]);
});

test("a send tap unlocks the phone player without cutting an answer still playing", async () => {
  const sources: string[] = [];
  class FakeAudio {
    paused = true;
    src = "";
    onended: null | (() => void) = null;
    async play() { sources.push(this.src); this.paused = false; }
    pause() { this.paused = true; }
  }
  const saved = { Audio: globalThis.Audio, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  Object.assign(globalThis, { Audio: FakeAudio });
  globalThis.URL.createObjectURL = () => "blob:answer";
  globalThis.URL.revokeObjectURL = () => {};
  try {
    const { createAnswerPlayer } = await import("../../packages/mobile/src/chat/playback.js");
    const player = createAnswerPlayer();
    player.unlock();
    assert.match(sources.at(-1) ?? "", /^data:audio\/wav/);
    await player.play(new Blob(["wav"]));
    assert.equal(sources.at(-1), "blob:answer");
    player.unlock();
    assert.equal(sources.at(-1), "blob:answer");
    player.stop();
    player.unlock();
    assert.match(sources.at(-1) ?? "", /^data:audio\/wav/);
  } finally {
    Object.assign(globalThis, { Audio: saved.Audio });
    URL.createObjectURL = saved.create;
    URL.revokeObjectURL = saved.revoke;
  }
});

function fakeHeadset(log: string[], write: () => Promise<void> = async () => {}) {
  return {
    skipped: false,
    write,
    async close() { log.push("close"); },
    abort() { log.push("abort"); },
  };
}

const synthOnce = async (_request: unknown, onChunk: (chunk: Buffer) => unknown) => {
  await onChunk(Buffer.from("pcm"));
  return { streamed: true };
};

test("a newer readout supersedes one still synthesizing, which returns no audio", async () => {
  const stops: number[] = [];
  const coordinator = createDuplexCoordinator(async () => { stops.push(1); });
  const log: string[] = [];
  let release: () => void = () => {};
  const first = speakFromConfig("First.", {
    config, model: "kokoro", coordinator,
    openPlayback: async () => fakeHeadset(log),
    synthesize: (request: { signal: AbortSignal }, onChunk: (chunk: Buffer) => unknown) => new Promise((resolve, reject) => {
      void onChunk(Buffer.from("a"));
      request.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      release = () => resolve({ streamed: true });
    }),
    pcmToWav: (pcm: Buffer) => pcm,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = await speakFromConfig("Second.", {
    config, model: "kokoro", coordinator,
    openPlayback: async () => fakeHeadset([]),
    synthesize: synthOnce,
    pcmToWav: (pcm: Buffer) => pcm,
  });
  release();
  await assert.rejects(first, (err: { code?: string }) => err.code === "voice_cancelled");
  assert.equal(second.bluetooth, "played");
  assert.ok(log.includes("abort"));
  assert.equal(stops.length, 1);
});

test("an interrupt that lands between synthesis and the headset opening returns no audio", async () => {
  const coordinator = createDuplexCoordinator(async () => {});
  const log: string[] = [];
  let open: (value: unknown) => void = () => {};
  const pending = speakFromConfig("Hello.", {
    config, model: "kokoro", coordinator,
    openPlayback: () => new Promise((resolve) => { open = resolve; }),
    synthesize: synthOnce,
    pcmToWav: (pcm: Buffer) => pcm,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await coordinator.interrupt();
  open(fakeHeadset(log));
  await assert.rejects(pending, (err: { code?: string }) => err.code === "voice_cancelled");
  assert.deepEqual(log, ["abort"]);
});

test("recording stops a headset readout still draining after the browser got its copy", async () => {
  const stops: number[] = [];
  const coordinator = createDuplexCoordinator(async () => { stops.push(1); });
  const log: string[] = [];
  let failWrite: (err: Error) => void = () => {};
  const spoken = await speakFromConfig("Hello.", {
    config, model: "kokoro", coordinator,
    openPlayback: async () => fakeHeadset(log, () => new Promise((_, reject) => { failWrite = reject; })),
    synthesize: synthOnce,
    pcmToWav: (pcm: Buffer) => pcm,
  });
  assert.equal(spoken.bluetooth, "played");
  await coordinator.interrupt();
  failWrite(new Error("stream destroyed"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(stops.length, 1);
  assert.ok(log.includes("abort"));
  assert.ok(!log.includes("close"));
  const next = await speakFromConfig("Again.", {
    config, model: "kokoro", coordinator,
    openPlayback: async () => fakeHeadset([]),
    synthesize: synthOnce,
    pcmToWav: (pcm: Buffer) => pcm,
  });
  assert.equal(next.bluetooth, "played");
});

test("two pages asking for the same answer share one readout", async () => {
  const coordinator = createDuplexCoordinator(async () => {});
  let syntheses = 0;
  let opens = 0;
  let drain: () => void = () => {};
  const options = {
    config, model: "kokoro", coordinator,
    openPlayback: async () => {
      opens += 1;
      return fakeHeadset([], () => new Promise<void>((resolve) => { drain = resolve; }));
    },
    synthesize: async (request: unknown, onChunk: (chunk: Buffer) => unknown) => {
      syntheses += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return synthOnce(request, onChunk);
    },
    pcmToWav: (pcm: Buffer) => pcm,
  };
  const [desktop, phone] = await Promise.all([
    speakFromConfig("Same answer.", options),
    speakFromConfig("Same answer.", options),
  ]);
  assert.equal(desktop.bluetooth, "played");
  assert.equal(phone.audio.toString(), desktop.audio.toString());
  const late = await speakFromConfig("Same answer.", options);
  assert.equal(late.audio.toString(), desktop.audio.toString());
  assert.equal(syntheses, 1);
  assert.equal(opens, 1);
  drain();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await speakFromConfig("Same answer.", options);
  assert.equal(syntheses, 2);
});

test("a streamed answer with no headset goes to the browser alone", async () => {
  const spoken = await speakFromConfig("Hello.", {
    config, model: "kokoro",
    openPlayback: async () => ({ skipped: true }),
    synthesize: synthOnce,
    pcmToWav: (pcm: Buffer) => pcm,
  });
  assert.equal(spoken.bluetooth, "skipped");
  assert.equal(spoken.audio.toString(), "pcm");
});

test("a synthesis failure closes the headset and reports the failure", async () => {
  const log: string[] = [];
  await assert.rejects(speakFromConfig("Hello.", {
    config, model: "kokoro",
    openPlayback: async () => fakeHeadset(log),
    synthesize: async (_request: unknown, onChunk: (chunk: Buffer) => unknown) => {
      await onChunk(Buffer.from("a"));
      throw Object.assign(new Error("router down"), { code: "voice_failed" });
    },
    pcmToWav: (pcm: Buffer) => pcm,
  }), (err: { code?: string }) => err.code === "voice_failed");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(log, ["abort"]);
});

test("the browser receives the answer even when the headset plays it", async () => {
  const spoken = await speakFromConfig("Hello there.", {
    config,
    model: "kokoro",
    async openPlayback() {
      return { skipped: false, async write() {}, async close() {}, abort() {} };
    },
    async synthesize(_request, onChunk) {
      await onChunk(Buffer.from("pcm"));
      return { streamed: true };
    },
    pcmToWav(pcm) {
      return Buffer.concat([Buffer.from("wav:"), pcm]);
    },
  });
  assert.equal(spoken.bluetooth, "played");
  assert.equal(spoken.audio.toString(), "wav:pcm");
});

test("the answer returns once synthesized while the headset is still playing", async () => {
  let drain: () => void = () => {};
  let closed = false;
  const spoken = await Promise.race([
    speakFromConfig("Hello there.", {
      config,
      model: "kokoro",
      async openPlayback() {
        return {
          skipped: false,
          write: () => new Promise<void>((resolve) => { drain = resolve; }),
          async close() { closed = true; },
          abort() {},
        };
      },
      async synthesize(_request, onChunk) {
        await onChunk(Buffer.from("pcm"));
        return { streamed: true };
      },
      pcmToWav: (pcm) => pcm,
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("waited for the headset")), 200)),
  ]);
  assert.equal(spoken.bluetooth, "played");
  assert.equal(spoken.audio.toString(), "pcm");
  assert.equal(closed, false);
  drain();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(closed, true);
});

test("a sentence boundary inserts a pause the model does not provide", async () => {
  const calls = [];
  const spoken = await speakFromConfig("Hello there. Go on.", {
    config,
    model: "kokoro",
    async openPlayback() {
      return { skipped: false, async write() {}, async close() {}, abort() {} };
    },
    async synthesize(request, onChunk) {
      calls.push(request.text);
      await onChunk(Buffer.from([1, 2]));
      return { streamed: true };
    },
    pcmToWav(pcm) {
      return pcm;
    },
  });
  assert.deepEqual(calls, ["Hello there.", "Go on."]);
  const gapBytes = 24_000 * 2 * 300 / 1000;
  assert.equal(spoken.audio.length, 2 + gapBytes + 2);
  assert.equal(spoken.audio[2], 0);
  assert.equal(spoken.audio[2 + gapBytes - 1], 0);
  assert.equal(spoken.bluetooth, "played");
});

test("no headset still returns the answer for the browser", async () => {
  const wav = Buffer.from("RIFF");
  const spoken = await speakFromConfig("Hello there.", {
    config,
    model: "kokoro",
    async openPlayback() {
      return { skipped: true };
    },
    async synthesize() {
      return { streamed: false, audio: wav };
    },
    async playFile() {
      throw new Error("should not play");
    },
  });
  assert.equal(spoken.bluetooth, "skipped");
  assert.equal(spoken.audio, wav);
});

test("recording invalidates synthesis that has not reached the speaker", async () => {
  let stopped = 0;
  const duplex = createDuplexCoordinator(async () => {
    stopped += 1;
  });
  const speech = duplex.beginSpeech();
  assert.equal(speech.active(), true);
  await duplex.interrupt();
  assert.equal(speech.signal.aborted, true);
  assert.equal(speech.active(), false);
  assert.equal(stopped, 1);
});
