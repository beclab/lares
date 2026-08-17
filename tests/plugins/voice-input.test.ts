import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyFailure, pickSttModelId, retryable } from "../../packages/plugins/voice-input/host/stt.js";
import { pickSttApp } from "../../packages/plugins/voice-input/host/model-app.js";

test("pickSttModelId honors a listed preference, else the first whisper/stt row", () => {
  const catalog = [
    "Qwen3.6-27B (llama.cpp)/x",
    "Whisper Large V3 (FW) X3/openai/whisper-large-v3",
    "EmbeddingGemma/embeddinggemma-300m",
  ];
  assert.equal(pickSttModelId(catalog), catalog[1]);
  assert.equal(pickSttModelId(catalog, "Qwen3.6-27B (llama.cpp)/x"), "Qwen3.6-27B (llama.cpp)/x");
  assert.equal(pickSttModelId(catalog, "missing"), catalog[1]);
  assert.equal(pickSttModelId(["Qwen/chat"]), null);
});

test("classifyFailure separates undecodable audio from transient upstream", () => {
  assert.equal(classifyFailure(422, "unknown file extension"), "voice_audio_unreadable");
  assert.equal(classifyFailure(500, "moov atom not found"), "voice_audio_unreadable");
  assert.equal(classifyFailure(404, "no such model"), "voice_model_unavailable");
  assert.equal(classifyFailure(503, "backend restarting"), "voice_failed");
});

test("retryable covers cold-start / restart statuses only", () => {
  for (const status of [429, 500, 502, 503, 504]) assert.equal(retryable(status), true);
  for (const status of [400, 401, 404, 422]) assert.equal(retryable(status), false);
});

test("pickSttApp takes a transcribing catalog row and skips the audio siblings", () => {
  const items = [
    { app_name: "audioqwen3ttsv3", title: "Qwen3-TTS 1.7B", description: "preset-voice text to speech." },
    { app_name: "audiosilerovadv3", title: "Silero VAD V5", description: "Silero VAD v5 for voice activity detection." },
    { app_name: "audiofwwhisperx3v3", title: "Whisper Large V3 (FW) X3", description: "whisper-large-v3 for offline STT." },
  ];
  assert.deepEqual(pickSttApp(items), { app: "audiofwwhisperx3v3", title: "Whisper Large V3 (FW) X3" });
  assert.equal(pickSttApp([items[0], items[1]]), null);
  assert.equal(pickSttApp([]), null);
  assert.equal(pickSttApp(undefined as never), null);
});

test("readConfig / writeConfig round-trip through DSH_HOME", async () => {
  const home = mkdtempSync(join(tmpdir(), "dina-voice-"));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { readConfig, writeConfig } = await import(`../../packages/plugins/voice-input/host/config.js?cfg=${Date.now()}`);
    assert.deepEqual(readConfig(), { model: "", language: "" });
    const saved = writeConfig({ model: "  whisper-x  ", language: "zh", ignored: 5 });
    assert.equal(saved.model, "whisper-x");
    assert.equal(saved.language, "zh");
    assert.equal(readConfig().model, "whisper-x");
    assert.equal(Object.hasOwn(readConfig(), "ignored"), false);
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
});
