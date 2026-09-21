import assert from "node:assert/strict";
import test from "node:test";

import { loopbackWebUrl, routerConsoleOrigin, routerConsoleUrl } from "@olares/lares-core/olares/entrance";
import { injectRouterConsole } from "../../packages/web/dsh-overlay/host/router-console.js";

test("loopbackWebUrl is the canonical local surface", () => {
  assert.equal(loopbackWebUrl(8080), "http://127.0.0.1:8080");
  assert.throws(() => loopbackWebUrl(undefined), /webServer missing/);
});

test("the console entrance comes from the Router data plane the chart rendered", () => {
  const cases: [string, string][] = [
    ["https://router.yaotest004.olares.com/v1", "https://router.yaotest004.olares.com"],
    ["https://router.yaotest004.olares.cn/v1", "https://router.yaotest004.olares.cn"],
    // 自定义域名的 Olares ID：zone 不可枚举，照搬 chart 渲染的入口。
    ["https://router.alex.space.n1.monster/v1", "https://router.alex.space.n1.monster"],
    ["https://Router.YaoTest004.Olares.com/v1/", "https://router.yaotest004.olares.com"],
  ];
  for (const [gateway, expected] of cases) {
    assert.equal(routerConsoleOrigin(gateway), expected);
  }
});

test("a gateway that is not a user entrance has no console", () => {
  for (const gateway of [
    // 集群内服务名与本地开发的 OpenAI 兼容端点都不是浏览器入口。
    "http://router-svc.router-shared/v1",
    "http://127.0.0.1:11434/v1",
    "https://router.yaotest004.olares.com:8443/v1",
    "ftp://router.yaotest004.olares.com/v1",
    "",
    undefined,
  ]) {
    assert.equal(routerConsoleOrigin(gateway), "");
  }
});

test("each settings panel opens its own Router console route", () => {
  const origin = "https://router.yaotest004.olares.com";
  assert.equal(routerConsoleUrl("llm", origin), `${origin}/llm`);
  assert.equal(routerConsoleUrl("audio", origin), `${origin}/audio`);
  assert.equal(routerConsoleUrl("tools", origin), `${origin}/tools`);
  assert.equal(routerConsoleUrl("TOOLS", origin), `${origin}/tools`);
  assert.equal(routerConsoleUrl("", origin), origin);
});

test("a route that is not a plain console path is refused", () => {
  const origin = "https://router.yaotest004.olares.com";
  for (const route of ["../admin", "llm?x=1", "//evil.com", "llm#frag", "llm/", "l lm"]) {
    assert.equal(routerConsoleUrl(route, origin), "");
  }
});

test("without an injected entrance the console button has no URL", () => {
  assert.equal(routerConsoleUrl("llm", undefined), "");
  assert.equal(routerConsoleUrl("llm", "http://router-svc.router-shared"), "");
});

test("the Host hands the console entrance to the page once", () => {
  const html = "<html><head><title>x</title></head><body></body></html>";
  const once = injectRouterConsole(html, "https://router.yaotest004.olares.com/v1");
  assert.match(
    once,
    /<head><script data-lares-router-console>globalThis\.__LARES_ROUTER_CONSOLE__="https:\/\/router\.yaotest004\.olares\.com";<\/script>/,
  );
  assert.equal(injectRouterConsole(once, "https://router.yaotest004.olares.com/v1"), once);
  // 局域网页面也拿公网入口：`router.<用户>.olares.local` 在局域网 DNS 里不存在。
  assert.equal(injectRouterConsole(html, "http://router-svc.router-shared/v1"), html);
});
