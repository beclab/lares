import assert from "node:assert/strict";
import test from "node:test";
import { catalogCache } from "../../packages/core/router/catalog-cache.js";

type Ctx = {
  llm: {
    listProviders: () => { id: string; name: string }[];
    listModels: (provider: string) => Promise<{ id: string; name: string; description?: string }[]>;
    resolveCallConfig: (config: { provider: string; model: string }) => Promise<{ provider: string; model: string }>;
  };
  agentDefaultModel: {
    currentSelection: () => { provider: string; model: string; reasoningEffort?: string };
    saveSelection: (next: { provider: string; model: string }) => Promise<void>;
  };
  settings: {
    mutate: (ns: string, ops: unknown[]) => Promise<void>;
  };
};

function catalogModule() {
  return import(`../../packages/web/chat-model/host/catalog.js?t=${Date.now()}`);
}

function stubCtx(overrides: Partial<Ctx["llm"]> = {}, saved: unknown[] = [], mutations: unknown[] = []): Ctx {
  return {
    llm: {
      listProviders: () => [{ id: "olares-router", name: "Olares Router" }],
      listModels: async () => [{ id: "Qwen/chat", name: "Qwen chat" }],
      resolveCallConfig: async (config) => ({ provider: config.provider, model: config.model }),
      ...overrides,
    },
    agentDefaultModel: {
      currentSelection: () => ({ provider: "olares-router", model: "Qwen/chat", reasoningEffort: "off" }),
      saveSelection: async (next) => {
        saved.push(next);
      },
    },
    settings: {
      mutate: async (ns, ops) => {
        mutations.push({ ns, ops });
      },
    },
  };
}

test("Router refresh keeps only unique chat models", async () => {
  const { chatModelsFromRouterCatalog } = await catalogModule();
  assert.deepEqual(
    chatModelsFromRouterCatalog({
      data: [
        { id: "Qwen/chat", mode: "chat", supports: ["vision"] },
        { id: "Qwen/chat", mode: "chat" },
        { id: "whisper", mode: "audio" },
        { id: "legacy-chat" },
        { id: "legacy-embed" },
        { id: "unsafe\r\nmodel", mode: "chat" },
        {
          id: "Qwen/thinks",
          mode: "chat",
          supports: ["reasoning_effort"],
          reasoning_effort: { options: ["low", "xhigh"] },
        },
      ],
    }),
    [
      { id: "Qwen/chat", name: "Qwen/chat", input: ["text", "image"] },
      { id: "legacy-chat", name: "legacy-chat" },
      { id: "Qwen/thinks", name: "Qwen/thinks", reasoningEfforts: { low: "low", xhigh: "xhigh" } },
    ],
  );
});

test("Router refresh declares the sizes Router states and omits the ones it does not", async () => {
  const { chatModelsFromRouterCatalog } = await catalogModule();
  assert.deepEqual(
    chatModelsFromRouterCatalog({
      data: [
        { id: "Qwen/sized", mode: "chat", context_size: 104448, max_output_tokens: 8192 },
        { id: "Qwen/unsized", mode: "chat" },
        { id: "Qwen/context-only", mode: "chat", context_size: 32768 },
        // Router omits a size it does not know rather than sending zero; a
        // payload that sends one anyway must not size the model at zero.
        { id: "Qwen/zeroed", mode: "chat", context_size: 0, max_output_tokens: -1 },
        { id: "Qwen/fractional", mode: "chat", context_size: 1024.5 },
        { id: "Qwen/stringly", mode: "chat", context_size: "104448" },
      ],
    }),
    [
      { id: "Qwen/sized", name: "Qwen/sized", contextWindow: 104448, maxTokens: 8192 },
      { id: "Qwen/unsized", name: "Qwen/unsized" },
      { id: "Qwen/context-only", name: "Qwen/context-only", contextWindow: 32768 },
      { id: "Qwen/zeroed", name: "Qwen/zeroed" },
      { id: "Qwen/fractional", name: "Qwen/fractional" },
      { id: "Qwen/stringly", name: "Qwen/stringly" },
    ],
  );
});

test("Router refresh replaces the routable catalog and repairs a stale default", async () => {
  const { refreshCatalog, catalogRevision, onCatalogRevision } = await catalogModule();
  const previousFetch = globalThis.fetch;
  const saved: unknown[] = [];
  const mutations: unknown[] = [];
  const revisions: number[] = [];
  catalogCache.reset();
  const stop = onCatalogRevision((revision) => revisions.push(revision));
  const before = catalogRevision();
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [{ id: "Qwen/new", mode: "chat" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    const ctx = stubCtx({}, saved, mutations);
    assert.deepEqual(await refreshCatalog(ctx), [{ id: "Qwen/new", name: "Qwen/new" }]);
    assert.deepEqual(mutations, [
      {
        ns: "llm-pi-ai",
        ops: [
          {
            op: "set",
            path: ["providers", "olares-router", "models"],
            value: [{ id: "Qwen/new", name: "Qwen/new" }],
          },
        ],
      },
    ]);
    assert.deepEqual(saved, [{ provider: "olares-router", model: "Qwen/new" }]);
    assert.equal(catalogRevision(), before + 1);
    assert.deepEqual(revisions, [before + 1]);
  } finally {
    stop();
    globalThis.fetch = previousFetch;
    catalogCache.reset();
  }
});

test("Router refresh repairs a stale default with the preferred MTP build", async () => {
  const { refreshCatalog } = await catalogModule();
  const previousFetch = globalThis.fetch;
  const saved: unknown[] = [];
  catalogCache.reset();
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          { id: "Qwen/plain", mode: "chat" },
          { id: "Qwen/MTP-fast", mode: "chat" },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  try {
    await refreshCatalog(stubCtx({}, saved));
    assert.deepEqual(saved, [{ provider: "olares-router", model: "Qwen/MTP-fast" }]);
  } finally {
    globalThis.fetch = previousFetch;
    catalogCache.reset();
  }
});

test("concurrent Router refresh requests share one catalog update", async () => {
  const { refreshCatalog } = await catalogModule();
  const previousFetch = globalThis.fetch;
  catalogCache.reset();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(JSON.stringify({ data: [{ id: "Qwen/chat", mode: "chat" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const ctx = stubCtx();
    await Promise.all([refreshCatalog(ctx), refreshCatalog(ctx)]);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
    catalogCache.reset();
  }
});

test("a failed settings write leaves the catalog cache on the previous snapshot", async () => {
  const { refreshCatalog, catalogRevision } = await catalogModule();
  const previousFetch = globalThis.fetch;
  catalogCache.reset();
  catalogCache.seed({ data: [{ id: "Qwen/old", mode: "chat" }] });
  const before = catalogRevision();
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [{ id: "Qwen/new", mode: "chat" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    const ctx = stubCtx();
    ctx.settings.mutate = async () => {
      throw new Error("settings locked");
    };
    await assert.rejects(() => refreshCatalog(ctx), /settings locked/);
    assert.equal(catalogCache.snapshot().rows[0].id, "Qwen/old");
    assert.equal(catalogRevision(), before);
  } finally {
    globalThis.fetch = previousFetch;
    catalogCache.reset();
  }
});

test("catalog lists only Router models even when community providers are registered", async () => {
  const { listCatalog } = await catalogModule();
  const asked: string[] = [];
  const ctx = stubCtx({
    listProviders: () => [
      { id: "olares-router", name: "Olares Router" },
      { id: "community", name: "Community" },
    ],
    listModels: async (provider: string) => {
      asked.push(provider);
      return [
        { id: "Qwen/chat", name: "Qwen chat", description: "general" },
        { id: "Qwen/other", name: "" },
      ];
    },
  });

  assert.deepEqual(await listCatalog(ctx), {
    models: [
      {
        provider: "olares-router",
        providerName: "Olares Router",
        id: "Qwen/chat",
        name: "Qwen chat",
        description: "general",
      },
      { provider: "olares-router", providerName: "Olares Router", id: "Qwen/other", name: "Qwen/other" },
    ],
    failures: [],
  });
  assert.deepEqual(asked, ["olares-router"]);
});

test("the Router placeholder is not presented as a usable chat model", async () => {
  const { listCatalog } = await catalogModule();
  const ctx = stubCtx({
    listModels: async () => [{ id: "default", name: "default" }],
  });
  assert.deepEqual(await listCatalog(ctx), { models: [], failures: [] });
});

test("the default is saved without a reasoning effort the Router route cannot serve", async () => {
  const { saveDefault } = await catalogModule();
  const saved: unknown[] = [];
  const ctx = stubCtx({}, saved);

  assert.deepEqual(await saveDefault(ctx, { provider: "olares-router", model: " Qwen/other " }), {
    provider: "olares-router",
    model: "Qwen/other",
  });
  assert.deepEqual(saved, [{ provider: "olares-router", model: "Qwen/other" }]);
});

test("a model the Host cannot route is refused instead of becoming the default", async () => {
  const { saveDefault } = await catalogModule();
  const saved: unknown[] = [];
  const ctx = stubCtx(
    {
      resolveCallConfig: async () => {
        throw new Error('has no configured model "ghost"');
      },
    },
    saved,
  );

  await assert.rejects(
    () => saveDefault(ctx, { model: "ghost" }),
    (err: { code?: string; status?: number }) => err.code === "model_unavailable" && err.status === 400,
  );
  await assert.rejects(
    () => saveDefault(ctx, { model: "  " }),
    (err: { code?: string }) => err.code === "bad_request",
  );
  assert.deepEqual(saved, []);
});

test("a request without a provider is pinned to Olares Router", async () => {
  const { saveDefault } = await catalogModule();
  const asked: string[] = [];
  const ctx = stubCtx({
    resolveCallConfig: async (config) => {
      asked.push(config.provider);
      return { provider: config.provider, model: config.model };
    },
  });

  await saveDefault(ctx, { model: "Qwen/other" });
  assert.deepEqual(asked, ["olares-router"]);
});

test("a non-Router provider or placeholder cannot become the default", async () => {
  const { saveDefault } = await catalogModule();
  const ctx = stubCtx();
  await assert.rejects(
    () => saveDefault(ctx, { provider: "community", model: "other/model" }),
    (err: { code?: string; status?: number }) => err.code === "bad_request" && err.status === 400,
  );
  await assert.rejects(
    () => saveDefault(ctx, { provider: "olares-router", model: "default" }),
    (err: { code?: string; status?: number }) =>
      err.code === "model_unavailable" && err.status === 400,
  );
});
