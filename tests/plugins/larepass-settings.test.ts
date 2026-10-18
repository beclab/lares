import assert from "node:assert/strict";
import test from "node:test";
import {
  createHostSettings,
  rememberedSettings,
  resetHostSettingsCache,
} from "@olares/lares-core/larepass/settings";
import {
  conversationSettings,
  resolveSubmitMode,
} from "@olares/lares-core/larepass/submission-settings";

function ok(body) {
  return { ok: true, status: 200, body };
}

function mockRequest() {
  const calls = [];
  let voiceConfig = { model: "", language: "" };
  const request = async (path, init = {}) => {
    calls.push({ path, method: init.method ?? "GET", body: init.body });
    if (path === "/api/settings/describe") {
      assert.deepEqual(init.body.payload.args, {});
      return ok({
        type: "server-response",
        rpcId: init.body.rpcId,
        result: {
          ok: true,
          value: {
            writable: true,
            namespaces: [{
              ns: "ui-conversation",
              value: { busyEnter: "queue" },
              revision: 3,
            }],
          },
        },
      });
    }
    if (path === "/api/settings/update") {
      assert.deepEqual(Object.keys(init.body.payload.args).sort(), ["expectedRevision", "ns", "patch"]);
      assert.equal(init.body.payload.args.ns, "ui-conversation");
      return ok({
        type: "server-response",
        rpcId: init.body.rpcId,
        result: {
          ok: true,
          value: {
            ns: "ui-conversation",
            value: init.body.payload.args.patch,
            revision: 4,
          },
        },
      });
    }
    if (path === "/api/lares/models") return ok({ models: [{ id: "m1", provider: "p" }], default: { provider: "p", model: "m1" } });
    if (path === "/api/lares/models/refresh") return ok({ models: [], default: null });
    if (path === "/api/lares/models/default") return ok({ models: [], default: init.body });
    if (path === "/api/lares/voice/config") {
      if (init.method === "POST") voiceConfig = { ...voiceConfig, ...init.body };
      return ok(voiceConfig);
    }
    if (path.startsWith("/api/lares/voice/status")) return ok({ modelAvailable: true, model: "whisper" });
    if (path.startsWith("/api/lares/voice/models")) {
      return ok({ stt: ["whisper", { id: "paraformer" }], tts: ["kokoro", { id: "hexgrad" }] });
    }
    if (path.startsWith("/api/lares/web-search/config") && !path.includes("/default")) return ok({ searchModels: [{ id: "brave" }], defaultSearchModel: "brave" });
    if (path === "/api/lares/web-search/config/default") {
      return ok({
        searchModels: [{ id: "brave" }],
        defaultSearchModel: init.body.defaultSearchModel,
        searchOff: init.body.searchOff,
      });
    }
    return { ok: false, status: 404, body: { error: { message: path } } };
  };
  return { calls, request };
}

test("busy Enter follows the durable preference and accelerated uses its opposite", () => {
  assert.equal(resolveSubmitMode(false, false, true, "steer"), "queue");
  assert.equal(resolveSubmitMode(true, false, true, "queue"), "queue");
  assert.equal(resolveSubmitMode(true, true, true, "queue"), "steer");
  assert.equal(resolveSubmitMode(true, false, true, "steer"), "steer");
  assert.equal(resolveSubmitMode(true, true, true, "steer"), "queue");
  assert.equal(resolveSubmitMode(true, false, false, "steer"), "queue");
  assert.deepEqual(conversationSettings({ writable: false, namespaces: [] }), {
    busyEnter: "queue",
    revision: undefined,
    writable: false,
  });
});

test("createHostSettings maps model, voice, and search over the Host request", async () => {
  resetHostSettingsCache();
  const { calls, request } = mockRequest();
  const settings = createHostSettings(request);

  assert.equal((await settings.models()).default.model, "m1");
  assert.deepEqual((await settings.refreshModels()).models, []);
  assert.equal((await settings.setDefaultModel({ provider: "p", model: "m2" })).default.model, "m2");

  const voice = await settings.voice();
  assert.deepEqual(voice.sttModels, ["whisper", "paraformer"]);
  assert.deepEqual(voice.ttsModels, ["kokoro", "hexgrad"]);
  assert.equal(voice.config.model, "");
  const saved = await settings.saveVoice({ model: "whisper" });
  assert.equal(saved.config.model, "whisper");
  assert.ok(calls.some((call) => call.path === "/api/lares/voice/status?refresh=1"));

  assert.equal((await settings.search()).defaultSearchModel, "brave");
  const followRouter = await settings.setSearchDefault({ defaultSearchModel: null, searchOff: false });
  assert.equal(followRouter.defaultSearchModel, null);
  assert.equal(followRouter.searchOff, false);
  assert.equal((await settings.conversation()).busyEnter, "queue");
  assert.equal((await settings.setBusyEnter("steer")).busyEnter, "steer");
  const update = calls.find((call) => call.path === "/api/settings/update");
  assert.equal(update.body.payload.args.expectedRevision, 3);
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
  assert.equal(calls.filter((call) => call.path === "/api/lares/web-search/config").length, 1);
  assert.ok(calls.some((call) => call.path === "/api/lares/web-search/config?refresh=1"));
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


test("conversation preference refuses read-only writes and preserves state on conflict", async () => {
  for (const writable of [false, true]) {
    resetHostSettingsCache();
    let writes = 0;
    const settings = createHostSettings(async (path, init) => {
      if (path.endsWith("describe")) {
        assert.deepEqual(init.body.payload.args, {});
        return ok({ type: "server-response", rpcId: init.body.rpcId, result: { ok: true,
          value: { writable, namespaces: [{ ns: "ui-conversation", value: { busyEnter: "queue" }, revision: 7 }] } } });
      }
      writes++;
      assert.deepEqual(init.body.payload.args, { ns: "ui-conversation", patch: { busyEnter: "steer" }, expectedRevision: 7 });
      return ok({ type: "server-response", rpcId: init.body.rpcId,
        result: { ok: false, error: { code: "revision-conflict", message: "revision conflict" } } });
    });
    await assert.rejects(settings.setBusyEnter("steer"), writable ? /revision conflict/ : /read-only/);
    assert.equal(writes, writable ? 1 : 0);
    assert.equal(rememberedSettings().conversation.busyEnter, "queue");
    assert.equal(rememberedSettings().conversation.revision, 7);
  }
});
