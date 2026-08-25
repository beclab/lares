import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cpuHw,
  ffmpegHwCandidates,
  nvencHw,
  vaapiHw,
} from "../../packages/plugins/drive-import/host/ffmpeg-hw.js";
import {
  encodeWorkspaceVideo,
  ffmpegEncodeArgv,
  parseFfmpegReport,
} from "../../packages/plugins/drive-import/host/ffmpeg-run.js";

test("ffmpegHwCandidates follows devices and always ends on CPU", () => {
  const both = ffmpegHwCandidates({
    nvidiaDevice: true,
    vaapiDevice: "/dev/dri/renderD128",
    nvidiaVisible: "",
    cudaLibrary: true,
  });
  assert.deepEqual(both.map((hw) => hw.kind), ["nvenc", "vaapi", "cpu"]);
  assert.ok(both[0].encodeArgv.includes("h264_nvenc"));
  assert.ok(both[1].globalArgv.includes("/dev/dri/renderD128"));
  const nvidiaWithoutCuda = ffmpegHwCandidates({
    nvidiaDevice: true,
    vaapiDevice: "/dev/dri/renderD128",
    nvidiaVisible: "",
    cudaLibrary: false,
  });
  assert.deepEqual(nvidiaWithoutCuda.map((hw) => hw.kind), ["vaapi", "cpu"]);
  const none = ffmpegHwCandidates({
    nvidiaDevice: false,
    vaapiDevice: null,
    nvidiaVisible: "none",
    cudaLibrary: true,
  });
  assert.deepEqual(none.map((hw) => hw.kind), ["cpu"]);
  assert.deepEqual(cpuHw().encodeArgv.slice(0, 2), ["-c:v", "libx264"]);
});

test("ffmpegEncodeArgv puts VAAPI device before lavfi and does not probe", () => {
  const args = ffmpegEncodeArgv({
    lavfi: "testsrc2=size=1280x720:rate=30",
    duration: 3,
    absolutePath: "/tmp/gpu_final_probe.mp4",
  }, vaapiHw("/dev/dri/renderD128"), { overwrite: true });
  assert.deepEqual(args.slice(0, 8), [
    "-hide_banner",
    "-y",
    "-vaapi_device",
    "/dev/dri/renderD128",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1280x720:rate=30",
  ]);
  assert.ok(args.includes("h264_vaapi"));
  assert.equal(args.at(-1), "/tmp/gpu_final_probe.mp4");
});

test("ffmpegEncodeArgv keeps NVENC hwaccel before a file input", () => {
  const args = ffmpegEncodeArgv({
    inputAbsolute: "/data/workspace/clip.webm",
    duration: null,
    absolutePath: "/data/workspace/outputs/clip.mp4",
  }, nvencHw(), { overwrite: true });
  const inputAt = args.indexOf("-i");
  assert.ok(args.slice(0, inputAt).includes("cuda"));
  assert.equal(args[inputAt + 1], "/data/workspace/clip.webm");
  assert.ok(args.slice(inputAt).includes("h264_nvenc"));
});

test("parseFfmpegReport reads the last speed and the encoder from the log", () => {
  const report = parseFfmpegReport(
    "[h264_vaapi @ 0x1] Opening\nframe=  1 speed=0.10x\nframe= 90 fps=85 q=-0.0 Lsize=123kB speed=2.83x\n",
    "libx264",
  );
  assert.equal(report.encoder, "h264_vaapi");
  assert.equal(report.speed, "2.83x");
});

test("encodeWorkspaceVideo retries the next encoder without a probe process", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-ffmpeg-run-"));
  try {
    const out = join(root, "out.mp4");
    let calls = 0;
    const fakeChild = (exit: { code?: number; stderr?: string }) => {
      const child = new EventEmitter() as EventEmitter & {
        stderr: EventEmitter;
        stdout: EventEmitter;
      };
      child.stderr = new EventEmitter();
      child.stdout = new EventEmitter();
      queueMicrotask(() => {
        if (exit.stderr) child.stderr.emit("data", Buffer.from(exit.stderr));
        child.emit("close", exit.code ?? 0);
      });
      return child;
    };
    const result = await encodeWorkspaceVideo({
      lavfi: "testsrc2=size=64x64:rate=1",
      duration: 1,
      absolutePath: out,
      overwrite: true,
    }, {
      candidates: [vaapiHw(), cpuHw()],
      spawnFn: (_bin: string, args: string[]) => {
        calls += 1;
        if (args.includes("h264_vaapi")) return fakeChild({ code: 1, stderr: "vaapi fail" });
        writeFileSync(out, "ok");
        return fakeChild({
          code: 0,
          stderr: "[libx264 @ 0x1] encoder\nframe= 1 speed=1.20x\n",
        });
      },
    });
    assert.equal(calls, 2);
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
        candidates: [cpuHw()],
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
        candidates: [cpuHw()],
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
