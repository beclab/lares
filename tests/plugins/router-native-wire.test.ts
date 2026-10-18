import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { PiAiAdapter, Config } from "@deepseek-ai/dsh-llm-pi-ai";
import { LlmRuntime, createUserMessage } from "@deepseek-ai/dsh-llm";
import { streamSimple } from "../../node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js";
import { catalogCoordinator } from "../../packages/core/router/catalog-coordinator.js";

test("actual dsh adapter sends Router identifiers without pi-ai clamping or defaulting", async () => {
  const requests: any[] = [];
  let rejection: "json" | "empty" | undefined;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    if (rejection) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(rejection === "json" ? JSON.stringify({ error: { code: "fixture_rejected", message: "fixture refuses this request" } }) : "");
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const value of [{ choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }] }, { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }]) res.write(`data: ${JSON.stringify(value)}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address: any = server.address();
  const model: any = { id: "fixture", name: "Fixture", api: "openai-completions", provider: "olares-router", baseUrl: `http://127.0.0.1:${address.port}/v1`, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 512, compat: { supportsReasoningEffort: true, supportsStore: false } };
  const profiles = new Map([["olares-router", { modelErrors: new Map(), configuredMaxTokens: new Map(), streamIdleTimeoutMs: 10000, headers: {}, reasoning: "high" }]]);
  const adapter: any = new PiAiAdapter({ profiles: () => profiles, resolveApiKey: async () => "fixture" });
  adapter.snapshot = { profiles, models: { getModel: () => model, streamSimple } };
  const original = catalogCoordinator.committed;
  const seed = (options = ["none", "high", "custom"]) => { catalogCoordinator.committed = { rows: [{ id: "fixture", reasoningEfforts: Object.fromEntries(options.map(x => [x, x])), reasoningDefault: "high" }] } as any; };
  try {
    seed();
    for (const effort of [undefined, "none", "high", "custom"]) {
      const prepared = await adapter.prepareCall("olares-router", "fixture");
      const config = { provider: "olares-router", model: "fixture", ...(effort ? { reasoningEffort: effort } : {}) };
      const resolved = LlmRuntime.prototype.resolveCallWithInfo.call({}, config, prepared.model);
      assert.equal(resolved.config.reasoningEffort, effort);
      // A refresh cannot replace a prepared operation's bound capability snapshot.
      seed(["high"]);
      const events = []; for await (const event of prepared.stream({ ...resolved.config, messages: [createUserMessage({ content: [{ type: "text", text: "fixture" }] })] })) events.push(event);
      assert.ok(events.length);
      assert.equal(requests.at(-1).reasoning_effort, effort);
      assert.equal(Object.hasOwn(requests.at(-1), "reasoning_effort"), effort !== undefined);
      seed();
    }
    const prepared = await adapter.prepareCall("olares-router", "fixture");
    assert.throws(() => LlmRuntime.prototype.resolveCallWithInfo.call({}, { provider: "olares-router", model: "fixture", reasoningEffort: "off" }, prepared.model), /does not support/);
    assert.equal(requests.length, 4);
    for (const mode of ["json", "empty"] as const) {
      rejection = mode;
      const prepared = await adapter.prepareCall("olares-router", "fixture");
      const errors = [];
      for await (const event of prepared.stream({ provider: "olares-router", model: "fixture", reasoningEffort: "none", messages: [createUserMessage({ content: [{ type: "text", text: "fixture" }] })] })) errors.push(event);
      assert.match(JSON.stringify(errors), mode === "json" ? /fixture refuses this request/ : /400.*no body/);
      if (mode === "json") assert.match(JSON.stringify(errors), /fixture_rejected/);
      assert.equal(requests.at(-1).reasoning_effort, "none");
    }
    assert.equal(requests.length, 6);
  } finally { catalogCoordinator.committed = original; server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});

test("Router config accepts native IDs; other providers retain fixed-level validation", () => {
  const value: any = { providers: { "olares-router": { api: "openai-completions", baseURL: "http://localhost/v1", models: [{ id: "fixture", reasoningEfforts: { none: "none", custom: "custom" } }] } } };
  assert.doesNotThrow(() => Config(value));
  const source = readFileSync(new URL("../../node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js", import.meta.url), "utf8");
  const start = source.indexOf("function resolveModelReasoning("), end = source.indexOf("\n/**", start);
  const resolve = new Function("THINKING_LEVELS", "invalid", `${source.slice(start, end)};return resolveModelReasoning;`)(["off", "low", "medium", "high"], (_provider, message) => { throw Error(message); });
  assert.deepEqual(resolve("olares-router", value.providers["olares-router"].models[0]), { reasoning: false });
  assert.throws(() => resolve("other", { id: "fixture", reasoningEfforts: { none: "none" } }), /unsupported thinking level/);
  assert.equal(resolve("other", { id: "fixture", reasoningEfforts: { low: "low", high: "high" } }).thinkingLevelMap.high, "high");
});

test("the real session controller declares its coordinated settings dependency", async () => {
  const { SessionController } = await import("@deepseek-ai/dsh-api-session-controller");
  assert.ok(SessionController.inject.includes("settings"));
});

test("the full vendor installer is idempotent after native Router patches", async () => {
  const { spawnSync } = await import("node:child_process");
  const files = ["dsh-llm-pi-ai/lib/index.js", "dsh-api-session-controller/lib/index.js", "dsh-client-ui-model-selection/lib/client.js"];
  const before = files.map(file => readFileSync(new URL(`../../node_modules/@deepseek-ai/${file}`, import.meta.url), "utf8"));
  for (let run = 0; run < 2; run++) {
    const result = spawnSync(process.execPath, ["scripts/apply-vendor-patches.mjs"], { cwd: new URL("../../", import.meta.url), encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  assert.deepEqual(files.map(file => readFileSync(new URL(`../../node_modules/@deepseek-ai/${file}`, import.meta.url), "utf8")), before);
});

test("restoring an old session awaits coordinated capabilities before persisting none", async () => {
  const { normalizeRouterSelection } = await import("../../packages/core/router/model-authorization.js");
  const source = readFileSync(new URL("../../node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js", import.meta.url), "utf8");
  const start = source.indexOf("\tasync installSelection(agent)"), end = source.indexOf("\n\t/**", start);
  let release: () => void = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  const rows = [{ id: "fixture", reasoningEfforts: { none: "none" } }];
  const Registry = new Function("synchronizeHostCatalog", "normalizeRouterSelection", `return class { ${source.slice(start, end)} }`)(() => pending, current => normalizeRouterSelection(current, rows));
  const registry = new Registry();
  let selected = { provider: "olares-router", model: "fixture", reasoningEffort: "off" };
  registry.ctx = { logger: { warn() {} } };
  registry.selectionFor = () => ({ current: selected });
  registry.selectForNextRequest = (_agent, next) => { selected = next; };
  const restoring = registry.installSelection({});
  assert.equal(selected.reasoningEffort, "off");
  release(); await restoring;
  assert.equal(selected.reasoningEffort, "none");
  selected = { provider: "olares-router", model: "fixture", reasoningEffort: "off" };
  registry.selectForNextRequest = () => { throw Error("durable write rejected"); };
  await assert.rejects(registry.installSelection({}), /durable write rejected/);
  assert.equal(selected.reasoningEffort, "off");
});
