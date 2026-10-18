import assert from "node:assert/strict";
import test from "node:test";
import { modelState, modelStateLabel, requireComposerModel } from "../../packages/core/router/model-state.js";
import { authorizedCatalog, authorizedChatModel, routerReasoningInfo } from "../../packages/core/router/model-authorization.js";
import { CatalogCache, catalogCache } from "../../packages/core/router/catalog-cache.js";
import { routerCatalogRows } from "../../packages/core/router/catalog.js";

const current = { provider: "olares-router", model: "Qwen/9B" };
const models = [{ provider: "olares-router", id: "Qwen/9B" }];
test("composer distinguishes loading, empty, unselected, stale, error and ready without changing selection", () => {
  assert.equal(modelState({ status: "loading" }).state, "loading");
  assert.equal(modelState({ models: [] }).state, "empty");
  assert.equal(modelState({ models }).state, "unselected");
  assert.equal(modelState({ current, models: [] }).state, "unavailable");
  assert.equal(modelState({ current, models, error: "offline" }).state, "error");
  assert.equal(modelState({ current, models }).valid, true);
  assert.match(modelStateLabel({ current, models: [] }, "zh"), /9B.*不可用/);
  assert.throws(() => requireComposerModel({ current: { ...current, model: "default" }, models }));
  assert.doesNotThrow(() => requireComposerModel({ current, models }));
});

test("Host rejects placeholders, excluded models and audio-only models against the authorized catalog", async () => {
  const cache = new CatalogCache();
  cache.seed({ data: [{ id: current.model, mode: "chat" }, { id: "ASR", mode: "audio" }] });
  assert.equal(await authorizedChatModel(current, cache), true);
  for (const model of ["default", "", "ASR", "admin-only"]) {
    assert.equal(await authorizedChatModel({ ...current, model }, cache), false);
  }
  cache.seed({ data: [] });
  assert.equal(await authorizedChatModel(current, cache), false);
});

test("catalog refresh failures retain last success with an explicit failure instead of empty success", async () => {
  const cache = new CatalogCache({ fetch: async () => { throw Error("offline"); } });
  cache.seed({ data: [{ id: current.model, mode: "chat" }] });
  cache.invalidate();
  const result = await authorizedCatalog(cache);
  assert.equal(result.rows[0].id, current.model);
  assert.match(result.failures[0].message, /offline/);
});

test("Router none stays none with the declared default only", () => {
  const payload = { data: [{ id: current.model, mode: "chat", supports: ["reasoning_effort"], reasoning_effort: { options: ["none", "high"], default: "none" } }] };
  const rows = routerCatalogRows(payload);
  assert.deepEqual(rows[0].reasoningEfforts, { none: "none", high: "high" });
  catalogCache.seed(payload);
  assert.deepEqual(routerReasoningInfo(current.provider, current.model, rows), { reasoning: { efforts: [{ id: "none", name: "none" }, { id: "high", name: "high" }], defaultEffort: "none" } });
  catalogCache.reset();
});
