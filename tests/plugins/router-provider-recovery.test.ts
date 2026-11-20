import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { apply, Config } from "@deepseek-ai/dsh-llm-pi-ai";
import { bootstrapLaresSettings } from "../../packages/service/olares/bootstrap-settings.js";
import { CatalogCache } from "../../packages/core/router/catalog-cache.js";
import { CatalogCoordinator } from "../../packages/core/router/catalog-coordinator.js";
import { listedCatalog, routerProviderProfile } from "../../packages/core/router/models.js";
import { authorizedChatModel } from "../../packages/core/router/model-authorization.js";

// Exercise the installed DSH plugin's actual live-write validation hook.
function dshValidator() {
  let validate: (this: unknown, raw: unknown, next: () => unknown) => unknown;
  const captured = new Error("validation hook captured");
  const ctx = {
    fiber: { entry: { options: { id: "llm-pi-ai" } } },
    inject() {},
    on(event: string, hook: typeof validate) {
      assert.equal(event, "internal/config");
      validate = hook;
      throw captured;
    },
  };
  assert.throws(() => apply(ctx as any, Config({ providers: {} })), (err) => err === captured);
  return (providers: Record<string, unknown>) => validate.call(ctx.fiber, undefined, () => ({ providers }));
}

test("an empty first boot produces an importable route but no authorized model", async () => {
  const home = mkdtempSync(join(tmpdir(), "lares-empty-provider-"));
  try {
    const boot = bootstrapLaresSettings(home, { catalog: [], catalogLoaded: true, baseURL: "http://127.0.0.1:8080/llm/v1" });
    const config = parse(readFileSync(join(home, "settings.yaml"), "utf8"))["llm-pi-ai"];
    assert.doesNotThrow(() => dshValidator()(config.providers));
    assert.equal(boot.model, null);
    assert.deepEqual(listedCatalog({ name: "Olares Router" }, config.providers["olares-router"].models), []);
    const cache = new CatalogCache();
    cache.seed({ data: [] });
    assert.equal(await authorizedChatModel({ provider: "olares-router", model: "default" }, cache), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("live reconciliation repairs a failed import, then survives catalog removal and recovery", async () => {
  const cache = new CatalogCache();
  const coordinator = new CatalogCoordinator(cache);
  const validate = dshValidator();
  let profile: any = { models: [], compat: { sendSessionAffinityHeaders: true, sessionAffinityFormat: "openrouter" } };
  let selection = { provider: "olares-router", model: "" };
  const ports = {
    routerProfile: () => profile,
    async mutateSettings(ns, ops) {
      assert.equal(ns, "llm-pi-ai");
      assert.deepEqual(ops[0].path, ["providers", "olares-router"]);
      validate({ "olares-router": ops[0].value });
      profile = ops[0].value;
    },
    defaultModel: {
      currentSelection: () => selection,
      async saveSelection(next) { selection = next; },
    },
  };
  cache.seed({ data: [] });
  assert.deepEqual((await coordinator.sync(ports)).models, []);
  assert.equal(profile.api, "openai-completions");
  assert.equal(profile.baseURL, "http://127.0.0.1:8080/llm/v1");
  assert.equal(profile.apiKeyEnv, "LARES_ROUTER_SHIM_KEY");
  assert.equal(selection.model, "");
  const id = "Olares/unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL";
  cache.seed({ data: [{ id, mode: "chat" }] });
  await coordinator.sync(ports);
  assert.equal(selection.model, id);
  assert.deepEqual(profile.models.map(m => m.id), [id]);
  cache.seed({ data: [] });
  assert.deepEqual((await coordinator.sync(ports)).models, []);
  assert.equal(await authorizedChatModel(selection, cache), false);
  cache.seed({ data: [{ id, mode: "chat" }] });
  await coordinator.sync(ports);
  assert.equal(await authorizedChatModel(selection, cache), true);
});

test("refresh preserves an existing provider's endpoint, credentials and unrelated options", () => {
  const existing = {
    api: "openai-completions", baseURL: "http://127.0.0.1:9999/llm/v1",
    displayName: "My Router", apiKeyEnv: "MY_ROUTER_KEY",
    headers: { "x-custom": "kept" }, timeoutMs: 12000,
  };
  const profile = routerProviderProfile([{ id: "Qwen/chat" }], existing);
  for (const [key, value] of Object.entries(existing)) assert.deepEqual(profile[key], value);
  assert.doesNotThrow(() => dshValidator()({ "olares-router": profile }));
});

test("boot repairs missing protocol fields in an existing legacy route", () => {
  const home = mkdtempSync(join(tmpdir(), "lares-partial-provider-"));
  try {
    writeFileSync(join(home, "settings.yaml"), "llm-pi-ai:\n  providers:\n    olares-router:\n      models: []\n");
    bootstrapLaresSettings(home, { catalog: [], catalogLoaded: false, baseURL: "http://127.0.0.1:9999/llm/v1" });
    const config = parse(readFileSync(join(home, "settings.yaml"), "utf8"))["llm-pi-ai"];
    assert.equal(config.providers["olares-router"].baseURL, "http://127.0.0.1:9999/llm/v1");
    assert.doesNotThrow(() => dshValidator()(config.providers));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a nonempty startup catalog repairs legacy affinity options that block provider registration", () => {
  const home = mkdtempSync(join(tmpdir(), "lares-nonempty-provider-"));
  const id = "Olares/unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL";
  const validate = dshValidator();
  const legacy = {
    api: "openai-completions", baseURL: "http://127.0.0.1:8080/llm/v1",
    apiKeyEnv: "LARES_ROUTER_SHIM_KEY", models: [{ id, name: id }],
    compat: { supportsReasoningEffort: true, supportsStore: false, sendSessionAffinityHeaders: true, sessionAffinityFormat: "openrouter" },
  };
  try {
    assert.throws(() => validate({ "olares-router": legacy }), /sendSessionAffinityHeaders.*not configurable/);
    writeFileSync(join(home, "settings.yaml"), JSON.stringify({ "llm-pi-ai": { providers: { "olares-router": legacy } } }));
    const boot = bootstrapLaresSettings(home, {
      catalogLoaded: true, baseURL: legacy.baseURL,
      catalog: [{ id, name: id, mode: "chat", supportsVision: false, reasoningEfforts: null, contextWindow: null, maxTokens: null }],
    });
    const config = parse(readFileSync(join(home, "settings.yaml"), "utf8"))["llm-pi-ai"];
    assert.equal(boot.model, id);
    assert.equal(config.providers["olares-router"].models[0].id, id);
    assert.doesNotThrow(() => validate(config.providers));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
