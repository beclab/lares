import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFetchTool } from "../../packages/plugins/drive-import/host/index.js";
import { runOlaresDownload } from "../../packages/plugins/drive-import/host/download.js";
import { describeFetch, resolveFetch } from "../../packages/plugins/drive-import/host/paths.js";

function execContext(cwd: string) {
  return { agent: { session: { header: { cwd } } }, signal: new AbortController().signal };
}

function fakeChild(exit: { code?: number; stderr?: string; error?: Error }) {
  const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    if (exit.error) {
      child.emit("error", exit.error);
      return;
    }
    if (exit.stderr) child.stderr.emit("data", Buffer.from(exit.stderr));
    child.emit("close", exit.code ?? 0);
  });
  return child;
}

test("resolveFetch defaults to downloads/ and the source file name", () => {
  assert.deepEqual(resolveFetch({ path: "drive/Home/Downloads/clip.webm" }), {
    source: "drive/Home/Downloads/clip.webm",
    destination: "downloads/clip.webm",
  });
  assert.equal(resolveFetch({ path: "sync/abc/notes/我的 稿子.md" }).destination, "downloads/我的_稿子.md");
});

test("resolveFetch honours an explicit file or directory destination", () => {
  assert.equal(resolveFetch({ path: "drive/Home/a.webm", destination: "clips/one.webm" }).destination, "clips/one.webm");
  assert.equal(resolveFetch({ path: "drive/Home/a.webm", destination: "clips/" }).destination, "clips/a.webm");
});

test("resolveFetch rejects anything that is not one fetchable files path", () => {
  assert.throws(() => resolveFetch({ path: "" }), /path is required/);
  assert.throws(() => resolveFetch({ path: "/data/workspace/a.webm" }), /not an Olares files path/);
  assert.throws(() => resolveFetch({ path: "drive/Home/Downloads/" }), /single file/);
  assert.throws(() => resolveFetch({ path: "share/Home/a.webm" }), /downloadable namespace/);
  assert.throws(() => resolveFetch({ path: "drive/Home" }), /malformed/);
});

test("resolveFetch keeps the destination inside the workspace", () => {
  assert.throws(() => resolveFetch({ path: "drive/Home/a.webm", destination: "../a.webm" }), /inside the workspace/);
  assert.throws(() => resolveFetch({ path: "drive/Home/a.webm", destination: "/tmp/a.webm" }), /inside the workspace/);
});

test("describeFetch answers null instead of throwing for replayed arguments", () => {
  assert.equal(describeFetch({ path: "nowhere" }), null);
  assert.equal(describeFetch({ path: "drive/Home/a.webm" })?.destination, "downloads/a.webm");
});

test("the call view declares the fetched path as a produced file", () => {
  const tool = createFetchTool(async () => {});
  const view = tool.presentCall?.({ path: "drive/Home/Downloads/clip.webm" });
  assert.equal(view?.card, "generic");
  assert.equal(view?.kind, "edit");
  assert.deepEqual(view?.locations, [{ path: "downloads/clip.webm" }]);
});

test("drive_fetch downloads into the session workspace and reports the relative path", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-drive-import-"));
  try {
    const seen: string[] = [];
    const tool = createFetchTool(async (source: string, absolutePath: string) => {
      seen.push(source, absolutePath);
      writeFileSync(absolutePath, "video-bytes");
    });
    const result = await tool.execute({ path: "drive/Home/Downloads/clip.webm" }, execContext(root));
    assert.deepEqual(result, { path: "downloads/clip.webm", bytes: 11 });
    assert.deepEqual(seen, [
      "drive/Home/Downloads/clip.webm",
      join(realpathSync(root), "downloads", "clip.webm"),
    ]);
    assert.equal(readFileSync(join(root, "downloads", "clip.webm"), "utf8"), "video-bytes");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("drive_fetch refuses to clobber a destination unless overwrite is asked for", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-drive-import-"));
  try {
    const tool = createFetchTool(async (_source: string, absolutePath: string) => {
      writeFileSync(absolutePath, "fresh");
    });
    await tool.execute({ path: "drive/Home/a.txt" }, execContext(root));
    await assert.rejects(
      tool.execute({ path: "drive/Home/a.txt" }, execContext(root)),
      /already exists/,
    );
    const replaced = await tool.execute(
      { path: "drive/Home/a.txt", overwrite: true },
      execContext(root),
    );
    assert.equal(replaced.path, "downloads/a.txt");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runOlaresDownload passes the files path and target through to the CLI", async () => {
  let call: { command: string; args: string[] } | null = null;
  await runOlaresDownload("drive/Home/a.webm", "/data/workspace/downloads/a.webm", {
    overwrite: true,
    spawnFn: (command: string, args: string[]) => {
      call = { command, args };
      return fakeChild({ code: 0 });
    },
  });
  assert.deepEqual(call, {
    command: "olares-cli",
    args: ["files", "download", "drive/Home/a.webm", "/data/workspace/downloads/a.webm", "--overwrite"],
  });
});

test("runOlaresDownload surfaces the CLI exit status and its stderr tail", async () => {
  await assert.rejects(
    runOlaresDownload("drive/Home/a.webm", "/tmp/a.webm", {
      spawnFn: () => fakeChild({ code: 1, stderr: "401 unauthorized\n" }),
    }),
    /exited 1: 401 unauthorized/,
  );
  await assert.rejects(
    runOlaresDownload("drive/Home/a.webm", "/tmp/a.webm", {
      spawnFn: () => fakeChild({ error: new Error("spawn ENOENT") }),
    }),
    /failed: spawn ENOENT/,
  );
});
