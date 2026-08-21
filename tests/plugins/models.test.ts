import assert from "node:assert/strict";
import test from "node:test";

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
  return import(`../../packages/plugins/models/host/catalog.js?t=${Date.now()}`);
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
        { id: "Qwen/chat", mode: "chat" },
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
      { id: "Qwen/chat", name: "Qwen/chat" },
      { id: "legacy-chat", name: "legacy-chat" },
      { id: "Qwen/thinks", name: "Qwen/thinks", reasoningEfforts: { low: "low", xhigh: "xhigh" } },
    ],
  );
});

test("Router refresh replaces the routable catalog and repairs a stale default", async () => {
  const { refreshCatalog } = await catalogModule();
  const previousFetch = globalThis.fetch;
  const saved: unknown[] = [];
  const mutations: unknown[] = [];
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
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Router refresh repairs a stale default with the preferred MTP build", async () => {
  const { refreshCatalog } = await catalogModule();
  const previousFetch = globalThis.fetch;
  const saved: unknown[] = [];
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
  }
});

test("concurrent Router refresh requests share one catalog update", async () => {
  const { refreshCatalog } = await catalogModule();
  const previousFetch = globalThis.fetch;
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
