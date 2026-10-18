import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { bootstrapLaresSettings } from "../../packages/service/olares/bootstrap-settings.js";

test("empty authorized catalogs start without declaring a placeholder or picking a model", () => {
  const dir = mkdtempSync(join(tmpdir(), "lares-no-model-"));
  try {
    const result = bootstrapLaresSettings(dir, { catalog: [], baseURL: "http://localhost/llm/v1" });
    const doc = parse(readFileSync(join(dir, "settings.yaml"), "utf8"));
    assert.equal(result.model, null);
    assert.deepEqual(doc["llm-pi-ai"].providers["olares-router"].models, []);
    assert.equal(doc["agent-default-model"].model, "");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("empty success clears availability; network failure keeps last catalog and stale selection", () => {
  const dir = mkdtempSync(join(tmpdir(), "lares-stale-model-"));
  try {
    writeFileSync(join(dir, "settings.yaml"), "llm-pi-ai:\n  providers:\n    olares-router:\n      models:\n        - id: old/model\nagent-default-model:\n  provider: olares-router\n  model: old/model\n  reasoningEffort: low\n");
    const seed = { catalog: [], baseURL: "http://localhost/llm/v1" };
    bootstrapLaresSettings(dir, { ...seed, catalogLoaded: false });
    let doc = parse(readFileSync(join(dir, "settings.yaml"), "utf8"));
    assert.equal(doc["llm-pi-ai"].providers["olares-router"].models.length, 1);
    bootstrapLaresSettings(dir, { ...seed, catalogLoaded: true });
    doc = parse(readFileSync(join(dir, "settings.yaml"), "utf8"));
    assert.deepEqual(doc["llm-pi-ai"].providers["olares-router"].models, []);
    assert.equal(doc["agent-default-model"].model, "old/model");
    assert.equal(doc["agent-default-model"].reasoningEffort, "low");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
