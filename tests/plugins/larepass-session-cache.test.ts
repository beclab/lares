import assert from "node:assert/strict";
import test from "node:test";
import { createSessionCache, eventsUpdated } from "@olares/lares-core/larepass/session-cache";

const user = (seq, text) => ({
  type: "user/message",
  seq,
  data: { content: [{ type: "text", text }], source: { kind: "user" } },
});

test("eventsUpdated ignores identical transcripts", () => {
  const row = user(1, "hi");
  assert.equal(eventsUpdated([row], [row]), false);
  assert.equal(eventsUpdated([row], [{ ...row }]), false);
  assert.equal(eventsUpdated([row], [user(1, "bye")]), true);
  assert.equal(eventsUpdated([row], [row, user(2, "next")]), true);
});

test("session cache merges by session and only reports a change when data moves", () => {
  const cache = createSessionCache();
  assert.equal(cache.merge("a", [user(1, "one")]), true);
  assert.equal(cache.merge("a", [user(1, "one")]), false);
  assert.equal(cache.merge("b", [user(1, "two")]), true);
  assert.deepEqual(cache.events("a").map((row) => row.data.content[0].text), ["one"]);
  assert.deepEqual(cache.events("b").map((row) => row.data.content[0].text), ["two"]);
});

test("session cache marks a page ready from history and keeps scroll per session", () => {
  const cache = createSessionCache();
  assert.equal(cache.ready("a"), false);
  assert.equal(cache.rememberHistory("a", [user(1, "one")]), true);
  assert.equal(cache.ready("a"), true);
  assert.equal(cache.rememberHistory("a", [user(1, "one")]), false);
  cache.setScroll("a", { top: 80, stick: false });
  cache.setScroll("b", { top: 0, stick: true });
  assert.deepEqual(cache.scroll("a"), { top: 80, stick: false });
  assert.deepEqual(cache.scroll("b"), { top: 0, stick: true });
});

test("session cache can occupy an empty ready page and drop it", () => {
  const cache = createSessionCache();
  cache.readyEmpty("draft");
  assert.equal(cache.ready("draft"), true);
  assert.deepEqual(cache.events("draft"), []);
  cache.merge("draft", [user(1, "nope")]);
  cache.readyEmpty("draft");
  assert.equal(cache.events("draft").length, 1);
  cache.drop("draft");
  assert.equal(cache.peek("draft"), null);
  assert.equal(cache.ready("draft"), false);
});

test("session cache coalesces in-flight loads per session", async () => {
  const cache = createSessionCache();
  let runs = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const start = async () => {
    runs += 1;
    await gate;
  };
  const first = cache.load("a", start);
  const second = cache.load("a", start);
  const other = cache.load("b", start);
  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.equal(cache.loading("a"), true);
  release();
  await Promise.all([first, second, other]);
  assert.equal(runs, 2);
  assert.equal(cache.loading("a"), false);
});
