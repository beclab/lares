import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error plain ESM shared client source
import { routerConsoleUrl } from "@lares/core/olares/entrance";

test("router console keeps the entrance zone", () => {
  assert.equal(routerConsoleUrl("", "e274648a.yaotest004.olares.com"), "https://router.yaotest004.olares.com");
  assert.equal(routerConsoleUrl("", "e274648a.yaotest004.olares.local"), "https://router.yaotest004.olares.local");
  assert.equal(routerConsoleUrl("", "E274648A.YaoTest004.Olares.com"), "https://router.yaotest004.olares.com");
});

test("each settings panel opens its own Router console route", () => {
  const host = "e274648a.yaotest004.olares.com";
  assert.equal(routerConsoleUrl("llm", host), "https://router.yaotest004.olares.com/llm");
  assert.equal(routerConsoleUrl("audio", host), "https://router.yaotest004.olares.com/audio");
  assert.equal(routerConsoleUrl("tools", host), "https://router.yaotest004.olares.com/tools");
  assert.equal(routerConsoleUrl("TOOLS", host), "https://router.yaotest004.olares.com/tools");
});

test("a route that is not a plain console path is refused", () => {
  const host = "e274648a.yaotest004.olares.com";
  for (const route of ["../admin", "llm?x=1", "//evil.com", "llm#frag", "llm/", "l lm"]) {
    assert.equal(routerConsoleUrl(route, host), "");
  }
});

test("router console is unavailable outside an Olares entrance", () => {
  for (const host of [
    "127.0.0.1",
    "localhost",
    "olares.com",
    "",
    "192.168.50.166",
    "lares.user.example.com",
    "lares.extra.user.olares.com",
    "-invalid.user.olares.com",
  ]) {
    assert.equal(routerConsoleUrl("llm", host), "");
  }
});
