import assert from "node:assert/strict";
import test from "node:test";
import { failText, firstLine, lastIndexOfType, lastUserText, latestLine, thinkSummary, withPendingUser } from "../../packages/mobile/src/chat/format.js";
import { renderMarkdown } from "../../packages/mobile/src/chat/markdown.js";

test("renderMarkdown turns chat markdown into escaped HTML", () => {
  const html = renderMarkdown("hello **world** and `code`\n\n- a\n- b\n\n```\n<script>\n```\n\n[link](https://olares.com)");
  assert.match(html, /<strong>world<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<li>a<\/li>/);
  assert.match(html, /<pre><code>&lt;script&gt;\n<\/code><\/pre>/);
  assert.match(html, /href="https:\/\/olares.com"/);
  assert.match(html, /rel="noreferrer"/);
  assert.match(html, /target="_blank"/);
  assert.equal(html.includes("<script>"), false);
});

test("renderMarkdown turns dashes after a heading line into a list", () => {
  const html = renderMarkdown("📁 **文件与工作区**\n- 读写文件\n- 跑 shell\n\n🔍 **联网与搜索**\n- 用 `url_fetch` 下载");
  assert.match(html, /<p>📁 <strong>文件与工作区<\/strong><\/p>/);
  assert.match(html, /<ul>\s*<li>读写文件<\/li>\s*<li>跑 shell<\/li>\s*<\/ul>/);
  assert.match(html, /<p>🔍 <strong>联网与搜索<\/strong><\/p>/);
  assert.match(html, /<li>用 <code>url_fetch<\/code> 下载<\/li>/);
  assert.equal(html.includes("- 读写"), false);
});

test("withPendingUser appends an in-flight user turn once", () => {
  const items = [{ type: "user", text: "hi" }];
  assert.equal(withPendingUser(items, "hi"), items);
  assert.deepEqual(withPendingUser(items, "next").at(-1), { type: "user", text: "next", pending: true });
  assert.equal(failText((key) => key, "unauthorized"), "chat.unauthorized");
});

test("lastUserText skips pending turns", () => {
  assert.equal(lastUserText([{ type: "assistant", text: "a" }]), "");
  assert.equal(lastUserText([{ type: "user", text: "one" }, { type: "user", text: "two", pending: true }]), "one");
  assert.equal(lastIndexOfType([{ type: "reasoning" }, { type: "assistant" }, { type: "reasoning" }], "reasoning"), 2);
});

test("thinkSummary follows the PC header: latest line while running, first line when done", () => {
  assert.equal(firstLine("a\nb\n"), "a");
  assert.equal(latestLine("a\nb\n"), "b");
  assert.equal(thinkSummary({ running: true, text: "plan\nit" }), "it");
  assert.equal(thinkSummary({ running: false, text: "plan\nit" }), "plan");
});
