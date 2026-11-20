import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setFetchSelection } from "@olares/lares-core/fetch/config";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Context } from "@deepseek-ai/cordis";
import { WebRuntime } from "@deepseek-ai/dsh-web";
import { apply as applyRouterWeb } from "../../packages/web/router-search/host/index.js";
import { createServer } from "node:http";
import { once } from "node:events";
import { routerScrape, ScrapeError, scrapeWebErrorCode } from "@olares/lares-core/router/scrape";
import { createLaresFetchProvider } from "../../packages/web/router-search/host/fetch-provider.js";

const previousHome = process.env.DSH_HOME;
let fetchTestHome: string;
test.before(() => {
  fetchTestHome = mkdtempSync(join(tmpdir(), "lares-fetch-enabled-"));
  process.env.DSH_HOME = fetchTestHome;
  setFetchSelection({ defaultFetchModel: null, fetchOff: false }, []);
});
test.after(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousHome;
  rmSync(fetchTestHome, { recursive: true, force: true });
});

const env = { LLM_GATEWAY_URL: "http://router.test/v1/", LARES_ROUTER_API_KEY: "router-key" };
const doc = { object: "scrape", status: "ok", url: "https://example.com/final", markdown: "# Page\n\nContent" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function withFetch(fn: typeof fetch, run: () => Promise<void>) {
  const previous = globalThis.fetch;
  globalThis.fetch = fn;
  try { await run(); } finally { globalThis.fetch = previous; }
}

function hasCode(code: string) {
  return (err: unknown) => err instanceof ScrapeError && err.code === code;
}

test("web fetch sends a Router scrape request with the default route and key", async () => {
  await withFetch(async (input, init = {}) => {
    assert.equal(String(input), "http://router.test/v1/scrape");
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer router-key");
    assert.deepEqual(JSON.parse(String(init.body)), { model: "default-scrape", url: "https://example.com/" });
    return json(doc);
  }, async () => {
    const result = await routerScrape("https://example.com", { env });
    assert.deepEqual(result, { url: doc.url, statusCode: 200, body: { kind: "text", content: doc.markdown }, truncated: false });
  });
});

test("web fetch reuses platform app identity when no Router key is configured", async () => {
  await withFetch(async (_input, init = {}) => {
    const headers = new Headers(init.headers);
    assert.equal(headers.get("authorization"), null);
    assert.equal(headers.get("x-caller-appid"), "lares");
    return json(doc);
  }, async () => { await routerScrape("https://example.com", { env: { LLM_GATEWAY_URL: env.LLM_GATEWAY_URL, OLARES_APP_ID: "lares" } }); });
});

test("invalid target URLs never make a network request", async () => {
  await withFetch(async () => { throw new Error("must not fetch"); }, async () => {
    for (const url of ["", "file:///etc/passwd", "https://user:secret@example.com", "garbage", "https://example.com/" + "a".repeat(2048)]) {
      await assert.rejects(routerScrape(url, { env }), hasCode("invalid_url"));
    }
  });
});

test("Router auth, default routing, upstream failures and malformed documents are explicit errors", async () => {
  for (const [body, status, code] of [
    [{ error: { code: "invalid_api_key" } }, 401, "credential"],
    [{ error: { code: "model_not_allowed" } }, 403, "credential"],
    [{ error: { code: "no_default_model" } }, 400, "unavailable"],
    [{ error: { code: "upstream_bad_gateway" } }, 502, "failed"],
    [{ ...doc, markdown: "  " }, 200, "failed"],
    [{ ...doc, status: "failed" }, 200, "failed"],
    [{ ...doc, url: "file:///tmp/private" }, 200, "failed"],
  ] as const) {
    await withFetch(async () => json(body, status), async () => {
      await assert.rejects(routerScrape("https://example.com", { env }), hasCode(code));
    });
  }
  await withFetch(async () => new Response("not JSON"), async () => {
    await assert.rejects(routerScrape("https://example.com", { env }), hasCode("failed"));
  });
});

test("response bytes are bounded and Markdown is capped without broken surrogate pairs", async () => {
  await withFetch(async () => json({ ...doc, markdown: "a".repeat(1024 * 1024) }), async () => {
    await assert.rejects(routerScrape("https://example.com", { env }), hasCode("too_large"));
  });
  await withFetch(async () => json({ ...doc, markdown: "abc😀tail" }), async () => {
    const result = await routerScrape("https://example.com", { env, maxBodyChars: 4 });
    assert.equal(result.body.content, "abc");
    assert.equal(result.truncated, true);
  });
});

test("caller cancellation and timeout stop the Router request", async () => {
  const aborted = new AbortController();
  aborted.abort();
  await withFetch(async () => { throw new Error("must not fetch"); }, async () => {
    await assert.rejects(routerScrape("https://example.com", { env, signal: aborted.signal }), hasCode("aborted"));
  });
  await withFetch(async (_input, init = {}) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
  }), async () => {
    await assert.rejects(routerScrape("https://example.com", { env, timeoutMs: 5 }), hasCode("timeout"));
    const controller = new AbortController();
    const pending = routerScrape("https://example.com", { env, signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, hasCode("aborted"));
  });
});

test("fetch provider maps WebError, remains independent of search settings and receives cancellation", async () => {
  const provider = createLaresFetchProvider();
  assert.equal(provider.id, "lares");
  assert.equal(provider.available(), true);
  await assert.rejects(provider.fetch({ url: "file:///private" }), (err: { code?: string }) => err.code === "WEB_INVALID_URL");
  const controller = new AbortController(); controller.abort();
  await assert.rejects(provider.fetch({ url: "https://example.com" }, controller.signal), (err: { code?: string }) => err.code === "WEB_ABORTED");
  const overlay = readFileSync(new URL("../../packages/web/dsh-overlay/cordis.patch.yml", import.meta.url), "utf8");
  assert.match(overlay, /searchProvider: lares\s+fetchProvider: lares/);
  assert.equal(scrapeWebErrorCode("unknown"), "WEB_PROVIDER_ERROR");
});

test("Router fetch uses real HTTP with auth and handles streamed responses", async () => {
  const server = createServer(async (req, res) => {
    assert.equal(req.url, "/v1/scrape");
    assert.equal(req.headers.authorization, "Bearer router-key");
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.equal(JSON.parse(body).model, "default-scrape");
    res.setHeader("content-type", "application/json");
    const encoded = JSON.stringify(doc);
    res.write(encoded.slice(0, 25));
    res.end(encoded.slice(25));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const result = await routerScrape("https://example.com", { env: { ...env, LLM_GATEWAY_URL: `http://127.0.0.1:${address.port}/v1` } });
    assert.equal(result.body.content, doc.markdown);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});


test("the host registers fetch and search; DSH selects Router over the local HTTP provider", async () => {
  const ctx = new Context();
  const web = new WebRuntime(ctx, { fetchProvider: "lares" });
  const disposers: (() => void)[] = [];
  web.registerFetchProvider({ id: "http", available: () => true, async fetch() { throw new Error("local HTTP must not be selected"); } });
  applyRouterWeb({
    web,
    webServer: { register() { return () => {}; } },
    effect(start: () => () => void) { const dispose = start(); disposers.push(dispose); return dispose; },
  });
  await withFetch(async () => json(doc), async () => {
    const result = await web.fetch({ url: "https://example.com" });
    assert.equal(result.body.content, doc.markdown);
  });
  for (const dispose of disposers.reverse()) dispose();
  await assert.rejects(web.fetch({ url: "https://example.com" }), (err: { code?: string }) => err.code === "WEB_PROVIDER_CONFIGURED_MISSING");
  await ctx.fiber.dispose();
});
