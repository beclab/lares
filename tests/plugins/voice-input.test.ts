import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyFailure, pickSttModelId, retryable } from "@lares/core/router/stt";

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

test("resolved STT cache is keyed by the configured preference", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          { id: "whisper-a", mode: "audio" },
          { id: "whisper-b", mode: "audio" },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  try {
    const { forgetSttModel, resolveSttModel } = await import(
      `../../packages/core/router/stt.js?cache=${Date.now()}`
    );
    forgetSttModel();
    assert.equal(await resolveSttModel("whisper-a"), "whisper-a");
    assert.equal(await resolveSttModel("whisper-b"), "whisper-b");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("readConfig / writeConfig round-trip through DSH_HOME", async () => {
  const home = mkdtempSync(join(tmpdir(), "lares-voice-"));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { readConfig, validateConfigPatch, writeConfig } = await import(
      `../../packages/core/voice/config.js?cfg=${Date.now()}`
    );
    assert.deepEqual(readConfig(), { model: "", language: "" });
    const saved = writeConfig({ model: "  whisper-x  ", language: "zh" });
    assert.equal(saved.model, "whisper-x");
    assert.equal(saved.language, "zh");
    assert.equal(readConfig().model, "whisper-x");
    for (const patch of [
      { ignored: "value" },
      { language: "zh\r\nX-Injected: yes" },
      { language: "fr" },
      { model: "whisper\r\nX-Injected: yes" },
      { model: 42 },
      [],
      null,
    ]) {
      assert.throws(
        () => validateConfigPatch(patch),
        (err: { code?: string; status?: number }) =>
          err.code === "voice_config_invalid" && err.status === 400,
      );
    }
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
});
