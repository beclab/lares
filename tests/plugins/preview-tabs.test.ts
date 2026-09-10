import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MAX_PREVIEW_TABS,
  closeTab,
  openTab,
  touchTab,
} from "../../packages/core/files/preview-tabs.js";

function strip(paths: string[]) {
  return paths.reduce(
    (state, path) => {
      const next = openTab(state, path);
      return { tabs: next.tabs, lru: next.lru };
    },
    { tabs: [] as { path: string; name: string }[], lru: [] as string[] },
  );
}

test("opening a path adds one tab and names it after the file", () => {
  const { tabs, evicted } = openTab({ tabs: [], lru: [] }, "outputs/gpu-check.mp4");
  assert.deepEqual(tabs, [{ path: "outputs/gpu-check.mp4", name: "gpu-check.mp4" }]);
  assert.equal(evicted, null);
});

test("reopening a path keeps its tab and marks it as read last", () => {
  const state = strip(["a.md", "b.md"]);
  const reopened = openTab(state, "a.md");
  assert.deepEqual(reopened.tabs.map((tab) => tab.path), ["a.md", "b.md"]);
  assert.deepEqual(reopened.lru, ["b.md", "a.md"]);
  assert.equal(reopened.evicted, null);
});

test("a full strip drops the least recently read tab and reports it", () => {
  const paths = Array.from({ length: MAX_PREVIEW_TABS }, (_, index) => `f${index}.md`);
  const state = strip(paths);
  const read = { tabs: state.tabs, lru: touchTab(state.lru, "f0.md") };

  const opened = openTab(read, "extra.md");
  assert.equal(opened.evicted?.path, "f1.md");
  assert.equal(opened.tabs.length, MAX_PREVIEW_TABS);
  assert.ok(!opened.tabs.some((tab) => tab.path === "f1.md"));
  assert.ok(!opened.lru.includes("f1.md"));
});

test("closing the active tab lands on the tab read before it", () => {
  const state = strip(["a.md", "b.md", "c.md"]);
  const read = { ...state, lru: touchTab(state.lru, "a.md") };
  const closed = closeTab({ ...read, activePath: "a.md" }, "a.md");

  assert.deepEqual(closed?.tabs.map((tab) => tab.path), ["b.md", "c.md"]);
  assert.equal(closed?.activePath, "c.md");
});

test("closing a background tab leaves the reader where they are", () => {
  const state = strip(["a.md", "b.md"]);
  const closed = closeTab({ ...state, activePath: "b.md" }, "a.md");
  assert.equal(closed?.activePath, "b.md");
});

test("closing the last tab reports no active path, and unknown paths are ignored", () => {
  const state = strip(["a.md"]);
  assert.deepEqual(closeTab({ ...state, activePath: "a.md" }, "a.md"), {
    tabs: [],
    lru: [],
    activePath: null,
  });
  assert.equal(closeTab({ ...state, activePath: "a.md" }, "b.md"), null);
});

test("the PC shell opens produced files as header tabs over the conversation", () => {
  const shell = readFileSync(new URL("../../packages/mobile/src/desktop/DesktopShell.vue", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../packages/mobile/src/App.vue", import.meta.url), "utf8");

  assert.match(shell, /<LaresDesktopPreviewTabs/);
  assert.match(shell, /<LaresDesktopPreview\b/);
  assert.match(shell, /@chat="\$emit\('show-chat'\)"/);
  assert.match(shell, /@close="\$emit\('close-preview-tab', \$event\)"/);
  // The preview covers the conversation instead of unmounting it, so the
  // transcript keeps its scroll position while a file is on screen.
  assert.match(shell, /\.desktop-shell__conversation \{ position:relative;/);
  assert.doesNotMatch(shell, /<LaresPreview\b/);

  assert.match(app, /@show-chat="showChat"/);
  assert.match(app, /@close-preview-tab="closePreviewTab"/);
  assert.match(app, /previewTabs: this\.previewTabs/);
});

test("the produced-file card opens its preview from a button, not a bare link", () => {
  const deliverables = readFileSync(new URL("../../packages/mobile/src/chat/Deliverables.vue", import.meta.url), "utf8");
  const open = /\.lares-turn-open \{([^}]*)\}/.exec(deliverables)?.[1] ?? "";

  assert.match(open, /border: 1px solid var\(--q-input-stroke\)/);
  assert.match(open, /border-radius: 14px/);
});
