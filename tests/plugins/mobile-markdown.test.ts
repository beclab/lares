import assert from "node:assert/strict";
import test from "node:test";
import { failText, lastIndexOfType, lastUserText, thinkTitle, withPendingUser } from "../../packages/mobile/src/chat/format.js";
import { renderMarkdown } from "../../packages/mobile/src/chat/markdown.js";

test("renderMarkdown turns chat markdown into escaped HTML", () => {
  const html = renderMarkdown("hello **world** and `code`\n\n- a\n- b\n\n```\n<script>\n```\n\n[link](https://olares.com)");
  assert.match(html, /<strong>world<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<li>a<\/li>/);
  assert.match(html, /<pre><code>&lt;script&gt;<\/code><\/pre>/);
  assert.match(html, /href="https:\/\/olares.com"/);
  assert.equal(html.includes("<script>"), false);
});

test("withPendingUser appends an in-flight user turn once", () => {
  const items = [{ type: "user", text: "hi" }];
  assert.equal(withPendingUser(items, "hi"), items);
  assert.deepEqual(withPendingUser(items, "next").at(-1), { type: "user", text: "next", pending: true });
  assert.equal(failText((key) => key, "unauthorized"), "chat.unauthorized");
});

test("lastUserText skips pending turns and thinkTitle follows the live clock", () => {
  const t = (key, params) => (params ? `${key}:${params.seconds}` : key);
  assert.equal(lastUserText([{ type: "assistant", text: "a" }]), "");
  assert.equal(lastUserText([{ type: "user", text: "one" }, { type: "user", text: "two", pending: true }]), "one");
  assert.equal(lastIndexOfType([{ type: "reasoning" }, { type: "assistant" }, { type: "reasoning" }], "reasoning"), 2);
  assert.equal(thinkTitle(true, 2400, t), "think.running");
  assert.equal(thinkTitle(false, 0, t), "think.doneUnknown");
  assert.equal(thinkTitle(false, 2400, t), "think.done:2");
});
