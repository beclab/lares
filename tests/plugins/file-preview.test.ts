import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_PREVIEW_TEXT_BYTES,
  buildPreview,
  parseRange,
  previewTypeForName,
  resolveWorkspaceFile,
} from "../../packages/plugins/file-preview/host/files.js";
import {
  rewriteWorkspaceTargets,
  workspaceTargetPath,
} from "../../packages/plugins/file-preview/src/client/markdown.js";
import { producedForClosing } from "../../packages/plugins/file-preview/src/client/deliverables.js";
import { FilePreviewWorkspace } from "../../packages/plugins/file-preview/src/client/workspace.js";

test("previewTypeForName classifies browser-safe preview formats", () => {
  assert.deepEqual(previewTypeForName("photo.webp"), { kind: "image", mediaType: "image/webp" });
  assert.deepEqual(previewTypeForName("movie.MP4"), { kind: "video", mediaType: "video/mp4" });
  assert.deepEqual(previewTypeForName("voice.mp3"), { kind: "audio", mediaType: "audio/mpeg" });
  assert.deepEqual(previewTypeForName("report.pdf"), { kind: "pdf", mediaType: "application/pdf" });
  assert.equal(previewTypeForName("notes.md").kind, "markdown");
  assert.equal(previewTypeForName("main.ts").kind, "text");
  assert.equal(previewTypeForName("slides.pptx").kind, "unsupported");
  assert.equal(previewTypeForName("unsafe.svg").kind, "unsupported");
});

test("turn media keeps produced paths ordered, unique, and bounded by closing seq", () => {
  const owner = {
    seq: 8,
    turn: {
      data: new Map([
        ["deliverables", {
          produced: [
            { seq: 3, path: "image/card.png" },
            { seq: 7, path: "audio/brief.mp3" },
            { seq: 8, path: "image/card.png" },
            { seq: 9, path: "later.mp4" },
          ],
        }],
      ]),
    },
  };
  assert.deepEqual(producedForClosing(owner), ["image/card.png", "audio/brief.mp3"]);
});

test("parseRange accepts bounded, open, and suffix byte ranges", () => {
  assert.deepEqual(parseRange(undefined, 100), null);
  assert.deepEqual(parseRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(parseRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=90-200", 100), { start: 90, end: 99 });
  assert.throws(() => parseRange("bytes=100-101", 100), { code: "range_not_satisfiable" });
  assert.throws(() => parseRange("items=0-1", 100), { code: "range_not_satisfiable" });
});

test("resolveWorkspaceFile confines real files and symlinks to the workspace", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-file-preview-"));
  const outside = mkdtempSync(join(tmpdir(), "lares-file-preview-outside-"));
  try {
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs", "notes.txt"), "hello");
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(join(outside, "secret.txt"), join(root, "escape.txt"));

    const file = await resolveWorkspaceFile(root, "docs/notes.txt");
    assert.equal(file.path, join("docs", "notes.txt"));
    assert.equal(file.kind, "text");
    await assert.rejects(
      () => resolveWorkspaceFile(root, "../secret.txt"),
      (error: { code?: string }) => error.code === "path_forbidden",
    );
    await assert.rejects(
      () => resolveWorkspaceFile(root, "escape.txt"),
      (error: { code?: string }) => error.code === "path_forbidden",
    );
    await assert.rejects(
      () => resolveWorkspaceFile(root, "docs"),
      (error: { code?: string }) => error.code === "path_not_file",
    );
    await assert.rejects(
      () => resolveWorkspaceFile(root, "docs/missing.txt"),
      (error: { code?: string }) => error.code === "file_not_found",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("buildPreview returns UTF-8 text and rejects binary text", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-file-preview-"));
  try {
    writeFileSync(join(root, "readme.md"), "# 标题\n");
    writeFileSync(join(root, "broken.txt"), Buffer.from([0xff, 0xfe]));

    const markdown = await buildPreview(await resolveWorkspaceFile(root, "readme.md"));
    assert.equal(markdown.kind, "markdown");
    assert.equal(markdown.text, "# 标题\n");
    await assert.rejects(
      async () => buildPreview(await resolveWorkspaceFile(root, "broken.txt")),
      (error: { code?: string }) => error.code === "file_not_text",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspaceTargetPath resolves workspace targets and rejects the rest", () => {
  const from = "preview-demo/index.md";
  assert.equal(workspaceTargetPath(from, "image/testcard.png"), "preview-demo/image/testcard.png");
  assert.equal(workspaceTargetPath(from, "./doc/tour.md"), "preview-demo/doc/tour.md");
  assert.equal(workspaceTargetPath(from, "../shared/a.txt"), "shared/a.txt");
  assert.equal(workspaceTargetPath(from, "/top.md"), "top.md");
  assert.equal(workspaceTargetPath(from, "<my%20notes.txt>"), "preview-demo/my notes.txt");
  assert.equal(workspaceTargetPath(from, "notes.txt#section"), "preview-demo/notes.txt");
  assert.equal(workspaceTargetPath(from, "https://olares.com"), null);
  assert.equal(workspaceTargetPath(from, "mailto:a@b.c"), null);
  assert.equal(workspaceTargetPath(from, "//cdn/a.png"), null);
  assert.equal(workspaceTargetPath(from, "#anchor"), null);
  assert.equal(workspaceTargetPath(from, "../../etc/passwd"), null);
  assert.equal(workspaceTargetPath(from, "  "), null);
});

test("rewriteWorkspaceTargets rewrites prose targets and leaves code verbatim", () => {
  const source = [
    "[tour](doc/tour.md) and ![card](image/testcard.png)",
    "[out](https://olares.com) `[code](a.png)` [gone](../../etc/passwd)",
    "```md",
    "[fenced](a.png)",
    "```",
    "[after](b.md)",
  ].join("\n");

  const rewritten = rewriteWorkspaceTargets(
    source,
    "demo/index.md",
    (path: string) => `https://host/raw?p=${path}`,
  );

  assert.match(rewritten, /\[tour\]\(https:\/\/host\/raw\?p=demo\/doc\/tour\.md\)/);
  assert.match(rewritten, /!\[card\]\(https:\/\/host\/raw\?p=demo\/image\/testcard\.png\)/);
  assert.match(rewritten, /\[out\]\(https:\/\/olares\.com\)/);
  assert.match(rewritten, /`\[code\]\(a\.png\)`/);
  assert.match(rewritten, /\[gone\]\(\.\.\/\.\.\/etc\/passwd\)/);
  assert.match(rewritten, /\[fenced\]\(a\.png\)/);
  assert.match(rewritten, /\[after\]\(https:\/\/host\/raw\?p=demo\/b\.md\)/);
});

test("openCurrent claims workspace files and declines everything else", async () => {
  const requested: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const path = new URL(String(url), "http://x").searchParams.get("path") ?? "";
    requested.push(path);
    return path.endsWith("/.")
      ? new Response(JSON.stringify({ error: { code: "path_not_file" } }), { status: 415 })
      : new Response(
        JSON.stringify({ path, name: "notes.txt", kind: "text", size: 2, text: "hi" }),
        { status: 200 },
      );
  }) as typeof fetch;

  const workspace = new FilePreviewWorkspace();
  const unbind = workspace.bindCurrent("s1");
  try {
    assert.equal(await workspace.openCurrent("/data/workspace/."), false);
    assert.equal(workspace.getSnapshot("s1").mode, "chat");
    assert.deepEqual(workspace.getSnapshot("s1").tabs, []);

    assert.equal(await workspace.openCurrent("notes.txt"), true);
    const snapshot = workspace.getSnapshot("s1");
    assert.equal(snapshot.mode, "preview");
    assert.equal(snapshot.activePath, "notes.txt");
    assert.equal(snapshot.content.status, "ready");
    // The claim probe is the only request: the tab opens with content in hand.
    assert.deepEqual(requested, ["/data/workspace/.", "notes.txt"]);
  } finally {
    unbind();
    globalThis.fetch = original;
  }
});

test("scroll offsets belong to the tab and end with it", () => {
  const workspace = new FilePreviewWorkspace();
  const ready = {
    status: "ready",
    data: { path: "a.md", name: "a.md", kind: "markdown", size: 0, text: "" },
  };
  workspace.open("s1", "a.md", ready);
  workspace.rememberScroll("s1", "a.md", 320);
  workspace.rememberScroll("s1", "b.md", 40);

  assert.equal(workspace.scrollOffset("s1", "a.md"), 320);
  assert.equal(workspace.scrollOffset("s1", "b.md"), 40);
  assert.equal(workspace.scrollOffset("s1", "unseen.md"), 0);
  assert.equal(workspace.scrollOffset("s2", "a.md"), 0);

  workspace.close("s1", "a.md");
  assert.equal(workspace.scrollOffset("s1", "a.md"), 0);
});

test("buildPreview truncates on a character boundary", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-file-preview-"));
  try {
    // "中" is three bytes, so the cut lands mid-character.
    const filler = "中".repeat(Math.ceil(MAX_PREVIEW_TEXT_BYTES / 3) + 100);
    writeFileSync(join(root, "long.txt"), filler);

    const preview = await buildPreview(await resolveWorkspaceFile(root, "long.txt"));
    assert.equal(preview.truncated, true);
    const bytes = Buffer.byteLength(preview.text ?? "", "utf8");
    assert.ok(bytes <= MAX_PREVIEW_TEXT_BYTES && bytes > MAX_PREVIEW_TEXT_BYTES - 3);
    assert.ok((preview.text ?? "").endsWith("中"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
