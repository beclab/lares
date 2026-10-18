import assert from "node:assert/strict";
import test from "node:test";
import { resolveDefaultSelection, ensureDefaultSelection } from "../../packages/core/router/default-selection.js";

const models = [{ id: "first/model" }, { id: "other/MTP" }];
test("default resolution preserves valid choices and otherwise uses catalog order", () => {
  const valid = { provider: "olares-router", model: "other/MTP", reasoningEffort: "none" };
  assert.equal(resolveDefaultSelection(valid, models), valid);
  for (const model of ["", "default", "gone/model"]) assert.deepEqual(resolveDefaultSelection({ provider: "olares-router", model, reasoningEffort: "none" }, models), { provider: "olares-router", model: "first/model" });
  assert.equal(resolveDefaultSelection(valid, []), valid);
});

test("concurrent initialization shares a save and failed saves remain retryable", async () => {
  let current = { provider: "olares-router", model: "", reasoningEffort: "none" };
  let writes = 0, fail = true;
  const service = { currentSelection: () => current, saveSelection: async (next, options) => {
    writes++; await new Promise(resolve => setImmediate(resolve));
    if (fail) throw Error("settings locked");
    assert.deepEqual(options.expected, current); current = next;
  } };
  await assert.rejects(Promise.all([ensureDefaultSelection(service, models), ensureDefaultSelection(service, models)]), /settings locked/);
  assert.equal(writes, 1); assert.equal(current.model, "");
  fail = false; await ensureDefaultSelection(service, models);
  assert.equal(writes, 2); assert.deepEqual(current, { provider: "olares-router", model: "first/model" });
  await ensureDefaultSelection(service, []); assert.equal(writes, 2);
});

// Exercise the installed dsh save queue, not a separate concurrency helper.
import { AgentDefaultModelConfig } from "@deepseek-ai/dsh-agent-default-model";
test("queued manual default saves win over stale automatic initialization", async () => {
  const initial = { provider: "olares-router", model: "", reasoningEffort: "none" };
  let current = initial;
  const service: any = {
    ownerContext: { fiber: { entry: {} } }, saves: Promise.resolve(),
    currentSelection: () => current,
    ctx: { get: () => ({ edit: async (_entry, update) => { current = update(); } }) },
  };
  const save = (next, options?) => AgentDefaultModelConfig.prototype.saveSelection.call(service, next, options);
  const manual = { provider: "olares-router", model: "other/MTP", reasoningEffort: "high" };
  await Promise.all([save(manual), save({ provider: "olares-router", model: "first/model" }, { expected: initial })]);
  assert.deepEqual(current, manual);
  current = initial;
  await Promise.all([save({ provider: "olares-router", model: "first/model" }, { expected: initial }), save(manual)]);
  assert.deepEqual(current, manual);
});

test("automatic initialization reports an unavailable settings editor", async () => {
  const service: any = { ownerContext: { fiber: { entry: {} } }, ctx: { get: () => undefined } };
  await assert.rejects(AgentDefaultModelConfig.prototype.saveSelection.call(service, { provider: "olares-router", model: "first/model" }, { expected: { provider: "olares-router", model: "" } }), /not writable/);
});

import { CatalogCache, catalogCache } from "../../packages/core/router/catalog-cache.js";
import { CatalogCoordinator } from "../../packages/core/router/catalog-coordinator.js";
import { buildModelCatalog } from "@deepseek-ai/dsh-api-session-controller";

test("actual session catalog waits for default initialization before returning", async () => {
  catalogCache.seed({ data: [{ id: "first/model", mode: "chat" }] });
  let current = { provider: "olares-router", model: "", reasoningEffort: "none" };
  const ctx: any = {
    agentDefaultModel: { currentSelection: () => current, saveSelection: async next => { current = next; } },
    settings: { mutate: async () => {} },
    llm: { listProviders: () => [{ id: "olares-router", name: "Router" }], listModels: async () => [{ id: "first/model", name: "First" }], resolveModelInfo: async () => ({}) },
  };
  const value = await buildModelCatalog(ctx);
  assert.deepEqual(value.default, { provider: "olares-router", model: "first/model" });
  assert.equal(value.groups[0].models[0].id, value.default.model);
});

test("failed and audio-only catalogs cannot initialize a default; recovery can", async () => {
  let fail = true, writes = 0, current = { provider: "olares-router", model: "" };
  const cache = new CatalogCache({ fetch: async () => { if (fail) throw Error("LAN unavailable"); return new Response(JSON.stringify({ data: [{ id: "first/model", mode: "chat" }] })); } });
  const coordinator = new CatalogCoordinator(cache);
  const ports = { mutateSettings: async () => {}, defaultModel: { currentSelection: () => current, saveSelection: async next => { writes++; current = next; } } };
  await assert.rejects(coordinator.sync(ports), /LAN unavailable/); assert.equal(writes, 0);
  cache.seed({ data: [{ id: "ASR", mode: "audio" }, { id: "TTS", mode: "audio" }] });
  await coordinator.sync(ports); assert.equal(writes, 0);
  fail = false; await coordinator.sync(ports, true); assert.equal(writes, 1); assert.equal(current.model, "first/model");
});
