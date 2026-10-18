import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { PCM_PLAYER_WORKLET } from "@olares/lares-core/voice/pcm-worklet";

function player(rate: number, outputRate: number) {
  let Processor: any; const events: any[] = [];
  class Base { port = { onmessage: null, postMessage: (e: any) => events.push(e) }; }
  runInNewContext(PCM_PLAYER_WORKLET, { AudioWorkletProcessor: Base, sampleRate: outputRate, registerProcessor: (_: string, cls: any) => { Processor = cls; } });
  const worker = new Processor({ processorOptions: { inputRate: rate } });
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
