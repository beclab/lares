import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { bootstrapDinaSettings, type DinaSettingsSeed } from "../../packages/service/olares/bootstrap-settings.js";

const CATALOG = [
  { id: "Qwen/chat", name: "Qwen/chat", mode: "chat", reasoningEfforts: { low: "low", xhigh: "xhigh" } },
  { id: "Qwen/other", name: "Qwen/other", mode: "chat", reasoningEfforts: null },
  { id: "EmbeddingGemma/embed", name: "EmbeddingGemma/embed", mode: "embedding", reasoningEfforts: null },
];

const DECLARED = [
  { id: "Qwen/chat", name: "Qwen/chat", reasoningEfforts: { low: "low", xhigh: "xhigh" } },
  { id: "Qwen/other", name: "Qwen/other" },
];

function seed(overrides: Partial<DinaSettingsSeed> = {}): DinaSettingsSeed {
  return {
    catalog: CATALOG,
    baseURL: "http://127.0.0.1:8080/llm/v1",
    chatFallback: "Qwen/chat",
    ...overrides,
  };
}

function readSettings(dir: string): Record<string, any> {
  return parse(readFileSync(join(dir, "settings.yaml"), "utf8")) as Record<string, any>;
}

function withHome(body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "dina-settings-"));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("seeds the Router route and the default model, then leaves the document alone", () => {
  withHome((dir) => {
    const first = bootstrapDinaSettings(dir, seed());
    assert.equal(first.routeSeeded, true);
    assert.equal(first.changed, true);
    assert.equal(first.model, "Qwen/chat");

    const doc = readSettings(dir);
    const profile = doc["llm-pi-ai"].providers["olares-router"];
    assert.equal(profile.api, "openai-completions");
    assert.equal(profile.baseURL, "http://127.0.0.1:8080/llm/v1");
    assert.equal(profile.apiKeyEnv, "DINA_ROUTER_SHIM_KEY");
    assert.deepEqual(profile.compat, { supportsReasoningEffort: true });
    assert.deepEqual(profile.models, DECLARED);
    assert.equal(doc["agent-default-model"].provider, "olares-router");
    assert.equal(doc["agent-default-model"].model, "Qwen/chat");

    const second = bootstrapDinaSettings(dir, seed());
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
    const result = bootstrapDinaSettings(dir, seed());
    assert.equal(result.routeSeeded, false);
    assert.equal(result.routeModels, 2);
    assert.equal(result.model, "Qwen/chat");

    const profile = readSettings(dir)["llm-pi-ai"].providers["olares-router"];
    assert.equal(profile.displayName, "My Router");
    assert.equal(profile.baseURL, "http://127.0.0.1:9999/llm/v1");
    assert.deepEqual(profile.compat, { supportsReasoningEffort: true });
    assert.deepEqual(profile.models, DECLARED);
  });
});

test("an unreachable catalog leaves the declared models standing", () => {
  withHome((dir) => {
    writeRoute(dir, ["Qwen/chat"]);
    bootstrapDinaSettings(dir, seed({ catalog: [], chatFallback: null }));
    assert.deepEqual(readSettings(dir)["llm-pi-ai"].providers["olares-router"].models, [
      { id: "Qwen/chat" },
    ]);
  });
});

test("repoints a stale provider, keeps the saved model, drops the reasoning effort", () => {
  withHome((dir) => {
    writeFileSync(
      join(dir, "settings.yaml"),
      [
        "agent-default-model:",
        "  provider: deepseek-official",
        '  model: "Qwen/chat"',
        "  reasoningEffort: max",
        "dsh-better-sidebar:",
        "  # user comment",
        "  openByDefault: false",
        "",
      ].join("\n"),
    );
    const result = bootstrapDinaSettings(dir, seed({ chatFallback: "Qwen/other" }));
    assert.equal(result.model, "Qwen/chat");

    const raw = readFileSync(join(dir, "settings.yaml"), "utf8");
    assert.match(raw, /# user comment/);
    const doc = parse(raw) as Record<string, any>;
    assert.equal(doc["agent-default-model"].provider, "olares-router");
    assert.equal(doc["agent-default-model"].model, "Qwen/chat");
    assert.equal("reasoningEffort" in doc["agent-default-model"], false);
  });
});

test("a model the Router no longer offers is replaced by the catalog pick", () => {
  withHome((dir) => {
    writeFileSync(
      join(dir, "settings.yaml"),
      'agent-default-model:\n  provider: olares-router\n  model: "gone/model"\n',
    );
    const result = bootstrapDinaSettings(dir, seed({ chatFallback: "Qwen/other" }));
    assert.equal(result.model, "Qwen/other");
  });
});

test("a saved non-chat Router model is replaced even while the catalog still lists it", () => {
  withHome((dir) => {
    writeFileSync(
      join(dir, "settings.yaml"),
      'agent-default-model:\n  provider: olares-router\n  model: "EmbeddingGemma/embed"\n',
    );
    const result = bootstrapDinaSettings(dir, seed());
    assert.equal(result.model, "Qwen/chat");
  });
});

test("an unreachable catalog still seeds a route naming the resolved model", () => {
  withHome((dir) => {
    const result = bootstrapDinaSettings(dir, seed({ catalog: [], chatFallback: "Qwen/chat" }));
    assert.equal(result.routeSeeded, true);
    const profile = readSettings(dir)["llm-pi-ai"].providers["olares-router"];
    assert.deepEqual(profile.models, [{ id: "Qwen/chat", name: "Qwen/chat" }]);
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
    bootstrapDinaSettings(dir, seed());
    const profile = readSettings(dir)["llm-pi-ai"].providers["olares-router"];
    assert.deepEqual(profile.compat, { supportsReasoningEffort: true });
    assert.deepEqual(profile.models, DECLARED);
  });
});
