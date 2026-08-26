import assert from "node:assert/strict";
import test from "node:test";
import { createSnapshotStore } from "@lares/core/tools/async";

test("settings snapshot reuses the last payload until force", async () => {
  const store = createSnapshotStore();
  let loads = 0;
  const start = async () => {
    loads += 1;
    return { loads };
  };
  assert.equal(store.peek(), null);
  assert.deepEqual(await store.load(start), { loads: 1 });
  assert.deepEqual(await store.load(start), { loads: 1 });
  assert.equal(loads, 1);
  assert.deepEqual(await store.load(start, { force: true }), { loads: 2 });
  assert.equal(loads, 2);
  store.remember({ loads: 9 });
  assert.deepEqual(await store.load(start), { loads: 9 });
  assert.equal(loads, 2);
});

test("model / search / voice settings skip a second load", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("/api/lares/models")) {
      return json({ default: { provider: "olares-router", model: "qwen" }, models: [], failures: [] });
    }
    if (url.includes("/api/lares/web-search")) {
      return json({ defaultSearchModel: "tavily/search", searchModels: [{ id: "tavily/search" }] });
    }
    if (url.includes("/api/lares/voice/config")) return json({ model: "", language: "" });
    if (url.includes("/api/lares/voice/status")) return json({ modelAvailable: true, model: "whisper" });
    if (url.includes("/api/lares/voice/models")) return json({ stt: ["whisper"] });
    throw new Error(url);
  };
  try {
    const stamp = Date.now();
    const models = await import(`../../packages/core/router/models-client.js?snap=${stamp}`);
    const search = await import(`../../packages/core/search/client.js?snap=${stamp}`);
    const voice = await import(`../../packages/core/voice/client.js?snap=${stamp}`);

    await models.loadModelSettings();
    await models.loadModelSettings();
    await search.loadSearchSettings();
    await search.loadSearchSettings();
    await voice.loadVoiceSettings();
    await voice.loadVoiceSettings();
    assert.deepEqual(calls, [
      "GET /api/lares/models",
      "GET /api/lares/web-search/config",
      "GET /api/lares/voice/config",
      "GET /api/lares/voice/status",
      "GET /api/lares/voice/models",
    ]);

    await models.loadModelSettings({ force: true });
    await search.loadSearchSettings({ force: true });
    await voice.loadVoiceSettings({ force: true });
    assert.equal(calls.filter((line) => line.startsWith("GET /api/lares/models")).length, 2);
    assert.equal(calls.filter((line) => line.includes("/web-search/config")).length, 2);
    assert.ok(calls.some((line) => line.includes("/voice/status?refresh=1")));
    assert.equal(voice.rememberedVoiceSettings().status.model, "whisper");
    assert.equal(search.rememberedSearchSettings().defaultSearchModel, "tavily/search");
    assert.equal(models.rememberedModelSettings().default.model, "qwen");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
