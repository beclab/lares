import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("publicConfig redacts apiKey and writeProvider keeps the stored secret on blank", async () => {
  const home = mkdtempSync(join(tmpdir(), "dina-websearch-"));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { publicConfig, readConfig, writeProvider } = await import(
      `../../packages/plugins/web-search/host/config.js?cfg=${Date.now()}`
    );

    assert.equal(readConfig().providers.tavily.apiKey, "");
    writeProvider("tavily", { apiKey: " tvly-secret " });
    writeProvider("custom", { url: " https://example.com/search ", apiKey: "custom-key" });

    const stored = readConfig();
    assert.equal(stored.defaultProvider, null);
    assert.equal(stored.providers.tavily.apiKey, "tvly-secret");
    assert.equal(stored.providers.custom.url, "https://example.com/search");

    const view = publicConfig();
    assert.equal(view.providers.tavily.hasApiKey, true);
    assert.equal(view.providers.tavily.saved, true);
    assert.equal(Object.hasOwn(view.providers.tavily, "apiKey"), false);
    assert.equal(view.providers.custom.saved, true);
    assert.equal(view.providers.custom.url, "https://example.com/search");

    writeProvider("tavily", { apiKey: "   " });
    assert.equal(readConfig().providers.tavily.apiKey, "tvly-secret");
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
});

test("providerReady follows the saved credentials of the default provider", async () => {
  const { providerReady, providerConfigured } = await import(
    `../../packages/plugins/web-search/host/config.js?ready=${Date.now()}`
  );
  const config = (defaultProvider, providers) => ({ defaultProvider, providers });

  assert.equal(
    providerConfigured(
      config(null, { tavily: { apiKey: "k" }, custom: { url: "", apiKey: "" } }),
      "tavily",
    ),
    true,
  );
  assert.equal(
    providerReady(config(null, { tavily: { apiKey: "k" }, custom: { url: "", apiKey: "" } })),
    false,
  );
  assert.equal(
    providerReady(config("tavily", { tavily: { apiKey: "k" }, custom: { url: "", apiKey: "" } })),
    true,
  );
  assert.equal(
    providerReady(config("tavily", { tavily: { apiKey: "" }, custom: { url: "", apiKey: "" } })),
    false,
  );
  assert.equal(
    providerReady(
      config("custom", {
        tavily: { apiKey: "" },
        custom: { url: "https://example.com/s", apiKey: "k" },
      }),
    ),
    true,
  );
  assert.equal(
    providerReady(
      config("custom", { tavily: { apiKey: "" }, custom: { url: "not-a-url", apiKey: "k" } }),
    ),
    false,
  );
});

test("setDefaultProvider only accepts saved backends", async () => {
  const home = mkdtempSync(join(tmpdir(), "dina-websearch-default-"));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { readConfig, setDefaultProvider, writeProvider } = await import(
      `../../packages/plugins/web-search/host/config.js?default=${Date.now()}`
    );
    assert.throws(() => setDefaultProvider("tavily"), (err) => err.code === "not_saved");
    assert.throws(() => setDefaultProvider("custom"), (err) => err.code === "not_saved");

    writeProvider("tavily", { apiKey: "tvly" });
    setDefaultProvider("tavily");
    assert.equal(readConfig().defaultProvider, "tavily");

    setDefaultProvider(null);
    assert.equal(readConfig().defaultProvider, null);
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
});

test("mapTavilyPayload and mapDinaPayload normalize sources", async () => {
  const { mapTavilyPayload } = await import(
    `../../packages/plugins/web-search/host/providers/tavily.js?map=${Date.now()}`
  );
  const { mapDinaPayload } = await import(
    `../../packages/plugins/web-search/host/providers/custom.js?map=${Date.now()}`
  );
  assert.deepEqual(
    mapTavilyPayload({
      results: [
        { title: "Hello", url: "https://example.com", content: "world", score: 0.9 },
        { url: "" },
        "skip",
      ],
    }),
    [{ url: "https://example.com", title: "Hello", snippet: "world" }],
  );
  assert.deepEqual(
    mapDinaPayload({
      sources: [
        { url: "https://a.test", title: "A", snippet: "s", publishedAt: "2026-01-01" },
        { url: "https://b.test" },
      ],
    }),
    [
      { url: "https://a.test", title: "A", snippet: "s", publishedAt: "2026-01-01" },
      { url: "https://b.test" },
    ],
  );
});

test("tavilySearch maps success and auth errors", async () => {
  const { tavilySearch, TAVILY_SEARCH_URL } = await import(
    `../../packages/plugins/web-search/host/providers/tavily.js?http=${Date.now()}`
  );
  const { WebError } = await import("@deepseek-ai/dsh-web");

  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, TAVILY_SEARCH_URL);
    assert.equal(init.headers.Authorization, "Bearer tvly-ok");
    const body = JSON.parse(init.body);
    assert.equal(body.query, "hello");
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return {
          results: [{ title: "Doc", url: "https://example.com/doc", content: "snippet" }],
        };
      },
      async text() {
        return "";
      },
    };
  };
  try {
    const result = await tavilySearch("tvly-ok", "hello", { maxResults: 3 });
    assert.equal(result.sources[0].url, "https://example.com/doc");
    assert.equal(result.sources[0].snippet, "snippet");
    assert.equal(result.truncated, false);
  } finally {
    globalThis.fetch = original;
  }

  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    statusText: "Unauthorized",
    async json() {
      return { detail: "unauthorized" };
    },
    async text() {
      return "";
    },
  });
  try {
    await assert.rejects(() => tavilySearch("bad", "hello"), (err) => {
      assert.ok(err instanceof WebError);
      assert.equal(err.code, "WEB_PROVIDER_CREDENTIAL_MISSING");
      return true;
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("customSearch supports dina and tavily-compat protocols", async () => {
  const { customSearch } = await import(
    `../../packages/plugins/web-search/host/providers/custom.js?http=${Date.now()}`
  );
  const original = globalThis.fetch;

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.deepEqual(body, { query: "q", maxResults: 2 });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return { sources: [{ url: "https://dina.test", title: "D", snippet: "s" }] };
      },
      async text() {
        return "";
      },
    };
  };
  try {
    const result = await customSearch({
      url: "https://example.com/search",
      apiKey: "k",
      protocol: "dina",
      query: "q",
      maxResults: 2,
    });
    assert.equal(result.sources[0].url, "https://dina.test");
  } finally {
    globalThis.fetch = original;
  }

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.max_results, 3);
    assert.equal(body.search_depth, "basic");
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return { results: [{ url: "https://tvly.test", title: "T", content: "c" }] };
      },
      async text() {
        return "";
      },
    };
  };
  try {
    const result = await customSearch({
      url: "https://example.com/tavily",
      apiKey: "k",
      protocol: "tavily-compat",
      query: "q",
      maxResults: 3,
    });
    assert.equal(result.sources[0].snippet, "c");
  } finally {
    globalThis.fetch = original;
  }
});

test("facade available/search follows the default provider", async () => {
  const home = mkdtempSync(join(tmpdir(), "dina-websearch-facade-"));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const original = globalThis.fetch;
  try {
    const { setDefaultProvider, writeProvider } = await import(
      `../../packages/plugins/web-search/host/config.js?facade=${Date.now()}`
    );
    const { createDinaSearchProvider, DINA_PROVIDER_ID } = await import(
      `../../packages/plugins/web-search/host/provider.js?facade=${Date.now()}`
    );
    const provider = createDinaSearchProvider();
    assert.equal(provider.id, DINA_PROVIDER_ID);
    assert.equal(provider.available(), false);

    writeProvider("tavily", { apiKey: "tvly" });
    assert.equal(provider.available(), false);
    setDefaultProvider("tavily");
    assert.equal(provider.available(), true);

    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return { results: [{ url: "https://ok.test", title: "OK", content: "x" }] };
        },
        async text() {
          return "";
        },
      };
    };
    const result = await provider.search({ query: "news", maxResults: 4 });
    assert.equal(called, true);
    assert.equal(result.sources[0].url, "https://ok.test");

    writeProvider("custom", { url: "https://x.test", apiKey: "k" });
    setDefaultProvider("custom");
    assert.equal(provider.available(), true);

    setDefaultProvider(null);
    assert.equal(provider.available(), false);
    await assert.rejects(() => provider.search({ query: "news" }), (err) => {
      assert.equal(err.code, "WEB_PROVIDER_CONFIGURED_UNAVAILABLE");
      return true;
    });
  } finally {
    globalThis.fetch = original;
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
});
