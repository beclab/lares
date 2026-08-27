import assert from "node:assert/strict";
import test from "node:test";
import {
  createHostSettings,
  rememberedSettings,
  resetHostSettingsCache,
} from "@lares/core/larepass/settings";

function ok(body) {
  return { ok: true, status: 200, body };
}

function mockRequest() {
  const calls = [];
  let voiceConfig = { model: "", language: "" };
  const request = async (path, init = {}) => {
    calls.push({ path, method: init.method ?? "GET", body: init.body });
    if (path === "/api/lares/models") return ok({ models: [{ id: "m1", provider: "p" }], default: { provider: "p", model: "m1" } });
    if (path === "/api/lares/models/refresh") return ok({ models: [], default: null });
    if (path === "/api/lares/models/default") return ok({ models: [], default: init.body });
    if (path === "/api/lares/voice/config") {
      if (init.method === "POST") voiceConfig = { ...voiceConfig, ...init.body };
      return ok(voiceConfig);
    }
    if (path.startsWith("/api/lares/voice/status")) return ok({ modelAvailable: true, model: "whisper" });
    if (path.startsWith("/api/lares/voice/models")) return ok({ stt: ["whisper", { id: "paraformer" }] });
    if (path === "/api/lares/web-search/config") return ok({ searchModels: [{ id: "brave" }], defaultSearchModel: "brave" });
    if (path === "/api/lares/web-search/config/default") {
      return ok({ searchModels: [{ id: "brave" }], defaultSearchModel: init.body.defaultSearchModel });
    }
    return { ok: false, status: 404, body: { error: { message: path } } };
  };
  return { calls, request };
}

test("createHostSettings maps model, voice, and search over the Host request", async () => {
  resetHostSettingsCache();
  const { calls, request } = mockRequest();
  const settings = createHostSettings(request);

  assert.equal((await settings.models()).default.model, "m1");
  assert.deepEqual((await settings.refreshModels()).models, []);
  assert.equal((await settings.setDefaultModel({ provider: "p", model: "m2" })).default.model, "m2");

  const voice = await settings.voice();
  assert.deepEqual(voice.sttModels, ["whisper", "paraformer"]);
  assert.equal(voice.config.model, "");
  const saved = await settings.saveVoice({ model: "whisper" });
  assert.equal(saved.config.model, "whisper");
  assert.ok(calls.some((call) => call.path === "/api/lares/voice/status?refresh=1"));

  assert.equal((await settings.search()).defaultSearchModel, "brave");
  assert.equal((await settings.setSearchDefault(null)).defaultSearchModel, null);
});

test("createHostSettings reuses the last snapshot until force", async () => {
  resetHostSettingsCache();
  const { calls, request } = mockRequest();
  const settings = createHostSettings(request);

  assert.equal((await settings.models()).default.model, "m1");
  assert.equal((await settings.models()).default.model, "m1");
  assert.equal((await settings.search()).defaultSearchModel, "brave");
  assert.equal((await settings.search()).defaultSearchModel, "brave");
  await settings.voice();
  await settings.voice();
  assert.equal(calls.filter((call) => call.path === "/api/lares/models").length, 1);
  assert.equal(calls.filter((call) => call.path === "/api/lares/web-search/config").length, 1);
  assert.equal(calls.filter((call) => call.path === "/api/lares/voice/config").length, 1);
  assert.equal(rememberedSettings().models.default.model, "m1");

  await settings.models({ force: true });
  await settings.search({ force: true });
  await settings.voice(true);
  assert.equal(calls.filter((call) => call.path === "/api/lares/models").length, 2);
  assert.equal(calls.filter((call) => call.path === "/api/lares/web-search/config").length, 2);
  assert.ok(calls.some((call) => call.path === "/api/lares/voice/status?refresh=1"));
});

test("createHostSettings surfaces Host error payloads", async () => {
  resetHostSettingsCache();
  const settings = createHostSettings(async () => ({
    ok: false,
    status: 503,
    body: { error: { message: "router down" } },
  }));
  await assert.rejects(settings.models(), /router down/);
});
