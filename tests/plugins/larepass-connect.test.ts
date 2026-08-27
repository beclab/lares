import assert from "node:assert/strict";
import test from "node:test";
import { createHostSettings, rememberedSettings } from "@olares/lares-core/larepass/settings";
import { connectChat, resetChatHost } from "../../packages/mobile/src/runtime.js";

function ok(body) {
  return { ok: true, status: 200, body };
}

function silentRequest() {
  return async () => ok({ models: [], default: null });
}

test("connectChat reuses one runtime per Host and disposes the previous on switch", async () => {
  resetChatHost();
  const first = connectChat({ baseUrl: "https://a.olares.com", request: silentRequest() });
  assert.equal(connectChat({ baseUrl: "https://a.olares.com", request: silentRequest() }), first);

  await createHostSettings(async () => ok({
    models: [{ id: "m1", provider: "p" }],
    default: { provider: "p", model: "m1" },
  })).models();
  assert.equal(rememberedSettings().models.default.model, "m1");

  let disposed = 0;
  const original = first.dispose.bind(first);
  first.dispose = () => {
    disposed += 1;
    original();
  };

  const second = connectChat({ baseUrl: "https://b.olares.com", request: silentRequest() });
  assert.notEqual(second, first);
  assert.equal(disposed, 1);
  assert.equal(rememberedSettings().models, null);
  resetChatHost();
});
