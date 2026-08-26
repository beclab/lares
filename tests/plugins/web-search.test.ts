import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  searchDefaultReady,
  searchMenuValue,
  searchSelectorItems,
  searchValueFromMenu,
} from "@lares/core/search/menu";
import { searchWebErrorCode } from "@lares/core/router/search";

test("search settings map none to an unset default", () => {
  assert.equal(searchMenuValue(null), "none");
  assert.equal(searchValueFromMenu("none"), null);
  assert.equal(searchDefaultReady([{ id: "tavily/search" }], "tavily/search"), true);
  assert.equal(searchDefaultReady([{ id: "tavily/search" }], "missing"), false);
  assert.deepEqual(searchSelectorItems([], { none: "None", empty: "No services" }), [
    { id: "none", label: "No services" },
  ]);
  assert.deepEqual(
    searchSelectorItems([{ id: "tavily/search", name: "Tavily" }], { none: "None", empty: "No services" }),
    [
      { id: "none", label: "None" },
      { id: "tavily/search", label: "Tavily" },
    ],
  );
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
    const { readConfig, setDefaultSearchModel } = await import(
      `../../packages/core/search/config.js?config=${Date.now()}`
    );
    const available = [{ id: "tavily/search" }];

    assert.equal(readConfig().defaultSearchModel, null);
    assert.throws(
      () => setDefaultSearchModel("missing/search", available),
      (err: { code?: string; status?: number }) => err.code === "not_available" && err.status === 400,
    );

    const saved = setDefaultSearchModel("  tavily/search  ", available);
    assert.equal(saved.defaultSearchModel, "tavily/search");
    assert.equal(readConfig().defaultSearchModel, "tavily/search");

    setDefaultSearchModel(null, available);
    assert.equal(readConfig().defaultSearchModel, null);
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
  try {
    const { setDefaultSearchModel, readConfig } = await import(
      `../../packages/core/search/config.js?read=${Date.now()}`
    );
    setDefaultSearchModel("tavily/search", [{ id: "tavily/search" }]);
    const { currentConfig } = await import(
      `../../packages/web/router-search/host/index.js?read=${Date.now()}`
    );
    assert.deepEqual(await currentConfig(), {
      defaultSearchModel: "tavily/search",
      searchModels: [],
    });
    assert.equal(readConfig().defaultSearchModel, "tavily/search");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
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

  const originalFetch = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    if (String(input).endsWith("/models")) {
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

    assert.equal(calls[0].url, "http://router.test/v1/models");
    assert.equal((calls[0].init.headers as Record<string, string>)["x-caller-appid"], "lares");
    assert.equal(calls[1].url, "http://router.test/v1/search");
    assert.deepEqual(JSON.parse(String(calls[1].init.body)), {
      model: "tavily/search",
      query: "Olares",
      max_results: 2,
    });
  } finally {
    globalThis.fetch = originalFetch;
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

test("dsh search facade follows the selected Router model", async () => {
  const home = mkdtempSync(join(tmpdir(), "lares-websearch-facade-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const originalFetch = globalThis.fetch;
  try {
    const { setDefaultSearchModel } = await import(
      `../../packages/core/search/config.js?facade=${Date.now()}`
    );
    const { createLaresSearchProvider } = await import(
      `../../packages/web/router-search/host/provider.js?facade=${Date.now()}`
    );
    const provider = createLaresSearchProvider();
    assert.equal(provider.available(), false);

    setDefaultSearchModel("tavily/search", [{ id: "tavily/search" }]);
    assert.equal(provider.available(), true);

    globalThis.fetch = async (_input, init) => {
      assert.equal(JSON.parse(String(init?.body)).model, "tavily/search");
      return new Response(
        JSON.stringify({ results: [{ url: "https://ok.test", title: "OK" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const result = await provider.search({ query: "news", maxResults: 4 });
    assert.equal(result.sources[0].url, "https://ok.test");
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
