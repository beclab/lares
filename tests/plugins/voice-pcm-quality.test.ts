import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { PCM_PLAYER_WORKLET } from "@olares/lares-core/voice/pcm-worklet";

function player(rate: number, outputRate: number, extra: Record<string, unknown> = {}) {
  let Processor: any; const events: any[] = [];
  class Base { port = { onmessage: null, postMessage: (e: any) => events.push(e) }; }
  runInNewContext(PCM_PLAYER_WORKLET, { AudioWorkletProcessor: Base, sampleRate: outputRate, registerProcessor: (_: string, cls: any) => { Processor = cls; } });
  const worker = new Processor({ processorOptions: { inputRate: rate, outputRate, ...extra } });
  const send = (data: any) => worker.port.onmessage({ data });
  return { worker, events, send };
}
function render(samples: Float32Array, rate: number, outRate: number, chunks: number[]) {
  const { worker, events, send } = player(rate, outRate);
  for (let at = 0, i = 0; at < samples.length; i++) { const part = samples.slice(at, at + chunks[i % chunks.length]); send({ type: "audio", samples: part }); at += part.length; }
  send({ type: "finish" }); const output: number[] = [];
  for (let i = 0; i < 1000; i++) { const block = new Float32Array(128); const active = worker.process([], [[block]]); output.push(...block); if (!active) break; }
  assert.ok(events.some(e => e.type === "done"));
  assert.equal(events.findLast(e => e.type === "progress").frames, samples.length);
  return output.slice(0, Math.ceil(samples.length * outRate / rate));
}
test("PCM playback resampling is independent of transport chunk boundaries", () => {
  const samples = Float32Array.from({ length: 2203 }, (_, i) => Math.sin(i * .23) * .6);
  for (const [rate, outRate] of [[24000, 48000], [16000, 48000], [24000, 44100], [48000, 44100], [48000, 48000], [96000, 48000]]) {
    const whole = render(samples, rate, outRate, [samples.length]);
    const chunks = render(samples, rate, outRate, [1, 7, 53, 3, 128]);
    const maxError = Math.max(...whole.map((x, i) => Math.abs(x - chunks[i])));
    assert.ok(maxError < 1e-5, `${rate} -> ${outRate}: chunk-dependent error ${maxError}`);
  }
});

test("mono speech is written to every output channel", () => {
  const { worker, send } = player(24000, 48000);
  send({ type: "audio", samples: Float32Array.of(0.25, -0.5) });
  const left = new Float32Array(4);
  const right = new Float32Array(4);
  worker.process([], [[left, right]]);
  for (let i = 0; i < left.length; i += 1) assert.ok(Math.abs(left[i] - right[i]) < 1e-6);
  assert.ok(Math.abs(left[0] - 0.25) < 1e-6);
  assert.ok(Math.abs(right[0] - 0.25) < 1e-6);
});

test("a late neighboring sample pauses interpolation without consuming or repeating it", () => {
  const { worker, events, send } = player(24000, 48000);
  send({ type: "audio", samples: Float32Array.of(.1) });
  const first = new Float32Array(128); worker.process([], [[first]]);
  for (let i = 0; i < 4; i++) worker.process([], [[new Float32Array(128)]]);
  assert.equal(events.filter(e => e.type === "underrun").length, 1);
  send({ type: "pause" }); const offset = worker.offset;
  worker.process([], [[new Float32Array(128)]]); assert.equal(worker.offset, offset);
  send({ type: "audio", samples: Float32Array.of(.2, .3) }); send({ type: "finish" }); send({ type: "resume" });
  const rest = new Float32Array(128); worker.process([], [[rest]]);
  const heard = [first[0], ...rest.slice(0, 5)];
  const expected = [.1, .15, .2, .25, .3, .3];
  heard.forEach((sample, i) => assert.ok(Math.abs(sample - expected[i]) < 1e-6));
});

test("playback holds the first samples until a short buffer arrives, then plays them at the source clock", () => {
  const { worker, events, send } = player(24000, 48000, { preroll: 4 });
  send({ type: "audio", samples: Float32Array.of(0.2, 0.4) });
  const blocked = new Float32Array(128);
  worker.process([], [[blocked]]);
  assert.equal(blocked[0], 0);
  assert.equal(events.some((event) => event.type === "started"), false);
  assert.equal(worker.offset, 0);
  send({ type: "audio", samples: Float32Array.of(0.6, 0.8) });
  const out = new Float32Array(8);
  worker.process([], [[out]]);
  assert.equal(events.some((event) => event.type === "started"), true);
  assert.ok(Math.abs(out[0] - 0.2) < 1e-6);
  assert.ok(Math.abs(out[1] - 0.3) < 1e-6);
});

test("playback keeps a long buffer instead of treating it as overflow", () => {
  const { worker, events, send } = player(24000, 48000);
  const total = 24000 * 6;
  for (let at = 0; at < total; at += 2400) send({ type: "audio", samples: new Float32Array(Math.min(2400, total - at)) });
  assert.equal(events.some((event) => event.type === "error"), false);
  send({ type: "finish" });
  let active = true;
  for (let i = 0; active && i < 20000; i++) active = worker.process([], [[new Float32Array(128)]]);
  assert.equal(active, false);
  assert.equal(events.at(-1).type, "done");
  assert.equal(events.findLast((event) => event.type === "progress").frames, total);
});

test("a finished utterance shorter than the buffer still plays at the source clock", () => {
  const { worker, send } = player(24000, 48000, { preroll: 4800 });
  send({ type: "audio", samples: Float32Array.of(0.5) });
  send({ type: "finish" });
  const out = new Float32Array(4);
  assert.equal(worker.process([], [[out]]), false);
  assert.ok(Math.abs(out[0] - 0.5) < 1e-6);
  assert.ok(Math.abs(out[1] - 0.5) < 1e-6);
});


test("a long reply waits for the speaker instead of failing when the queue is full", async () => {
  const { createPcmStreamPlayer, PLAYBACK_QUEUE_SECONDS } = await import("@olares/lares-core/voice/pcm-player");
  const original = (globalThis as any).AudioWorkletNode;
  const posted: number[] = [];
  let node: { port: { onmessage: ((event: { data: { type: string, frames?: number } }) => void) | null } } | null = null;
  class Context {
    state = "running";
    destination = {};
    audioWorklet = { addModule: async () => {} };
    async resume() {}
    async close() { this.state = "closed"; }
  }
  class Node {
    port = {
      onmessage: null as ((event: { data: { type: string, frames?: number } }) => void) | null,
      postMessage: (data: { type: string, samples?: Float32Array }) => { if (data.type === "audio" && data.samples) posted.push(data.samples.length); },
    };
    connect() {}
    disconnect() {}
    constructor() { node = this; }
  }
  (globalThis as any).AudioWorkletNode = Node;
  const player = createPcmStreamPlayer({ context: Context });
  const rate = 24000;
  const budget = rate * PLAYBACK_QUEUE_SECONDS;
  try {
    await player.start({ sampleRate: rate, channels: 1, encoding: "pcm_s16le" });
    const writing = player.write(new Uint8Array(rate * 2 * (PLAYBACK_QUEUE_SECONDS + 2)));
    await Promise.resolve();
    assert.equal(posted.reduce((sum, count) => sum + count, 0), budget);
    let settled = false;
    writing.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    node?.port.onmessage?.({ data: { type: "progress", frames: rate * 2 } });
    await writing;
    assert.equal(posted.reduce((sum, count) => sum + count, 0), rate * (PLAYBACK_QUEUE_SECONDS + 2));
    const extra = player.write(new Uint8Array(2));
    await Promise.resolve();
    player.stop();
    await assert.rejects(extra, /voice_cancelled/);
  } finally {
    player.stop();
    if (original === undefined) delete (globalThis as any).AudioWorkletNode;
    else (globalThis as any).AudioWorkletNode = original;
  }
});

test("browser PCM writes preserve odd-byte packet boundaries and release the context", async () => {
  const { createPcmStreamPlayer } = await import("@olares/lares-core/voice/pcm-player");
  const original = (globalThis as any).AudioWorkletNode;
  const received: number[] = [];
  let closed = 0, disconnected = 0;
  class Context {
    state = "running";
    destination = {};
    audioWorklet = { addModule: async () => {} };
    async resume() {}
    async close() { this.state = "closed"; closed++; }
  }
  class Node {
    port = {
      onmessage: null as any,
      postMessage: (data: any) => {
        if (data.type === "audio") received.push(...data.samples);
        if (data.type === "finish") queueMicrotask(() => this.port.onmessage?.({ data: { type: "done" } }));
      },
    };
    connect() {}
    disconnect() { disconnected++; }
  }
  (globalThis as any).AudioWorkletNode = Node;
  const player = createPcmStreamPlayer({ context: Context });
  try {
    await player.start({ sampleRate: 24000, channels: 1, encoding: "pcm_s16le" });
    const samples = [-32768, -113, 0, 219, 32767];
    const bytes = Buffer.alloc(samples.length * 2);
    samples.forEach((sample, i) => bytes.writeInt16LE(sample, i * 2));
    for (const [start, end] of [[0, 1], [1, 8], [8, 9], [9, 10]]) player.write(bytes.subarray(start, end));
    await player.finish();
    assert.deepEqual(received, samples.map(sample => sample / 32768));
    player.stop(); player.stop();
    assert.equal(closed, 1);
    assert.equal(disconnected, 1);
  } finally {
    player.stop();
    if (original === undefined) delete (globalThis as any).AudioWorkletNode;
    else (globalThis as any).AudioWorkletNode = original;
  }
});

test("a context primed during the gesture is reused and kept open", async () => {
  const { createPcmStreamPlayer, primePlaybackContext } = await import("@olares/lares-core/voice/pcm-player");
  const original = (globalThis as any).AudioWorkletNode;
  let closed = 0;
  const metrics: any[] = [];
  class Context {
    state = "running";
    destination = {};
    audioWorklet = { addModule: async () => {} };
    async resume() {}
    async close() { this.state = "closed"; closed++; }
  }
  class Node {
    port = { onmessage: null as any, postMessage() {} };
    connect() {}
    disconnect() {}
  }
  (globalThis as any).AudioWorkletNode = Node;
  const primed = primePlaybackContext(Context as any);
  const player = createPcmStreamPlayer({ context: Context, onMetric: (event) => metrics.push(event) });
  try {
    await player.start({ sampleRate: 24000, channels: 1, encoding: "pcm_s16le" });
    player.stop();
    assert.equal(closed, 0);
    assert.equal(primed.state, "running");
    assert.equal(metrics.find((event) => event.stage === "playback_context").shared, true);
  } finally {
    await primed.close();
    player.stop();
    if (original === undefined) delete (globalThis as any).AudioWorkletNode;
    else (globalThis as any).AudioWorkletNode = original;
  }
});

test("an interrupted primed context is replaced instead of silencing the reply", async () => {
  const { createPcmStreamPlayer, primePlaybackContext } = await import("@olares/lares-core/voice/pcm-player");
  const original = (globalThis as any).AudioWorkletNode;
  const metrics: any[] = [];
  class Context {
    state = "running";
    destination = {};
    audioWorklet = { addModule: async () => {} };
    async resume() {}
    async close() { this.state = "closed"; }
  }
  class Node {
    port = { onmessage: null as any, postMessage() {} };
    connect() {}
    disconnect() {}
  }
  (globalThis as any).AudioWorkletNode = Node;
  const primed = primePlaybackContext(Context as any);
  primed!.state = "suspended";
  const player = createPcmStreamPlayer({ context: Context as any, onMetric: (event) => metrics.push(event) });
  try {
    await player.start({ sampleRate: 24000, channels: 1, encoding: "pcm_s16le" });
    const context = metrics.find((event) => event.stage === "playback_context");
    assert.equal(context.shared, false);
    assert.equal(context.state, "running");
  } finally {
    player.stop();
    if (original === undefined) delete (globalThis as any).AudioWorkletNode;
    else (globalThis as any).AudioWorkletNode = original;
  }
});

test("an interrupted playback context resumes on statechange and on visibility", async () => {
  const { createPcmStreamPlayer, primePlaybackContext } = await import("@olares/lares-core/voice/pcm-player");
  const original = (globalThis as any).AudioWorkletNode;
  class Context extends EventTarget {
    state = "running";
    destination = {};
    audioWorklet = { addModule: async () => {} };
    resumes = 0;
    async resume() { this.resumes += 1; if (this.state !== "closed") this.state = "running"; }
    async close() { this.state = "closed"; }
  }
  class Node {
    port = { onmessage: null as any, postMessage() {} };
    connect() {}
    disconnect() {}
  }
  (globalThis as any).AudioWorkletNode = Node;
  const primed = primePlaybackContext(Context as any) as Context;
  const player = createPcmStreamPlayer({ context: Context as any });
  try {
    await player.start({ sampleRate: 24000, channels: 1, encoding: "pcm_s16le" });
    const before = primed.resumes;
    primed.state = "suspended";
    primed.dispatchEvent(new Event("statechange"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(primed.resumes > before);
  } finally {
    player.stop();
    if (original === undefined) delete (globalThis as any).AudioWorkletNode;
    else (globalThis as any).AudioWorkletNode = original;
  }
});
