import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { Writable } from "node:stream";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_PREVIEW_TEXT_BYTES,
  MAX_RAW_BYTES,
  buildPreview,
  fileFromPreviewRequest,
  parseRange,
  previewTypeForName,
  resolveWorkspaceFile,
  sendFileDownload,
  sendRawFile,
} from "@olares/lares-core/files/preview";
import { workspaceFileAlias } from "@olares/lares-core/workspace/path";
import {
  rewriteWorkspaceTargets,
  workspaceTargetPath,
} from "@olares/lares-core/files/markdown";
import { producedForClosing, selectInlineTurnMedia } from "@olares/lares-core/files/deliverables";
import { isDuplicateProducedMention } from "@olares/lares-core/files/produced-mentions";
import { filenameFromDisposition } from "@olares/lares-core/files/disposition";
import { downloadCurrentFile } from "../../packages/web/workspace-preview/src/client/download.js";
import { partitionPreviews } from "@olares/lares-core/files/preview-groups";
import { hostUrl, PC_TEST_PROXY } from "@olares/lares-core/larepass/host";
import {
  FilePreviewWorkspace,
  interceptOpenPath,
  isPrimaryUnmodifiedClick,
  isUnpreviewableOpenPath,
  previewOpenPath,
  rawFileUrl,
  rawUrlPath,
  workspaceLinkClickPath,
} from "@olares/lares-core/files/preview-workspace";

test("previewTypeForName classifies browser-safe preview formats", () => {
  assert.deepEqual(previewTypeForName("photo.webp"), { kind: "image", mediaType: "image/webp" });
  assert.deepEqual(previewTypeForName("movie.MP4"), { kind: "video", mediaType: "video/mp4" });
  assert.deepEqual(previewTypeForName("voice.mp3"), { kind: "audio", mediaType: "audio/mpeg" });
  assert.deepEqual(previewTypeForName("mesh.glb"), { kind: "model3d", mediaType: "model/gltf-binary" });
  assert.equal(previewTypeForName("scene.GLTF").kind, "text");
  assert.equal(previewTypeForName("cad.obj").kind, "text");
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

test("turn-tail inline media includes Files media and skips non-media chips", () => {
  const owner = {
    seq: 4,
    turn: {
      data: new Map([
        ["deliverables", {
          produced: [
            { seq: 1, path: "image/card.png" },
            { seq: 2, path: "notes.txt" },
            { seq: 3, path: "drive/Home/Downloads/clip.webm" },
            { seq: 4, path: "outputs/mesh.glb" },
            { seq: 4, path: "outputs/scene.gltf" },
            { seq: 4, path: "outputs/cad.obj" },
          ],
        }],
      ]),
    },
  };
  assert.deepEqual(selectInlineTurnMedia(owner), [
    "image/card.png",
    "drive/Home/Downloads/clip.webm",
    "outputs/mesh.glb",
  ]);
  assert.equal(
    previewOpenPath("/data/workspace", "/data/workspace/drive/Home/Downloads/clip.webm"),
    "drive/Home/Downloads/clip.webm",
  );
  assert.equal(previewOpenPath("/data/workspace", "notes.txt"), "notes.txt");
});

test("turn media deduplicates absolute and relative reports by resolved workspace path", () => {
  const absolute = "/data/workspace/media-test/README.txt";
  const relative = "media-test/README.txt";
  const preview = {
    path: relative,
    name: "README.txt",
    kind: "text",
    mediaType: "text/plain; charset=utf-8",
    size: 4,
    text: "test",
  };
  assert.deepEqual(
    partitionPreviews(
      [absolute, relative, "media-test/test.png"],
      new Map([
        [absolute, preview],
        [relative, preview],
        ["media-test/test.png", {
          path: "media-test/test.png",
          name: "test.png",
          kind: "image",
          mediaType: "image/png",
          size: 3,
        }],
      ]),
    ),
    {
      media: [{
        path: "media-test/test.png",
        name: "test.png",
        kind: "image",
        mediaType: "image/png",
        size: 3,
      }],
      files: [relative],
      loading: false,
    },
  );
});

test("in-message chips that only name a produced path are duplicates", () => {
  const paths = ["outputs/orange-cat-jump.mp4", "drive/Data/flowstudio/out/cover.webp"];
  assert.equal(isDuplicateProducedMention("outputs/orange-cat-jump.mp4", paths), true);
  assert.equal(isDuplicateProducedMention("`orange-cat-jump.mp4`", paths), true);
  assert.equal(isDuplicateProducedMention("@cover.webp", paths), true);
  assert.equal(isDuplicateProducedMention("需要大图可打开同组的 delivery.webp", paths), false);
});

test("turn media treats produced glb as inline media", () => {
  const item = {
    path: "outputs/mesh.glb",
    name: "mesh.glb",
    kind: "model3d",
    mediaType: "model/gltf-binary",
    size: 12,
  };
  assert.deepEqual(
    partitionPreviews(["outputs/mesh.glb"], new Map([["outputs/mesh.glb", item]])),
    { media: [item], files: [], loading: false },
  );
});

test("Olares Files media waits for preview then inlines like workspace media", () => {
  const path = "drive/Home/Downloads/clip.webm";
  const item = {
    path,
    name: "clip.webm",
    kind: "video",
    mediaType: "video/webm",
    size: 80,
  };
  assert.deepEqual(
    partitionPreviews([path], new Map()),
    { media: [], files: [], loading: true },
  );
  assert.deepEqual(
    partitionPreviews([path], new Map([[path, item]])),
    { media: [item], files: [], loading: false },
  );
  assert.deepEqual(
    partitionPreviews([path], new Map([[path, null]])),
    { media: [], files: [path], loading: false },
  );
});

test("produced chips omit missing files and non-media downloads scratch", () => {
  const chart = {
    path: "plex/Chart.yaml",
    name: "Chart.yaml",
    kind: "text",
    mediaType: "text/plain; charset=utf-8",
    size: 20,
  };
  const portrait = {
    path: "downloads/portrait.jpg",
    name: "portrait.jpg",
    kind: "image",
    mediaType: "image/jpeg",
    size: 40,
  };
  assert.deepEqual(
    partitionPreviews(
      [
        "downloads/jellyfin-list.json",
        "downloads/portrait.jpg",
        "plex/Chart.yaml",
        "downloads/gone.mp4",
      ],
      new Map([
        ["downloads/jellyfin-list.json", {
          path: "downloads/jellyfin-list.json",
          name: "jellyfin-list.json",
          kind: "text",
          mediaType: "text/plain; charset=utf-8",
          size: 10,
        }],
        ["downloads/portrait.jpg", portrait],
        ["plex/Chart.yaml", chart],
        ["downloads/gone.mp4", null],
      ]),
    ),
    { media: [portrait], files: ["plex/Chart.yaml"], loading: false },
  );
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
    writeFileSync(join(root, "notes.md"), "# hi\n");
    assert.equal(workspaceFileAlias(root, "/app/notes.md"), "notes.md");
    assert.equal(workspaceFileAlias(root, "/app/packages/notes.md"), null);
    assert.equal(workspaceFileAlias(root, "/tmp/notes.md"), null);
    assert.equal(workspaceFileAlias(root, "/etc/notes.md"), null);
    const aliased = await resolveWorkspaceFile(root, "/app/notes.md");
    assert.equal(aliased.path, "notes.md");
    await assert.rejects(
      () => resolveWorkspaceFile(root, "/app/packages/secret.txt"),
      (error: { code?: string }) => error.code === "path_forbidden",
    );
    await assert.rejects(
      () => resolveWorkspaceFile(root, "/app/absent.md"),
      (error: { code?: string }) => error.code === "path_forbidden",
    );
    await assert.rejects(
      () => resolveWorkspaceFile(root, "/tmp/notes.md"),
      (error: { code?: string }) => error.code === "path_forbidden",
    );
    const fromRequest = await fileFromPreviewRequest(
      "/preview?path=docs/notes.txt&sessionId=s1",
      async () => ({ path: root }),
    );
    assert.equal(fromRequest.path, join("docs", "notes.txt"));
    await assert.rejects(
      () => fileFromPreviewRequest("/preview", async () => ({ path: root })),
      (error: { code?: string }) => error.code === "path_invalid",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("file-preview opens Lares skill files without copying them onto Drive", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "lares-skill-preview-"));
  const workspace = mkdtempSync(join(tmpdir(), "lares-skill-preview-ws-"));
  const outside = mkdtempSync(join(tmpdir(), "lares-skill-preview-out-"));
  try {
    const skill = join(dataDir, "skills", "olares-router", "references");
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, "olares-router-calling.md"), "# calling\n");
    writeFileSync(join(outside, "secret.md"), "nope");
    symlinkSync(join(outside, "secret.md"), join(skill, "escape.md"));

    const env = { LARES_DATA_DIR: dataDir };
    const file = await fileFromPreviewRequest(
      `/preview?path=${encodeURIComponent(join(skill, "olares-router-calling.md"))}&sessionId=s1`,
      async () => ({ path: workspace }),
      { env },
    );
    assert.equal(file.origin, "local");
    assert.equal(file.kind, "markdown");
    assert.equal(file.name, "olares-router-calling.md");

    await assert.rejects(
      () => fileFromPreviewRequest(
        `/preview?path=${encodeURIComponent(join(skill, "escape.md"))}&sessionId=s1`,
        async () => ({ path: workspace }),
        { env },
      ),
      (error: { code?: string }) => error.code === "path_forbidden",
    );
    await assert.rejects(
      () => fileFromPreviewRequest(
        `/preview?path=${encodeURIComponent(join(dataDir, "preview-cache", "a.md"))}&sessionId=s1`,
        async () => ({ path: workspace }),
        { env },
      ),
      (error: { code?: string }) => error.code === "path_forbidden",
    );
    await assert.rejects(
      () => fileFromPreviewRequest(
        `/preview?path=${encodeURIComponent(join(skill, "missing.md"))}&sessionId=s1`,
        async () => ({ path: workspace }),
        { env },
      ),
      (error: { code?: string }) => error.code === "file_not_found",
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("streaming refuses a file replaced after path validation", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-file-preview-"));
  const outside = mkdtempSync(join(tmpdir(), "lares-file-preview-outside-"));
  try {
    writeFileSync(join(root, "report.txt"), "inside");
    writeFileSync(join(outside, "secret.txt"), "secret");
    const resolved = await resolveWorkspaceFile(root, "report.txt");
    rmSync(join(root, "report.txt"));
    symlinkSync(join(outside, "secret.txt"), join(root, "report.txt"));
    await assert.rejects(
      () => sendFileDownload(
        { method: "HEAD", headers: {} } as never,
        { writeHead: () => {}, end: () => {} } as never,
        resolved,
      ),
      (error: { code?: string }) => error.code === "file_changed",
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

test("unknown extensions preview when their contents are text, not binary", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-file-preview-"));
  try {
    writeFileSync(join(root, "schema.protox"), "message Report {}\n");
    writeFileSync(join(root, "font.unknown"), Buffer.from([0, 1, 2, 3, 4]));

    const text = await buildPreview(await resolveWorkspaceFile(root, "schema.protox"));
    assert.equal(text.kind, "text");
    assert.equal(text.text, "message Report {}\n");

    const binary = await buildPreview(await resolveWorkspaceFile(root, "font.unknown"));
    assert.equal(binary.kind, "unsupported");
    assert.equal("text" in binary, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("download serves what inline preview refuses, as an attachment", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-file-preview-"));
  try {
    writeFileSync(join(root, "季度.pptx"), "deck");
    const file = await resolveWorkspaceFile(root, "季度.pptx");
    assert.equal(file.kind, "unsupported");

    const sent: { status?: number; headers?: Record<string, string> } = {};
    const res = {
      writeHead: (status: number, headers: Record<string, string>) => {
        sent.status = status;
        sent.headers = headers;
      },
      end: () => {},
    };
    await sendFileDownload({ method: "HEAD", headers: {} } as never, res as never, file);

    assert.equal(sent.status, 200);
    assert.equal(sent.headers?.["content-length"], "4");
    assert.equal(
      sent.headers?.["content-disposition"],
      `attachment; filename*=UTF-8''${encodeURIComponent("季度.pptx")}`,
    );
    await assert.rejects(
      () => sendRawFile({ method: "HEAD", headers: {} } as never, res as never, file),
      (error: { code?: string }) => error.code === "preview_unsupported",
    );

    const chunks: Buffer[] = [];
    const body = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }) as Writable & { writeHead: (status: number, headers: Record<string, string>) => void };
    const streamed: { status?: number; headers?: Record<string, string> } = {};
    body.writeHead = (status, headers) => {
      streamed.status = status;
      streamed.headers = headers;
    };
    await sendFileDownload({ method: "GET", headers: {} } as never, body as never, file);
    await once(body, "finish");
    assert.equal(streamed.status, 200);
    assert.equal(Buffer.concat(chunks).toString(), "deck");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("large range-streamed media stays previewable while whole documents stay bounded", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-file-preview-"));
  try {
    writeFileSync(join(root, "large.mp4"), "");
    writeFileSync(join(root, "large.png"), "");
    writeFileSync(join(root, "large.glb"), "");
    truncateSync(join(root, "large.mp4"), MAX_RAW_BYTES + 1);
    truncateSync(join(root, "large.png"), MAX_RAW_BYTES + 1);
    truncateSync(join(root, "large.glb"), MAX_RAW_BYTES + 1);
    const sent: { status?: number; headers?: Record<string, string> } = {};
    const res = {
      writeHead: (status: number, headers: Record<string, string>) => {
        sent.status = status;
        sent.headers = headers;
      },
      end: () => {},
    };
    await sendRawFile(
      { method: "HEAD", headers: {} } as never,
      res as never,
      await resolveWorkspaceFile(root, "large.mp4"),
    );
    assert.equal(sent.status, 200);
    assert.equal(sent.headers?.["cache-control"], "private, no-cache");
    const image = await resolveWorkspaceFile(root, "large.png");
    const mesh = await resolveWorkspaceFile(root, "large.glb");
    await assert.rejects(
      () => sendRawFile(
        { method: "HEAD", headers: {} } as never,
        res as never,
        image,
      ),
      (error: { code?: string }) => error.code === "file_too_large",
    );
    await assert.rejects(
      () => sendRawFile(
        { method: "HEAD", headers: {} } as never,
        res as never,
        mesh,
      ),
      (error: { code?: string }) => error.code === "file_too_large",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("raw media URLs change when the file version changes", () => {
  assert.notEqual(
    rawFileUrl("s1", "outputs/video.mp4", 100),
    rawFileUrl("s1", "outputs/video.mp4", 101),
  );
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
    "[drive](drive/Home/Downloads/clip.webm)",
  ].join("\n");

  const rewritten = rewriteWorkspaceTargets(
    source,
    "demo/index.md",
    (path: string) => `https://host/raw?p=${path}`,
  );

  assert.match(rewritten, /\[drive\]\(https:\/\/host\/raw\?p=drive\/Home\/Downloads\/clip\.webm\)/);
  assert.match(rewritten, /\[tour\]\(https:\/\/host\/raw\?p=demo\/doc\/tour\.md\)/);
  assert.match(rewritten, /!\[card\]\(https:\/\/host\/raw\?p=demo\/image\/testcard\.png\)/);
  assert.match(rewritten, /\[out\]\(https:\/\/olares\.com\)/);
  assert.match(rewritten, /`\[code\]\(a\.png\)`/);
  assert.match(rewritten, /\[gone\]\(\.\.\/\.\.\/etc\/passwd\)/);
  assert.match(rewritten, /\[fenced\]\(a\.png\)/);
  assert.match(rewritten, /\[after\]\(https:\/\/host\/raw\?p=demo\/b\.md\)/);
});

test("markdown preview clicks only intercept unmodified same-origin workspace links", () => {
  assert.equal(isPrimaryUnmodifiedClick({ button: 0 }), true);
  assert.equal(isPrimaryUnmodifiedClick({ button: 0, metaKey: true }), false);
  const href = rawFileUrl("s1", "notes.md");
  assert.equal(
    workspaceLinkClickPath("s1", {
      button: 0,
      target: { closest: () => ({ getAttribute: () => href }) },
    }),
    "notes.md",
  );
  assert.equal(
    workspaceLinkClickPath("s1", {
      button: 0,
      target: { closest: () => ({ getAttribute: () => "https://example.com" }) },
    }),
    null,
  );
});

test("raw preview URLs stay Host-native so PC and LarePass share the same address", () => {
  const href = hostUrl({
    proxyPrefix: PC_TEST_PROXY,
    path: rawFileUrl("s1", "notes.md"),
  });
  assert.equal(href, "/api/lares/file-preview/raw?sessionId=s1&path=notes.md");
  assert.equal(rawUrlPath("s1", href), "notes.md");
  assert.equal(rawUrlPath("s1", `${PC_TEST_PROXY}${href}`), "notes.md");
  assert.equal(
    workspaceLinkClickPath("s1", {
      button: 0,
      target: { closest: () => ({ getAttribute: () => href }) },
    }),
    "notes.md",
  );
});

test("overlay source is not a preview click target", () => {
  assert.equal(isUnpreviewableOpenPath("/app/packages/core/media/router-images.js"), true);
  assert.equal(isUnpreviewableOpenPath("/app/packages/skills/lares-media-create/SKILL.md"), true);
  assert.equal(isUnpreviewableOpenPath("/app"), true);
  assert.equal(isUnpreviewableOpenPath("/app/notes.md"), false);
  assert.equal(isUnpreviewableOpenPath("notes.md"), false);
  assert.equal(isUnpreviewableOpenPath("/data/lares/skills/olares-router/SKILL.md"), false);
});

test("interceptOpenPath falls back to the native opener when preview declines", async () => {
  const native: string[] = [];
  await interceptOpenPath({ openCurrent: async () => false }, "folder/", (path) => {
    native.push(path);
  });
  assert.deepEqual(native, ["folder/"]);
  await interceptOpenPath({ openCurrent: async () => true }, "notes.md", () => {
    throw new Error("should not fall back");
  });
  const overlay: string[] = [];
  await interceptOpenPath(
    { openCurrent: async () => true },
    "/app/packages/core/media/router-images.js",
    (path) => {
      overlay.push(path);
    },
  );
  assert.deepEqual(overlay, []);
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

    assert.equal(await workspace.openCurrent("/app/packages/core/media/router-images.js"), false);
    assert.equal(workspace.getSnapshot("s1").mode, "preview");
    assert.equal(workspace.getSnapshot("s1").activePath, "notes.txt");
    // Overlay source is ignored before fetch; the claim probe is only the
    // directory decline and the workspace file.
    assert.deepEqual(requested, ["/data/workspace/.", "notes.txt"]);
  } finally {
    unbind();
    globalThis.fetch = original;
  }
});

test("an unauthenticated Files click opens a retryable preview error", async () => {
  const original = globalThis.fetch;
  let authenticated = false;
  globalThis.fetch = (async () => authenticated
    ? new Response(JSON.stringify({
      path: "drive/Home/notes.txt",
      name: "notes.txt",
      kind: "text",
      size: 2,
      text: "hi",
    }), { status: 200 })
    : new Response(JSON.stringify({ error: { code: "files_unauthenticated" } }), { status: 401 })) as typeof fetch;

  const workspace = new FilePreviewWorkspace();
  const unbind = workspace.bindCurrent("s1");
  try {
    assert.equal(await workspace.openCurrent("drive/Home/notes.txt"), true);
    assert.equal(workspace.getSnapshot("s1").mode, "preview");
    assert.equal(workspace.getSnapshot("s1").content.status, "error");
    assert.equal(workspace.getSnapshot("s1").content.message, "files_unauthenticated");

    authenticated = true;
    assert.equal(await workspace.openCurrent("drive/Home/notes.txt"), true);
    assert.equal(workspace.getSnapshot("s1").mode, "preview");
    assert.equal(workspace.getSnapshot("s1").activePath, "drive/Home/notes.txt");
    assert.equal(workspace.getSnapshot("s1").content.status, "ready");
    assert.equal(workspace.getSnapshot("s1").tabs.length, 1);
  } finally {
    unbind();
    globalThis.fetch = original;
  }
});

test("openCurrent unjoins a files path the chat view attached to the session cwd", async () => {
  const requested: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    requested.push(new URL(String(url), "http://x").searchParams.get("path") ?? "");
    return new Response(JSON.stringify({
      path: "drive/Home/clip.webm",
      name: "clip.webm",
      kind: "video",
      size: 8,
    }), { status: 200 });
  }) as typeof fetch;

  const workspace = new FilePreviewWorkspace();
  const unbind = workspace.bindCurrent("s1", "/data/workspace");
  try {
    assert.equal(
      await workspace.openCurrent("/data/workspace/drive/Home/clip.webm"),
      true,
    );
    assert.deepEqual(requested, ["drive/Home/clip.webm"]);
    assert.equal(workspace.getSnapshot("s1").activePath, "drive/Home/clip.webm");
  } finally {
    unbind();
    globalThis.fetch = original;
  }
});

test("openCurrent still opens a tab when a Files path is missing", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ error: { code: "file_not_found" } }),
    { status: 404 },
  )) as typeof fetch;

  const workspace = new FilePreviewWorkspace();
  const unbind = workspace.bindCurrent("s1");
  try {
    assert.equal(
      await workspace.openCurrent("drive/Data/flowstudio/userData/luolong01/clip.mp4"),
      true,
    );
    const snapshot = workspace.getSnapshot("s1");
    assert.equal(snapshot.mode, "preview");
    assert.equal(snapshot.content.status, "error");
    assert.equal(snapshot.content.message, "file_not_found");
  } finally {
    unbind();
    globalThis.fetch = original;
  }
});

test("reopening a path refetches files that were overwritten in place", async () => {
  const original = globalThis.fetch;
  let revision = 0;
  globalThis.fetch = (async () => {
    revision += 1;
    return new Response(JSON.stringify({
      path: "notes.txt",
      name: "notes.txt",
      kind: "text",
      size: revision,
      modifiedAt: revision,
      text: `revision ${revision}`,
    }), { status: 200 });
  }) as typeof fetch;

  const workspace = new FilePreviewWorkspace();
  const unbind = workspace.bindCurrent("s1");
  try {
    assert.equal(await workspace.openCurrent("notes.txt"), true);
    assert.equal(workspace.getSnapshot("s1").content.data.text, "revision 1");
    assert.equal(await workspace.openCurrent("notes.txt"), true);
    assert.equal(workspace.getSnapshot("s1").content.data.text, "revision 2");
  } finally {
    unbind();
    globalThis.fetch = original;
  }
});

test("absolute and relative open requests share the host-canonical tab", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    path: "notes.txt",
    name: "notes.txt",
    kind: "text",
    size: 2,
    modifiedAt: 1,
    text: "ok",
  }), { status: 200 })) as typeof fetch;
  const workspace = new FilePreviewWorkspace();
  const unbind = workspace.bindCurrent("s1");
  try {
    await workspace.openCurrent("/data/workspace/notes.txt");
    await workspace.openCurrent("notes.txt");
    assert.deepEqual(
      workspace.getSnapshot("s1").tabs.map((tab) => tab.path),
      ["notes.txt"],
    );
  } finally {
    unbind();
    globalThis.fetch = original;
  }
});

test("opening an existing tab through a markdown link also refreshes it", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    path: "notes.txt",
    name: "notes.txt",
    kind: "text",
    size: 2,
    modifiedAt: 2,
    text: "new",
  }), { status: 200 })) as typeof fetch;

  const workspace = new FilePreviewWorkspace();
  workspace.open("s1", "notes.txt", {
    status: "ready",
    data: { path: "notes.txt", name: "notes.txt", kind: "text", size: 1, modifiedAt: 1, text: "old" },
  });
  try {
    workspace.open("s1", "notes.txt");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(workspace.getSnapshot("s1").content.data.text, "new");
  } finally {
    globalThis.fetch = original;
  }
});

test("image and video preview CSS fits the pane instead of scrolling the bitmap", () => {
  const css = readFileSync(
    join(import.meta.dirname, "../../packages/web/workspace-preview/src/client/styles.css"),
    "utf8",
  );
  const media = (css.match(/\.lares-preview-media\s*\{[^}]+\}/)?.[0] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(media, /grid-template:\s*minmax\(0,\s*1fr\)\s*\/\s*minmax\(0,\s*1fr\)/);
  assert.match(media, /overflow:\s*hidden/);
  assert.doesNotMatch(media, /overflow:\s*auto/);
});

test("the chat offset survives the preview owning the scrollport", () => {
  // Standing in for the browser: taking the scrollport collapses the flow, so
  // the offset reads back as 0 until the preview hands it over again.
  const scrollport = {
    offset: () => scrollport.value,
    scrollTo: (offset: number) => {
      scrollport.value = offset;
    },
    value: 0,
  };
  const workspace = new FilePreviewWorkspace(scrollport);
  const ready = {
    status: "ready",
    data: { path: "a.md", name: "a.md", kind: "markdown", size: 0, text: "" },
  };

  scrollport.value = 266;
  workspace.open("s1", "a.md", ready);
  scrollport.value = 0;

  // A second tab is not a fresh takeover: the first capture still stands.
  workspace.open("s1", "b.md", ready);
  workspace.activate("s1", "a.md");
  assert.equal(scrollport.value, 0);

  workspace.showChat("s1");
  workspace.restoreChatScroll("s1");
  assert.equal(scrollport.value, 266);

  // Nothing captured: a later release must not move the reader to the top.
  scrollport.value = 140;
  workspace.restoreChatScroll("s1");
  assert.equal(scrollport.value, 140);
});

test("a captured chat offset belongs to one session and is droppable without writing", () => {
  const scrollport = {
    offset: () => scrollport.value,
    scrollTo: (offset: number) => {
      scrollport.value = offset;
    },
    value: 0,
  };
  const workspace = new FilePreviewWorkspace(scrollport);
  const ready = {
    status: "ready",
    data: { path: "a.md", name: "a.md", kind: "markdown", size: 0, text: "" },
  };

  scrollport.value = 266;
  workspace.open("s1", "a.md", ready);
  scrollport.value = 0;
  workspace.showChat("s1");

  scrollport.value = 80;
  workspace.open("s2", "b.md", ready);
  scrollport.value = 0;
  workspace.abandonChatScroll("s1");
  workspace.restoreChatScroll("s1");
  assert.equal(scrollport.value, 0);

  workspace.showChat("s2");
  workspace.restoreChatScroll("s2");
  assert.equal(scrollport.value, 80);
});

test("downloadCurrentFile preflights then streams outside the conversation", async () => {
  assert.equal(
    filenameFromDisposition(`attachment; filename*=UTF-8''${encodeURIComponent("季度.pptx")}`),
    "季度.pptx",
  );
  const requested: { url: string; method?: string }[] = [];
  const saved: { url?: string; name?: string }[] = [];
  await downloadCurrentFile("/api/lares/file-preview/download?path=a.png", {
    fetchFn: async (url: string, init?: RequestInit) => {
      requested.push({ url, method: init?.method });
      return new Response(null, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-disposition": "attachment; filename*=UTF-8''shot.png",
      },
      });
    },
    save: (url: string, name: string) => {
      saved.push({ url, name });
    },
  });
  assert.deepEqual(requested, [{
    url: "/api/lares/file-preview/download?path=a.png",
    method: "HEAD",
  }]);
  assert.deepEqual(saved, [{
    url: "/api/lares/file-preview/download?path=a.png",
    name: "shot.png",
  }]);
  await assert.rejects(
    downloadCurrentFile("/api/lares/file-preview/download?path=missing.png", {
      fetchFn: async () => new Response("gone", { status: 404 }),
      save: () => {
        throw new Error("must not save a failed download");
      },
    }),
    { message: "file_not_found" },
  );
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

test("workspaceTargetPath keeps Olares files paths as identity", () => {
  const from = "preview-demo/index.md";
  assert.equal(
    workspaceTargetPath(from, "drive/Home/Downloads/clip.webm"),
    "drive/Home/Downloads/clip.webm",
  );
  assert.equal(
    workspaceTargetPath(from, "Home/Documents/clip.webm"),
    "drive/Home/Documents/clip.webm",
  );
  assert.equal(
    workspaceTargetPath("drive/Home/notes/index.md", "photo.png"),
    "drive/Home/notes/photo.png",
  );
  assert.equal(workspaceTargetPath(from, "downloads/clip.webm"), "preview-demo/downloads/clip.webm");
});

test("fileFromPreviewRequest serves an Olares files path without the session workspace", async () => {
  let workspaceCalled = false;
  const file = await fileFromPreviewRequest(
    "/preview?path=Home/Documents/clip.webm&sessionId=s1",
    async () => {
      workspaceCalled = true;
      return { path: "/nope" };
    },
    {
      stat: async (source: string) => ({
        path: source,
        name: "clip.webm",
        size: 491_000_000,
        modifiedAt: 1,
      }),
    },
  );
  assert.equal(workspaceCalled, false);
  assert.equal(file.origin, "files");
  assert.equal(file.path, "drive/Home/Documents/clip.webm");
  assert.equal(file.kind, "video");
  assert.equal(file.size, 491_000_000);
  assert.equal(file.absolutePath, undefined);
});

test("fileFromPreviewRequest rejects a Files directory without a workspace lookup", async () => {
  let workspaceCalled = false;
  let stated = false;
  await assert.rejects(
    () => fileFromPreviewRequest(
      "/preview?path=drive/Home/Downloads/&sessionId=s1",
      async () => {
        workspaceCalled = true;
        return { path: "/nope" };
      },
      {
        stat: async () => {
          stated = true;
          return { path: "drive/Home/Downloads", name: "Downloads", size: 0, modifiedAt: 0 };
        },
      },
    ),
    (error: { code?: string; status?: number }) => error.code === "path_invalid" && error.status === 400,
  );
  assert.equal(workspaceCalled, false);
  assert.equal(stated, false);
});

test("fileFromPreviewRequest unwraps a files path the chat opener joined onto the cwd", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lares-file-preview-joined-")));
  try {
    const stat = async (source: string) => ({
      path: source,
      name: "clip.webm",
      size: 1_761_844_690,
      modifiedAt: 1,
    });
    const query = `path=${encodeURIComponent(join(root, "drive/Home/Downloads/clip.webm"))}`;
    const file = await fileFromPreviewRequest(
      `/preview?${query}&sessionId=s1`,
      async () => ({ path: root }),
      { stat },
    );
    assert.equal(file.origin, "files");
    assert.equal(file.path, "drive/Home/Downloads/clip.webm");
    assert.equal(file.kind, "video");

    // A real workspace file keeps the workspace namespace.
    mkdirSync(join(root, "drive", "Home", "Downloads"), { recursive: true });
    writeFileSync(join(root, "drive", "Home", "Downloads", "clip.webm"), "local");
    const local = await fileFromPreviewRequest(
      `/preview?${query}&sessionId=s1`,
      async () => ({ path: root }),
      { stat },
    );
    assert.equal(local.origin, undefined);
    assert.equal(local.size, 5);

    // A missing workspace file that is not a files address still fails as one.
    await assert.rejects(
      () => fileFromPreviewRequest(
        `/preview?path=${encodeURIComponent(join(root, "notes.txt"))}&sessionId=s1`,
        async () => ({ path: root }),
        { stat },
      ),
      (error: { code?: string }) => error.code === "file_not_found",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fileFromPreviewRequest unwraps a files path when cwd realpath differs", async () => {
  const real = realpathSync(mkdtempSync(join(tmpdir(), "lares-file-preview-real-")));
  const lexical = join(tmpdir(), `lares-file-preview-link-${Date.now()}`);
  symlinkSync(real, lexical);
  try {
    const query = `path=${encodeURIComponent(join(lexical, "drive/Home/Downloads/clip.webm"))}`;
    const file = await fileFromPreviewRequest(
      `/preview?${query}&sessionId=s1`,
      async () => ({ path: lexical }),
      {
        stat: async (source: string) => ({
          path: source,
          name: "clip.webm",
          size: 12,
          modifiedAt: 1,
        }),
      },
    );
    assert.equal(file.origin, "files");
    assert.equal(file.path, "drive/Home/Downloads/clip.webm");
  } finally {
    rmSync(lexical, { force: true });
    rmSync(real, { recursive: true, force: true });
  }
});

test("files-path video metadata does not download bytes", async () => {
  let materialized = false;
  const preview = await buildPreview(
    {
      origin: "files",
      path: "drive/Home/Downloads/clip.webm",
      name: "clip.webm",
      size: 491_000_000,
      modifiedAt: 1,
      kind: "video",
      mediaType: "video/webm",
    } as never,
    {
      materialize: async () => {
        materialized = true;
        throw new Error("should not materialize");
      },
    },
  );
  assert.equal(preview.kind, "video");
  assert.equal(preview.size, 491_000_000);
  assert.equal(materialized, false);
});

test("raw preview proxies a Files range instead of materializing a cache", async () => {
  const file = await fileFromPreviewRequest(
    "/raw?path=drive/Home/Downloads/clip.webm&sessionId=s1",
    async () => ({ path: "/nope" }),
    {
      stat: async (source: string) => ({
        path: source,
        name: "clip.webm",
        size: 5,
        modifiedAt: 1,
      }),
    },
  );
  const sent: { status?: number; headers?: Record<string, string> } = {};
  const res = {
    writeHead: (status: number, headers: Record<string, string>) => {
      sent.status = status;
      sent.headers = headers;
    },
    end: () => {},
  };
  let opened = false;
  await sendRawFile(
    { method: "HEAD", headers: { range: "bytes=0-4" } } as never,
    res as never,
    file,
    {
      openFilesRaw: async () => {
        opened = true;
        throw new Error("HEAD must not open Files raw");
      },
    },
  );
  assert.equal(opened, false);
  assert.equal(sent.status, 206);
  assert.equal(sent.headers?.["content-type"], "video/webm");
  assert.equal(sent.headers?.["content-length"], "5");
  assert.equal(sent.headers?.["content-range"], "bytes 0-4/5");
});

test("Files download HEAD uses stated size and does not open raw", async () => {
  let opened = false;
  const sent: { status?: number; headers?: Record<string, string> } = {};
  const res = {
    writeHead: (status: number, headers: Record<string, string>) => {
      sent.status = status;
      sent.headers = headers;
    },
    end: () => {},
  };
  const file = {
    origin: "files",
    path: "drive/Home/Downloads/clip.webm",
    name: "clip.webm",
    size: 1_761_844_690,
    modifiedAt: 1,
    kind: "video",
    mediaType: "video/webm",
  };
  await sendFileDownload(
    { method: "HEAD", headers: {} } as never,
    res as never,
    file as never,
    {
      openFilesRaw: async () => {
        opened = true;
        throw new Error("HEAD must not open Files raw");
      },
    },
  );
  assert.equal(opened, false);
  assert.equal(sent.status, 200);
  assert.equal(sent.headers?.["content-length"], "1761844690");
  assert.match(sent.headers?.["content-disposition"] ?? "", /attachment/);
});
