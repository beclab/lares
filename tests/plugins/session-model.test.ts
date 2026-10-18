import assert from "node:assert/strict";
import test from "node:test";
import {
  bindComposerModelDirectory,
  catalogDefaultReady,
  currentEffortId,
  effortDisplayLabel,
  effortMenuItems,
  effortMenuRows,
  effortSwitchSelection,
  findListedModel,
  groupModelsByProvider,
  isComposerModelAvailable,
  isSameSessionModel,
  modelSwitchSelection,
  reasoningFromEfforts,
  reasoningOfModel,
  selectionKey,
  sessionModelLabel,
  sessionModelSelection,
  composerModelsFromCatalog,
} from "@olares/lares-core/router/session-model";

test("Router catalog effort dict becomes the switcher menu shape", () => {
  assert.deepEqual(reasoningFromEfforts({ low: "low", high: "high" }), {
    efforts: [{ id: "low", name: "low" }, { id: "high", name: "high" }],
  });
  assert.equal(reasoningOfModel({ reasoningEfforts: { off: "off" } }).defaultEffort, undefined);
  assert.equal(reasoningFromEfforts(undefined), undefined);
});

test("composer model switching is off on a subagent session", () => {
  assert.equal(isComposerModelAvailable(undefined), true);
  assert.equal(isComposerModelAvailable("agent://child"), false);
});

test("bindComposerModelDirectory load/select only when the session owns the model", async () => {
  const calls = [];
  const directory = {
    store: { id: "store" },
    load: async () => {
      calls.push("load");
    },
    select: async (selection) => {
      calls.push(selection);
    },
  };
  const blocked = bindComposerModelDirectory(directory, false);
  blocked.load();
  assert.equal(await blocked.select({ model: "x" }), false);
  assert.deepEqual(calls, []);

  const open = bindComposerModelDirectory(directory, true);
  await open.load();
  assert.equal(await open.select({ model: "x" }), true);
  assert.deepEqual(calls, ["load", { model: "x" }]);
});

test("session switch payload preserves provider default without an explicit effort", () => {
  const group = { id: "olares-router" };
  const model = { id: "qwen", reasoning: { defaultEffort: "low", efforts: [{ id: "low" }] } };
  assert.deepEqual(modelSwitchSelection(group, model), {
    provider: "olares-router",
    model: "qwen",
  });
  assert.deepEqual(modelSwitchSelection(group, { id: "plain" }), {
    provider: "olares-router",
    model: "plain",
  });
});

test("effort switch keeps the current model and omits provider-default", () => {
  const current = { provider: "olares-router", model: "qwen", reasoningEffort: "low" };
  assert.deepEqual(effortSwitchSelection(current, "high"), {
    provider: "olares-router",
    model: "qwen",
    reasoningEffort: "high",
  });
  assert.deepEqual(effortSwitchSelection(current, undefined), {
    provider: "olares-router",
    model: "qwen",
  });
});

test("findListedModel and current effort follow the directory snapshot", () => {
  const groups = [
    {
      id: "olares-router",
      models: [
        { id: "qwen", name: "Qwen", reasoning: { defaultEffort: "low", efforts: [{ id: "low" }, { id: "high" }] } },
      ],
    },
  ];
  const current = { provider: "olares-router", model: "qwen", reasoningEffort: "high" };
  const model = findListedModel(groups, current);
  assert.equal(model?.name, "Qwen");
  assert.equal(isSameSessionModel(current, groups[0], model), true);
  assert.equal(currentEffortId(current, model.reasoning), "high");
  assert.equal(currentEffortId({ provider: "olares-router", model: "qwen" }, model.reasoning), undefined);
});

test("effort and model labels follow the directory snapshot", () => {
  const reasoning = { defaultEffort: "low", efforts: [{ id: "low", name: "Low" }, { id: "high", name: "High" }] };
  assert.equal(effortDisplayLabel(undefined, "high", "Default"), undefined);
  assert.equal(effortDisplayLabel(reasoning, undefined, "Default"), "Default");
  assert.equal(effortDisplayLabel(reasoning, "high", "Default"), "High");
  assert.equal(sessionModelLabel({ name: "Qwen" }, { model: "qwen" }, "Select"), "Qwen");
  assert.deepEqual(effortMenuRows({ efforts: [{ id: "low", name: "Low" }] }, "Default")[0], {
    key: "provider-default",
    id: undefined,
    name: "Default",
  });
});

test("effort menu includes a provider-default row only when Router did not name one", () => {
  assert.deepEqual(effortMenuItems(undefined), []);
  assert.deepEqual(
    effortMenuItems({ defaultEffort: "low", efforts: [{ id: "low", name: "Low" }] }),
    [{ id: undefined, providerDefault: true }, { id: "low", providerDefault: false, name: "Low", description: undefined }],
  );
  assert.equal(effortMenuItems({ efforts: [{ id: "low", name: "Low" }] })[0].providerDefault, true);
});

test("settings list groups by provider registration order", () => {
  const groups = groupModelsByProvider([
    { provider: "olares-router", id: "a" },
    { provider: "other", id: "b" },
    { provider: "olares-router", id: "c" },
  ]);
  assert.deepEqual(
    groups.map((group) => ({ provider: group.provider, ids: group.models.map((model) => model.id) })),
    [
      { provider: "olares-router", ids: ["a", "c"] },
      { provider: "other", ids: ["b"] },
    ],
  );
  const current = { provider: "olares-router", model: "c" };
  assert.equal(catalogDefaultReady(groups.flatMap((group) => group.models), current), true);
  assert.equal(catalogDefaultReady(groups.flatMap((group) => group.models), { provider: "olares-router", model: "missing" }), false);
  assert.equal(selectionKey(current), "olares-router\u0000c");
});

test("the composer catalog keeps each model's reasoning and prefers the session selection", () => {
  const catalog = {
    default: { provider: "olares-router", model: "qwen" },
    groups: [{
      id: "olares-router",
      name: "Olares Router",
      models: [
        { id: "plain", name: "Plain" },
        {
          id: "qwen",
          name: "Qwen",
          reasoning: { efforts: [{ id: "low", name: "Low" }, { id: "high", name: "High" }] },
        },
      ],
    }],
    failures: [{ id: "other", name: "Other", message: "down" }],
  };
  const pending = { provider: "olares-router", model: "qwen", reasoningEffort: "high" };
  assert.deepEqual(
    sessionModelSelection({ next: pending }, catalog.default),
    pending,
  );
  assert.deepEqual(sessionModelSelection(null, catalog.default), catalog.default);
  const listed = composerModelsFromCatalog(catalog, pending);
  assert.equal(listed.default, pending);
  assert.equal(listed.routable, true);
  assert.deepEqual(listed.failures, [{ provider: "other", name: "Other", message: "down" }]);
  assert.deepEqual(listed.models[1].reasoning.efforts.map((level) => level.id), ["low", "high"]);
  assert.equal(reasoningOfModel(listed.models[1]).efforts.length, 2);
  assert.equal(composerModelsFromCatalog(null, pending), null);
});
