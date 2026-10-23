import assert from "node:assert/strict";
import test from "node:test";
import { createSpeechEndpoint, frameRms } from "@olares/lares-core/voice/endpoint";

const FRAME = 32;

function feed(endpoint, frames) {
  for (let i = 0; i < frames.length; i += 1) {
    if (endpoint.push(frames[i][0], frames[i][1], FRAME)) return i;
  }
  return -1;
}

const repeat = (count, prob, rms) => Array.from({ length: count }, () => [prob, rms]);

test("a take ends half a second after the speaker goes quiet", () => {
  const frames = [...repeat(40, 0.95, 0.2), ...repeat(40, 0.01, 0)];
  assert.equal(feed(createSpeechEndpoint(), frames), 40 + Math.ceil(500 / FRAME) - 1);
});

test("farther voices in the room do not hold the take open", () => {
  const frames = [...repeat(40, 0.95, 0.2), ...repeat(40, 0.95, 0.03)];
  const at = feed(createSpeechEndpoint(), frames);
  const quiet = 40 + Math.ceil(500 / FRAME) - 1;
  // The loudness average still carries the speaker for a few frames.
  assert.ok(at >= quiet && at <= quiet + 5, `ended at frame ${at}`);
});

test("the speaker pausing briefly keeps the take open", () => {
  const frames = [...repeat(40, 0.95, 0.2), ...repeat(8, 0.01, 0), ...repeat(40, 0.9, 0.15), ...repeat(8, 0.01, 0)];
  assert.equal(feed(createSpeechEndpoint(), frames), -1);
});

test("nothing ends before the speaker has said anything", () => {
  assert.equal(feed(createSpeechEndpoint(), repeat(300, 0.01, 0)), -1);
});

test("frame loudness is root mean square", () => {
  assert.equal(frameRms(Float32Array.from([0.5, -0.5, 0.5, -0.5])), 0.5);
  assert.equal(frameRms(new Float32Array(0)), 0);
});

function fakeAudio() {
  let processor: any = null;
  class AudioContext {
    sampleRate = 16000;
    destination = {};
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { processor = { connect() {}, disconnect() {}, onaudioprocess: null }; return processor; }
    createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; }
    async resume() {}
    async close() {}
  }
  return {
    AudioContext,
    feed(level: number) {
      const samples = new Float32Array(2048);
      for (let i = 0; i < samples.length; i += 1) samples[i] = i % 2 ? -level : level;
      processor.onaudioprocess({ inputBuffer: { getChannelData: () => samples } });
    },
  };
}

test("a noisy room does not count as speech, and quiet speech still ends the take", async () => {
  const { createEnergyEndpoint } = await import("@olares/lares-core/voice/device-input");
  const audio = fakeAudio();
  (globalThis as any).AudioContext = audio.AudioContext;
  let ended = 0, spoke = 0;
  const endpoint = createEnergyEndpoint({}, (heard: boolean) => { if (heard) ended += 1; }, () => { spoke += 1; }, () => {}, { silenceMs: 500 });
  // 1% full-scale room noise: above the old fixed floor, below the estimated room floor.
  for (let i = 0; i < 20; i += 1) audio.feed(0.01);
  assert.equal(spoke, 0);
  for (let i = 0; i < 5; i += 1) audio.feed(0.08);
  assert.equal(spoke, 1);
  for (let i = 0; i < 8; i += 1) audio.feed(0.01);
  assert.equal(ended, 1);
  endpoint.stop();
});
