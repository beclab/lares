import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  searchMenuValue,
  searchSelectorItems,
  searchStatus,
  searchValueFromMenu,
} from "@olares/lares-core/search/menu";
import { searchWebErrorCode } from "@olares/lares-core/router/search";

test("search settings keep following Router apart from being turned off", () => {
  assert.equal(searchMenuValue(null), "router-default");
  assert.equal(searchMenuValue({ defaultSearchModel: null, searchOff: false }), "router-default");
  assert.equal(searchMenuValue({ defaultSearchModel: null, searchOff: true }), "off");
  assert.equal(searchMenuValue({ defaultSearchModel: "tavily/search", searchOff: false }), "tavily/search");

  assert.deepEqual(searchValueFromMenu("router-default"), { defaultSearchModel: null, searchOff: false });
  assert.deepEqual(searchValueFromMenu("off"), { defaultSearchModel: null, searchOff: true });
  assert.deepEqual(searchValueFromMenu("tavily/search"), {
    defaultSearchModel: "tavily/search",
    searchOff: false,
  });

  assert.deepEqual(
    searchSelectorItems([{ id: "tavily/search", name: "Tavily" }], { routerDefault: "Router", off: "Off" }),
    [
      { id: "router-default", label: "Router" },
      { id: "tavily/search", label: "Tavily" },
      { id: "off", label: "Off" },
    ],
  );
});

test("search status separates following Router from an empty or stale choice", () => {
  const listed = [{ id: "tavily/search" }];
  assert.deepEqual(searchStatus(listed, { defaultSearchModel: null, searchOff: false }), {
    ready: true,
    key: "settings.status.router",
  });
  assert.deepEqual(searchStatus([], { defaultSearchModel: null, searchOff: false }), {
    ready: false,
    key: "settings.status.empty",
  });
  assert.deepEqual(searchStatus(listed, { defaultSearchModel: null, searchOff: true }), {
    ready: false,
    key: "settings.status.off",
  });
  assert.deepEqual(searchStatus(listed, { defaultSearchModel: "tavily/search", searchOff: false }), {
    ready: true,
    key: "settings.status.ready",
    model: "tavily/search",
  });
  assert.deepEqual(searchStatus(listed, { defaultSearchModel: "gone/search", searchOff: false }), {
    ready: false,
    key: "settings.status.notReady",
    model: "gone/search",
  });
});

test("SearchError codes map onto dsh WebError codes", () => {
  assert.equal(searchWebErrorCode("no_model"), "WEB_PROVIDER_CONFIGURED_UNAVAILABLE");
  assert.equal(searchWebErrorCode("aborted"), "WEB_ABORTED");
  assert.equal(searchWebErrorCode("unknown"), "WEB_PROVIDER_ERROR");
});

test("Router catalog exposes only search models", async () => {
    const { searchModelsFromRouterCatalog } = await import(
      `../../packages/core/router/search.js?catalog=${Date.now()}`
    );
  assert.deepEqual(
    searchModelsFromRouterCatalog({
      data: [
        { id: "openai/gpt", mode: "chat" },
        { id: "tavily/search", mode: "search" },
        { id: "tavily/search-advanced", mode: "SEARCH" },
        { id: "tavily/search", mode: "search" },
        { id: "", mode: "search" },
        { id: "unsafe\r\nmodel", mode: "search" },
      ],
    }),
    [
      { id: "tavily/search", name: "tavily/search" },
      { id: "tavily/search-advanced", name: "tavily/search-advanced" },
    ],
  );
});

test("default search model must come from the live Router catalog", async () => {
  const home = mkdtempSync(join(tmpdir(), "lares-websearch-"));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { readConfig, setSearchSelection } = await import(
      `../../packages/core/search/config.js?config=${Date.now()}`
    );
    const available = [{ id: "tavily/search" }];

    assert.deepEqual(readConfig(), { defaultSearchModel: null, searchOff: false });
    assert.throws(
      () => setSearchSelection({ defaultSearchModel: "missing/search", searchOff: false }, available),
      (err: { code?: string; status?: number }) => err.code === "not_available" && err.status === 400,
    );

    const saved = setSearchSelection({ defaultSearchModel: "  tavily/search  ", searchOff: false }, available);
    assert.equal(saved.defaultSearchModel, "tavily/search");
    assert.equal(readConfig().defaultSearchModel, "tavily/search");

    // Turning search off is remembered as its own state, so an automatic
    // default can never reopen it.
    setSearchSelection({ defaultSearchModel: null, searchOff: true }, available);
    assert.deepEqual(readConfig(), { defaultSearchModel: null, searchOff: true });

    setSearchSelection({ defaultSearchModel: null, searchOff: false }, available);
    assert.deepEqual(readConfig(), { defaultSearchModel: null, searchOff: false });
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  }
});

test("reading a temporarily incomplete Router catalog does not erase the saved default", async () => {
  const home = mkdtempSync(join(tmpdir(), "lares-websearch-read-"));
  const previousHome = process.env.DSH_HOME;
  const originalFetch = globalThis.fetch;
  process.env.DSH_HOME = home;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const { catalogCache } = await import("../../packages/core/router/catalog-cache.js");
  catalogCache.reset();
  try {
    const { setSearchSelection, readConfig } = await import(
      `../../packages/core/search/config.js?read=${Date.now()}`
    );
    setSearchSelection({ defaultSearchModel: "tavily/search", searchOff: false }, [{ id: "tavily/search" }]);
    const { currentConfig } = await import(
      `../../packages/web/router-search/host/index.js?read=${Date.now()}`
    );
    assert.deepEqual(await currentConfig(), {
      defaultSearchModel: "tavily/search",
      searchOff: false,
      searchModels: [],
    });
    assert.equal(readConfig().defaultSearchModel, "tavily/search");
  } finally {
    globalThis.fetch = originalFetch;
    catalogCache.reset();
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
});

test("a search settings refresh hits Router instead of the catalog TTL", async () => {
  const home = mkdtempSync(join(tmpdir(), "lares-websearch-refresh-"));
  const previousHome = process.env.DSH_HOME;
  const previousUrl = process.env.LLM_GATEWAY_URL;
  const originalFetch = globalThis.fetch;
  process.env.DSH_HOME = home;
  process.env.LLM_GATEWAY_URL = "http://router.test/v1";
  const { catalogCache } = await import("../../packages/core/router/catalog-cache.js");
  catalogCache.reset();
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls += 1;
    assert.match(String(input), /\/models\?include_not_ready=true$/);
    return new Response(
      JSON.stringify({ data: [{ id: `tavily/${calls}`, mode: "search" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const { currentSearchConfig } = await import(
      `../../packages/core/search/config.js?refresh=${Date.now()}`
    );
    assert.equal((await currentSearchConfig()).searchModels[0].id, "tavily/1");
    assert.equal((await currentSearchConfig()).searchModels[0].id, "tavily/1");
    assert.equal(calls, 1);
    assert.equal((await currentSearchConfig({ refresh: true })).searchModels[0].id, "tavily/2");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    catalogCache.reset();
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    if (previousUrl === undefined) delete process.env.LLM_GATEWAY_URL;
    else process.env.LLM_GATEWAY_URL = previousUrl;
    rmSync(home, { recursive: true, force: true });
  }
});

test("Router list and search use the same gateway identity as LLM calls", async () => {
  const previous = {
    url: process.env.LLM_GATEWAY_URL,
    appId: process.env.OLARES_APP_ID,
    key: process.env.LARES_ROUTER_API_KEY,
  };
  process.env.LLM_GATEWAY_URL = "http://router.test/v1/";
  process.env.OLARES_APP_ID = "lares";
  delete process.env.LARES_ROUTER_API_KEY;

  const { catalogCache } = await import("../../packages/core/router/catalog-cache.js");
  catalogCache.reset();

  const originalFetch = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    if (String(input).includes("/models")) {
      return new Response(
        JSON.stringify({
          data: [
            { id: "chat/model", mode: "chat" },
            { id: "tavily/search", mode: "search" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        object: "search",
        results: [
          { title: "Olares", url: "https://olares.com", snippet: "Personal cloud" },
          { title: "unsafe", url: "javascript:alert(1)", snippet: "must not escape" },
          { title: "skip" },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const { fetchRouterSearchModels, routerSearch } = await import(
      `../../packages/web/router-search/host/router.js?http=${Date.now()}`
    );
    assert.deepEqual(await fetchRouterSearchModels(), [
      { id: "tavily/search", name: "tavily/search" },
    ]);

    const result = await routerSearch("tavily/search", "Olares", { maxResults: 2 });
    assert.deepEqual(result, {
      sources: [
        { title: "Olares", url: "https://olares.com", snippet: "Personal cloud" },
      ],
      truncated: false,
    });

    assert.equal(calls[0].url, "http://router.test/v1/models?include_not_ready=true");
    assert.equal((calls[0].init.headers as Record<string, string>)["x-caller-appid"], "lares");
    assert.equal(calls[1].url, "http://router.test/v1/search");
    assert.deepEqual(JSON.parse(String(calls[1].init.body)), {
      model: "tavily/search",
      query: "Olares",
      max_results: 2,
    });
  } finally {
    globalThis.fetch = originalFetch;
    catalogCache.reset();
    restoreEnv("LLM_GATEWAY_URL", previous.url);
    restoreEnv("OLARES_APP_ID", previous.appId);
    restoreEnv("LARES_ROUTER_API_KEY", previous.key);
  }
});

test("Router search distinguishes its timeout from caller cancellation", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  try {
    const { routerSearch } = await import(
      `../../packages/web/router-search/host/router.js?timeout=${Date.now()}`
    );
    await assert.rejects(
      () => routerSearch("tavily/search", "news", { timeoutMs: 1 }),
      (err: { code?: string; message?: string }) =>
        err.code === "WEB_PROVIDER_ERROR" && /timed out/i.test(err.message ?? ""),
    );

    const controller = new AbortController();
    const request = routerSearch("tavily/search", "news", {
      signal: controller.signal,
      timeoutMs: 1_000,
    });
    controller.abort(new Error("cancelled by caller"));
    await assert.rejects(
      () => request,
      (err: { code?: string }) => err.code === "WEB_ABORTED",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dsh search facade works before anyone picks a service", async () => {
  const home = mkdtempSync(join(tmpdir(), "lares-websearch-facade-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const originalFetch = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = async (_input, init) => {
    asked.push(JSON.parse(String(init?.body)).model);
    return new Response(
      JSON.stringify({ results: [{ url: "https://ok.test", title: "OK" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const { setSearchSelection } = await import(
      `../../packages/core/search/config.js?facade=${Date.now()}`
    );
    const { createLaresSearchProvider } = await import(
      `../../packages/web/router-search/host/provider.js?facade=${Date.now()}`
    );
    const provider = createLaresSearchProvider();

    // A fresh install has chosen nothing, and must still search: the choice
    // belongs to Router's own default-search category.
    assert.equal(provider.available(), true);
    const result = await provider.search({ query: "news", maxResults: 4 });
    assert.equal(result.sources[0].url, "https://ok.test");
    assert.deepEqual(asked, ["default-search"]);

    setSearchSelection({ defaultSearchModel: "tavily/search", searchOff: false }, [{ id: "tavily/search" }]);
    assert.equal(provider.available(), true);
    await provider.search({ query: "news" });
    assert.deepEqual(asked, ["default-search", "tavily/search"]);

    setSearchSelection({ defaultSearchModel: null, searchOff: true }, []);
    assert.equal(provider.available(), false);
    await assert.rejects(
      () => provider.search({ query: "news" }),
      (err: { code?: string }) => err.code === "WEB_PROVIDER_CONFIGURED_UNAVAILABLE",
    );
    assert.equal(asked.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
