import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CatalogCache, writeCatalogSeed } from "../../packages/core/router/catalog-cache.js";

const payload = { data: [{ id: "Qwen/chat", mode: "chat" }] };

function okFetch(body = payload) {
  let calls = 0;
  const fetchImpl = async (url: string | URL) => {
    calls += 1;
    assert.match(String(url), /\/models\?include_not_ready=true$/);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls: () => calls };
}

test("catalog cache coalesces concurrent misses and serves within TTL", async () => {
  const { fetchImpl, calls } = okFetch();
  const cache = new CatalogCache({ ttlMs: 1_000, fetch: fetchImpl, now: () => 1_000 });
  const [a, b] = await Promise.all([cache.get(), cache.get()]);
  assert.equal(calls(), 1);
  assert.equal(a.rows[0].id, "Qwen/chat");
  assert.equal(b.rows[0].id, "Qwen/chat");
  await cache.get();
  assert.equal(calls(), 1);
});

test("invalidate forces the next get to hit Router", async () => {
  const { fetchImpl, calls } = okFetch();
  const cache = new CatalogCache({ ttlMs: 1_000, fetch: fetchImpl, now: () => 1_000 });
  await cache.get();
  cache.invalidate();
  await cache.get();
  assert.equal(calls(), 2);
});

test("TTL expiry refetches without an explicit invalidate", async () => {
  let now = 0;
  const { fetchImpl, calls } = okFetch();
  const cache = new CatalogCache({ ttlMs: 10, fetch: fetchImpl, now: () => now });
  now = 1;
  await cache.get();
  now = 12;
  await cache.get();
  assert.equal(calls(), 2);
});

test("a failed upstream leaves the next get free to retry", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response("nope", { status: 503 });
  };
  const cache = new CatalogCache({ ttlMs: 1_000, fetch: fetchImpl, now: () => 1 });
  await assert.rejects(() => cache.get(), (err: { code?: string; status?: number }) => {
    return err.code === "router_unavailable" && err.status === 503;
  });
  await assert.rejects(() => cache.get());
  assert.equal(calls, 2);
});

test("boot seed file is reused on the first get so the child does not refetch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lares-catalog-"));
  try {
    writeCatalogSeed(payload, dir);
    let calls = 0;
    const cache = new CatalogCache({
      ttlMs: 1_000,
      dataDir: dir,
      fetch: async () => {
        calls += 1;
        return new Response(JSON.stringify(payload), { status: 200 });
      },
      now: () => 1,
    });
    const snap = await cache.get();
    assert.equal(snap.rows[0].id, "Qwen/chat");
    assert.equal(calls, 0);
    assert.equal(JSON.parse(readFileSync(join(dir, "router-catalog.json"), "utf8")).data[0].id, "Qwen/chat");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a successful fetch writes the seed file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lares-catalog-write-"));
  try {
    const { fetchImpl } = okFetch();
    const cache = new CatalogCache({ ttlMs: 1_000, dataDir: dir, fetch: fetchImpl, now: () => 1 });
    await cache.get();
    assert.equal(JSON.parse(readFileSync(join(dir, "router-catalog.json"), "utf8")).data[0].id, "Qwen/chat");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unreadable seed file is ignored and the cache fetches", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lares-catalog-bad-"));
  try {
    writeFileSync(join(dir, "router-catalog.json"), "{", { mode: 0o600 });
    const { fetchImpl, calls } = okFetch();
    const cache = new CatalogCache({ ttlMs: 1_000, dataDir: dir, fetch: fetchImpl, now: () => 1 });
    await cache.get();
    assert.equal(calls(), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
