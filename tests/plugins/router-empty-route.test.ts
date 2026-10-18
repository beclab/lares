import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("the actual dsh adapter accepts an explicitly empty Lares route without placeholder models", () => {
  const source = readFileSync(new URL("../../node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js", import.meta.url), "utf8");
  const start = source.indexOf("function resolveRouteModels(");
  const end = source.indexOf("\n//#endregion", start);
  const resolve = new Function("catalogModels", "catalogProvider", "invalid", "sharedCatalogApi", "assertOfferedCompatFields", "configuredCompatEntries", "compatProtocols", `${source.slice(start, end)}; return resolveRouteModels;`)(
    () => new Map(), () => undefined, (_provider, message) => { throw new Error(message); }, () => undefined, () => {}, () => [["supportsReasoningEffort", true]], () => ["openai-completions"],
  );
  const result = resolve({ provider: "olares-router", models: [], compat: { supportsReasoningEffort: true } });
  assert.deepEqual(result.models, []);
  assert.throws(() => resolve({ provider: "other", models: [] }), /resolves no models/);
});
