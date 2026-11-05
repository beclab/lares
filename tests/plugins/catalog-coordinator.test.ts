import assert from "node:assert/strict";
import test from "node:test";
import { CatalogCache } from "../../packages/core/router/catalog-cache.js";
import { CatalogCoordinator } from "../../packages/core/router/catalog-coordinator.js";

test("catalog publication waits for dsh and coalesces competing reads", async () => {
  const cache = new CatalogCache();
  cache.seed({ data: [{ id: "new/model", mode: "chat" }] });
  const coordinator = new CatalogCoordinator(cache);
  let release: () => void = () => {};
  let writes = 0;
  const ports = { mutateSettings: async () => { writes++; await new Promise<void>((resolve) => { release = resolve; }); } };
  const first = coordinator.sync(ports), second = coordinator.sync(ports);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(coordinator.committed, null);
  assert.equal(coordinator.revision, 0);
  release();
  assert.equal(await first, await second);
  assert.equal(writes, 1);
  assert.equal(coordinator.committed.models[0].id, "new/model");
});

test("empty success clears dsh; a failed update preserves the committed snapshot", async () => {
  const cache = new CatalogCache();
  const coordinator = new CatalogCoordinator(cache);
  const updates: any[] = [];
  const ports = { mutateSettings: async (_ns, ops) => { updates.push(ops[0].value); } };
  cache.seed({ data: [{ id: "old/model", mode: "chat" }] });
  await coordinator.sync(ports);
  cache.seed({ data: [] }); await coordinator.sync(ports);
  assert.deepEqual(updates[1], []);
  cache.seed({ data: [{ id: "other/model", mode: "chat" }] });
  const revision = coordinator.revision;
  await assert.rejects(coordinator.sync({ mutateSettings: async () => { throw Error("write rejected"); } }));
  assert.deepEqual(coordinator.committed.models, []);
  assert.equal(coordinator.revision, revision);
});

test("a reasoning default change publishes a new capability version", async () => {
  const cache = new CatalogCache();
  const coordinator = new CatalogCoordinator(cache);
  const ports = { mutateSettings: async () => {} };
  const seed = (value: string) => cache.seed({ data: [{ id: "model", mode: "chat", supports: ["reasoning_effort"], reasoning_effort: { options: ["none", "high"], default: value } }] });
  seed("high"); await coordinator.sync(ports);
  seed("none"); await coordinator.sync(ports);
  assert.equal(coordinator.revision, 2);
  assert.equal(coordinator.committed.rows[0].reasoningDefault, "none");
});

test("the default follows default-chat, read once per catalog TTL unless refreshed", async () => {
  let now = 0;
  const catalog = { data: [{ id: "big/model", mode: "chat" }, { id: "small/model", mode: "chat" }] };
  const cache = new CatalogCache({ now: () => now, ttlMs: 1000, fetch: (async () => new Response(JSON.stringify(catalog))) as unknown as typeof fetch });
  cache.seed(catalog);
  const coordinator = new CatalogCoordinator(cache);
  let target = "big/model", reads = 0;
  let current = { provider: "olares-router", model: "big/model" };
  const ports = {
    mutateSettings: async () => {},
    defaultChat: async () => { reads++; return target; },
    defaultModel: { currentSelection: () => current, saveSelection: async (next: any) => { current = next; } },
  };
  await coordinator.sync(ports);
  assert.equal(current.model, "big/model");
  target = "small/model";
  now = 500; await coordinator.sync(ports);
  assert.equal(reads, 1);
  assert.equal(current.model, "big/model");
  now = 1500; await coordinator.sync(ports);
  assert.equal(reads, 2);
  assert.equal(current.model, "small/model");
  target = "big/model";
  await coordinator.sync(ports, true);
  assert.equal(reads, 3);
  assert.equal(current.model, "big/model");
});
