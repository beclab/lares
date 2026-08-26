import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFetchTool,
  createFfmpegEncodeTool,
  createUrlFetchTool,
  createWorkspacePublishTool,
} from "../../packages/web/workspace-artifacts/host/index.js";
import { runOlaresDownload } from "@lares/core/drive/download";
import {
  describeFetch,
  describeFfmpegEncode,
  describeUrlFetch,
  describeWorkspacePublish,
  resolveFetch,
  resolveFfmpegEncode,
  resolveUrlFetch,
  resolveWorkspacePublish,
} from "@lares/core/drive/paths";
import {
  assertPublicUrl,
  decodeDataUrl,
  downloadUrl,
  isPublicAddress,
  saveDataUrl,
} from "@lares/core/drive/url-download";
import {
  driveFetchDefinition,
  ffmpegEncodeDefinition,
  urlFetchDefinition,
  workspacePublishDefinition,
} from "@lares/core/drive/tools";

test("agent tool definitions live in core, not the web host", () => {
  assert.equal(driveFetchDefinition().name, "drive_fetch");
  assert.equal(urlFetchDefinition().name, "url_fetch");
  assert.equal(workspacePublishDefinition().name, "workspace_publish");
  assert.equal(ffmpegEncodeDefinition().name, "ffmpeg_encode");
});

function execContext(cwd: string) {
  return {
    agent: { session: { header: { cwd } } },
    signal: new AbortController().signal,
  } as any;
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

test("resolveUrlFetch derives safe paths and requires an extension for opaque URLs", () => {
  assert.deepEqual(resolveUrlFetch({ url: "https://cdn.example.com/media/photo.jpg?width=1200#top" }), {
    kind: "http",
    source: "https://cdn.example.com/media/photo.jpg?width=1200",
    destination: "downloads/photo.jpg",
  });
  assert.deepEqual(
    resolveUrlFetch({
      url: "https://images.example.com/photo-abc?width=1200",
      destination: "portraits/woman.jpg",
    }),
    {
      kind: "http",
      source: "https://images.example.com/photo-abc?width=1200",
      destination: "portraits/woman.jpg",
    },
  );
  assert.deepEqual(resolveUrlFetch({ url: "data:image/png;base64,aaaa" }), {
    kind: "data",
    source: "data:",
    destination: "downloads/download.png",
  });
  assert.throws(
    () => resolveUrlFetch({ url: "https://images.example.com/photo-abc?width=1200" }),
    /destination with a file extension is required/,
  );
  assert.throws(() => resolveUrlFetch({ url: "file:///etc/passwd" }), /only public HTTP\(S\)/);
  assert.throws(
    () => resolveUrlFetch({ url: "https://user:pass@example.com/a.jpg" }),
    /without embedded credentials/,
  );
  assert.throws(
    () => resolveUrlFetch({ url: "https://example.com/a.jpg", destination: "../a.jpg" }),
    /inside the workspace/,
  );
  assert.equal(describeUrlFetch({ url: "not a url" }), null);
});

test("resolveWorkspacePublish accepts only one workspace-relative file path", () => {
  assert.deepEqual(resolveWorkspacePublish({ path: "outputs/movie.mp4" }), {
    path: "outputs/movie.mp4",
  });
  assert.deepEqual(resolveWorkspacePublish({ path: "outputs\\voice.wav" }), {
    path: "outputs/voice.wav",
  });
  for (const path of ["", "/tmp/a.png", "../a.png", "outputs/", "a/./b.png"]) {
    assert.throws(() => resolveWorkspacePublish({ path }), /one existing file/);
  }
  assert.equal(describeWorkspacePublish({ path: "../a.png" }), null);
});

test("resolveFfmpegEncode builds a testsrc2 job without encoder or device flags", () => {
  assert.deepEqual(
    resolveFfmpegEncode({
      pattern: "testsrc2",
      duration: 3,
      width: 1280,
      height: 720,
      destination: "out.mp4",
    }),
    {
      input: null,
      subtitles: null,
      pattern: "testsrc2",
      lavfi: "testsrc2=size=1280x720:rate=30",
      duration: 3,
      destination: "out.mp4",
      overwrite: false,
    },
  );
  assert.equal(
    resolveFfmpegEncode({ input: "downloads/clip.webm" }).destination,
    "outputs/clip.mp4",
  );
  assert.equal(
    resolveFfmpegEncode({
      input: "downloads/clip.webm",
      subtitles: "sub/中文字幕.srt",
    }).subtitles,
    "sub/中文字幕.srt",
  );
  assert.throws(() => resolveFfmpegEncode({ pattern: "testsrc2" }), /duration is required/);
  assert.throws(
    () => resolveFfmpegEncode({ pattern: "testsrc2", duration: 3, input: "a.mp4" }),
    /exactly one of input or pattern/,
  );
  assert.throws(
    () => resolveFfmpegEncode({
      pattern: "testsrc2",
      duration: 3,
      subtitles: "sub/captions.srt",
    }),
    /subtitles require an input video/,
  );
  assert.throws(
    () => resolveFfmpegEncode({ input: "a.mp4", subtitles: "sub/captions.txt" }),
    /subtitles must end in/,
  );
  assert.throws(
    () => resolveFfmpegEncode({ input: "a.mp4", destination: "outputs/a.mkv" }),
    /destination must end in \.mp4/,
  );
  assert.equal(describeFfmpegEncode({ pattern: "nope", duration: 1 }), null);
});

test("the call view declares the fetched path as a produced file", () => {
  const tool = createFetchTool(async () => {});
  const view = tool.presentCall?.({ path: "drive/Home/Downloads/clip.webm" }) as any;
  assert.equal(view?.card, "generic");
  assert.equal(view?.kind, "edit");
  assert.deepEqual(view?.locations, [{ path: "downloads/clip.webm" }]);
});

test("url_fetch declares and returns a produced workspace file", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-url-import-"));
  try {
    const seen: string[] = [];
    const tool = createUrlFetchTool(async (source: string, absolutePath: string) => {
      seen.push(source, absolutePath);
      writeFileSync(absolutePath, "jpeg-bytes");
      return { bytes: 10, mediaType: "image/jpeg" };
    });
    const args = {
      url: "https://images.example.com/photo-abc?width=1200",
      destination: "portraits/woman.jpg",
    };
    const view = tool.presentCall?.(args) as any;
    assert.equal(view?.card, "generic");
    assert.equal(view?.kind, "edit");
    assert.deepEqual(view?.locations, [{ path: "portraits/woman.jpg" }]);

    const result = await tool.execute(args, execContext(root));
    assert.deepEqual(result, {
      path: "portraits/woman.jpg",
      bytes: 10,
      mediaType: "image/jpeg",
    });
    assert.deepEqual(seen, [
      "https://images.example.com/photo-abc?width=1200",
      join(realpathSync(root), "portraits", "woman.jpg"),
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("url_fetch writes a data URL into the workspace as a produced file", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-data-import-"));
  try {
    const tool = createUrlFetchTool(async () => {
      throw new Error("http download must not run for a data URL");
    });
    const args = { url: `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}` };
    const view = tool.presentCall?.(args) as any;
    assert.equal(view?.kind, "edit");
    assert.deepEqual(view?.locations, [{ path: "downloads/download.png" }]);
    assert.deepEqual(
      await tool.execute(args, execContext(root)),
      { path: "downloads/download.png", bytes: 9, mediaType: "image/png" },
    );
    assert.equal(readFileSync(join(root, "downloads", "download.png"), "utf8"), "png-bytes");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace_publish validates and declares an existing generated file", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-workspace-publish-"));
  const outside = mkdtempSync(join(tmpdir(), "lares-workspace-publish-outside-"));
  try {
    mkdirSync(join(root, "outputs"));
    writeFileSync(join(root, "outputs", "clip.mp4"), "video");
    writeFileSync(join(outside, "secret.mp4"), "secret");
    symlinkSync(join(outside, "secret.mp4"), join(root, "outputs", "escape.mp4"));

    const tool = createWorkspacePublishTool();
    const view = tool.presentCall?.({ path: "outputs/clip.mp4" }) as any;
    assert.equal(view?.card, "generic");
    assert.equal(view?.kind, "edit");
    assert.deepEqual(view?.locations, [{ path: "outputs/clip.mp4" }]);
    assert.deepEqual(
      await tool.execute({ path: "outputs/clip.mp4" }, execContext(root)),
      { path: "outputs/clip.mp4", bytes: 5 },
    );
    await assert.rejects(
      tool.execute({ path: "outputs/missing.mp4" }, execContext(root)),
      /file was not found/,
    );
    await assert.rejects(
      tool.execute({ path: "outputs/escape.mp4" }, execContext(root)),
      /leaves the session workspace/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("ffmpeg_encode publishes the output and reports encoder and speed", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-ffmpeg-encode-"));
  try {
    const tool = createFfmpegEncodeTool(async (job: { absolutePath: string }) => {
      writeFileSync(job.absolutePath, "mp4-bytes");
      return { bytes: 9, encoder: "libx264", speed: "2.83x" };
    });
    const args = {
      pattern: "testsrc2",
      duration: 3,
      width: 1280,
      height: 720,
      destination: "out.mp4",
    };
    const view = tool.presentCall?.(args) as any;
    assert.equal(view?.kind, "edit");
    assert.deepEqual(view?.locations, [{ path: "out.mp4" }]);
    assert.deepEqual(await tool.execute(args, execContext(root)), {
      path: "out.mp4",
      bytes: 9,
      encoder: "libx264",
      speed: "2.83x",
    });
    assert.equal(readFileSync(join(root, "out.mp4"), "utf8"), "mp4-bytes");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ffmpeg_encode resolves an input and subtitles inside the workspace", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-ffmpeg-subtitles-"));
  try {
    mkdirSync(join(root, "inputs"));
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "inputs", "clip.mp4"), "video");
    writeFileSync(join(root, "sub", "captions.srt"), "subtitles");
    let seen: any = null;
    const tool = createFfmpegEncodeTool(async (job: any) => {
      seen = job;
      writeFileSync(job.absolutePath, "encoded");
      return { bytes: 7, encoder: "libx264", speed: "4.2x" };
    });
    await tool.execute({
      input: "inputs/clip.mp4",
      subtitles: "sub/captions.srt",
      destination: "outputs/subtitled.mp4",
    }, execContext(root));
    assert.equal(seen.inputAbsolute, join(realpathSync(root), "inputs", "clip.mp4"));
    assert.equal(seen.subtitlesAbsolute, join(realpathSync(root), "sub", "captions.srt"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
    ) as any;
    assert.equal(replaced.path, "downloads/a.txt");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("overwrite never follows a destination symlink out of the workspace", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-drive-import-"));
  const outside = mkdtempSync(join(tmpdir(), "lares-drive-import-outside-"));
  try {
    mkdirSync(join(root, "downloads"));
    const target = join(outside, "a.txt");
    writeFileSync(target, "outside");
    symlinkSync(target, join(root, "downloads", "a.txt"));
    const tool = createFetchTool(async (_source: string, absolutePath: string) => {
      writeFileSync(absolutePath, "escaped");
    });
    await assert.rejects(
      tool.execute(
        { path: "drive/Home/a.txt", overwrite: true },
        execContext(root),
      ),
      /cannot overwrite a symlink/,
    );
    assert.equal(readFileSync(target, "utf8"), "outside");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
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

test("url_fetch accepts only globally routable addresses", async () => {
  assert.equal(isPublicAddress("93.184.216.34"), true);
  assert.equal(isPublicAddress("10.0.0.1"), false);
  assert.equal(isPublicAddress("127.0.0.1"), false);
  assert.equal(isPublicAddress("::1"), false);
  await assert.doesNotReject(() => assertPublicUrl(
    "https://example.com/a.jpg",
    (async () => [{ address: "93.184.216.34", family: 4 }]) as any,
  ));
  await assert.rejects(
    () => assertPublicUrl(
      "https://internal.example/a.jpg",
      (async () => [{ address: "192.168.1.20", family: 4 }]) as any,
    ),
    /refused non-public host/,
  );
});

test("downloadUrl streams a public response and blocks redirects to private hosts", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-url-download-"));
  try {
    const target = join(root, "photo.jpg");
    const lookupFn = async (host: string) => host === "cdn.example.com"
      ? [{ address: "93.184.216.34", family: 4 }]
      : [{ address: "127.0.0.1", family: 4 }];
    const result = await downloadUrl("https://cdn.example.com/photo.jpg", target, {
      lookupFn,
      fetchFn: async () => new Response(Buffer.from("jpeg"), {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": "4" },
      }),
    });
    assert.deepEqual(result, { bytes: 4, mediaType: "image/jpeg" });
    assert.equal(readFileSync(target, "utf8"), "jpeg");

    let calls = 0;
    await assert.rejects(
      downloadUrl("https://cdn.example.com/jump", join(root, "blocked.jpg"), {
        lookupFn,
        fetchFn: async () => {
          calls += 1;
          return new Response(null, {
            status: 302,
            headers: { location: "http://localhost/private.jpg" },
          });
        },
      }),
      /refused non-public host/,
    );
    assert.equal(calls, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("downloadUrl retries transient upstream failures without leaving partial files", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-url-retry-"));
  try {
    const target = join(root, "audio.mp3");
    let attempts = 0;
    const result = await downloadUrl("https://cdn.example.com/audio.mp3", target, {
      retryDelayMs: 0,
      lookupFn: (async () => [{ address: "93.184.216.34", family: 4 }]) as any,
      fetchFn: async () => {
        attempts += 1;
        if (attempts === 1) return new Response(null, { status: 503 });
        return new Response(Buffer.from("mp3"), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
      },
    });
    assert.equal(attempts, 2);
    assert.deepEqual(result, { bytes: 3, mediaType: "audio/mpeg" });
    assert.equal(readFileSync(target, "utf8"), "mp3");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("downloadUrl pins the resolved public address so a later private lookup cannot win", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-url-pin-"));
  try {
    let lookups = 0;
    const seen: unknown[] = [];
    const result = await downloadUrl("https://cdn.example.com/photo.jpg", join(root, "photo.jpg"), {
      lookupFn: (async () => {
        lookups += 1;
        return lookups === 1
          ? [{ address: "93.184.216.34", family: 4 }]
          : [{ address: "127.0.0.1", family: 4 }];
      }) as any,
      fetchFn: async (_url: unknown, init: { lookup: Function }) => {
        const pinned = await new Promise((resolve, reject) => {
          init.lookup("cdn.example.com", { all: true }, (error: Error | null, addresses: unknown) => {
            if (error) reject(error);
            else resolve(addresses);
          });
        });
        seen.push(pinned);
        return new Response(Buffer.from("jpeg"), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      },
    });
    assert.equal(lookups, 1);
    assert.deepEqual(seen, [[{ address: "93.184.216.34", family: 4 }]]);
    assert.deepEqual(result, { bytes: 4, mediaType: "image/jpeg" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("saveDataUrl writes decoded bytes without touching the network", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-data-url-"));
  try {
    const target = join(root, "clip.png");
    const result = await saveDataUrl(
      `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`,
      target,
    );
    assert.deepEqual(result, { bytes: 9, mediaType: "image/png" });
    assert.equal(readFileSync(target, "utf8"), "png-bytes");
    assert.equal(decodeDataUrl("data:text/plain,A+B").bytes.toString(), "A+B");
    assert.throws(
      () => decodeDataUrl("data:image/png;base64,AAAA!"),
      /payload is not valid/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
