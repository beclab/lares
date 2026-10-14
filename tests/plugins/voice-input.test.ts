import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VoiceError, classifyFailure, isSttModel, isTtsModel, pickSttModelId, retryable } from "@olares/lares-core/router/stt";
import { reduceSpeechEvent } from "@olares/lares-core/voice/speech";
import { speechScript } from "@olares/lares-core/voice/script";
import { postTranscribe } from "@olares/lares-core/voice/client";
import { frameHasAudio, isRecordingTooShort, openRecordingStream, pickInputDevice } from "@olares/lares-core/voice/recorder";
import {
  EMPTY_VOICE_CONFIG,
  STT_LANGUAGE_CHOICES,
  voiceLanguageItems,
  voiceMenuValue,
  voiceModelItems,
  voiceStatusReady,
  voiceValueFromMenu,
} from "@olares/lares-core/voice/languages";

test("a take is too short when it is only a container header", () => {
  assert.equal(isRecordingTooShort(699, 2048), true);
  assert.equal(isRecordingTooShort(800, 1023), true);
  assert.equal(isRecordingTooShort(800, 1024), false);
});

test("recording opens the headset Chrome lists, not the silent Default input", async () => {
  const devices = [
    { kind: "audioinput", deviceId: "default", label: "Default" },
    { kind: "audioinput", deviceId: "dolphin", label: "Dolphin520" },
    { kind: "audiooutput", deviceId: "out", label: "Dolphin520" },
  ];
  assert.equal(pickInputDevice(devices, "Dolphin520"), "dolphin");
  assert.equal(pickInputDevice(devices, ""), "");
  assert.equal(pickInputDevice(devices, "Missing"), "");

  const calls: { audio: Record<string, unknown> }[] = [];
  const media = {
    async enumerateDevices() {
      return devices;
    },
    async getUserMedia(constraints: { audio: Record<string, unknown> }) {
      calls.push(constraints);
      return { getTracks: () => [] };
    },
  };
  await openRecordingStream({ label: "Dolphin520" }, media as never);
  await openRecordingStream({}, media as never);
  assert.equal(calls[0].audio.deviceId && (calls[0].audio.deviceId as { exact: string }).exact, "dolphin");
  assert.equal("deviceId" in calls[1].audio, false);
});

test("the headset link is audible only after the opening silence ends", () => {
  assert.equal(frameHasAudio(new Float32Array(4096)), false);
  const live = new Float32Array(8);
  live[3] = 0.001;
  assert.equal(frameHasAudio(live), true);
});

test("voice settings map the auto sentinel to an empty stored value", () => {
  assert.equal(voiceMenuValue(""), "auto");
  assert.equal(voiceValueFromMenu("auto"), "");
  assert.equal(voiceValueFromMenu("zh"), "zh");
  assert.deepEqual(STT_LANGUAGE_CHOICES.map((item) => item.id), ["zh", "en", "ja", "ko"]);
  assert.deepEqual(EMPTY_VOICE_CONFIG, { model: "", ttsModel: "", language: "", speak: false });
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

test("speech playback keeps only the text that survives the last tool call", () => {
  let state = { pending: "", text: "" };
  const steps = [
    { type: "turn/start", data: { turn: 1 } },
    { type: "assistant/message", data: { turn: 1, message: { content: [{ type: "reasoning", text: "thinking" }, { type: "text", text: "I will look that up." }] } } },
    { type: "tool/call", data: { turn: 1, name: "search" } },
    { type: "assistant/message", data: { turn: 1, message: { content: [{ type: "text", text: "The answer is ready." }] } } },
    { type: "turn/end", data: { turn: 1 } },
  ];
  for (const event of steps) state = reduceSpeechEvent(state, event);
  assert.equal(state.text, "The answer is ready.");
  assert.equal(speechScript("See `docs` and ```\ncode\n``` please."), "See docs and please.");
});

test("speech script keeps abbreviations and decimals inside the sentence", () => {
  assert.equal(
    speechScript("Pi is 3.14. **Done!** Next?\nYes"),
    "Pi is 3.14.\nDone!\nNext?\nYes",
  );
  assert.equal(
    speechScript("Mr. Smith left the U.S. He went home."),
    "Mr. Smith left the U.S.\nHe went home.",
  );
  assert.equal(speechScript("See e.g. this. It works."), "See e.g. this.\nIt works.");
});

test("recognition includes flagged models whose names are not whisper-like", () => {
  assert.equal(isSttModel({ id: "parakeet/nvidia/parakeet-unified-en-0.6b", mode: "audio", supportsStt: true }), true);
  assert.equal(isTtsModel({ id: "kokoro/hexgrad/Kokoro-82M", mode: "tts", supportsTts: true }), true);
  assert.equal(isTtsModel({ id: "parakeet/nvidia/parakeet-unified-en-0.6b", mode: "audio", supportsStt: true }), false);
});

test("install requests the catalog chart for that kind", async () => {
  const { installVoiceChart } = await import(`../../packages/core/voice/install.js?install=${Date.now()}`);
  const calls: string[][] = [];
  const spawnFn = ((_cmd: string, args: string[]) => {
    calls.push(args);
    return {
      stdout: { on(_event: string, listener: (chunk: string) => void) { listener('{"status":"accepted"}'); } },
      stderr: { on() {} },
      on(event: string, listener: (code?: number) => void) {
        if (event === "close") listener(0);
      },
    };
  }) as unknown as typeof import("node:child_process").spawn;
  const installed = await installVoiceChart("tts", { spawnFn });
  assert.equal(installed.app, "audioqwen3tts06v3");
  assert.deepEqual(calls[0], [
    "market", "install", "audioqwen3tts06v3", "-s", "market.test", "--version", "1.0.0", "--compute-mode", "nvidia", "-o", "json",
  ]);
});

test("chart phase follows the market row", async () => {
  const { chartPhase, chartModelId, stopVoiceChart } = await import(
    `../../packages/core/voice/install.js?phase=${Date.now()}`
  );
  assert.equal(chartPhase(null), "absent");
  assert.equal(chartPhase({ status: "failed", message: "not installed" }), "absent");
  assert.equal(chartPhase({ state: "downloading" }), "busy");
  assert.equal(chartPhase({ state: "running" }), "running");
  assert.equal(chartPhase({ state: "stopped" }), "stopped");
  assert.equal(chartModelId("stt", ["parakeet/x", "audioqwen3asr06v3/Qwen/Qwen3-ASR-0.6B"]), "audioqwen3asr06v3/Qwen/Qwen3-ASR-0.6B");

  const calls: string[][] = [];
  const spawnFn = ((_cmd: string, args: string[]) => {
    calls.push(args);
    const body = args[1] === "status" ? '{"state":"stopped"}' : '{"status":"success","finalState":"stopped"}';
    return {
      stdout: { on(_event: string, listener: (chunk: string) => void) { listener(body); } },
      stderr: { on() {} },
      on(event: string, listener: (code?: number) => void) {
        if (event === "close") listener(0);
      },
    };
  }) as unknown as typeof import("node:child_process").spawn;
  const stopped = await stopVoiceChart("stt", { spawnFn });
  assert.equal(stopped.phase, "stopped");
  assert.deepEqual(calls[0]?.slice(0, 3), ["market", "stop", "audioqwen3asr06v3"]);
  assert.ok(calls[0]?.includes("--watch"));
});

test("probe treats an engine answer as connected and a stopped chart as not", async () => {
  const { probeVoice } = await import(`../../packages/core/voice/service.js?probe=${Date.now()}`);
  const reached = await probeVoice("stt", {
    status: async () => ({ app: "audioqwen3asr06v3", phase: "running" }),
    listModels: async () => [{ id: "audioqwen3asr06v3/Qwen/Qwen3-ASR-0.6B", supportsStt: true }],
    transcribe: async () => {
      throw new VoiceError("voice_audio_unreadable", 400, "no speech");
    },
  });
  assert.equal(reached.ok, true);
  await assert.rejects(
    () => probeVoice("tts", {
      status: async () => ({ app: "audioqwen3tts06v3", phase: "stopped" }),
    }),
    (err) => err instanceof VoiceError && err.code === "voice_probe_failed",
  );
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
  const { catalogCache } = await import("../../packages/core/router/catalog-cache.js");
  catalogCache.reset();
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
    catalogCache.reset();
  }
});

test("resolved STT cache is keyed by the configured preference", async () => {
  const originalFetch = globalThis.fetch;
  const { catalogCache } = await import("../../packages/core/router/catalog-cache.js");
  catalogCache.reset();
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
    catalogCache.reset();
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
    assert.deepEqual(readConfig(), { model: "", ttsModel: "", language: "", speak: false });
    const saved = writeConfig({ model: "  whisper-x  ", language: "zh" });
    assert.equal(saved.model, "whisper-x");
    assert.equal(saved.language, "zh");
    assert.equal(writeConfig({ speak: true, ttsModel: "kokoro/hexgrad/Kokoro-82M" }).speak, true);
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
