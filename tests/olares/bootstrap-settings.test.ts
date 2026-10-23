import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { bootstrapLaresSettings, type LaresSettingsSeed } from "../../packages/service/olares/bootstrap-settings.js";

const CATALOG = [
  { id: "Qwen/chat", name: "Qwen/chat", mode: "chat", supportsVision: true, reasoningEfforts: { low: "low", xhigh: "xhigh" }, contextWindow: 104448, maxTokens: 8192 },
  { id: "Qwen/other", name: "Qwen/other", mode: "chat", supportsVision: false, reasoningEfforts: null, contextWindow: null, maxTokens: null },
  { id: "EmbeddingGemma/embed", name: "EmbeddingGemma/embed", mode: "embedding", supportsVision: false, reasoningEfforts: null, contextWindow: null, maxTokens: null },
];

const DECLARED = [
  { id: "Qwen/chat", name: "Qwen/chat", input: ["text", "image"], reasoningEfforts: { low: "low", xhigh: "xhigh" }, contextWindow: 104448, maxTokens: 8192 },
  { id: "Qwen/other", name: "Qwen/other" },
];

function seed(overrides: Partial<LaresSettingsSeed> = {}): LaresSettingsSeed {
  return {
    catalog: CATALOG,
    baseURL: "http://127.0.0.1:8080/llm/v1",
    ...overrides,
  };
}

function readSettings(dir: string): Record<string, any> {
  return parse(readFileSync(join(dir, "settings.yaml"), "utf8")) as Record<string, any>;
}

function withHome(body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "lares-settings-"));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("seeded compat only names switches dsh will import", () => {
  const source = readFileSync(new URL("../../node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js", import.meta.url), "utf8");
  const gateStart = source.indexOf("const COMPLETIONS_COMPAT_GATE = {");
  const gate = source.slice(gateStart, source.indexOf("};", gateStart));
  withHome((dir) => {
    bootstrapLaresSettings(dir, seed());
    const compat = readSettings(dir)["llm-pi-ai"].providers["olares-router"].compat;
    for (const key of Object.keys(compat)) {
      assert.match(gate, new RegExp(`${key}: "offer"`));
    }
  });
});

test("seeds the first authorized chat model, then leaves the document alone", () => {
  withHome((dir) => {
    const first = bootstrapLaresSettings(dir, seed());
    assert.equal(first.routeSeeded, true);
    assert.equal(first.changed, true);
    assert.equal(first.model, "Qwen/chat");

    const doc = readSettings(dir);
    const profile = doc["llm-pi-ai"].providers["olares-router"];
    assert.equal(profile.api, "openai-completions");
    assert.equal(profile.baseURL, "http://127.0.0.1:8080/llm/v1");
    assert.equal(profile.apiKeyEnv, "LARES_ROUTER_SHIM_KEY");
    assert.deepEqual(profile.compat, { supportsReasoningEffort: true, supportsStore: false });
    assert.equal(profile.retryPolicy.maxRetries, 12);
    assert.equal(profile.retryPolicy.backoff.maxDelayMs, 60_000);
    assert.deepEqual(profile.models, DECLARED);
    assert.equal(doc["agent-default-model"].provider, "olares-router");
    assert.equal(doc["agent-default-model"].model, "Qwen/chat");

    const second = bootstrapLaresSettings(dir, seed());
    assert.equal(second.changed, false);
    assert.equal(second.routeSeeded, false);
  });
});

function writeRoute(dir: string, models: string[]): void {
  writeFileSync(
    join(dir, "settings.yaml"),
    [
      "llm-pi-ai:",
      "  providers:",
      "    olares-router:",
      "      displayName: My Router",
      "      api: openai-completions",
      "      baseURL: http://127.0.0.1:9999/llm/v1",
      "      models:",
      ...models.map((id) => `        - id: ${id}`),
      "agent-default-model:",
      "  provider: olares-router",
      `  model: ${models[0]}`,
      "",
    ].join("\n"),
  );
}

test("an existing route keeps the user's endpoint but follows the Router catalog", () => {
  withHome((dir) => {
    writeRoute(dir, ["default"]);
    const result = bootstrapLaresSettings(dir, seed());
    assert.equal(result.routeSeeded, false);
    assert.equal(result.routeModels, 2);
    assert.equal(result.model, "Qwen/chat");

    const profile = readSettings(dir)["llm-pi-ai"].providers["olares-router"];
    assert.equal(profile.displayName, "My Router");
    assert.equal(profile.baseURL, "http://127.0.0.1:9999/llm/v1");
    assert.deepEqual(profile.compat, { supportsReasoningEffort: true, supportsStore: false });
    // The retry policy is how Router behaves, not a user preference.
    assert.equal(profile.retryPolicy.maxRetries, 12);
    assert.deepEqual(profile.models, DECLARED);
  });
});

test("an unreachable catalog leaves the declared models standing", () => {
  withHome((dir) => {
    writeRoute(dir, ["Qwen/chat"]);
    bootstrapLaresSettings(dir, seed({ catalog: [], catalogLoaded: false }));
    assert.deepEqual(readSettings(dir)["llm-pi-ai"].providers["olares-router"].models, [
      { id: "Qwen/chat" },
    ]);
  });
});

test("keeps saved provider, model and reasoning effort", () => {
  withHome((dir) => {
    writeFileSync(
      join(dir, "settings.yaml"),
      [
        "agent-default-model:",
        "  provider: olares-router",
        '  model: "Qwen/chat"',
        "  reasoningEffort: max",
        "dsh-better-sidebar:",
        "  # user comment",
        "  openByDefault: false",
        "",
      ].join("\n"),
    );
    const result = bootstrapLaresSettings(dir, seed());
    assert.equal(result.model, "Qwen/chat");

    const raw = readFileSync(join(dir, "settings.yaml"), "utf8");
    assert.match(raw, /# user comment/);
    const doc = parse(raw) as Record<string, any>;
    assert.equal(doc["agent-default-model"].provider, "olares-router");
    assert.equal(doc["agent-default-model"].model, "Qwen/chat");
    assert.equal(doc["agent-default-model"].reasoningEffort, "max");
  });
});

test("a missing global default falls back without rewriting session history", () => {
  withHome((dir) => {
    writeFileSync(
      join(dir, "settings.yaml"),
      'agent-default-model:\n  provider: olares-router\n  model: "gone/model"\n',
    );
    const result = bootstrapLaresSettings(dir, seed());
    assert.equal(result.model, "Qwen/chat");
  });
});

test("a non-chat global default falls back to the first chat model", () => {
  withHome((dir) => {
    writeFileSync(
      join(dir, "settings.yaml"),
      'agent-default-model:\n  provider: olares-router\n  model: "EmbeddingGemma/embed"\n',
    );
    const result = bootstrapLaresSettings(dir, seed());
    assert.equal(result.model, "Qwen/chat");
  });
});

test("an unreachable catalog never manufactures a model declaration", () => {
  withHome((dir) => {
    const result = bootstrapLaresSettings(dir, seed({ catalog: [], catalogLoaded: false }));
    assert.equal(result.routeSeeded, true);
    const profile = readSettings(dir)["llm-pi-ai"].providers["olares-router"];
    assert.deepEqual(profile.models, []);
  });
});

test("a route seeded before Router reported efforts picks them up on the next boot", () => {
  withHome((dir) => {
    writeFileSync(
      join(dir, "settings.yaml"),
      [
        "llm-pi-ai:",
        "  providers:",
        "    olares-router:",
        "      api: openai-completions",
        "      compat:",
        "        thinkingFormat: deepseek",
        "        supportsReasoningEffort: false",
        "      models:",
        "        - id: Qwen/chat",
        "",
      ].join("\n"),
    );
    bootstrapLaresSettings(dir, seed());
    const profile = readSettings(dir)["llm-pi-ai"].providers["olares-router"];
    assert.deepEqual(profile.compat, { supportsReasoningEffort: true, supportsStore: false });
    assert.deepEqual(profile.models, DECLARED);
  });
});
