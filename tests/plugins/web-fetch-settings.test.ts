import { createServer } from "node:http";
import { once } from "node:events";
import { fetchSettingsHandler } from "../../packages/web/router-search/host/fetch-settings.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchModelsFromRouterCatalog } from "@olares/lares-core/router/fetch";
import { fetchMenuValue, fetchValueFromMenu, fetchStatus } from "@olares/lares-core/fetch/menu";
import { readConfig, setFetchSelection } from "@olares/lares-core/fetch/config";
import { createLaresFetchProvider } from "../../packages/web/router-search/host/fetch-provider.js";

test("fetch settings show only scrape services and preserve follow/off/stale states", () => {
  const models = fetchModelsFromRouterCatalog({ data: [
    { id: "crawl4ai/scrape", mode: "scrape" },
    { id: "jina/reader", mode: "scrape" },
    { id: "tavily/search", mode: "search" },
    { id: "openai/chat", mode: "chat" },
  ] });
  assert.deepEqual(models.map((m) => m.id), ["crawl4ai/scrape", "jina/reader"]);
  assert.equal(fetchMenuValue(null), "router-default");
  assert.deepEqual(fetchValueFromMenu("off"), { defaultFetchModel: null, fetchOff: true });
  assert.equal(fetchStatus(models, { defaultFetchModel: "gone/scrape" }).key, "settings.status.notReady");
  assert.equal(fetchStatus([], { defaultFetchModel: null }).key, "settings.status.empty");
  assert.equal(fetchStatus(models, { fetchOff: true }).ready, false);
});

test("persisted fetch selection controls the actual provider independently of search", async () => {
  const home = mkdtempSync(join(tmpdir(), "lares-webfetch-settings-"));
  const beforeHome = process.env.DSH_HOME;
  const beforeGateway = process.env.LLM_GATEWAY_URL;
  const previousFetch = globalThis.fetch;
  process.env.DSH_HOME = home;
  process.env.LLM_GATEWAY_URL = "http://router.test/v1";
  const requests: Record<string, unknown>[] = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ object: "scrape", status: "ok", url: "https://example.com", markdown: "# Page" }), { status: 200 });
  };
  try {
    const provider = createLaresFetchProvider();
    assert.deepEqual(readConfig(), { defaultFetchModel: null, fetchOff: false });
    assert.throws(() => setFetchSelection({ defaultFetchModel: "missing/scrape", fetchOff: false }, []));
    setFetchSelection({ defaultFetchModel: "crawl4ai/scrape", fetchOff: false }, [{ id: "crawl4ai/scrape" }]);
    assert.equal(readConfig().defaultFetchModel, "crawl4ai/scrape");
    await provider.fetch({ url: "https://example.com" } as any);
    assert.equal(requests[0]?.model, "crawl4ai/scrape");
    setFetchSelection({ defaultFetchModel: null, fetchOff: true }, []);
    assert.equal(provider.available(), false);
    await assert.rejects(() => provider.fetch({ url: "https://example.com" } as any), /turned off/);
    assert.equal(requests.length, 1);
    setFetchSelection({ defaultFetchModel: null, fetchOff: false }, []);
    assert.equal(provider.available(), true);
    await provider.fetch({ url: "https://example.com" } as any);
    assert.equal(requests[1]?.model, "default-scrape");
  } finally {
    globalThis.fetch = previousFetch;
    if (beforeHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = beforeHome;
    if (beforeGateway === undefined) delete process.env.LLM_GATEWAY_URL; else process.env.LLM_GATEWAY_URL = beforeGateway;
    rmSync(home, { recursive: true, force: true });
  }
});

test("fetch settings HTTP routes list, refresh and persist selections", async () => {
 const home=mkdtempSync(join(tmpdir(),"lares-fetch-http-"));
 const beforeHome=process.env.DSH_HOME;
 const beforeGateway=process.env.LLM_GATEWAY_URL;
 const previousFetch=globalThis.fetch;
 process.env.DSH_HOME=home;
 process.env.LLM_GATEWAY_URL="http://router.fetch-settings.test/v1";
 let catalogCalls=0;
 globalThis.fetch=async () => {
  catalogCalls++;
  return new Response(JSON.stringify({data:[{id:"crawl4ai/scrape",mode:"scrape"},{id:"tavily/search",mode:"search"}]}),{status:200});
 };
 const server=createServer((req,res)=>fetchSettingsHandler(req,res));
 server.listen(0,"127.0.0.1");
 await once(server,"listening");
 const address=server.address() as {port:number};
 const base=`http://127.0.0.1:${address.port}/api/lares/web-fetch`;
 try {
  let response=await previousFetch(`${base}/config?refresh=1`);
  assert.equal(response.status,200);
  const config=await response.json();
  assert.deepEqual(config.fetchModels.map((m: {id:string})=>m.id),["crawl4ai/scrape"]);
  assert.equal(config.fetchOff,false);
  response=await previousFetch(`${base}/config/default`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({defaultFetchModel:"crawl4ai/scrape",fetchOff:false})});
  assert.equal(response.status,200);
  assert.equal((await response.json()).defaultFetchModel,"crawl4ai/scrape");
  response=await previousFetch(`${base}/config/default`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({defaultFetchModel:"tavily/search",fetchOff:false})});
  assert.equal(response.status,400);
  assert.equal(readConfig().defaultFetchModel,"crawl4ai/scrape");
  await previousFetch(`${base}/config?refresh=1`);
  assert.ok(catalogCalls>=2);
 } finally {
  globalThis.fetch=previousFetch;
  if(beforeHome===undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME=beforeHome;
  if(beforeGateway===undefined) delete process.env.LLM_GATEWAY_URL; else process.env.LLM_GATEWAY_URL=beforeGateway;
  server.closeAllConnections();
  await new Promise<void>((resolve)=>server.close(()=>resolve()));
  rmSync(home,{recursive:true,force:true});
 }
});
