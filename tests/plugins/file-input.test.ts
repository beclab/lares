import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  findWorkspaceForSession,
  numberedName,
  saveUpload,
  sanitizeFilename,
} from "../../packages/plugins/file-input/host/storage.js";

type FakeRequest = Readable & { headers: Record<string, string> };

function request(body: string, headers: Record<string, string> = {}): FakeRequest {
  const stream = Readable.from(body ? [Buffer.from(body)] : []) as FakeRequest;
  stream.headers = headers;
  return stream;
}

test("sanitizeFilename strips traversal and header-hostile characters", () => {
  assert.equal(sanitizeFilename("../../report final?.pdf"), "report_final_.pdf");
  assert.equal(sanitizeFilename(".."), "file");
  assert.equal(sanitizeFilename("截图 01.png"), "截图_01.png");
});

test("numberedName keeps the extension last", () => {
  assert.equal(numberedName("report.pdf", 1), "report.pdf");
  assert.equal(numberedName("report.pdf", 3), "report-3.pdf");
  assert.equal(numberedName("archive.tar.gz", 2), "archive.tar-2.gz");
  assert.equal(numberedName("LICENSE", 2), "LICENSE-2");
});

test("findWorkspaceForSession only returns an owning workspace", () => {
  const first = { id: "a", sessionIds: ["one"] };
  const second = { id: "b", sessionIds: ["two", "three"] };
  const registry = { list: () => [first, second] };
  assert.equal(findWorkspaceForSession(registry, "three"), second);
  assert.equal(findWorkspaceForSession(registry, "missing"), null);
  assert.equal(findWorkspaceForSession(registry, ""), null);
});

test("saveUpload stores the file under its own name inside the workspace", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-file-input-"));
  try {
    const stored = await saveUpload(request("hello", { "content-length": "5" }), root, "../../notes.txt", 8);
    assert.equal(stored.path, join(".lares", "uploads", "notes.txt"));
    assert.equal(stored.size, 5);
    assert.equal(readFileSync(join(root, stored.path), "utf8"), "hello");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("saveUpload numbers a name that is already taken", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-file-input-"));
  try {
    const first = await saveUpload(request("one"), root, "report.pdf");
    const second = await saveUpload(request("two"), root, "report.pdf");
    const third = await saveUpload(request("three"), root, "report.pdf");
    assert.equal(first.path, join(".lares", "uploads", "report.pdf"));
    assert.equal(second.path, join(".lares", "uploads", "report-2.pdf"));
    assert.equal(third.path, join(".lares", "uploads", "report-3.pdf"));
    assert.equal(readFileSync(join(root, second.path), "utf8"), "two");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("concurrent uploads of one name never share a path", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-file-input-"));
  try {
    const stored = await Promise.all(
      ["a", "b", "c", "d"].map((body) => saveUpload(request(body), root, "shot.png")),
    );
    const paths = new Set(stored.map((entry) => entry.path));
    assert.equal(paths.size, 4);
    assert.deepEqual(
      readdirSync(join(root, ".lares", "uploads")).sort(),
      ["shot-2.png", "shot-3.png", "shot-4.png", "shot.png"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("saveUpload leaves nothing behind when the stream is rejected", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-file-input-"));
  const uploads = join(root, ".lares", "uploads");
  try {
    await assert.rejects(
      () => saveUpload(request("too large"), root, "large.bin", 4),
      (error: { code?: string; status?: number }) =>
        error.code === "file_too_large" && error.status === 413,
    );
    await assert.rejects(
      () => saveUpload(request("", { "content-length": "0" }), root, "empty.txt"),
      (error: { code?: string; status?: number }) =>
        error.code === "file_empty" && error.status === 400,
    );
    assert.deepEqual(readdirSync(uploads), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("saveUpload rejects a declared length over the limit before writing", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-file-input-"));
  try {
    await assert.rejects(
      () => saveUpload(request("hello", { "content-length": "999" }), root, "big.bin", 8),
      (error: { code?: string; status?: number }) =>
        error.code === "file_too_large" && error.status === 413,
    );
    assert.equal(existsSync(join(root, ".lares", "uploads")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
