import assert from "node:assert/strict";
import test from "node:test";
import { streamSimple } from "../../node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js";
import { routerReasoningPayload } from "../../packages/core/router/model-authorization.js";

test("actual request builder distinguishes default, explicit none and strength", async () => {
  const rows = [{ id: "fixture", reasoningEfforts: { none: "none", high: "high" } }];
  const model: any = { id: "fixture", name: "Fixture", api: "openai-completions", provider: "fixture", baseUrl: "http://127.0.0.1:1", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024, compat: { supportsReasoningEffort: true, supportsStore: false }, thinkingLevelMap: { none: "none", high: "high", low: null, medium: null, minimal: null, xhigh: null, max: null } };
  for (const [requested, expected] of [[undefined, undefined], ["none", "none"], ["high", "high"]]) {
    let wire: any = null;
    const stream = streamSimple(model, { messages: [{ role: "user", content: "fixture", timestamp: 0 }] }, { apiKey: "fixture", reasoning: requested === "none" ? undefined : requested,
      onPayload(payload) { wire = routerReasoningPayload(payload, model.id, requested, rows); throw Error("Stopped before network"); },
    });
    for await (const event of stream) {}
    assert.notEqual(wire, null);
    assert.equal(wire.reasoning_effort, expected);
    assert.equal(Object.hasOwn(wire, "reasoning_effort"), expected !== undefined);
  }
  assert.throws(() => routerReasoningPayload({}, "fixture", "low", rows), /Unsupported/);
});
