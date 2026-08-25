import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  encodeWorkspaceVideo,
  ffmpegEncodeArgv,
  parseFfmpegReport,
  subtitleFilter,
} from "../../packages/plugins/drive-import/host/ffmpeg-run.js";

test("ffmpegEncodeArgv encodes lavfi with libx264 and does not pass devices", () => {
  const args = ffmpegEncodeArgv({
    lavfi: "testsrc2=size=1280x720:rate=30",
    duration: 3,
    absolutePath: "/tmp/out.mp4",
  }, { overwrite: true });
  assert.deepEqual(args.slice(0, 8), [
    "-hide_banner",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1280x720:rate=30",
    "-t",
    "3",
  ]);
  assert.ok(args.includes("libx264"));
  assert.equal(args[args.indexOf("-pix_fmt") + 1], "yuv420p");
  assert.ok(args.includes("+faststart"));
  assert.equal(args.includes("-hwaccel"), false);
  assert.equal(args.includes("-vaapi_device"), false);
  assert.equal(args.at(-1), "/tmp/out.mp4");
});

test("ffmpegEncodeArgv burns subtitles as a software filter", () => {
  const args = ffmpegEncodeArgv({
    inputAbsolute: "/data/workspace/input clip.mp4",
    subtitlesAbsolute: "/data/workspace/sub/captions:zh,final.srt",
    duration: null,
    absolutePath: "/data/workspace/outputs/subtitled.mp4",
  }, { overwrite: true });
  assert.equal(
    args[args.indexOf("-vf") + 1],
    `pad=ceil(iw/2)*2:ceil(ih/2)*2,${subtitleFilter("/data/workspace/sub/captions:zh,final.srt")}`,
  );
  assert.ok(args.includes("libx264"));
  assert.equal(args.includes("-hwaccel"), false);
});

test("parseFfmpegReport reads the last speed and the encoder from the log", () => {
  const report = parseFfmpegReport(
    "[libx264 @ 0x1] Opening\nframe=  1 speed=0.10x\nframe= 90 fps=85 q=-0.0 Lsize=123kB speed=2.83x\n",
  );
  assert.equal(report.encoder, "libx264");
  assert.equal(report.speed, "2.83x");
});

test("encodeWorkspaceVideo reports libx264 speed from a successful run", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-ffmpeg-run-"));
  try {
    const out = join(root, "out.mp4");
    const result = await encodeWorkspaceVideo({
      lavfi: "testsrc2=size=64x64:rate=1",
      duration: 1,
      absolutePath: out,
      overwrite: true,
    }, {
      spawnFn: () => {
        const child = new EventEmitter() as EventEmitter & {
          stderr: EventEmitter;
          stdout: EventEmitter;
        };
        child.stderr = new EventEmitter();
        child.stdout = new EventEmitter();
        writeFileSync(out, "ok");
        queueMicrotask(() => {
          child.stderr.emit("data", Buffer.from("[libx264 @ 0x1] encoder\nframe= 1 speed=1.20x\n"));
          child.emit("close", 0);
        });
        return child;
      },
    });
    assert.equal(result.encoder, "libx264");
    assert.equal(result.speed, "1.20x");
    assert.equal(result.bytes, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("encodeWorkspaceVideo refuses an existing file when overwrite is false", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-ffmpeg-ow-"));
  try {
    const out = join(root, "out.mp4");
    writeFileSync(out, "existing");
    await assert.rejects(
      () => encodeWorkspaceVideo({
        lavfi: "testsrc2=size=16x16:rate=1",
        duration: 1,
        absolutePath: out,
        overwrite: false,
      }, {
        spawnFn: () => {
          throw new Error("ffmpeg must not run");
        },
      }),
      /already exists/,
    );
    assert.equal(readFileSync(out, "utf8"), "existing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("encodeWorkspaceVideo treats ffmpeg -n exit 0 as failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-ffmpeg-n-"));
  try {
    const out = join(root, "out.mp4");
    await assert.rejects(
      () => encodeWorkspaceVideo({
        lavfi: "testsrc2=size=16x16:rate=1",
        duration: 1,
        absolutePath: out,
        overwrite: true,
      }, {
        spawnFn: () => {
          const child = new EventEmitter() as EventEmitter & {
            stderr: EventEmitter;
            stdout: EventEmitter;
          };
          child.stderr = new EventEmitter();
          child.stdout = new EventEmitter();
          queueMicrotask(() => {
            child.stderr.emit(
              "data",
              Buffer.from("File '/tmp/out.mp4' already exists. Exiting.\nError opening output file /tmp/out.mp4.\n"),
            );
            child.emit("close", 0);
          });
          return child;
        },
      }),
      /already exists/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
