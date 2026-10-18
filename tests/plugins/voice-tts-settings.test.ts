import assert from "node:assert/strict";
import test from "node:test";
import { createVoicePreferences } from "@olares/lares-core/voice/preferences";
import { createTtsSettings, TTS_PREVIEW_TEXT, ttsSettingsModel } from "@olares/lares-core/voice/tts-settings";
import { fetchTtsVoices, ttsVoiceForModel } from "@olares/lares-core/voice/tts-voice";
import { previewTts } from "@olares/lares-core/voice/tts-preview";
import { validateConfigPatch } from "@olares/lares-core/voice/config";
import { setVoiceActivity, voiceActivity } from "@olares/lares-core/voice/activity";
import { VOICE_DEFAULTS } from "@olares/lares-core/voice/options";

const deferred = () => { let resolve: any; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; };
async function harness(overrides: any = {}) {
  let value: any = { config: { ...structuredClone(VOICE_DEFAULTS), ttsModel: "tts-a" }, ttsModels: ["tts-a", "tts-b"], ttsDefault: "tts-a" };
  let fail = false;
  const preferences = createVoicePreferences({ load: async () => value, save: async patch => { if (fail) throw Error("failed"); value = { ...value, config: { ...value.config, ...patch } }; return value; } });
  await preferences.load();
  const auditions: any[] = [];
  const controller = createTtsSettings({ preferences, list: async () => [{ id: "speaker", label: "Speaker" }], preview: async take => { auditions.push(take); }, ...overrides });
  await controller.load();
  return { controller, preferences, auditions, get config() { return value.config; }, fail() { fail = true; }, refresh(config: any, ids = value.ttsModels) { value = { ...value, config: { ...value.config, ...config }, ttsModels: ids }; preferences.accept(value); } };
}

test("voices retain exact IDs/names, distinguish no presets from service failure", async () => {
  const rows = await fetchTtsVoices("provider/tts", { fetcher: async (path: any) => { assert.match(path, /provider%2Ftts/); return Response.json({ voices: ["vivian", { id: "serena", name: "Serena" }, { id: "vivian" }, {}] }); } });
  assert.deepEqual(rows, [{ id: "vivian", label: "vivian" }, { id: "serena", label: "Serena" }]);
  assert.deepEqual(await fetchTtsVoices("tts", { fetcher: async () => Response.json({ detail: "checkpoint has no preset voices" }, { status: 404 }) }), []);
  for (const status of [401, 403, 404, 500]) await assert.rejects(fetchTtsVoices("tts", { fetcher: async () => Response.json({ error: { code: "model_not_found" } }, { status }) }), /tts_voices_failed/);
});

test("legacy voice is model-bound, explicit model default suppresses it without writes", () => {
  const legacy: any = { ttsModel: "a", voice: "legacy" };
  assert.equal(ttsVoiceForModel(legacy, "a"), "legacy");
  assert.equal(ttsVoiceForModel(legacy, "b"), undefined);
  assert.deepEqual(legacy, { ttsModel: "a", voice: "legacy" });
  assert.equal(ttsVoiceForModel({ ...legacy, ttsVoiceByModel: { a: "" } }, "a"), undefined);
  assert.equal(ttsSettingsModel({ config: { ttsModel: "removed" }, ttsModels: ["a"] }), null);
  assert.equal(ttsSettingsModel({ config: {}, ttsModels: ["a", "b"], ttsDefault: "a", ttsSelected: "b" }), "a");
});

test("voice maps validate IDs and reject prototype keys and malformed values", () => {
  assert.deepEqual(validateConfigPatch({ ttsVoiceByModel: { "provider/tts": "speaker", other: "" } }), { ttsVoiceByModel: { "provider/tts": "speaker", other: "" } });
  for (const map of [[], null, { tts: 7 }, { "": "voice" }, { tts: "\u0000" }, JSON.parse('{"__proto__":"x"}')]) assert.throws(() => validateConfigPatch({ ttsVoiceByModel: map }), /invalid TTS/);
});

test("each model keeps its voice and saving failure retains the confirmed selection", async () => {
  const h = await harness();
  try {
    await h.controller.selectVoice("speaker");
    await h.controller.selectModel("tts-b"); await h.controller.load();
    assert.equal(h.controller.getSnapshot().selected, "");
    await h.controller.selectVoice("speaker");
    await h.controller.selectModel("tts-a"); await h.controller.load();
    assert.equal(h.controller.getSnapshot().selected, "speaker");
    assert.deepEqual(h.config.ttsVoiceByModel, { "tts-a": "speaker", "tts-b": "speaker" });
    h.fail(); await assert.rejects(h.controller.selectVoice(""));
    assert.equal(h.controller.getSnapshot().selected, "speaker");
    assert.ok(h.preferences.getSnapshot().errors.ttsVoiceByModel);
    await assert.rejects(h.controller.selectModel("tts-b")); assert.equal(h.config.ttsModel, "tts-a");
  } finally { h.controller.dispose(); }
});

test("model switching cancels stale directories and never adopts a late model's voices", async () => {
  const gate = deferred(); let signal: AbortSignal | undefined;
  const h = await harness();
  const controller = createTtsSettings({ preferences: h.preferences, list: async (id, options) => { if (id === "tts-a") { signal = options.signal; return gate.promise; } return [{ id: "b", label: "B" }]; }, preview: async () => {} });
  const pending = controller.load();
  try {
    await controller.selectModel("tts-b"); await controller.load();
    assert.equal(signal?.aborted, true);
    gate.resolve([{ id: "a", label: "A" }]); await pending;
    assert.deepEqual(controller.getSnapshot().voices, [{ id: "b", label: "B" }]);
  } finally { controller.dispose(); h.controller.dispose(); }
});

test("no presets allows default preview; failed directory is retryable; missing saved voice is unavailable", async () => {
  let failed = true;
  const h = await harness({ list: async () => { if (failed) throw Error("offline"); return []; } });
  try {
    assert.equal(h.controller.getSnapshot().error, "tts_voices_failed");
    await h.controller.audition(); assert.equal(h.auditions.length, 0);
    failed = false; await h.controller.load(); await h.controller.audition();
    assert.equal(h.auditions[0].voice, undefined);
    h.refresh({ ttsVoiceByModel: { "tts-a": "removed" } });
    assert.equal(h.controller.getSnapshot().unavailable, true);
    await h.controller.audition(); assert.equal(h.auditions.length, 1);
    await h.controller.selectVoice(""); assert.equal(h.controller.getSnapshot().unavailable, false);
  } finally { h.controller.dispose(); }
});

test("preview runs only explicitly with speak off and activity/switch/dispose cancels audio", async () => {
  const calls: any[] = [];
  const h = await harness({ preview: async take => { const gate = deferred(); calls.push({ take, gate }); return gate.promise; } });
  const source = {};
  try {
    assert.equal(h.config.speak, false); assert.equal(calls.length, 0);
    const first = h.controller.audition(); assert.equal(h.controller.getSnapshot().playing, true);
    assert.equal(calls[0].take.text, TTS_PREVIEW_TEXT);
    await h.controller.audition(); assert.equal(calls[0].take.signal.aborted, true);
    calls[0].gate.resolve(); await first;
    const second = h.controller.audition(); setVoiceActivity(source, true);
    assert.equal(calls[1].take.signal.aborted, true); assert.equal(h.controller.getSnapshot().blocked, true);
    await h.controller.audition(); assert.equal(calls.length, 2);
    setVoiceActivity(source, false); calls[1].gate.resolve(); await second;
    const third = h.controller.audition(); await h.controller.selectModel("tts-b");
    assert.equal(calls[2].take.signal.aborted, true); calls[2].gate.resolve(); await third;
    await h.controller.load(); const fourth = h.controller.audition(); h.controller.dispose();
    assert.equal(calls[3].take.signal.aborted, true); calls[3].gate.resolve(); await fourth;
    assert.equal(h.config.speak, false);
  } finally { setVoiceActivity(source, false); h.controller.dispose(); }
  assert.equal(voiceActivity.getSnapshot(), false);
});

test("preview wire uses model/voice directly, omits default voice, and releases late audio", async () => {
  const requests: any[] = [];
  let played = 0, paused = 0;
  const createAudio = () => {
    let ended: () => void = () => {};
    return { addEventListener(name: string, fn: any) { if (name === "ended") ended = fn; }, play() { played++; queueMicrotask(ended); return Promise.resolve(); }, pause() { paused++; } };
  };
  const fetcher = async (_path: any, options: any) => { requests.push(JSON.parse(options.body)); return new Response(new Uint8Array([1, 2]), { headers: { "content-type": "audio/wav" } }); };
  for (const voice of [undefined, "serena"]) await previewTts({ model: "tts-a", voice, text: TTS_PREVIEW_TEXT, signal: new AbortController().signal }, { fetcher, createAudio });
  assert.equal(Object.hasOwn(requests[0], "voice"), false); assert.equal(requests[1].voice, "serena");
  assert.equal(requests[1].model, "tts-a"); assert.equal(played, 2); assert.equal(paused, 2);
  const gate = deferred(), abort = new AbortController();
  const pending = previewTts({ model: "tts-a", text: TTS_PREVIEW_TEXT, signal: abort.signal }, { fetcher: async () => gate.promise, createAudio });
  abort.abort(); gate.resolve(new Response(new Uint8Array([1]))); await assert.rejects(pending); assert.equal(played, 2);
});

test("Vue Host transport keeps preview WAV bytes and voice-list JSON on the existing request port", async () => {
  const { createHostClient } = await import("../../packages/mobile/src/host.js");
  const seen: any[] = [];
  const client = createHostClient({ baseUrl: "https://lares.example", proxyPrefix: "", request: async (url: any, init: any) => {
    seen.push({ url, ...init });
    return { ok: true, status: 200, body: url.includes("/audio/speech") ? new Blob([new Uint8Array([82, 73, 70, 70])], { type: "audio/wav" }) : { voices: [{ id: "serena" }] } };
  } });
  assert.deepEqual(await fetchTtsVoices("tts", { fetcher: client.ttsFetch }), [{ id: "serena", label: "serena" }]);
  const response = await client.ttsFetch("/llm/v1/audio/speech", { method: "POST", body: "{}" });
  assert.equal(await (await response.blob()).text(), "RIFF");
  assert.equal(seen[1].responseType, "blob"); assert.match(seen[1].url, /^https:\/\/lares.example\/llm\/v1\/audio\/speech$/);
});

test("the real shared panel blocks audition while open and releases activity on pause/dispose", async () => {
  const { createVoicePanel } = await import("@olares/lares-core/voice/panel");
  const { createVoiceController } = await import("@olares/lares-core/voice/controller");
  const panel = createVoicePanel({ complete: async () => {}, create: async () => {
    const controller = createVoiceController({ input: { capture: async () => "", cancel() {} }, output: { stop() {} }, agent: { create: async () => "s", running: async () => false } });
    return { controller, start: options => controller.start(options), stop: () => controller.disconnect(), pause: () => controller.pause(), resume: () => controller.resume() };
  } });
  try {
    await panel.bind("new-session"); assert.equal(panel.getSnapshot().preset, "raw");
    await panel.open({ mode: "continuous" }); await panel.start(); assert.equal(voiceActivity.getSnapshot(), true);
    await panel.pause(); assert.equal(voiceActivity.getSnapshot(), false);
    await panel.open({ mode: "continuous" }); await panel.start(); assert.equal(voiceActivity.getSnapshot(), true);
  } finally { await panel.dispose(); }
  assert.equal(voiceActivity.getSnapshot(), false);
});
