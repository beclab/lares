import assert from "node:assert/strict";
import test from "node:test";
import { speakFromConfig } from "@olares/lares-core/voice/service";
import { speakProblemText, speakToggleNotice } from "@olares/lares-core/voice/problem";
import { captureSource } from "@olares/lares-core/voice/input";
import { browserPlays } from "@olares/lares-core/voice/playback";
import {
  createReplySpeaker,
  createSentencePlayer,
  reduceUtterance,
} from "@olares/lares-core/voice/speech";
import { gapAfter, speechSegments } from "@olares/lares-core/voice/script";
import { foldTranscript } from "@olares/lares-core/larepass/transcript";
import { createDuplexCoordinator } from "@olares/lares-core/voice/duplex";
import { synthesizeStream } from "@olares/lares-core/router/tts";

const config = { speak: true, ttsModel: "kokoro", model: "", language: "" };
const noVoices = async () => [];

test("synthesis names the voice it was given", async (t) => {
  const bodies: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return new Response(new Uint8Array([0, 0]), { headers: { "content-type": "audio/L16", "x-audio-sample-rate": "24000" } });
  });
  await synthesizeStream({ text: "你好", model: "qwen3-tts", voice: "serena" }, () => {});
  assert.equal(bodies[0].voice, "serena");
});

test("every sentence uses the saved model voice without hidden selection", async () => {
  const voices: unknown[] = [];
  let listed = 0;
  const options = {
    config: { ...config, ttsVoiceByModel: { "qwen3-tts-pin": "vivian" } },
    model: "qwen3-tts-pin",
    listVoices: async () => {
      listed += 1;
      return ["vivian", "serena"];
    },
    openPlayback: async () => ({ skipped: true }),
    synthesize: async (request: { voice?: string }, onChunk: (chunk: Buffer) => unknown) => {
      voices.push(request.voice);
      await onChunk(Buffer.from("pcm"));
      return { streamed: true };
    },
    pcmToWav: (pcm: Buffer) => pcm,
  };
  await speakFromConfig("First one. Second one.", options);
  await speakFromConfig("Third one.", options);
  assert.deepEqual(voices, ["vivian", "vivian", "vivian"]);
  assert.equal(listed, 0);
});

test("a stream labelled audio/L16 is read as PCM chunks, whatever the case", async (t) => {
  const pcm = new Uint8Array([1, 0, 2, 0]);
  t.mock.method(globalThis, "fetch", async () => new Response(pcm, {
    headers: { "content-type": "audio/L16", "x-audio-sample-rate": "24000" },
  }));
  const chunks: Buffer[] = [];
  const outcome = await synthesizeStream({ text: "你好", model: "qwen3-tts" }, (chunk) => {
    chunks.push(chunk);
  });
  assert.deepEqual(outcome, { streamed: true, sampleRate: 24000 });
  assert.deepEqual([...Buffer.concat(chunks)], [...pcm]);
});

test("turning playback on with no speech model says which problem that is", () => {
  const zh = (key: string) => ({
    "error.voice_tts_unavailable": "没有可用的语音播报模型，请先在语音设置里安装",
    "error.voice_speak_failed": "语音播报失败，请重试",
    "error.voice_speak_timeout": "语音播报超时，请重试",
  }[key] ?? key);
  assert.equal(speakToggleNotice(["kokoro"]), "");
  assert.equal(speakToggleNotice([]), "voice_tts_unavailable");
  assert.equal(speakToggleNotice(undefined), "");
  assert.equal(
    speakProblemText(zh, Object.assign(new Error("no speech model available"), { code: "voice_tts_unavailable" })),
    "没有可用的语音播报模型，请先在语音设置里安装",
  );
  assert.equal(
    speakProblemText(zh, Object.assign(new Error("router down"), { code: "voice_failed" })),
    "语音播报失败，请重试: router down",
  );
  assert.equal(
    speakProblemText(zh, Object.assign(new Error("speech timed out"), { code: "voice_timeout" })),
    "语音播报超时，请重试",
  );
  assert.equal(speakProblemText(zh, new Error("unknown voice setting: speak")), "unknown voice setting: speak");
});

test("the first sentence is handed out before the rest is synthesized", async () => {
  const coordinator = createDuplexCoordinator(async () => {});
  let finishSecond: () => void = () => {};
  const first = await Promise.race([
    speakFromConfig("First one. Second one.", {
      config, model: "kokoro", coordinator, listVoices: noVoices, part: 0,
      openPlayback: async () => ({ skipped: true }),
      synthesize: async (request: { text: string }, onChunk: (chunk: Buffer) => unknown) => {
        if (request.text === "Second one.") await new Promise<void>((resolve) => { finishSecond = resolve; });
        await onChunk(Buffer.from(request.text === "First one." ? "a" : "b"));
        return { streamed: true };
      },
      pcmToWav: (pcm: Buffer) => pcm,
      silencePcm: () => Buffer.from("_"),
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("waited for the whole answer")), 200)),
  ]) as { audio: Buffer };
  assert.equal(first.audio.toString(), "a");
  finishSecond();
});

test("a later sentence joins the readout, even after synthesis ended", async () => {
  const coordinator = createDuplexCoordinator(async () => {});
  let syntheses = 0;
  let opens = 0;
  const options = {
    config, model: "kokoro", coordinator, listVoices: noVoices,
    openPlayback: async () => {
      opens += 1;
      return fakeHeadset([]);
    },
    synthesize: async (request: { text: string }, onChunk: (chunk: Buffer) => unknown) => {
      syntheses += 1;
      await onChunk(Buffer.from(request.text === "First one." ? "a" : "b"));
      return { streamed: true };
    },
    pcmToWav: (pcm: Buffer) => pcm,
    silencePcm: () => Buffer.from("_"),
  };
  const first = await speakFromConfig("First one. Second one.", { ...options, part: 0 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = await speakFromConfig("First one. Second one.", { ...options, part: 1 });
  assert.equal(first.audio.toString(), "a");
  assert.equal(second.audio.toString(), "_b");
  assert.equal(syntheses, 2);
  assert.equal(opens, 1);
});

test("an interrupted readout cancels the sentences not yet handed out", async () => {
  const coordinator = createDuplexCoordinator(async () => {});
  const options = {
    config, model: "kokoro", coordinator, listVoices: noVoices,
    openPlayback: async () => ({ skipped: true }),
    synthesize: (request: { text: string; signal: AbortSignal }, onChunk: (chunk: Buffer) => unknown) => {
      if (request.text === "First one.") return synthOnce(request, onChunk);
      return new Promise((_, reject) => {
        request.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    },
    pcmToWav: (pcm: Buffer) => pcm,
  };
  await speakFromConfig("First one. Second one.", { ...options, part: 0 });
  const second = speakFromConfig("First one. Second one.", { ...options, part: 1 });
  await coordinator.interrupt();
  await assert.rejects(second, (err: { code?: string }) => err.code === "voice_cancelled");
});

test("speaking with no speech model reports that the model is missing", async () => {
  await assert.rejects(
    speakFromConfig("Hello.", { config, model: "" }),
    (err: { code?: string }) => err.code === "voice_tts_unavailable",
  );
});

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

function message(seq: number, step: number, content: unknown[], extra: Record<string, unknown> = {}) {
  return { seq, type: "assistant/message", data: { turn: 1, step, message: { content }, ...extra } };
}

function chunk(seq: number, step: number, value: Record<string, unknown>) {
  return { seq, type: "assistant/chunk", data: { turn: 1, step, chunk: value } };
}

function utteranceOf(events: unknown[]) {
  let state: ReturnType<typeof reduceUtterance> = null;
  for (const event of events) state = reduceUtterance(state, event);
  if (!state) return null;
  const { key, text, done, silent } = state;
  return { key, text, done, silent };
}

const toolCall = { type: "tool-call", callId: "c1", name: "search", arguments: "{}" };

test("the step being written is read while it streams, reasoning left out", () => {
  const events = [
    { seq: 0, type: "turn/start", data: { turn: 1 } },
    chunk(1, 0, { type: "reasoning-delta", index: 0, text: "hmm" }),
    chunk(2, 0, { type: "text-delta", index: 1, text: "First one. " }),
    chunk(3, 0, { type: "text-delta", index: 1, text: "Sec" }),
  ];
  assert.deepEqual(utteranceOf(events), { key: "1:0", text: "First one. Sec", done: false, silent: false });
  const settled = [...events, message(4, 0, [{ type: "reasoning", text: "hmm" }, { type: "text", text: "First one. Second one." }])];
  assert.deepEqual(utteranceOf(settled), { key: "1:0", text: "First one. Second one.", done: true, silent: false });
});

test("a step turns silent the moment it calls a tool, and an interrupted step is silent", () => {
  const streaming = [
    { seq: 0, type: "turn/start", data: { turn: 1 } },
    chunk(1, 0, { type: "text-delta", index: 0, text: "Let me check." }),
  ];
  assert.equal(utteranceOf([...streaming, chunk(2, 0, { type: "tool-call-delta", index: 1, id: "c1", name: "search", argumentsDelta: "" })])?.silent, true);
  assert.equal(utteranceOf([...streaming, message(2, 0, [{ type: "text", text: "Let me check." }, toolCall])])?.silent, true);
  assert.equal(utteranceOf([...streaming, message(2, 0, [{ type: "text", text: "Let me" }], { interrupted: true })])?.silent, true);
  const answered = utteranceOf([
    ...streaming,
    message(2, 0, [{ type: "text", text: "Let me check." }, toolCall]),
    chunk(3, 1, { type: "text-delta", index: 0, text: "Found it." }),
  ]);
  assert.deepEqual(answered, { key: "1:1", text: "Found it.", done: false, silent: false });
});

test("the turn ending completes the utterance and a new turn clears it", () => {
  const events = [
    { seq: 0, type: "turn/start", data: { turn: 1 } },
    chunk(1, 0, { type: "text-delta", index: 0, text: "Half an answer" }),
    { seq: 2, type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } },
  ];
  assert.equal(utteranceOf(events)?.done, true);
  assert.equal(utteranceOf([...events, { seq: 3, type: "turn/start", data: { turn: 2 } }]), null);
});

test("the phone transcript carries the utterance being written", () => {
  const snap = foldTranscript([
    { seq: 0, type: "turn/start", data: { turn: 1 } },
    chunk(1, 0, { type: "text-delta", index: 0, text: "First one. Sec" }),
  ]);
  assert.equal(snap.utterance?.key, "1:0");
  assert.equal(snap.utterance?.text, "First one. Sec");
  assert.equal(snap.utterance?.done, false);
});

test("a sentence still being written is not read yet", () => {
  assert.deepEqual(speechSegments("First one. Sec", { done: false }), ["First one."]);
  assert.deepEqual(speechSegments("First one. Sec"), ["First one.", "Sec"]);
  assert.deepEqual(speechSegments("Look. ```js\nconst a = 1;", { done: false }), ["Look."]);
  assert.deepEqual(speechSegments("Look. ```js\nconst a = 1;\n``` Then go. Next", { done: false }), ["Look.", "Then go."]);
});

test("speech respects structural boundaries and groups short same-level list items", () => {
  const answer = [
    "## 今日安排",
    "",
    "- **上午**：开会",
    "- [x] 下午写代码",
    "1. 先吃饭",
    "",
    "| 项目 | 时间 |",
    "| --- | :---: |",
    "| 跑步 | 30分钟 |",
    "---",
    "> 记得喝水",
    "祝你顺利。明天见",
  ].join("\n");
  assert.deepEqual(speechSegments(answer), [
    "今日安排", "上午：开会；下午写代码；", "先吃饭；", "项目 时间", "跑步 30分钟", "记得喝水 祝你顺利。", "明天见",
  ]);
  assert.deepEqual(speechSegments("## 标题\n- 第一项\n- 第二", { done: false }), ["标题"]);
  assert.deepEqual(speechSegments("## 标题\n- 第一项\n", { done: false }), ["标题"]);
});

test("natural speech keeps medium sentences intact and splits long prose at safe clauses", () => {
  const medium = "城市的秋天是繁华与静谧交织的画卷，银杏大道在行人的足下铺就一条金色的地毯，早晚渐起的凉风卷起了落叶。";
  assert.deepEqual(speechSegments(medium), [medium]);
  const long = medium.repeat(3);
  const parts = speechSegments(long);
  assert.equal(parts.join(""), long);
  assert.ok(parts.length >= 3);
  assert.deepEqual(speechSegments("天气凉了，记得加衣。"), ["天气凉了，记得加衣。"]);
  const english = "We sold 1,000 copies by 10:30 this morning across all of the stores in town, and more came later.";
  assert.deepEqual(speechSegments(english), [english]);
  assert.equal(gapAfter("城市的秋天，"), 150);
  assert.equal(gapAfter("早晚渐起的凉风卷起了落叶。"), 300);
});

function utterance(key: string, text: string, done = false, silent = false) {
  return { key, turn: 1, step: 0, text, done, silent };
}

function speakerRun(snaps: Array<{ sessionChanged?: boolean; running: boolean; utterance: null | ReturnType<typeof utterance> }>) {
  const speaker = createReplySpeaker();
  let running = false;
  return snaps.map((snap) => {
    const follow = speaker.observe({ sessionChanged: Boolean(snap.sessionChanged), wasRunning: running, ...snap });
    running = snap.running;
    return follow?.text ?? "";
  });
}

test("a live turn follows its answer while it is written, through the turn end", () => {
  assert.deepEqual(speakerRun([
    { sessionChanged: true, running: false, utterance: null },
    { running: true, utterance: null },
    { running: true, utterance: utterance("1:0", "First") },
    { running: true, utterance: utterance("1:0", "First one.", true) },
    { running: false, utterance: utterance("1:0", "First one.", true) },
    { running: false, utterance: utterance("1:0", "First one.", true) },
  ]), ["", "", "First", "First one.", "First one.", ""]);
});

test("opening a session never reads an answer it did not watch being written", () => {
  assert.deepEqual(speakerRun([
    { sessionChanged: true, running: true, utterance: utterance("1:0", "Already half") },
    { running: true, utterance: utterance("1:0", "Already half way") },
    { running: true, utterance: utterance("1:1", "Next step") },
  ]), ["", "", "Next step"]);
  assert.deepEqual(speakerRun([
    { sessionChanged: true, running: false, utterance: null },
    { running: false, utterance: utterance("1:0", "history page arrived", true) },
  ]), ["", ""]);
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeReader() {
  const handed: Array<{ text: string; done: boolean }> = [];
  const played: string[] = [];
  const log: string[] = [];
  const reader = createSentencePlayer({
    send: async (request: { text: string; done: boolean; part?: number }) => {
      if (request.part === undefined) {
        handed.push({ text: request.text, done: request.done });
        return { sentences: speechSegments(request.text, { done: request.done }).length };
      }
      return { audio: speechSegments(request.text, { done: request.done })[request.part] };
    },
    play: async (sentence: { audio: unknown }) => { played.push(String(sentence.audio)); },
    halt: () => log.push("halt"),
    silence: () => log.push("silence"),
  });
  return { reader, handed, played, log };
}

test("sentences are read in order while the answer is still being written", async () => {
  const { reader, handed, played } = fakeReader();
  reader.follow(utterance("s:1:0", "First one. Sec"));
  await tick();
  assert.deepEqual(played, ["First one."]);
  reader.follow(utterance("s:1:0", "First one. Second one. Thi"));
  await tick();
  reader.follow(utterance("s:1:0", "First one. Second one. Third.", true));
  for (let i = 0; i < 5; i += 1) await tick();
  assert.deepEqual(played, ["First one.", "Second one.", "Third."]);
  assert.equal(handed.at(-1)?.done, true);
  reader.follow(utterance("s:1:0", "First one. Second one. Third.", true));
  await tick();
  assert.equal(played.length, 3);
});

test("a step that calls a tool stops the reading, the host too, for good", async () => {
  const { reader, played, log } = fakeReader();
  reader.follow(utterance("s:1:0", "Let me check. The"));
  await tick();
  reader.follow(utterance("s:1:0", "Let me check. The", false, true));
  reader.follow(utterance("s:1:0", "Let me check. The", false, true));
  reader.follow(utterance("s:1:0", "Let me check. The rest. More"));
  await tick();
  assert.deepEqual(played, ["Let me check."]);
  assert.deepEqual(log, ["halt", "silence"]);
});

const letters: Record<string, string> = { "First one.": "a", "Second one.": "b", "Third.": "c" };

function streamingOptions(log: string[], extra: Record<string, unknown> = {}) {
  return {
    config,
    model: "kokoro",
    coordinator: createDuplexCoordinator(async () => {}),
    listVoices: noVoices,
    key: "s:1:0",
    openPlayback: async () => fakeHeadset(log),
    synthesize: async (request: { text: string }, onChunk: (chunk: Buffer) => unknown) => {
      await onChunk(Buffer.from(letters[request.text] ?? "?"));
      return { streamed: true };
    },
    pcmToWav: (pcm: Buffer) => pcm,
    silencePcm: () => Buffer.from("_"),
    ...extra,
  };
}

test("a streaming answer reads on in one headset readout as it grows", async () => {
  const log: string[] = [];
  let opens = 0;
  const options = streamingOptions(log, {
    openPlayback: async () => {
      opens += 1;
      return fakeHeadset(log);
    },
  });
  assert.deepEqual(await speakFromConfig("First one. Sec", { ...options, done: false }), { sentences: 1 });
  const first = await speakFromConfig("First one. Sec", { ...options, done: false, part: 0 }) as { audio: Buffer; bluetooth: string };
  assert.deepEqual(await speakFromConfig("First one. Second one. Thi", { ...options, done: false }), { sentences: 2 });
  const second = await speakFromConfig("First one. Second one. Thi", { ...options, done: false, part: 1 }) as { audio: Buffer };
  await speakFromConfig("First one. Second one. Third.", { ...options, done: true });
  const third = await speakFromConfig("First one. Second one. Third.", { ...options, done: true, part: 2 }) as { audio: Buffer };
  assert.deepEqual([first, second, third].map((sentence) => sentence.audio.toString()), ["a", "_b", "_c"]);
  assert.equal(first.bluetooth, "played");
  assert.equal(opens, 1);
  for (let i = 0; i < 5; i += 1) await tick();
  assert.deepEqual(log, ["close"]);
});

test("an interrupted streaming answer stays cancelled for its key", async () => {
  const options = streamingOptions([], { openPlayback: async () => ({ skipped: true }) });
  await speakFromConfig("First one. Sec", { ...options, done: false });
  await options.coordinator.interrupt();
  await assert.rejects(
    speakFromConfig("First one. Second one. Thi", { ...options, done: false }),
    (err: { code?: string }) => err.code === "voice_cancelled",
  );
});

test("a streaming readout lets the headset go once the answer stops arriving", async () => {
  const log: string[] = [];
  const options = streamingOptions(log, { idleMs: 20 });
  await speakFromConfig("First one. Sec", { ...options, done: false });
  await speakFromConfig("First one. Sec", { ...options, done: false, part: 0 });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(log, ["close"]);
});

test("the phone player resolves when a sentence has finished playing", async () => {
  let element: { paused: boolean; onended: null | (() => void) } | undefined;
  class FakeAudio {
    paused = true;
    src = "";
    onended: null | (() => void) = null;
    onerror: null | (() => void) = null;
    constructor() { element = this; }
    async play() { this.paused = false; }
    pause() { this.paused = true; }
  }
  const saved = { Audio: globalThis.Audio, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  Object.assign(globalThis, { Audio: FakeAudio });
  globalThis.URL.createObjectURL = () => "blob:sentence";
  globalThis.URL.revokeObjectURL = () => {};
  try {
    const { createAnswerPlayer } = await import("../../packages/mobile/src/chat/playback.js");
    const player = createAnswerPlayer();
    let done = false;
    const playing = player.play(new Blob(["wav"])).then((played: boolean) => { done = true; return played; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(done, false);
    element!.paused = true;
    element!.onended?.();
    assert.equal(await playing, true);
  } finally {
    Object.assign(globalThis, { Audio: saved.Audio });
    URL.createObjectURL = saved.create;
    URL.revokeObjectURL = saved.revoke;
  }
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
    const playing = player.play(new Blob(["wav"]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(sources.at(-1), "blob:answer");
    player.unlock();
    assert.equal(sources.at(-1), "blob:answer");
    player.stop();
    assert.equal(await playing, false);
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
    config, model: "kokoro", coordinator, listVoices: noVoices,
    openPlayback: async () => fakeHeadset(log),
    synthesize: (request: { signal: AbortSignal }, onChunk: (chunk: Buffer) => unknown) => new Promise((resolve, reject) => {
      void onChunk(Buffer.from("a"));
      request.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      release = () => resolve({ streamed: true, sampleRate: 24000 });
    }),
    pcmToWav: (pcm: Buffer) => pcm,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = await speakFromConfig("Second.", {
    config, model: "kokoro", coordinator, listVoices: noVoices,
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
    config, model: "kokoro", coordinator, listVoices: noVoices,
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
    config, model: "kokoro", coordinator, listVoices: noVoices,
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
    config, model: "kokoro", coordinator, listVoices: noVoices,
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
    config, model: "kokoro", coordinator, listVoices: noVoices,
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
    config, model: "kokoro", listVoices: noVoices,
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
    config, model: "kokoro", listVoices: noVoices,
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
    listVoices: noVoices,
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
      listVoices: noVoices,
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
    listVoices: noVoices,
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
    listVoices: noVoices,
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

test("the desktop page projects the answer being written from live chunks", async () => {
  const { speechDefinition, speechView } = await import("../../packages/web/composer-voice/src/client/speech-view.js");
  const live = (seq: number, step: number, value: Record<string, unknown>) => (
    { seq, type: "assistant/live-chunk", data: { turn: 3, step, chunk: value } }
  );
  const events = [
    { seq: 1, type: "turn/start", data: { turn: 3 } },
    live(2, 0, { type: "text-delta", index: 0, text: "First one. " }),
    live(3, 0, { type: "text-delta", index: 0, text: "Sec" }),
  ];
  assert.deepEqual(events.map((event) => speechDefinition.match(event)?.role), ["start", "update", "update"]);
  let state = speechDefinition.start();
  for (const event of events.slice(1)) state = speechDefinition.update({ state }, { event });
  const node = speechDefinition.buildViewNode({ key: "k", kind: "lares-voice-speech", id: "3", state });
  const view = speechView.create();
  const snapshot = view.apply({ upserts: [node] });
  assert.equal(snapshot.latest.key, "3:0");
  assert.equal(snapshot.latest.text, "First one. Sec");
  assert.equal(snapshot.latest.done, false);
  assert.equal(view.apply({ upserts: [node] }), snapshot);
  state = speechDefinition.update({ state }, { event: live(4, 0, { type: "tool-call-delta", index: 1, id: "c", argumentsDelta: "{" }) });
  const silenced = view.apply({ upserts: [speechDefinition.buildViewNode({ key: "k", kind: "lares-voice-speech", id: "3", state })] });
  assert.equal(silenced.latest.silent, true);
});

test("model default omits the voice and each new readout binds an independent config snapshot", async () => {
  const selected: any = { speak: true, ttsModel: "tts-snapshot", voice: "legacy", ttsVoiceByModel: { "tts-snapshot": "" } };
  const voices: any[] = [];
  let resume: () => void = () => {};
  const pending = new Promise<void>(resolve => { resume = resolve; });
  let calls = 0;
  const options = { config: selected, model: selected.ttsModel, openPlayback: async () => ({ skipped: true }), pcmToWav: (pcm: Buffer) => pcm,
    synthesize: async (request: any, output: any) => { voices.push(request.voice); if (++calls === 1) await pending; await output(Buffer.from("pcm")); return { streamed: true }; } };
  const first = speakFromConfig("First sentence. Second sentence.", options);
  await new Promise(resolve => setImmediate(resolve));
  selected.ttsVoiceByModel["tts-snapshot"] = "next";
  resume(); await first;
  assert.deepEqual(voices, [undefined, undefined]);
  await speakFromConfig("New reply.", options); assert.equal(voices.at(-1), "next");
});
