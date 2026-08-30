import assert from "node:assert/strict";
import test from "node:test";
import { watchCatalogRevision } from "../../packages/plugins/shared/client/catalog-events.js";
import { watchRouterCatalog } from "../../packages/plugins/shared/host/catalog-events.js";

test("watchRouterCatalog is a no-op when the NATS URL is empty", async () => {
  assert.equal(await watchRouterCatalog(() => {}, { env: {} }), null);
  assert.equal(await watchRouterCatalog(() => {}, { env: { LARES_CATALOG_EVENTS_NATS_URL: "  " } }), null);
});

test("watchCatalogRevision ignores the snapshot and fires on a later revision", () => {
  const sources: FakeEventSource[] = [];
  class FakeEventSource {
    onmessage: ((event: { data: string }) => void) | null = null;
    closed = false;
    constructor(public url: string) {
      sources.push(this);
    }
    close() {
      this.closed = true;
    }
    emit(revision: number) {
      this.onmessage?.({ data: JSON.stringify({ revision }) });
    }
  }
  const previous = globalThis.EventSource;
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  const seen: number[] = [];
  try {
    const stop = watchCatalogRevision((revision) => seen.push(revision));
    assert.equal(sources[0].url, "/api/lares/models/events");
    sources[0].emit(3);
    sources[0].emit(3);
    sources[0].emit(4);
    assert.deepEqual(seen, [4]);
    stop();
    assert.equal(sources[0].closed, true);
  } finally {
    globalThis.EventSource = previous;
  }
});
