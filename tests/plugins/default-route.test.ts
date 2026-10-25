import assert from "node:assert/strict";
import test from "node:test";
import { defaultChatTarget } from "../../packages/core/router/default-route.js";

const env = { LLM_GATEWAY_URL: "https://router.example/v1" };
const member = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ provider_model_id: id, qualified_name: name, servable: true, priority: 100, ...extra });
const routes = (chat: Record<string, unknown>) => ({ items: [{ name: "default-embed", kind: "default", members: [member("e", "Olares/embed")] }, { name: "default-chat", kind: "default", enabled: true, ...chat }] });
const serve = (body: unknown, status = 200) => {
  const seen: string[] = [];
  const fetch = async (url: string) => { seen.push(url); return new Response(JSON.stringify(body), { status }); };
  return { fetch: fetch as unknown as typeof globalThis.fetch, seen };
};

test("default-chat resolves to its target's qualified id from the console route list", async () => {
  const router = serve(routes({ members: [member("a", "Olares/big"), member("b", "Olares/small")], target: { provider_model_id: "b" } }));
  assert.equal(await defaultChatTarget({ env, fetch: router.fetch }), "Olares/small");
  assert.deepEqual(router.seen, ["https://router.example/console/api/model-routes?kind=default"]);
});

test("without a target the highest-priority servable member answers", async () => {
  const router = serve(routes({ members: [member("a", "Olares/stopped", { servable: false, priority: 200 }), member("b", "Olares/low", { priority: 10 }), member("c", "Olares/high", { priority: 50 })] }));
  assert.equal(await defaultChatTarget({ env, fetch: router.fetch }), "Olares/high");
});

test("an unservable target, a disabled route or an unreachable console is null", async () => {
  assert.equal(await defaultChatTarget({ env, fetch: serve(routes({ members: [member("a", "Olares/big", { servable: false })], target: { provider_model_id: "a" } })).fetch }), null);
  assert.equal(await defaultChatTarget({ env, fetch: serve(routes({ enabled: false, members: [member("a", "Olares/big")] })).fetch }), null);
  assert.equal(await defaultChatTarget({ env, fetch: serve({ error: "forbidden" }, 403).fetch }), null);
  assert.equal(await defaultChatTarget({ env, fetch: (async () => { throw new Error("offline"); }) as unknown as typeof fetch }), null);
});
