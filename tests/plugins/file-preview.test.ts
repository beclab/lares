import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPreview,
  parseRange,
  previewTypeForName,
  resolveWorkspaceFile,
} from "../../packages/plugins/file-preview/host/files.js";

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
