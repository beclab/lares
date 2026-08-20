import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyFailure, pickSttModelId, retryable } from "../../packages/plugins/voice-input/host/stt.js";

test("pickSttModelId honors a listed preference, else the first whisper/stt row", () => {
  const catalog = [
    { id: "Qwen3.6-27B (llama.cpp)/x", mode: "chat" },
    { id: "Olares/mispeech/Dasheng-AudioGen", mode: "audio" },
    { id: "Whisper Large V3 (FW) X3/openai/whisper-large-v3", mode: "audio" },
    { id: "EmbeddingGemma/embeddinggemma-300m", mode: "embedding" },
  ];
  assert.equal(pickSttModelId(catalog), catalog[2].id);
  assert.equal(pickSttModelId(catalog, catalog[2].id), catalog[2].id);
  assert.equal(pickSttModelId(catalog, catalog[0].id), catalog[2].id);
  assert.equal(pickSttModelId([{ id: "Qwen/chat", mode: "chat" }]), null);
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
