import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyFailure, pickSttModelId, retryable } from "@lares/core/router/stt";
import { postTranscribe, TranscriptQueue } from "@lares/core/voice/client";
import { isComposerVoiceReady, isRecordingTooShort } from "@lares/core/voice/recorder";
import {
  EMPTY_VOICE_CONFIG,
  STT_LANGUAGE_CHOICES,
  voiceLanguageItems,
  voiceMenuValue,
  voiceModelItems,
  voiceStatusReady,
  voiceValueFromMenu,
} from "@lares/core/voice/languages";

test("a take is too short when it is only a container header", () => {
  assert.equal(isRecordingTooShort(699, 2048), true);
  assert.equal(isRecordingTooShort(800, 1023), true);
  assert.equal(isRecordingTooShort(800, 1024), false);
});

test("voice settings map the auto sentinel to an empty stored value", () => {
  assert.equal(voiceMenuValue(""), "auto");
  assert.equal(voiceValueFromMenu("auto"), "");
  assert.equal(voiceValueFromMenu("zh"), "zh");
  assert.deepEqual(STT_LANGUAGE_CHOICES.map((item) => item.id), ["zh", "en", "ja", "ko"]);
  assert.deepEqual(EMPTY_VOICE_CONFIG, { model: "", language: "" });
  assert.equal(voiceLanguageItems("Auto")[0].label, "Auto");
  assert.deepEqual(voiceModelItems(["whisper-a"], "Auto"), [
    { id: "auto", label: "Auto" },
    { id: "whisper-a", label: "whisper-a" },
  ]);
  assert.equal(voiceStatusReady({ modelAvailable: true }), true);
  assert.equal(voiceStatusReady(null), false);
});

test("postTranscribe posts the blob to the Host voice URL", async () => {
  const original = globalThis.fetch;
  const calls: { url: string; type: string }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), type: String((init?.headers as Record<string, string>)?.["content-type"] ?? "") });
    return new Response(JSON.stringify({ text: "你好" }), { status: 200 });
  }) as typeof fetch;
  try {
    const blob = new Blob(["xxxx"], { type: "audio/webm" });
    assert.equal(
      await postTranscribe(blob, "zh", undefined, { baseUrl: "/laresHost/api/lares/voice" }),
      "你好",
    );
    assert.deepEqual(calls, [{ url: "/laresHost/api/lares/voice/transcribe?language=zh", type: "audio/webm" }]);
  } finally {
    globalThis.fetch = original;
  }
});

test("transcript queue waits until the composer is writable", () => {
  const drafts: string[] = [];
  const queue = new TranscriptQueue();
  queue.apply("hello", false, "", (next: string) => drafts.push(next));
  assert.deepEqual(drafts, []);
  queue.flush(true, "hi", (next: string) => drafts.push(next));
  assert.deepEqual(drafts, ["hi hello"]);
});

test("voice input only writes the draft while the composer is plain", () => {
  assert.equal(isComposerVoiceReady("plain", () => {}), true);
  assert.equal(isComposerVoiceReady("streaming", () => {}), false);
});

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

test("listModels reuses a live catalog until refresh", async () => {
  let fetches = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetches += 1;
    return new Response(JSON.stringify({ data: [{ id: "whisper-a", mode: "audio" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const { forgetSttModel, listModels } = await import(
      `../../packages/core/router/stt.js?catalog=${Date.now()}`
    );
    forgetSttModel();
    await Promise.all([listModels(), listModels()]);
    assert.equal(fetches, 1);
    await listModels();
    assert.equal(fetches, 1);
    await listModels({ refresh: true });
    assert.equal(fetches, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
