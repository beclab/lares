import assert from "node:assert/strict";
import test from "node:test";
import { routerCatalogRows } from "../../packages/core/router/catalog.js";
import { reasoningFromEfforts } from "../../packages/core/router/session-model.js";
import { normalizeRouterSelection, restoreRouterSelection, routerReasoningPayload } from "../../packages/core/router/model-authorization.js";

const provider = "olares-router";
const selection = { provider, model: "fixture", reasoningEffort: "off" };
const rows = [{ id: "fixture", reasoningEfforts: { none: "none", high: "high" } }];

test("Router effort identifiers, order and default survive catalog and menu projection", () => {
  for (const options of [["none", "high"], ["none"], ["high", "custom", "none"], ["off", "none"]]) {
    const [row] = routerCatalogRows({ data: [{ id: "fixture", supports: ["reasoning_effort"], reasoning_effort: { options, default: options[0] } }] });
    assert.deepEqual(Object.keys(row.reasoningEfforts), options);
    assert.deepEqual(Object.values(row.reasoningEfforts), options);
    assert.equal(row.reasoningDefault, options[0]);
    assert.deepEqual(reasoningFromEfforts(row.reasoningEfforts).efforts.map(x => x.id), options);
  }
  assert.equal(routerCatalogRows({ data: [{ id: "plain" }] })[0].reasoningEfforts, null);
});

test("only an unambiguous legacy Router off is restored and saved before use", async () => {
  assert.deepEqual(normalizeRouterSelection(selection, rows), { ...selection, reasoningEffort: "none" });
  assert.equal(normalizeRouterSelection({ ...selection, provider: "other" }, rows).reasoningEffort, "off");
  assert.equal(normalizeRouterSelection(selection, [{ id: "fixture", reasoningEfforts: { off: "off", none: "none" } }]), selection);
  assert.equal(normalizeRouterSelection(selection, [{ id: "fixture", reasoningEfforts: { high: "high" } }]), selection);
  let current = selection;
  await assert.rejects(restoreRouterSelection(current, async () => { throw Error("disk full"); }, rows), /disk full/);
  assert.equal(current.reasoningEffort, "off");
  current = await restoreRouterSelection(current, async next => { assert.equal(next.reasoningEffort, "none"); }, rows);
  assert.equal(current.reasoningEffort, "none");
});

test("request controls preserve explicit values and distinguish omitted defaults", () => {
  assert.deepEqual(routerReasoningPayload({ reasoning_effort: "high" }, "fixture", undefined, rows), {});
  assert.equal(routerReasoningPayload({}, "fixture", "none", rows).reasoning_effort, "none");
  assert.throws(() => routerReasoningPayload({}, "fixture", "off", rows), /Unsupported/);
  assert.throws(() => routerReasoningPayload({}, "fixture", "low", rows), /Unsupported/);
});

test("a removed effort stays visible as unavailable and cannot submit", async () => {
  const { modelState, modelStateLabel, requireComposerModel } = await import("../../packages/core/router/model-state.js");
  const snapshot = { status: "ready", current: selection, models: [{ provider, id: "fixture", reasoning: { efforts: [{ id: "none", name: "none" }] } }] };
  assert.equal(modelState(snapshot).state, "effort-unavailable");
  assert.equal(modelState(snapshot).valid, false);
  assert.match(modelStateLabel(snapshot, "zh"), /off.*不可用/);
  assert.throws(() => requireComposerModel(snapshot, "en"), /off.*unavailable/);
  assert.equal(modelState({ ...snapshot, current: { ...selection, reasoningEffort: "none" } }).valid, true);
});
