import assert from "node:assert/strict";
import test from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createUploadHandler } from "../../packages/plugins/file-input/host/index.js";
import {
  numberedName,
  saveUpload,
  sanitizeFilename,
} from "../../packages/plugins/file-input/host/storage.js";
import { uploadFile } from "../../packages/plugins/file-input/src/client/api.js";
import {
  claimComposerBlock,
  documentPasteFiles,
  FileIntake,
  splitComposerFiles,
} from "../../packages/plugins/file-input/src/client/intake.js";
import {
  insertUploadReferences,
  uploadReference,
} from "../../packages/plugins/file-input/src/client/reference.js";
import { createPreviewHandler } from "../../packages/plugins/file-preview/host/index.js";

type FakeRequest = Readable & { headers: Record<string, string> };

function request(body: string, headers: Record<string, string> = {}): FakeRequest {
  const stream = Readable.from(body ? [Buffer.from(body)] : []) as FakeRequest;
  stream.headers = headers;
  return stream;
}

type Reference = {
  source: string;
  ref: string;
  label: string;
  appearance?: string;
  clipboardText: string;
};

type Span = { start: number; end: number; draftRev: number };

/** Mirrors the dsh input machine's reference transaction (display text + trailing gap). */
function composer(draft = "", accepts = true) {
  let occurrences: { offset: number; length: number; clipboardText: string }[] = [];
  let draftRev = 0;
  const snapshot = () => ({ draft, draftRev });
  return {
    state: { getSnapshot: snapshot },
    setDraft(text: string) {
      draft = text;
      draftRev += 1;
    },
    insertReference(reference: Reference, span: Span) {
      if (!accepts || span.draftRev !== draftRev) return false;
      const display = `@${reference.label}`;
      const tail = draft.slice(span.end);
      const gap = tail.length === 0 || tail[0] !== " " ? " " : "";
      occurrences.push({
        offset: span.start,
        length: display.length,
        clipboardText: reference.clipboardText,
      });
      draft = draft.slice(0, span.start) + display + gap + tail;
      draftRev += 1;
      return true;
    },
    /** The draft-persistence projection: occurrences expand to their clipboard text. */
    persisted() {
      let out = "";
      let cursor = 0;
      for (const entry of occurrences) {
        out += draft.slice(cursor, entry.offset) + entry.clipboardText;
        cursor = entry.offset + entry.length;
      }
      return out + draft.slice(cursor);
    },
  };
}

function response() {
  let status = 0;
  let body = "";
  return {
    headersSent: false,
    writeHead(next: number) {
      status = next;
      this.headersSent = true;
    },
    end(chunk = "") {
      body += String(chunk);
    },
    result() {
      return { status, body };
    },
  };
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

test("saveUpload rejects an upload directory symlink that leaves the workspace", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-file-input-"));
  const outside = mkdtempSync(join(tmpdir(), "lares-file-input-outside-"));
  try {
    symlinkSync(outside, join(root, ".lares"));
    await assert.rejects(
      () => saveUpload(request("secret"), root, "escape.txt"),
      (error: { code?: string; status?: number }) =>
        error.code === "path_forbidden" && error.status === 403,
    );
    assert.equal(existsSync(join(outside, "uploads")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("document intake commits paths only after upload succeeds", async () => {
  const markdown = { name: "季度经营分析_2026Q2.md", type: "text/markdown", size: 8 };
  const image = { name: "chart.png", type: "image/png", size: 8 };
  assert.deepEqual(splitComposerFiles([markdown, image]), {
    images: [image],
    documents: [markdown],
  });

  const intake = new FileIntake(async () => ({
    path: ".lares/uploads/季度经营分析_2026Q2.md",
  }));
  const input = composer("分析");
  await intake.uploadFiles("s1", [markdown], (paths: string[]) => {
    assert.deepEqual(insertUploadReferences(input, paths), []);
  });
  assert.equal(input.state.getSnapshot().draft, "分析 @季度经营分析_2026Q2.md ");
  assert.equal(input.persisted(), "分析 @.lares/uploads/季度经营分析_2026Q2.md ");
  assert.deepEqual(intake.getSnapshot("s1"), { pending: 0, failures: [] });
});

test("an uploaded file becomes a file reference the model still sees as a path", () => {
  assert.deepEqual(uploadReference(".lares/uploads/季度经营分析_2026Q2.md"), {
    source: "reference",
    ref: "@.lares/uploads/季度经营分析_2026Q2.md",
    label: "季度经营分析_2026Q2.md",
    appearance: "file",
    clipboardText: "@.lares/uploads/季度经营分析_2026Q2.md",
  });
});

test("consecutive uploads stay separated and a refused insert is reported", () => {
  const input = composer();
  assert.deepEqual(
    insertUploadReferences(input, [".lares/uploads/a.md", ".lares/uploads/b.md"]),
    [],
  );
  assert.equal(input.state.getSnapshot().draft, "@a.md @b.md ");
  assert.equal(input.persisted(), "@.lares/uploads/a.md @.lares/uploads/b.md ");

  const closed = composer("", false);
  assert.deepEqual(insertUploadReferences(closed, [".lares/uploads/c.md"]), [
    ".lares/uploads/c.md",
  ]);
});

test("document paste consumes files without reading clipboard text", () => {
  const markdown = { name: "report.md", type: "text/markdown", size: 8 };
  let textReads = 0;
  const files = documentPasteFiles({
    files: [markdown],
    getData: () => {
      textReads += 1;
      return "/Users/me/report.md";
    },
  });
  assert.deepEqual(files, [markdown]);
  assert.equal(textReads, 0);
});

test("document intake preserves the draft and exposes a persistent failure", async () => {
  const markdown = { name: "broken.md", type: "text/markdown", size: 8 };
  const intake = new FileIntake(async () => {
    throw new Error("file_empty");
  });
  const input = composer("before");
  await intake.uploadFiles("s1", [markdown], (paths: string[]) => {
    insertUploadReferences(input, paths);
  });
  assert.equal(input.state.getSnapshot().draft, "before");
  assert.deepEqual(intake.getSnapshot("s1"), {
    pending: 0,
    failures: [{ id: intake.getSnapshot("s1").failures[0].id, name: "broken.md", code: "file_empty" }],
  });
});

test("document intake cancellation leaves no path or failure behind", async () => {
  const markdown = { name: "cancelled.md", type: "text/markdown", size: 8 };
  const intake = new FileIntake((_file: unknown, _sessionId: string, options: { signal: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        reject(new DOMException("cancelled", "AbortError"));
      }, { once: true });
    }));
  let committed = false;
  const pending = intake.uploadFiles("s1", [markdown], () => {
    committed = true;
  });
  assert.equal(intake.getSnapshot("s1").pending, 1);
  intake.cancelSession("s1");
  await pending;
  assert.equal(committed, false);
  assert.deepEqual(intake.getSnapshot("s1"), { pending: 0, failures: [] });
});

test("composer upload block clears only when it still owns the block", () => {
  let current: { reason: string } | undefined;
  const registry = {
    storeFor: () => ({ getSnapshot: () => current }),
    set: (_sessionId: string, block: { reason: string } | undefined) => {
      current = block;
    },
  };
  const release = claimComposerBlock(registry, "s1", "uploading");
  assert.deepEqual(current, { reason: "uploading" });
  release();
  assert.equal(current, undefined);

  current = { reason: "model unavailable" };
  claimComposerBlock(registry, "s1", "uploading")();
  assert.deepEqual(current, { reason: "model unavailable" });
});

test("uploadFile makes one request and leaves retry to the user", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new TypeError("network down");
  }) as typeof fetch;
  try {
    const file = new File(["hello"], "notes.md", { type: "text/markdown" });
    await assert.rejects(
      () => uploadFile(file, "s1", { requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
      /network down/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

/** Stands in for the Host context the route plugins are applied with. */
function hostContext(root: string) {
  const workspace = { path: root, status: async () => "ok" };
  return {
    get: () => undefined,
    sessionPersistence: { list: async () => [{ id: sessionId, cwd: root }] },
    workspaceRegistry: {
      resolveByPath: async (path: string) => (path === root ? workspace : undefined),
    },
  };
}

const sessionId = "session-test";

test("unicode markdown upload opens through the preview handler", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lares-file-input-")));
  const ctx = hostContext(root);
  try {
    mkdirSync(root, { recursive: true });
    const req = request("# 第二季度\n", {
      "content-length": String(Buffer.byteLength("# 第二季度\n")),
      "content-type": "text/markdown",
      "x-lares-file-name": encodeURIComponent("季度经营分析_2026Q2.md"),
      "x-lares-session-id": sessionId,
      "x-lares-upload-request-id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    const uploadRes = response();
    await createUploadHandler(ctx)(req, uploadRes);
    assert.equal(uploadRes.result().status, 201);
    const uploaded = JSON.parse(uploadRes.result().body);

    const previewRes = response();
    await createPreviewHandler(ctx)(
      { url: `/api/lares/file-preview/preview?sessionId=${sessionId}&path=${encodeURIComponent(uploaded.path)}` },
      previewRes,
    );
    assert.equal(previewRes.result().status, 200);
    const preview = JSON.parse(previewRes.result().body);
    assert.equal(typeof preview.modifiedAt, "number");
    delete preview.modifiedAt;
    assert.deepEqual(preview, {
      path: join(".lares", "uploads", "季度经营分析_2026Q2.md"),
      name: "季度经营分析_2026Q2.md",
      kind: "markdown",
      mediaType: "text/markdown; charset=utf-8",
      size: Buffer.byteLength("# 第二季度\n"),
      text: "# 第二季度\n",
      truncated: false,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("upload handler requires a traceable request id", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lares-file-input-")));
  try {
    const req = request("hello", {
      "x-lares-file-name": "notes.md",
      "x-lares-session-id": sessionId,
    });
    await assert.rejects(
      () => createUploadHandler(hostContext(root))(req, response()),
      (error: { code?: string; status?: number }) =>
        error.code === "upload_request_invalid" && error.status === 400,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
