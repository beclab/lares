import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SREF_KEY,
  encodeSref,
  isFlowstudioModel,
  isGenerationCreateRoute,
  srefKey,
  withSref,
  withSrefBuffer,
} from "@olares/lares-core/router/sref";

const NOW = 1_790_000_000 * 1000;
const NONCE = Buffer.from([...Array(16).keys()]);
const WORKFLOW = "Olares/b1f2c5f3-1ddf-4f4f-88e8-ca4052bab1e8";

test("sref matches the FlowStudio vector byte for byte", () => {
  // server/tests/test_router_sref.py LARES_VECTOR in FlowStudio.
  assert.equal(
    encodeSref("yuxing001", "test-key", { now: NOW, nonce: NONCE }),
    "1.AAECAwQFBgcICQoLDA0OD5vMnMDxzDY8WvFQNcAdXcC82xj4oR0fRbMgAEc5X6a4wkdGlqPlQ4YcqHORA-rBZg",
  );
});

test("sref never carries the username in the clear", () => {
  const token = encodeSref("yuxing001", "test-key", { now: NOW });
  assert.ok(!Buffer.from(token.slice(2), "base64url").includes(Buffer.from("yuxing001")));
});

test("only FlowStudio workflows on create routes are stamped", () => {
  assert.equal(isFlowstudioModel(WORKFLOW), true);
  assert.equal(isFlowstudioModel("Olares/unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL"), false);
  assert.equal(isFlowstudioModel("openai/gpt-image-1"), false);
  assert.equal(isGenerationCreateRoute("images/generations"), true);
  assert.equal(isGenerationCreateRoute("videos"), true);
  assert.equal(isGenerationCreateRoute("generations/gen_1"), false);
  assert.equal(isGenerationCreateRoute("chat/completions"), false);

  const env = { SREF_KEY: "k" };
  const cloud = { model: "openai/gpt-image-1", prompt: "x" };
  assert.equal(withSref(cloud, "yuxing001", env), cloud);
  const stamped = withSref({ model: WORKFLOW, prompt: "x" }, "yuxing001", env);
  assert.match(stamped.flowstudio.params.sref, /^1\./);
  assert.equal("sref" in stamped, false);
  assert.equal(stamped.prompt, "x");
});

test("a caller-supplied sref is replaced and missing user or key skips", () => {
  const env = { SREF_KEY: "k" };
  const body = { model: WORKFLOW, prompt: "x", sref: "1.forged" };
  assert.notEqual(withSref(body, "yuxing001", env).flowstudio.params.sref, "1.forged");
  assert.equal("sref" in withSref(body, "yuxing001", env), false);
  assert.equal(withSref({ model: WORKFLOW }, "", env).flowstudio, undefined);
  assert.equal(withSref({ model: WORKFLOW }, "yuxing001", { SREF_KEY: " " }).flowstudio, undefined);
  assert.equal(srefKey({}), DEFAULT_SREF_KEY);
});

test("raw bodies are stamped only when they are JSON", () => {
  const env = { SREF_KEY: "k" };
  const raw = Buffer.from(JSON.stringify({ model: WORKFLOW, prompt: "x" }));
  assert.match(JSON.parse(withSrefBuffer(raw, "yuxing001", env).toString()).flowstudio.params.sref, /^1\./);
  const form = Buffer.from("--boundary\r\n");
  assert.equal(withSrefBuffer(form, "yuxing001", env), form);
});

test("sref rides in flowstudio.params beside the workflow's own params, on every route", () => {
  const env = { SREF_KEY: "k" };
  // Router's canonical /generations refused a top-level sref: `json: unknown field "sref"`.
  const edit = withSref(
    { model: WORKFLOW, prompt: "x", operation: "edit", sref: "1.forged", flowstudio: { params: { megapixels: "0.92", sref: "1.forged" } } },
    "yuxing001",
    env,
  );
  assert.equal("sref" in edit, false);
  assert.equal(edit.flowstudio.params.megapixels, "0.92");
  assert.match(edit.flowstudio.params.sref, /^1\./);
  assert.notEqual(edit.flowstudio.params.sref, "1.forged");
});
